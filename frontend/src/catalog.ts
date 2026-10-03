// Search and sort for lists of entries (explore pickers and list pages share it).
// Each entry gets a folded search text and, per sort option, a value plus a section heading.
import { countryName, countryText, polityText, spanLabel } from './html';
import type { Country, DateRange, ItemByPlural, Plural, PolityLink } from './types';

export interface SortValue {
  value: string | number | null; // null sorts last
  heading: string; // section heading in the sorted list ("G", "19th century", "Netherlands")
}

export interface Entry<T = unknown> {
  slug: string;
  name: string;
  meta: string; // shown small next to the name
  search: string; // folded text the search matches against
  sorts: Record<string, SortValue>;
  item: T;
}

export interface SortOption {
  id: string;
  label: string;
}

/** Lowercase without accents: "Dürer" → "durer", "Shin-Ōhashi" → "shin-ohashi". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Every word of the query must appear somewhere in the entry. */
export function matches(entry: Entry, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.every((w) => entry.search.includes(w));
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

type Builder<P extends Plural> = (item: ItemByPlural[P]) => Omit<Entry<ItemByPlural[P]>, 'item' | 'search'> & { extra?: string[] };

interface TypeCatalog<P extends Plural> {
  sorts: SortOption[];
  build: Builder<P>;
}

// Today's country (from the entry's place) and the polities it is linked to, for search and sort.
const located = (e: { country: Country | null; polities: PolityLink[] }, rel: PolityLink['relationship']) => {
  const links = e.polities.filter((p) => p.relationship === rel);
  return {
    // the earliest link decides the sort position (polities come in time order)
    polity: links.length ? { value: fold(links[0].name), heading: links[0].name } : { value: null, heading: 'Not recorded' },
    country: byText(countryText(e.country), 'Country unknown'),
    words: [countryText(e.country) ?? '', ...links.map((p) => polityText(p, e.country))],
  };
};

const CATALOG: { [P in Plural]: TypeCatalog<P> } = {
  artists: {
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
        extra: [a.sort_name ?? '', a.birth_place?.name ?? '', ...l.words],
        sorts: { name: byName(a.sort_name ?? a.name), born: byYear(a.birth), died: byYear(a.death, 'to'), country: l.country, nationality: l.polity },
      };
    },
  },
  artworks: {
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
        extra: [a.kind ?? '', ...l.words],
        sorts: {
          title: byName(titleKey(a.title)), date: byYear(a.created), artist: byText(a.creator?.name, 'Artist unknown'),
          kind: byText(a.kind, 'Other'), country: l.country, polity: l.polity,
        },
      };
    },
  },
  movements: {
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Start year' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (m) => ({
      slug: m.slug, name: m.name, meta: m.period?.label ?? '', extra: [m.kind ?? ''],
      sorts: { name: byName(m.name), start: byYear(m.period), kind: byText(m.kind, 'Other') },
    }),
  },
  patrons: {
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Active from' },
      { id: 'kind', label: 'Kind' },
      { id: 'country', label: 'Country of birth (today)' },
      { id: 'nationality', label: 'Nationality' },
    ],
    build: (p) => {
      const l = located(p, 'nationality');
      return {
        slug: p.slug, name: p.name, meta: p.active?.label ?? '', extra: [p.kind ?? '', p.birth_place?.name ?? '', ...l.words],
        sorts: { name: byName(p.name), start: byYear(p.active), kind: byText(p.kind, 'Other'), country: l.country, nationality: l.polity },
      };
    },
  },
  places: {
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'country', label: 'Country' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (p) => ({
      slug: p.slug, name: p.name, meta: [p.kind, countryName(p.country_code)].filter(Boolean).join(' · '),
      sorts: { name: byName(p.name), country: byText(countryName(p.country_code), 'Country unknown'), kind: byText(p.kind, 'Other') },
    }),
  },
  institutions: {
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
        extra: l.words,
        sorts: { name: byName(i.name), founded: byYear(i.founded), kind: byText(i.kind, 'Other'), country: l.country },
      };
    },
  },
  polities: {
    sorts: [
      { id: 'name', label: 'Name A–Z' },
      { id: 'start', label: 'Start year' },
      { id: 'kind', label: 'Kind' },
    ],
    build: (p) => {
      const today = p.country_codes.map((c) => countryName(c) ?? c);
      return {
        slug: p.slug, name: p.name, meta: [p.period?.label, p.kind].filter(Boolean).join(' · '),
        extra: today,
        sorts: { name: byName(p.name), start: byYear(p.period), kind: byText(p.kind, 'Other') },
      };
    },
  },
};

export function entries<P extends Plural>(plural: P, items: ItemByPlural[P][]): Entry<ItemByPlural[P]>[] {
  const cat = CATALOG[plural] as unknown as TypeCatalog<P>;
  return items.map((item) => {
    const { extra = [], ...e } = cat.build(item);
    return { ...e, item, search: fold([e.name, e.meta, ...extra].join(' ')) };
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
