// The only module that talks to the backend. Everything else calls these functions, never fetch().
import type {
  DetailByPlural, EntityMap, EntityType, Graph, ItemByPlural, List, PlacesMap, Plural,
  PresenceMap, RelationshipType, SearchHit, SitesMap,
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

export const PLURAL: Record<EntityType, Plural> = {
  artist: 'artists', artwork: 'artworks', place: 'places',
  movement: 'movements', institution: 'institutions', person: 'people', polity: 'polities', term: 'glossary', source: 'bibliography',
};

export interface ListParams extends Params {
  q?: string; from?: number; to?: number; limit?: number; offset?: number;
}

export const getHealth = () => get<{ status: string; db: string }>('/health');

export const listEntities = <P extends Plural>(plural: P, params: ListParams = {}) =>
  get<List<ItemByPlural[P]>>(`/${plural}`, params);

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

/** Institutions and immovable artworks with an exact location of their own (a museum layer). */
export const getSites = () => get<SitesMap>('/map/sites');

export const getGraph = (plural: Plural, slug: string, depth = 1, types?: string[]) =>
  get<Graph>(`/graph/${plural}/${encodeURIComponent(slug)}`, { depth, types: types?.join(',') });
