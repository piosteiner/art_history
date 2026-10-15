// Path routing (/artists/vincent-van-gogh) with the History API. GitHub Pages serves a prerendered page per entry
// (scripts/prerender.mjs) and 404.html (the app shell) for everything else, so every address loads the app.
// The explore page keeps its state in the query: /?artists=…&from=1888&to=1889. Old #/… links are converted.
import { saveView } from './api';
import type { Plural } from './types';

export type Route =
  | { name: 'explore'; params: URLSearchParams }
  | { name: 'list'; plural: Plural }
  | { name: 'detail'; plural: Plural; slug: string }
  | { name: 'graph'; plural?: Plural; slug?: string; params: URLSearchParams }
  | { name: 'privacy' }
  | { name: 'numbers'; params: URLSearchParams }
  | { name: 'not-found' };

const PLURALS: Plural[] = ['artists', 'artworks', 'places', 'movements', 'institutions', 'people', 'polities', 'events', 'glossary', 'bibliography'];
const isPlural = (s: string): s is Plural => (PLURALS as string[]).includes(s);

export function parse(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(search);
  if (!parts.length || (parts.length === 1 && parts[0] === 'index.html')) return { name: 'explore', params: query };
  if (parts.length === 1 && parts[0] === 'privacy') return { name: 'privacy' };
  if (parts.length === 1 && parts[0] === 'provenance-numbers') return { name: 'numbers', params: query };
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
let rendered = ''; // pathname + search of the page on screen
/** Renders the current address; `scroll`: where the reader was on it (back/forward, reload), else the top. */
function run(scroll?: number) {
  rendered = location.pathname + location.search;
  stopRestoring();
  window.scrollTo(0, 0);
  onRouteHandler?.(currentRoute());
  window.dispatchEvent(new Event(ROUTE_EVENT));
  if (scroll) restoreScroll(scroll);
}

// ---- scroll positions: each history entry keeps its own, so back/forward returns to where the reader was ----------
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // the browser's would jump before the view is drawn
let saveTimer: number | undefined;
let restoring: (() => void) | null = null;
function saveScroll() {
  clearTimeout(saveTimer);
  if (!restoring) history.replaceState({ ...history.state, scroll: window.scrollY }, '');
}
window.addEventListener('scroll', () => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveScroll, 200); // browsers limit how often replaceState may be called
}, { passive: true });

/** Views render once their data is in: scroll as soon as the page is tall enough, until the reader scrolls (≤ 4 s). */
function restoreScroll(y: number) {
  const reached = () => {
    window.scrollTo(0, y);
    return Math.abs(window.scrollY - y) < 2;
  };
  if (reached()) return;
  const grows = new ResizeObserver(() => reached() && stopRestoring());
  const timer = window.setTimeout(() => stopRestoring(), 4000);
  const USER = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
  restoring = () => {
    grows.disconnect();
    clearTimeout(timer);
    USER.forEach((t) => window.removeEventListener(t, stopRestoring));
  };
  grows.observe(document.body);
  USER.forEach((t) => window.addEventListener(t, stopRestoring, { passive: true }));
}
function stopRestoring() {
  restoring?.();
  restoring = null;
}

/** Goes to an address inside the site without reloading the page. */
export function navigate(url: string, { replace = false } = {}) {
  if (!replace) saveScroll(); // the page being left keeps its position for "back"
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  run();
}

/** Updates the explore query without a navigation (no re-render, no new history entry). A long query (many entries
 *  picked) is stored by the API and replaced by a short address /?v=<code> once the choosing pauses — the same
 *  selection always gets the same code (API migration 072). Without the API the long address simply stays. */
const LONG_QUERY = 300;
let shortenTimer: number | undefined;
export function replaceQuery(params: URLSearchParams) {
  const qs = params.toString().replace(/%2C/g, ',');
  window.clearTimeout(shortenTimer);
  const long = `/${qs ? `?${qs}` : ''}`;
  replaceUrl(long);
  if (qs.length <= LONG_QUERY) return;
  shortenTimer = window.setTimeout(() => {
    saveView(qs).then((code) => {
      if (location.pathname + location.search === long) replaceUrl(`/?v=${code}`);  // not if the choice moved on
    }).catch(() => { /* the long address works too */ });
  }, 800);
}

/** Changes the address of the page on screen (filters in the query), keeping its scroll position for back/forward. */
export function replaceUrl(url: string) {
  history.replaceState(history.state, '', url);
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
  // back/forward to another page re-renders; a jump within the page (footnotes: #…-n1) is the browser's to scroll
  window.addEventListener('popstate', () => location.pathname + location.search !== rendered && run(history.state?.scroll));
  document.addEventListener('click', interceptLinks);
  run(history.state?.scroll); // a reload keeps the position too
}
