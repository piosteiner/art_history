// Hash routing (#/artists/vincent-van-gogh): GitHub Pages has no server-side fallback for deep links.
import type { Plural } from './types';

export type Route =
  | { name: 'explore' }
  | { name: 'list'; plural: Plural }
  | { name: 'detail'; plural: Plural; slug: string }
  | { name: 'not-found' };

const PLURALS: Plural[] = ['artists', 'artworks', 'places', 'movements', 'institutions', 'patrons'];
const isPlural = (s: string): s is Plural => (PLURALS as string[]).includes(s);

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'explore' };
  const [first, slug, ...rest] = parts;
  if (!isPlural(first) || rest.length) return { name: 'not-found' };
  return slug ? { name: 'detail', plural: first, slug } : { name: 'list', plural: first };
}

/** A view renders into `main` and may return a cleanup function (maps, observers). */
export type Cleanup = void | (() => void);

export function start(onRoute: (route: Route) => void) {
  const run = () => onRoute(parse(location.hash));
  window.addEventListener('hashchange', run);
  run();
}
