// Search and sort for lists of entries (explore pickers, list pages and the header search share it).
// Each entry has a name and a meta line that are shown, labelled fields that are searchable but not shown
// (type, birthplace, nationality …), and per sort option a value plus a section heading.
import { countryName, countryText, html, personDates, polityText, ROLE_LABEL, spanLabel, type Html } from './html';
import type { Country, DateRange, EntityType, ItemByPlural, NameEntry, Plural, PolityLink } from './types';

export interface SortValue {
  value: string | number | null; // null sorts last
  heading: string; // section heading in the sorted list ("G", "19th century", "Netherlands")
}

/** Searchable text that isn't on screen; shown as the reason when the search matched it ("Type: woodblock print"). */
export interface Field {
  label: string;
  text: string;
  /** What the search matches for this field when it is more than `text` (readings, romanized kana). */
  match?: string;
}

export interface Entry<T = unknown> {
  type: EntityType;
  slug: string;
  name: string;
  lang: string | null; // language of the name, for lang="…"
  meta: string; // shown small next to the name
  fields: Field[];
  search: string; // folded text of name, meta and fields
  sorts: Record<string, SortValue>;
  item: T;
}

export interface SortOption {
  id: string;
  label: string;
}

/** Lowercase without accents: "Dürer" → "durer", "Shin-Ōhashi" → "shin-ohashi". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const queryWords = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/** Every word of the query must appear somewhere in the entry. */
export function matches(entry: Entry, query: string) {
  return queryWords(query).every((w) => entry.search.includes(w));
}

// ---- why an entry matched ------------------------------------------------------------------------

/** `text` with every occurrence of the (folded) words wrapped in <mark>, accent-insensitive. */
export function highlight(text: string, words: string[]): Html {
  if (!words.length || !text) return html`${text}`;
  // fold character by character, remembering where each folded character came from
  let folded = '';
  const origin: number[] = [];
  [...text].reduce((pos, ch) => {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) origin.push(pos);
    folded += f;
    return pos + ch.length;
  }, 0);
  const ranges: [number, number][] = [];
  for (const w of words) {
    for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + w.length)) {
      const start = origin[i];
      const last = origin[i + w.length - 1];
      ranges.push([start, last + (text.codePointAt(last)! > 0xffff ? 2 : 1)]);
    }
  }
  if (!ranges.length) return html`${text}`;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([...r]);
  }
  let pos = 0;
  const parts: Html[] = [];
  for (const [a, b] of merged) {
    parts.push(html`${text.slice(pos, a)}<mark>${text.slice(a, b)}</mark>`);
    pos = b;
  }
  parts.push(html`${text.slice(pos)}`);
  return html`${parts}`;
}

export interface Match {
  name: Html;
  meta: Html;
  /** The hidden fields that explain the match, highlighted; empty when name or meta already show it. */
  why: Html | null;
  /** For ranking across types: 3 = the name starts with the query, 2 = name contains it, 1 = elsewhere. */
  score: number;
}

/** `shown`: other text already on screen for this entry (a list card shows more than name + meta). */
export function explain(entry: Entry, query: string, shown = ''): Match {
  const words = queryWords(query);
  const visible = fold(`${entry.name} ${entry.meta} ${shown}`);
  const hidden = words.filter((w) => !visible.includes(w));
  const reasons = entry.fields.filter((f) => hidden.some((w) => fold(f.match ?? f.text).includes(w)));
  const name = fold(entry.name);
  const q = words.join(' ');
  return {
    name: highlight(entry.name, words),
    meta: highlight(entry.meta, words),
    why: reasons.length
      ? html`${reasons.map((f, i) => html`${i ? ' · ' : ''}${f.label}: ${highlight(f.text, words)}`)}`
      : null,
    score: name.startsWith(q) ? 3 : words.every((w) => name.includes(w)) ? 2 : 1,
  };
}

// ---- headings ------------------------------------------------------------------------------------

const letter = (s: string) => {
  const c = fold(s).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** 1853 → "19th century", -500 → "5th century BCE". */
export function century(year: number | null | undefined) {
  if (year === null || year === undefined) return 'Date unknown';
  return year > 0 ? `${ordinal(Math.floor((year - 1) / 100) + 1)} century` : `${ordinal(Math.floor(-year / 100) + 1)} century BCE`;
}

/** Titles sort without a leading article: "The Starry Night" under S. */
const titleKey = (t: string) => t.replace(/^(the|a|an)\s+/i, '');

// ---- sort values -----------------------------------------------------------------------------

const byName = (key: string): SortValue => ({ value: fold(key), heading: letter(key) });
const byYear = (d: DateRange | null | undefined, edge: 'from' | 'to' = 'from'): SortValue => {
  const y = edge === 'from' ? d?.from_year ?? d?.to_year : d?.to_year ?? d?.from_year;
  return { value: y ?? null, heading: century(y) };
};
const byText = (v: string | null | undefined, unknown: string): SortValue =>
  v ? { value: fold(v), heading: v } : { value: null, heading: unknown };

// ---- per type --------------------------------------------------------------------------------

/** Fields without text are dropped, so builders can list them unconditionally. */
const fields = (...list: [string, string | null | undefined | false][]): Field[] =>
  list.filter(([, t]) => t).map(([label, text]) => ({ label, text: text as string }));

type Built<T> = Omit<Entry<T>, 'item' | 'search' | 'type' | 'lang'>;

interface TypeCatalog<P extends Plural> {
  type: EntityType;
  sorts: SortOption[];
  build: (item: ItemByPlural[P]) => Built<ItemByPlural[P]>;
}

// Today's country (from the entry's place) and the polities it is linked to, for search and sort.
const located = (e: { country: Country | null; polities: PolityLink[] }, rel: PolityLink['relationship']) => {
  const links = e.polities.filter((p) => p.relationship === rel);
  return {
    // the earliest link decides the sort position (polities come in time order)
    polity: links.length ? { value: fold(links[0].name), heading: links[0].name } : { value: null, heading: 'Not recorded' },
    country: byText(countryText(e.country), 'Country unknown'),
    polities: links.map((p) => polityText(p, e.country)).join(', '),
  };
};

const CATALOG: { [P in Plural]: TypeCatalog<P> } = {
  artists: {
    type: 'artist',
    sorts: [
      { id: 'name', label: 'Name (surname) A–Z' },
      { id: 'born', label: 'Birth year' },
      { id: 'died', label: 'Death year' },
      { id: 'country', label: 'Country of birth (today)' },
      { id: 'nationality', label: 'Nationality' },
    ],
    build: (a) => {
      const l = located(a, 'nationality');
      return {
        slug: a.slug, name: a.name, meta: spanLabel(a.birth, a.death).replace(' – ', '–'),
        fields: fields(
          ['Filed as', a.sort_name !== a.name && a.sort_name],
          ['Born in', [a.birth_place?.name, countryText(a.country)].filter(Boolean).join(', ')],
          ['Nationality', l.polities],
        ),
        sorts: { name: byName(a.sort_name ?? a.name), born: byYear(a.birth), died: byYear(a.death, 'to'), country: l.country, nationality: l.polity },
      };
    },
  },
  artworks: {
    type: 'artwork',
    sorts: [
      { id: 'title', label: 'Title A–Z' },
      { id: 'date', label: 'Date' },
      { id: 'artist', label: 'Artist' },
      { id: 'kind', label: 'Type' },
      { id: 'country', label: 'Country of origin (today)' },
      { id: 'polity', label: 'Made in (state, dynasty…)' },
    ],
    build: (a) => {
      const l = located(a, 'created_in_polity');
      return {
        slug: a.slug, name: a.title, meta: [a.creator?.name, a.created?.label].filter(Boolean).join(', '),
        fields: fields(
          ['Type', a.kind],
          ['Made in', [a.country?.place?.name, countryText(a.country)].filter(Boolean).join(', ')],
          ['State', l.polities],
        ),
        sorts: {
          title: byName(titleKey(a.title)), date: byYear(a.created), artist: byText(a.creator?.name, 'Artist unknown'),
          kind: byText(a.kind, 'Other'), country: l.country, polity: l.polity,
        },
      };
    },
  },
  movements: {
    type: 'movement',
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Start year' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (m) => ({
      slug: m.slug, name: m.name, meta: m.period?.label ?? '', fields: fields(['Kind', m.kind]),
      sorts: { name: byName(m.name), start: byYear(m.period), kind: byText(m.kind, 'Other') },
    }),
  },
  people: {
    type: 'person',
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Birth year (or active from)' },
      { id: 'kind', label: 'Kind' },
      { id: 'occupation', label: 'Occupation' },
      { id: 'role', label: 'Role (patron, owner, depicted)' },
      { id: 'country', label: 'Country of birth (today)' },
      { id: 'nationality', label: 'Nationality' },
    ],
    build: (p) => {
      const l = located(p, 'nationality');
      return {
        slug: p.slug, name: p.name, meta: personDates(p).replace(' – ', '–'),
        fields: fields(
          ['Kind', p.kind],
          ['Occupations', p.occupations.join(', ')],
          ['Roles', p.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')],
          ['Born in', [p.birth_place?.name, countryText(p.country)].filter(Boolean).join(', ')],
          ['Nationality', l.polities],
        ),
        sorts: {
          name: byName(p.name), start: byYear(p.birth ?? p.active), kind: byText(p.kind, 'Other'),
          occupation: byText(p.occupations[0], 'Occupation unknown'), role: byText(p.roles[0] ? ROLE_LABEL[p.roles[0]] ?? p.roles[0] : null, 'No role recorded'),
          country: l.country, nationality: l.polity,
        },
      };
    },
  },
  places: {
    type: 'place',
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'country', label: 'Country' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (p) => ({
      slug: p.slug, name: p.name, meta: [p.kind, countryName(p.country_code)].filter(Boolean).join(' · '), fields: [],
      sorts: { name: byName(p.name), country: byText(countryName(p.country_code), 'Country unknown'), kind: byText(p.kind, 'Other') },
    }),
  },
  institutions: {
    type: 'institution',
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'founded', label: 'Founding year' },
      { id: 'kind', label: 'Kind' },
      { id: 'country', label: 'Country' },
    ],
    build: (i) => {
      const l = located(i, 'located_in_polity');
      return {
        slug: i.slug, name: i.name, meta: [i.kind, i.founded ? `founded ${i.founded.label}` : ''].filter(Boolean).join(' · '),
        fields: fields(
          ['Location', [i.country?.place?.name, countryText(i.country)].filter(Boolean).join(', ')],
          ['Historically in', l.polities],
        ),
        sorts: { name: byName(i.name), founded: byYear(i.founded), kind: byText(i.kind, 'Other'), country: l.country },
      };
    },
  },
  glossary: {
    type: 'term',
    sorts: [
      { id: 'name', label: 'A–Z' },
      { id: 'category', label: 'Category' },
    ],
    build: (t) => ({
      slug: t.slug, name: t.name, meta: t.category,
      fields: fields(['Definition', t.definition]),
      sorts: { name: byName(t.name), category: byText(t.category, 'Other') },
    }),
  },
  polities: {
    type: 'polity',
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Start year' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (p) => ({
      slug: p.slug, name: p.name, meta: [p.period?.label, p.kind].filter(Boolean).join(' · '),
      fields: fields(['Territory today', p.country_codes.map((c) => countryName(c) ?? c).join(', ')]),
      sorts: { name: byName(p.name), start: byYear(p.period), kind: byText(p.kind, 'Other') },
    }),
  },
};

export function entries<P extends Plural>(plural: P, items: ItemByPlural[P][]): Entry<ItemByPlural[P]>[] {
  const cat = CATALOG[plural] as unknown as TypeCatalog<P>;
  return items.map((item) => {
    const e = cat.build(item);
    const named = item as { names?: NameEntry[]; search_text?: string | null; sort_key?: string; sort_name?: string | null; name_lang?: string | null; title_lang?: string | null; name_reading?: string | null; title_reading?: string | null };
    // other names (original, translations …), their readings and the API's search_text (kana in Latin letters …):
    // all searchable, shown as the reason when the match came from them ("Other names: 神奈川沖浪裏")
    const names = named.names ?? [];
    if (names.length || named.search_text) {
      e.fields.push({
        label: 'Other names', text: names.map((n) => n.text).join(' · ') || e.name,
        match: [...names.flatMap((n) => [n.text, n.reading ?? '']), named.name_reading ?? named.title_reading ?? '', named.search_text ?? ''].join(' '),
      });
    }
    // sort by the API's sort_key (the romanization for names in other scripts); artists keep sort_name first
    const first = cat.sorts[0].id;
    if (named.sort_key && !(plural === 'artists' && named.sort_name)) {
      e.sorts[first] = byName(plural === 'artworks' ? titleKey(named.sort_key) : named.sort_key);
    }
    const lang = named.title_lang ?? named.name_lang ?? null;
    return { ...e, lang, type: cat.type, item, search: fold([e.name, e.meta, ...e.fields.map((x) => x.match ?? x.text)].join(' ')) };
  });
}

/** Sort options that have data: an option where every entry is "unknown" isn't offered. */
export function sortOptions(plural: Plural, list: Entry[]): SortOption[] {
  const all = CATALOG[plural].sorts;
  return all.filter((o, i) => i === 0 || list.some((e) => e.sorts[o.id]?.value !== null));
}

export function sortEntries<T extends Entry>(list: T[], sortId: string): T[] {
  const cmp = (a: SortValue | undefined, b: SortValue | undefined) => {
    const x = a?.value ?? null;
    const y = b?.value ?? null;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
  };
  // within a section (same country, same century…) fall back to the name order (the first sort option)
  return [...list].sort((a, b) => {
    const byName = Object.keys(a.sorts)[0];
    return cmp(a.sorts[sortId], b.sorts[sortId]) || cmp(a.sorts[byName], b.sorts[byName]) || a.name.localeCompare(b.name, 'en', { numeric: true });
  });
}

// ---- remembered choice (per type, shared by picker and list page) ---------------------------------

const key = (plural: Plural) => `arthistory:sort:${plural}`;

export function savedSort(plural: Plural, options: SortOption[]) {
  try {
    const id = localStorage.getItem(key(plural));
    if (id && options.some((o) => o.id === id)) return id;
  } catch {
    /* no storage */
  }
  return options[0].id;
}

export function saveSort(plural: Plural, id: string) {
  try {
    localStorage.setItem(key(plural), id);
  } catch {
    /* no storage */
  }
}
