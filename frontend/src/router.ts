// Hash routing (#/artists/vincent-van-gogh): GitHub Pages has no server-side fallback for deep links.
// The explore page keeps its state in a query after the path: #/?artists=…&from=1888&to=1889.
import type { Plural } from './types';

export type Route =
  | { name: 'explore'; params: URLSearchParams }
  | { name: 'list'; plural: Plural }
  | { name: 'detail'; plural: Plural; slug: string }
  | { name: 'graph'; plural?: Plural; slug?: string; params: URLSearchParams }
  | { name: 'not-found' };

const PLURALS: Plural[] = ['artists', 'artworks', 'places', 'movements', 'institutions', 'patrons', 'polities'];
const isPlural = (s: string): s is Plural => (PLURALS as string[]).includes(s);

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'explore', params: new URLSearchParams(query) };
  if (parts[0] === 'graph') {
    const [, p, s, ...more] = parts;
    if (more.length || (p && !isPlural(p))) return { name: 'not-found' };
    return { name: 'graph', plural: p as Plural | undefined, slug: s, params: new URLSearchParams(query) };
  }
  const [first, slug, ...rest] = parts;
  if (!isPlural(first) || rest.length) return { name: 'not-found' };
  return slug ? { name: 'detail', plural: first, slug } : { name: 'list', plural: first };
}

/** Updates the explore query without a navigation (no hashchange, no new history entry). */
export function replaceQuery(params: URLSearchParams) {
  const qs = params.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', `#/${qs ? `?${qs}` : ''}`);
}

/** A view renders into `main` and may return a cleanup function (maps, observers). */
export type Cleanup = void | (() => void);

export function start(onRoute: (route: Route) => void) {
  const run = () => onRoute(parse(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
