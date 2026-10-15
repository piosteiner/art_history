// The only module that talks to the backend. Everything else calls these functions, never fetch().
import type {
  DetailByPlural, EntryHint, EntityMap, EntityType, FeaturedView, Graph, ProvenanceNumberHit, ItemByPlural, List, PlacesMap, Plural,
  EventsMap, PresenceMap, RelationshipType, SearchHit, SitesMap,
} from './types';

// In development the Vite server proxies /v1 (the API only allows CORS from the production origin).
const BASE = import.meta.env.DEV ? '/v1' : 'https://api.arthistory.piogino.ch/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Params = Record<string, string | number | undefined | null>;

// Responses are cacheable for 60 s anyway; keeping them for the page's lifetime makes back/forward instant.
const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText);
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
      if (!res.ok) throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText);
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

export const getEntity = <P extends Plural>(plural: P, slug: string) =>
  get<DetailByPlural[P]>(`/${plural}/${encodeURIComponent(slug)}`);

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
