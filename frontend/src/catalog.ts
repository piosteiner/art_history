// Search and sort for lists of entries (explore pickers, list pages and the header search share it).
// Each entry has a name and a meta line that are shown, labelled fields that are searchable but not shown
// (type, birthplace, nationality …), and per sort option a value plus a section heading.
import { countryName, countryText, creatorNames, displayName, html, personDates, polityText, ROLE_LABEL, type Html } from './html';
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
  /** Entries found only through this field come after the others, in this rank's section ("Now in the collection"). */
  tier?: { rank: number; heading: string };
  /** On the card anyway (an artwork's artist and date …): a word found here is visible, not a hidden reason (API 110). */
  shown?: boolean;
}

/** A search field as the API sends it with list items (API 110). */
interface ApiSearchField { label: string; text: string; match?: string; shown?: boolean; tier?: { rank: number; heading: string } }

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

/** Lowercase without accents and special letters: "Dürer" → "durer", "Groß" → "gross" (src/fold.ts). */
export { fold } from './fold';
import { fold } from './fold';
import { parseQuery, type ParsedQuery } from './query';
import { wholeKind } from './series';

/** The words a hit must have (src/query.ts: exclusions, "phrases" and connecting words aside). */
export const queryWords = (query: string) => parseQuery(query).words;

/** An artwork's current collection, folded (the field of the first tier, "Now in"); '' when it is in none. */
const collectionOf = (e: Entry) => fold(e.fields.filter((f) => f.tier?.rank === 1).map((f) => f.match ?? f.text).join(' '));

/**
 * Every word of the query appears somewhere in the entry, every quoted phrase as written, and nothing it excludes:
 * "-copy" anywhere; "not in Kunsthaus Zürich" in an artwork's current collection (elsewhere: anywhere) — src/query.ts.
 */
export function matches(entry: Entry, query: string | ParsedQuery) {
  const p = typeof query === 'string' ? parseQuery(query) : query;
  if (!p.words.every((w) => entry.search.includes(w)) || !p.phrases.every((ph) => entry.search.includes(ph))) return false;
  return !p.not.some((n) => {
    const target = n.where === 'collection' && entry.type === 'artwork' ? collectionOf(entry) : entry.search;
    return n.words.every((w) => target.includes(w));
  });
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
/** What the fields the card shows anyway say (API 110: `shown`) — visible like the name. */
const shownFields = (e: Entry) => e.fields.filter((f) => f.shown).map((f) => f.match ?? f.text).join(' ');

export function explain(entry: Entry, query: string, shown = ''): Match {
  const words = queryWords(query);
  const visible = fold(`${entry.name} ${entry.meta} ${shown} ${shownFields(entry)}`);
  const hidden = words.filter((w) => !visible.includes(w));
  const reasons = entry.fields.filter((f) => !f.shown && hidden.some((w) => fold(f.match ?? f.text).includes(w)));
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

/**
 * The hits of a search in the list's sort order, each with its section heading: entries found through a field with a
 * tier (a museum that holds or held them) come after the others, in their tier's order and under its heading — a search
 * for "Prado" lists the works there now, then those that were there.
 */
export function ordered<T>(hits: Entry<T>[], query: string, sort: string): { entry: Entry<T>; heading: string }[] {
  const words = queryWords(query);
  const tierOf = (e: Entry<T>) => {
    const visible = fold(`${e.name} ${e.meta} ${shownFields(e)}`);
    const hidden = words.filter((w) => !visible.includes(w));
    if (!hidden.length) return null;
    const by = e.fields.filter((f) => !f.shown && hidden.some((w) => fold(f.match ?? f.text).includes(w)));
    if (!by.length || by.some((f) => !f.tier)) return null;
    return by.map((f) => f.tier!).sort((a, b) => a.rank - b.rank)[0];
  };
  const sorted = sortEntries(hits, sort).map((entry) => ({ entry, tier: words.length ? tierOf(entry) : null }));
  return [...sorted.filter((x) => !x.tier), ...sorted.filter((x) => x.tier).sort((a, b) => a.tier!.rank - b.tier!.rank)]
    .map(({ entry, tier }) => ({ entry, heading: tier?.heading ?? entry.sorts[sort]?.heading ?? '' }));
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

// ---- sort values -----------------------------------------------------------------------------

const byName = (key: string): SortValue => ({ value: fold(key), heading: letter(key) });
const byYear = (d: DateRange | null | undefined, edge: 'from' | 'to' = 'from'): SortValue => {
  const y = edge === 'from' ? d?.from_year ?? d?.to_year : d?.to_year ?? d?.from_year;
  return { value: y ?? null, heading: century(y) };
};
const byText = (v: string | null | undefined, unknown: string): SortValue =>
  v ? { value: fold(v), heading: v } : { value: null, heading: unknown };

// ---- per type --------------------------------------------------------------------------------

export const STATUS_LABEL: Record<string, string> = { read: 'read', reading: 'reading', to_read: 'to read' };

/** The 1933–1945 provenance categories (Swiss Federal Office of Culture), short — the artworks list's filter. */
export const PROVENANCE_CATEGORY_LABEL: Record<string, string> = {
  A: 'A · clarified', B: 'B · not fully clarified', C: 'C · indications', D: 'D · looted / seized', other: 'Not assessed',
};

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
      { id: 'born', label: 'Birth year (or active from)' },
      { id: 'died', label: 'Death year (or active until)' },
      { id: 'country', label: 'Country of birth (today)' },
      { id: 'nationality', label: 'Nationality' },
    ],
    build: (a) => {
      const l = located(a, 'nationality');
      return {
        slug: a.slug, name: a.name, meta: personDates(a).replace(' – ', '–'),
        fields: [],
        sorts: { name: byName(a.name), born: byYear(a.birth ?? a.active), died: byYear(a.death ?? a.active, 'to'), country: l.country, nationality: l.polity },
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
      { id: 'series', label: 'Series' },
      { id: 'country', label: 'Country of origin (today)' },
      { id: 'polity', label: 'Made in (state, dynasty…)' },
    ],
    build: (a) => {
      const l = located(a, 'created_in_polity');
      return {
        slug: a.slug, name: displayName(a).text,
        meta: [a.is_group || a.parts ? wholeKind(a) : '', [creatorNames(a), a.created?.label].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
        fields: [],
        sorts: {
          // grouped under the series title, in number order (zero-padded so 3 comes before 21)
          // a whole (API 132) heads its own group, before its parts
          series: a.part_of
            ? { value: fold(`${a.part_of.title} ${String(a.part_number ?? '').padStart(6, '0')}`), heading: a.part_of.title }
            : a.is_group || a.parts
              ? { value: fold(`${a.title} ${''.padStart(6, '0')}`), heading: a.title }
              : { value: null, heading: 'Not in a series' },
          title: byName(a.title), date: byYear(a.created), artist: byText(a.creator?.name, 'Artist unknown'),
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
      slug: m.slug, name: m.name, meta: m.period?.label ?? '', fields: [],
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
        fields: [],
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
        slug: i.slug, name: i.name, meta: [i.kind, i.founded ? `founded ${i.founded.label}` : '', i.dissolved ? `closed ${i.dissolved.label}` : ''].filter(Boolean).join(' · '),
        fields: [],
        sorts: { name: byName(i.name), founded: byYear(i.founded), kind: byText(i.kind, 'Other'), country: l.country },
      };
    },
  },
  bibliography: {
    type: 'source',
    sorts: [
      { id: 'siglum', label: 'Short reference A–Z' },
      { id: 'year', label: 'Year' },
      { id: 'status', label: 'Reading status' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (s) => ({
      slug: s.slug, name: s.siglum || s.name, meta: [s.kind, s.year].filter(Boolean).join(' · '),
      fields: [],
      sorts: {
        siglum: byName(s.siglum || s.name), year: { value: Number(String(s.year ?? '').match(/-?\d+/)?.[0] ?? NaN) || null, heading: s.year ? String(s.year) : 'Year unknown' },
        status: byText(STATUS_LABEL[s.reading_status ?? ''] ?? null, 'Not recorded'), kind: byText(s.kind, 'Other'),
      },
    }),
  },
  events: {
    type: 'event',
    sorts: [
      { id: 'date', label: 'Date' },
      { id: 'name', label: 'Name A–Z' },
      { id: 'kind', label: 'Kind' },
      { id: 'country', label: 'Country' },
    ],
    build: (e) => ({
      slug: e.slug, name: e.name, meta: [e.kind, e.period?.label, e.place?.name].filter(Boolean).join(' · '),
      fields: [],
      sorts: { date: byYear(e.period), name: byName(e.name), kind: byText(e.kind, 'Other'), country: byText(countryText(e.country), 'Country unknown') },
    }),
  },
  glossary: {
    type: 'term',
    sorts: [
      { id: 'name', label: 'A–Z' },
      { id: 'category', label: 'Category' },
    ],
    build: (t) => ({
      slug: t.slug, name: t.name, meta: t.category,
      fields: [],
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
      fields: [],
      sorts: { name: byName(p.name), start: byYear(p.period), kind: byText(p.kind, 'Other') },
    }),
  },
};

export function entries<P extends Plural>(plural: P, items: ItemByPlural[P][]): Entry<ItemByPlural[P]>[] {
  const cat = CATALOG[plural] as unknown as TypeCatalog<P>;
  return items.map((item) => {
    const e = cat.build(item);
    // what a search finds besides the name: the API's search_fields (view entry_search_fields, API 110) — the same
    // definition the admin's lists search, so both find the same entries
    e.fields = ((item as { search_fields?: ApiSearchField[] }).search_fields ?? []).map((f) => ({ label: f.label, text: f.text, match: f.match, tier: f.tier, shown: f.shown }));
    const named = item as { names?: NameEntry[]; search_text?: string | null; sort_key?: string; name_lang?: string | null; title_lang?: string | null; name_reading?: string | null; title_reading?: string | null };
    // other names (original, translations …), their readings and the API's search_text (kana in Latin letters …):
    // all searchable, shown as the reason when the match came from them ("Other names: 神奈川沖浪裏")
    const names = named.names ?? [];
    if (names.length || named.search_text) {
      e.fields.push({
        label: 'Other names', text: names.map((n) => n.text).join(' · ') || e.name,
        match: [...names.flatMap((n) => [n.text, n.reading ?? '']), named.name_reading ?? named.title_reading ?? '', named.search_text ?? ''].join(' '),
      });
    }
    // sort by the API's sort_key for every type: "Family, Given" (or sort_name) for artists and people, titles
    // without a leading article in their language ("Starry Night", "Phare de Honfleur"), romanizations of other scripts
    const first = cat.sorts[0].id;
    if (named.sort_key) {
      e.sorts[first] = byName(named.sort_key);
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
