// The only module that talks to the backend. Everything else calls these functions, never fetch().
import { fold } from './fold';
import type {
  AsOfDetail, DateRange, DetailByPlural, EntryHint, EntityMap, EntityType, FeaturedView, Graph, History, NetworkHands, NetworkPath, ProvenanceNumberHit,
  ClustersMap, EncounterRow, ItemByPlural, List, PlacesMap, Plural, SharedHands, TextHit,
  EventsMap, PresenceMap, ProvenanceMap, RelationshipType, SearchHit, SitesMap, Periods,
} from './types';

// In development the Vite server proxies /v1 (the API only allows CORS from the production origin).
// VITE_API_BASE: another API for a build of the site (the test environment: api.test.arthistory.piogino.ch)
export const BASE = import.meta.env.DEV ? '/v1' : (import.meta.env.VITE_API_BASE as string | undefined) || 'https://api.arthistory.piogino.ch/v1';

export class ApiError extends Error {
  /** `body`: the whole answer, for errors that say more (089: a 404 names `first_recorded`). */
  constructor(public status: number, public code: string, message: string, public body: Record<string, unknown> | null = null) {
    super(message);
  }
}

type Params = Record<string, string | number | string[] | undefined | null>;

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

// The API's moments away (a deploy reloads it, a busy database answers 503 "try again"): a reading request tries again
// twice, after 1.5 and 4 s, before the page shows an error.
const RETRY_STATUS = new Set([502, 503, 504]);
async function fetchRetry(url: string, init: RequestInit, waits = [1500, 4000]): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (!RETRY_STATUS.has(res.status) || i >= waits.length) return res;
    } catch (err) {
      if (i >= waits.length || (err as Error).name === 'AbortError') throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, waits[i]));
  }
}

function get<T>(path: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));   // repeated: ?not_in=a&not_in=b
    else if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`;
  if (Date.now() - (fetchedAt.get(url) ?? 0) > KEEP_MS) cache.delete(url);
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    fetchedAt.set(url, Date.now());
    p = fetchRetry(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
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
/** Feedback from a visitor (API 141): stored through submit_feedback(); the API can't read it back. */
export interface FeedbackElement { label: string; heading: string; text: string; selector: string }
export interface FeedbackInput { kind: 'bug' | 'idea' | 'content' | 'other'; message: string; page_url: string; page_title: string;
  elements: FeedbackElement[]; email: string; viewport: string; website: string }
export async function sendFeedback(f: FeedbackInput): Promise<void> {
  const res = await fetch(`${BASE}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText, body);
  }
}

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
  movement: 'movements', institution: 'institutions', person: 'people', polity: 'polities', event: 'events', literature: 'literary-works', term: 'glossary', source: 'bibliography',
};

export interface ListParams extends Params {
  q?: string; from?: number; to?: number; limit?: number; offset?: number;
}

export const getHealth = () => get<{ status: string; db: string }>('/health');
/** A text page written in the CMS (API 114), read chapter by chapter (116): its top-level headings. 404 until published. */
export interface PageHeading { level: number; id: string; text: string }
export interface PageChapter { id: string; index: number; title: string; html: string; toc: PageHeading[]; prev: { id: string; title: string } | null; next: { id: string; title: string } | null }
export interface Page {
  slug: string; title: string; lang: string; updated_at: string; words: number; chars: number;
  intro_html: string; chapters: { id: string; title: string; words: number; chars: number }[];
  chapter?: PageChapter;
}
export const getPage = (slug: string, chapter?: string | null) =>
  get<Page>(`/pages/${encodeURIComponent(slug)}`, chapter ? { chapter } : {});
/** A short page in one piece (`?full=1`: `html` = the whole text, its headings not split into chapters). */
export const getWholePage = (slug: string) => get<Page & { html: string }>(`/pages/${encodeURIComponent(slug)}`, { full: '1' });

/** The page searched paragraph by paragraph (API: every word begins a word there; accents and case alike): hits in
 *  document order with their chapter (null: the introduction), the heading above and a passage with <mark>s. */
export interface PageSearchHit { chapter: { id: string; title: string; index: number } | null; heading: { id: string; text: string } | null; passage_html: string; matches: number }
export interface PageSearch { q: string; terms: string[]; total: number; hits: PageSearchHit[] }
export const searchPage = (slug: string, q: string) => get<PageSearch>(`/pages/${encodeURIComponent(slug)}/search`, { q });

/** The project's numbers (API /v1/stats, migration 138): per metric the latest value and one value per day. */
export interface Stats { updated: string | null; metrics: Record<string, { value: number; series: [string, number][] }> }
export const getStats = () => get<Stats>('/stats');
/** The project's vocabulary (GET /v1/stats/vocabulary): every kind of relationship and every provenance option, with how often each is used. */
export interface VocabOption { code: string; label: string; description: string | null; n: number }
export interface ModelVocabulary {
  relationships: { code: string; label: string; inverse_label: string; category: string; symmetric: boolean; presence: boolean; derived: boolean;
    subject_types: string[]; object_types: string[]; description: string | null; n: number }[];
  /** Other names (API 152/153): how a name relates to the main name, what kind of name it is. */
  names?: { roles: VocabOption[]; kinds: VocabOption[] };
  provenance: { methods: VocabOption[]; roles: VocabOption[]; certainty: VocabOption[]; records: VocabOption[]; status: VocabOption[];
    numbers: (VocabOption & { scope: string })[];
    currencies: { code: string; name: string; country: string | null; since: string | null; until: string | null; n: number }[] };
}
export const getModelVocabulary = () => get<ModelVocabulary>('/stats/vocabulary');

/** The public changelog (API 118): entries newest first, each with its bullet points (kind, rendered HTML). */
export type ChangeKind = 'neu' | 'verbessert' | 'behoben' | 'inhalt' | 'technik';
/** `area`/`area_color`: the bullet's topic (API 137) — the roadmap's list and colours. */
export interface ChangelogItem { kind: ChangeKind; label: string; html: string; roadmap: { id: number; title: string } | null; area?: string | null; area_color?: string | null }
export interface ChangelogTopic { name: string; color: string; n: number }
export interface ChangelogEntry { id: number; day: string; title: string | null; items: ChangelogItem[] }
export const getChangelog = (params: { kind?: ChangeKind | null; topic?: string | null; limit?: number; offset?: number } = {}) =>
  get<{ total: number; data: ChangelogEntry[]; topics?: ChangelogTopic[] }>('/changelog', params);
export const CHANGELOG_FEED = `${BASE}/changelog/feed.xml`;
/** The roadmap (API 118): four columns — in Arbeit, als Nächstes, später, erledigt (the last 30). */
export type RoadmapStatus = 'jetzt' | 'naechstes' | 'spaeter' | 'erledigt';
/** `area_color`: the topic's colour key (API 136: blue, teal, purple, pink, red, brown, olive, indigo, cyan, slate). */
export interface RoadmapItem { id: number; title: string; area: string | null; area_color?: string | null; notes_html: string | null; added_on?: string | null; done_on: string | null }
export const getRoadmap = () => get<{ done_days?: number; columns: { status: RoadmapStatus; label: string; items: RoadmapItem[] }[] }>('/roadmap');

export const listEntities = <P extends Plural>(plural: P, params: ListParams = {}) =>
  get<List<ItemByPlural[P]>>(`/${plural}`, params);

const PAGE = 500; // the API's largest `limit`

/**
 * Every entry of a type: the first page of 500 and, when `total` says there are more, the rest in parallel.
 * Pickers, list pages and the header search sort and filter in the browser, so they need the whole list. The API
 * serves the rows stored (migration 127): 3,500 artworks in under a second, ≈ 1 MB compressed. Server-side search
 * with paging is the next step only beyond tens of thousands of entries per type.
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

/** Several artworks' provenance on the map at once ("slug" → the `provenance` of its map; API /v1/map/provenances) —
 *  in requests of 100, so the address stays short. */
export async function getProvenances(slugs: string[]): Promise<Record<string, ProvenanceMap>> {
  const chunks = Array.from({ length: Math.ceil(slugs.length / 100) }, (_, i) => slugs.slice(i * 100, i * 100 + 100));
  const parts = await Promise.all(chunks.map((c) => get<{ data: Record<string, ProvenanceMap> }>('/map/provenances', { artworks: c.join(',') })));
  return Object.assign({}, ...parts.map((p) => p.data));
}

/** Who or what was physically where between the years `from` and `to`. */
export const getPresence = (from: number, to: number, types?: EntityType[]) =>
  get<PresenceMap>('/map/presence', { from, to, types: types?.join(',') });

export const getPlacesMap = (from?: number, to?: number) => get<PlacesMap>('/map/places', { from, to });

/** Every event with a position (area, else exact spot, else its place's marker), for the events layer. */
export const getEventsMap = () => get<EventsMap>('/map/events');

/** The curated start views, in order (published only); edited in the admin panel. */
/** Which artworks' provenance records a number (a lot, ERR, Munich, Linz …): exact matches, any kind or one. */
/** of: "n<id>" / "r<id>" (API 113) — only that number's series: the step or record and the works sharing it within its reach */
export const getProvenanceNumbers = (number: string, kind?: string | null, of?: string | null) =>
  get<{ data: ProvenanceNumberHit[] }>('/provenance-numbers', { number, ...(kind ? { kind } : {}), ...(of ? { of } : {}) }).then((r) => r.data);
export const getPeriods = () => get<Periods>('/periods');
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
/** notIn (API 113): leave out artworks whose current collection has every word of one of these phrases. */
export const searchText = (q: string, type: EntityType | null, limit: number, offset: number, notIn: string[] = []) =>
  get<{ total: number; data: TextHit[] }>('/search/text', { q, type, limit, offset, ...(notIn.length ? { not_in: notIn } : {}) });

/** "Did you mean …?" (API 113): the query with its unknown words replaced by the nearest words of our names; null: all known. */
export interface Suggestion { query: string | null; words: { from: string; to: string; edits: number }[] }
export const suggest = (q: string) => get<Suggestion>('/search/suggest', { q });
/** `query` with the suggestion's words put in (only those words; the rest as typed). */
export const applySuggestion = (query: string, s: Suggestion) => {
  const fix = new Map(s.words.map((w) => [w.from, w.to]));
  return query.replace(/\p{L}+/gu, (w) => fix.get(fold(w)) ?? w);
};

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

// ---- spatial history (API 091) ----------------------------------------------------------------------------------

/** Who was near whom, computed in the database: one entry's crossed paths (`<plural>/<slug>` or its number). */
export const getEncounters = (entity: string, withinKm?: number) =>
  get<{ data: EncounterRow[] }>('/map/encounters', { entity, within_km: withinKm }).then((r) => r.data);

/** Places with presence grouped for a zoom level (rounded), optionally in a time window. */
export const getClusters = (zoom: number, window: { from: number; to: number } | null) =>
  get<ClustersMap>('/map/clusters', { zoom, from: window?.from, to: window?.to });

// The owner's login (backend src/admin/routes/site-account.js): the CMS account, its session cookie on the admin host
// (same site as this one, so it is sent). Not cached — what a login shows must go away with the logout.
// VITE_ADMIN_BASE: the test environment's CMS; none in development (the dev server has no admin host to ask).
export const ADMIN: string | null = import.meta.env.DEV ? null : (import.meta.env.VITE_ADMIN_BASE as string | undefined) || 'https://admin.arthistory.piogino.ch';
export interface PrivateImage { url: string; source: string | null; locator: string | null; width: number; height: number }
async function account<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!ADMIN) return null;
  const res = await fetch(`${ADMIN}/site${path}`, { ...init, credentials: 'include', headers: { Accept: 'application/json' } });
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(res.status, 'account', res.statusText);
  return res.status === 204 ? null : (res.json() as Promise<T>);
}
/** Works that only have this account's reference images: slug → the image's address (none for visitors). */
export const getOwnThumbs = () => account<{ images: Record<string, string> }>('/thumbs').then((r) => r?.images ?? {});
/** The logged-in account, or null. */
export const getAccount = () => account<{ username: string }>('/me');
/** This account's private reference images of a work (184) — null when not logged in. */
export const getPrivateImages = (slug: string) =>
  account<{ images: PrivateImage[] }>(`/artworks/${encodeURIComponent(slug)}/private-images`).then((r) => r?.images ?? null);
export const logOut = () => account<null>('/logout', { method: 'POST' });
/** The CMS login, back to `next` (an address of this site) afterwards. */
export const loginUrl = (next: string) => (ADMIN ? `${ADMIN}/login?${new URLSearchParams({ next })}` : null);

// The quiz (API /v1/quiz, backend src/routes/quiz.js): a new draw every time — never from the cache above.
async function fresh<T>(path: string, params: Params = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'internal_error', body?.message ?? res.statusText, body);
  remember(body);
  return body as T;
}
export interface QuizWork {
  slug: string; public_id: number; title: string; title_en: string | null; image_url: string; credit: string | null; license: string | null;
  created: DateRange | null; creator: string | null; correct?: boolean;
  /** the logged-in account's private reference image (no public one, or ?mine=only) */
  own?: boolean;
}
export interface QuizNamed { slug: string; public_id: number; name: string; names: string[] }
export interface QuizPicture {
  slug: string; public_id: number; title: string; titles: string[]; created: DateRange | null; image_url: string | null;
  credit: string | null; license: string | null; attribution: string | null;
  creators: (QuizNamed & { family_name: string | null; main: boolean })[]; movements: QuizNamed[];
  own?: boolean;
}
export interface QuizMovement { slug: string; public_id: number; name: string; kind: string; period: DateRange | null }
export type QuizMovementRound =
  | { kind: 'pick'; movement: QuizMovement; options: QuizWork[] }
  | { kind: 'name'; works: QuizWork[]; answer: string; options: QuizMovement[] };
export interface QuizTerm { slug: string; public_id: number; name: string; category: string; definition: string }
export type QuizTermRound =
  | { kind: 'definition' | 'term'; term: QuizTerm; answer: string; options: QuizTerm[] }
  | { kind: 'describe'; term: QuizTerm };
export interface QuizArtistRound { artist: { slug: string; public_id: number; name: string; dates: string | null }; options: QuizWork[] }

/** `own`: logged in — the same game from the admin host (/site/quiz/…), with the works that have only the account's
 *  private reference images; the public one if the login has ended meanwhile. */
async function quiz<T>(kind: string, own: boolean, params: Params): Promise<T> {
  if (own) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const mine = await account<T>(`/quiz/${kind}?${qs}`);
    if (mine) return mine;
  }
  return fresh<T>(`/quiz/${kind}`, params);
}
/** A world region (backend migration 191) with the number of works the games can show from it */
export interface QuizRegion { region: string; name: string; name_de: string; note: string | null; works: number }
export const getQuizRegions = (own: boolean) => quiz<{ data: QuizRegion[] }>('regions', own, {});
// region: the works of that region only (else each round keeps to its artist's or movement's region)
export const getQuizPictures = (n: number, own: boolean, onlyOwn = false, region?: string | null) =>
  quiz<{ data: QuizPicture[]; movements: string[] }>('image', own, { n, mine: own && onlyOwn ? 'only' : undefined, region });
export const getQuizArtists = (n: number, own: boolean, region?: string | null) => quiz<{ data: QuizArtistRound[] }>('artist', own, { n, region });
export const getQuizMovements = (n: number, mode: string, own: boolean, region?: string | null) =>
  quiz<{ data: QuizMovementRound[] }>('movement', own, { n, mode, region });
export const getQuizGlossary = (n: number, mode: string) => fresh<{ data: QuizTermRound[] }>('/quiz/glossary', { n, mode });
