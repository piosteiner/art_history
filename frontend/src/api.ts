// The only module that talks to the backend. Everything else calls these functions, never fetch().
import type {
  AsOfDetail, DetailByPlural, EntryHint, EntityMap, EntityType, FeaturedView, Graph, History, NetworkHands, NetworkPath, ProvenanceNumberHit,
  ItemByPlural, List, PlacesMap, Plural, SharedHands, TextHit,
  EventsMap, PresenceMap, RelationshipType, SearchHit, SitesMap,
} from './types';

// In development the Vite server proxies /v1 (the API only allows CORS from the production origin).
const BASE = import.meta.env.DEV ? '/v1' : 'https://api.arthistory.piogino.ch/v1';

export class ApiError extends Error {
  /** `body`: the whole answer, for errors that say more (089: a 404 names `first_recorded`). */
  constructor(public status: number, public code: string, message: string, public body: Record<string, unknown> | null = null) {
    super(message);
  }
}

type Params = Record<string, string | number | undefined | null>;

// Responses are kept for 5 minutes: back/forward and returning to a list stay instant, and a tab left open for
// hours still sees new entries (kept for the page's whole lifetime, a list could miss everything added since).
const KEEP_MS = 5 * 60 * 1000;
const cache = new Map<string, Promise<unknown>>();
const fetchedAt = new Map<string, number>();

// Public numbers (API 085): every reference that names its type ({type, slug, public_id}) — relationships, provenance
// owners, backlinks, search results, previews — and every list row (typed by its list) is remembered here, so `href()`
// can build the canonical address /<plural>/<number>/<slug> wherever the number is known, without each caller
// passing it. An entry whose number we haven't seen yet keeps its slug address, which still works (and redirects).
const publicIds = new Map<string, number>(); // "artworks/irene-cahen-danvers-la-petite-irene" → 100476

/** The public number of an entry, when a response has named it. */
export const publicIdOf = (plural: Plural, slug: string) => publicIds.get(`${plural}/${slug}`);

function remember(v: unknown, listOf?: Plural, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return;
  if (Array.isArray(v)) {
    for (const x of v) remember(x, listOf, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.public_id === 'number' && typeof o.slug === 'string') {
    const plural = typeof o.type === 'string' ? PLURAL[o.type as EntityType] : listOf;
    if (plural) publicIds.set(`${plural}/${o.slug}`, o.public_id);
  }
  // only a list's own rows are typed by the list; references inside them carry their own type
  for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') remember(x, depth === 0 && k === 'data' ? listOf : undefined, depth + 1);
}

/** The plural a list path is of ("/artworks" → artworks), so its untyped rows can be remembered. */
const listPlural = (path: string) => {
  const m = /^\/([a-z]+)$/.exec(path);
  return m && (Object.values(PLURAL) as string[]).includes(m[1]) ? (m[1] as Plural) : undefined;
};

function get<T>(path: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;
  if (Date.now() - (fetchedAt.get(url) ?? 0) > KEEP_MS) cache.delete(url);
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    fetchedAt.set(url, Date.now());
    p = fetch(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText, body);
      remember(body, listPlural(path));
      return body as T;
    });
    p.catch(() => cache.delete(url)); // keep successes only
    cache.set(url, p);
  }
  return p;
}

/** Short addresses for long selections (API migration 072): stores the query, returns its code (same query, same
 *  code). Sent as text/plain — a "simple" request, no CORS preflight. */
const savedViews = new Map<string, Promise<string>>();
export function saveView(query: string): Promise<string> {
  let p = savedViews.get(query);
  if (!p) {
    p = fetch(`${BASE}/views`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: query }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText, body);
      return (body as { id: string }).id;
    });
    p.catch(() => savedViews.delete(query));
    savedViews.set(query, p);
  }
  return p;
}
/** The query behind a short address (renamed entries followed). */
export const getView = (id: string) => get<{ id: string; query: string }>(`/views/${encodeURIComponent(id)}`);

export const PLURAL: Record<EntityType, Plural> = {
  artist: 'artists', artwork: 'artworks', place: 'places',
  movement: 'movements', institution: 'institutions', person: 'people', polity: 'polities', event: 'events', term: 'glossary', source: 'bibliography',
};

export interface ListParams extends Params {
  q?: string; from?: number; to?: number; limit?: number; offset?: number;
}

export const getHealth = () => get<{ status: string; db: string }>('/health');

export const listEntities = <P extends Plural>(plural: P, params: ListParams = {}) =>
  get<List<ItemByPlural[P]>>(`/${plural}`, params);

const PAGE = 500; // the API's largest `limit`

/**
 * Every entry of a type: the first page of 500 and, when `total` says there are more, the rest in parallel.
 * Pickers, list pages and the header search sort and filter in the browser, so they need the whole list
 * (backend wish: server-side sort and search with paging, see README).
 */
export const listAll = async <P extends Plural>(plural: P): Promise<List<ItemByPlural[P]>> => {
  const first = await listEntities(plural, { limit: PAGE });
  if (first.total <= first.data.length) return first;
  const offsets: number[] = [];
  for (let o = first.data.length; o < first.total; o += PAGE) offsets.push(o); // after what came back
  const rest = await Promise.all(offsets.map((offset) => listEntities(plural, { limit: PAGE, offset })));
  return { ...first, data: [...first.data, ...rest.flatMap((r) => r.data)], limit: first.total };
};

/** An entry by its slug or its public number (API 085; a number under another type answers with that type's entry). */
export const getEntity = <P extends Plural>(plural: P, slugOrNumber: string) =>
  get<DetailByPlural[P]>(`/${plural}/${encodeURIComponent(slugOrNumber)}`);

export const search = (q: string) => get<{ data: SearchHit[] }>('/search', { q }).then((r) => r.data);

export const getVocabulary = () => get<{ data: RelationshipType[] }>('/vocabulary').then((r) => r.data);

/** One entity's places: presence/association points plus a `route` LineString. Not available for places. */
export const getEntityMap = (plural: Exclude<Plural, 'places'>, slug: string) =>
  get<EntityMap>(`/map/${plural}/${encodeURIComponent(slug)}`);

/** Who or what was physically where between the years `from` and `to`. */
export const getPresence = (from: number, to: number, types?: EntityType[]) =>
  get<PresenceMap>('/map/presence', { from, to, types: types?.join(',') });

export const getPlacesMap = (from?: number, to?: number) => get<PlacesMap>('/map/places', { from, to });

/** Every event with a position (area, else exact spot, else its place's marker), for the events layer. */
export const getEventsMap = () => get<EventsMap>('/map/events');

/** The curated start views, in order (published only); edited in the admin panel. */
/** Which artworks' provenance records a number (a lot, ERR, Munich, Linz …): exact matches, any kind or one. */
export const getProvenanceNumbers = (number: string, kind?: string | null) =>
  get<{ data: ProvenanceNumberHit[] }>('/provenance-numbers', kind ? { number, kind } : { number }).then((r) => r.data);
export const getFeatured = () => get<{ data: FeaturedView[] }>('/featured').then((r) => r.data);

/** Institutions and immovable artworks with an exact location of their own (a museum layer). */
export const getSites = () => get<SitesMap>('/map/sites');

export const getGraph = (plural: Plural, slug: string, depth = 1, types?: string[]) =>
  get<Graph>(`/graph/${plural}/${encodeURIComponent(slug)}`, { depth, types: types?.join(',') });

/** Previews of any entries ("artist/paul-gauguin", "term/contrapposto" …; at most 100 per call); missing ones are left out. */
export const getPreviews = (refs: string[]) =>
  get<{ data: Record<string, EntryHint> }>('/previews', { refs: refs.join(',') }).then((r) => r.data);

// ---- full-text search, network questions, versions (API 087–089) ------------------------------------------------

/** Names and texts (087): web-search syntax, stemmed in EN/DE/FR; `type` an entity type ("artwork"). */
export const searchText = (q: string, type: EntityType | null, limit: number, offset: number) =>
  get<{ total: number; data: TextHit[] }>('/search/text', { q, type, limit, offset });

/** The shortest chain between two entries (088): `<number>` or `<plural>/<slug or number>`. */
export const getNetworkPath = (from: string, to: string, via?: string) =>
  get<NetworkPath>('/network/path', { from, to, via });

/** Through whose hands works went in a window (088). */
export const getNetworkHands = (from: number, to: number) => get<NetworkHands>('/network/hands', { from, to });

/** Works that went through the same hands as this one (088); `current`: also hands both are still in. */
export const getSharedHands = (artwork: string, current: boolean) =>
  get<SharedHands>('/network/shared-hands', { artwork, depth: 2, current: current ? 1 : undefined });

/** An entry's versions (089), newest first. */
export const getHistory = (plural: Plural, key: string) => get<History>(`/history/${plural}/${encodeURIComponent(key)}`);

/** The entry as recorded at `asOf` (089) — a date or a moment, passed on exactly as given (microseconds). */
export const getEntityAsOf = (plural: Plural, key: string, asOf: string) =>
  get<AsOfDetail>(`/${plural}/${encodeURIComponent(key)}`, { as_of: asOf });
