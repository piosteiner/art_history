// Path routing (/artists/vincent-van-gogh) with the History API. GitHub Pages serves a prerendered page per entry
// (scripts/prerender.mjs) and 404.html (the app shell) for everything else, so every address loads the app.
// The explore page keeps its state in the query: /?artists=…&from=1888&to=1889. Old #/… links are converted.
import type { Plural } from './types';

export type Route =
  | { name: 'explore'; params: URLSearchParams }
  | { name: 'list'; plural: Plural }
  | { name: 'detail'; plural: Plural; slug: string }
  | { name: 'graph'; plural?: Plural; slug?: string; params: URLSearchParams }
  | { name: 'privacy' }
  | { name: 'not-found' };

const PLURALS: Plural[] = ['artists', 'artworks', 'places', 'movements', 'institutions', 'people', 'polities', 'glossary'];
const isPlural = (s: string): s is Plural => (PLURALS as string[]).includes(s);

export function parse(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(search);
  if (!parts.length || (parts.length === 1 && parts[0] === 'index.html')) return { name: 'explore', params: query };
  if (parts.length === 1 && parts[0] === 'privacy') return { name: 'privacy' };
  if (parts[0] === 'graph') {
    const [, p, s, ...more] = parts;
    if (more.length || (p && !isPlural(p))) return { name: 'not-found' };
    return { name: 'graph', plural: p as Plural | undefined, slug: s, params: query };
  }
  const [first, slug, ...rest] = parts;
  if (!isPlural(first) || rest.length) return { name: 'not-found' };
  return slug ? { name: 'detail', plural: first, slug } : { name: 'list', plural: first };
}

export const currentRoute = () => parse(location.pathname, location.search);

/** Fired after every navigation (link click, back/forward, navigate()). */
export const ROUTE_EVENT = 'arthistory:route';

let onRouteHandler: ((route: Route) => void) | undefined;
function run() {
  onRouteHandler?.(currentRoute());
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Goes to an address inside the site without reloading the page. */
export function navigate(url: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  run();
}

/** Updates the explore query without a navigation (no re-render, no new history entry). */
export function replaceQuery(params: URLSearchParams) {
  const qs = params.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', `/${qs ? `?${qs}` : ''}`);
}

/** A view renders into `main` and may return a cleanup function (maps, observers). */
export type Cleanup = void | (() => void);

/** Links to our own pages are handled here; Ctrl/Cmd/Shift/middle click keep the browser's behaviour (new tab …). */
function interceptLinks(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | SVGAElement | null;
  if (!a) return;
  const raw = a instanceof SVGAElement ? a.href.baseVal : a.getAttribute('href')!;
  if (a.getAttribute('target') || a.hasAttribute('download') || !raw.startsWith('/') || raw.startsWith('//')) return;
  const url = new URL(raw, location.origin);
  if (/\.[a-z0-9]+$/i.test(url.pathname) || url.pathname.startsWith('/v1/')) return; // files (health.html, sitemap.xml)
  e.preventDefault();
  if (url.pathname + url.search !== location.pathname + location.search) navigate(url.pathname + url.search + url.hash);
}

export function start(onRoute: (route: Route) => void) {
  // old addresses (#/artists/vincent-van-gogh) keep working
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
  // patrons became people (API migration 024): /patrons/theo-van-gogh → /people/theo-van-gogh
  if (/^\/patrons(\/|$)/.test(location.pathname)) history.replaceState(null, '', location.pathname.replace(/^\/patrons/, '/people') + location.search);
  onRouteHandler = onRoute;
  window.addEventListener('popstate', run);
  document.addEventListener('click', interceptLinks);
  run();
}
