import './style.css';
import { mountThemeToggle } from './theme';
import { html, PLURAL_LABEL, render, wireImageFallbacksEverywhere } from './html';
import { start, type Cleanup, type Route } from './router';
import { watchLinks } from './previews';
import { mountSearch } from './search';
import type { Plural } from './types';
import { detail } from './views/detail';
import { loading, showError } from './views/common';
import { list } from './views/list';
import { provenanceNumbers } from './views/numbers';
import { handsPage } from './views/hands';
import { searchPage } from './views/search';

// The same groups as the admin panel's menu: the collection · context (when and where) · reference
const NAV: { title: string; plurals: Plural[] }[] = [
  { title: 'The collection: works and who made, owned and kept them', plurals: ['artworks', 'artists', 'people', 'institutions'] },
  { title: 'Context: when and where', plurals: ['events', 'movements', 'places', 'polities'] },
  { title: 'Reference', plurals: ['glossary', 'bibliography'] },
];

const main = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
render(nav, html`<span class="nav-group"><a href="/">Explore</a><a href="/graph">Network</a><a href="/periods">Periods</a></span>
  ${NAV.map((g) => html`<span class="nav-group" title="${g.title}">${g.plurals.map((p) => html`<a href="/${p}">${PLURAL_LABEL[p]}</a>`)}</span>`)}`);
mountSearch(document.getElementById('search')!);
watchLinks(main); // previews on the internal links of every page
wireImageFallbacksEverywhere(); // an image that fails: its original, or without crossorigin (html.ts)
// light/dark: the page stays, maps swap their base map (THEME_EVENT in src/map.ts)
mountThemeToggle(document.getElementById('theme')!);

let cleanup: Cleanup;

// "Skip to content": focus the page area without adding #app to the address
main.tabIndex = -1;
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  const h1 = main.querySelector<HTMLElement>('h1');
  if (h1 && !h1.hasAttribute('tabindex')) h1.tabIndex = -1;
  (h1 ?? main).focus();
});

/**
 * After a navigation inside the site, focus goes to the new page's heading (once it has rendered), so keyboard and
 * screen reader users start there instead of on a link that is gone. Not on the first load, and not when the reader
 * has already moved focus somewhere else.
 */
let headingWatch: MutationObserver | undefined;
function focusHeading() {
  headingWatch?.disconnect();
  const before = document.activeElement;
  const done = () => {
    const h1 = main.querySelector<HTMLElement>('h1');
    if (!h1) return false;
    const now = document.activeElement;
    if (now === before || !now || now === document.body || !now.isConnected) {
      if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
    return true;
  };
  if (done()) return;
  const watch = new MutationObserver(() => done() && watch.disconnect());
  headingWatch = watch;
  watch.observe(main, { childList: true, subtree: true });
  setTimeout(() => watch.disconnect(), 5000);
}
let firstRoute = true;

// The map (MapLibre, ~1 MB) and the network (d3) load only on the pages that show them: text pages stay light.
// A view module that loads after the user has moved on is not shown; its cleanup runs with the route's.
function lazyView(load: () => Promise<() => Cleanup>): Cleanup {
  let cancelled = false;
  let inner: Cleanup;
  loading(main);
  load()
    .then((view) => { if (!cancelled) inner = view(); })
    .catch((err) => { if (!cancelled) showError(main, err); });
  return () => {
    cancelled = true;
    if (typeof inner === 'function') inner();
  };
}

// After a deploy, an open tab may ask for a chunk that no longer exists: reload once to get the new build.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('arthistory:reloaded') === location.href) return;
    sessionStorage.setItem('arthistory:reloaded', location.href);
  } catch { /* no storage: reload anyway, the browser stops loops itself */ }
  e.preventDefault();
  location.reload();
});

function onRoute(route: Route) {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  document.title = 'Art History';
  const section = route.name === 'list' || route.name === 'detail' ? route.plural : route.name === 'explore' ? '' : route.name === 'graph' ? 'graph' : route.name === 'periods' ? 'periods' : null;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('current', a.getAttribute('href') === `/${section ?? '-'}`));

  if (!firstRoute) queueMicrotask(focusHeading); // after the view's first render
  firstRoute = false;

  switch (route.name) {
    case 'explore':
      cleanup = lazyView(() => import('./views/explore').then((m) => () => m.explore(main, route.params)));
      break;
    case 'list':
      document.title = `${PLURAL_LABEL[route.plural]} · Art History`;
      cleanup = list(main, route.plural);
      break;
    case 'detail':
      cleanup = detail(main, route.plural, route.key);
      break;
    case 'graph':
      document.title = 'Network · Art History';
      cleanup = lazyView(() => import('./views/graph').then((m) => () => m.graph(main, route.plural, route.slug, route.params)));
      break;
    case 'privacy':  // the CMS page "privacy" (API 114)
      cleanup = lazyView(() => import('./views/page').then((m) => () => m.textPage(main, 'privacy')));
      break;
    case 'page':
      cleanup = lazyView(() => import('./views/page').then((m) => () => m.page(main, route.slug, route.chapter)));
      break;
    case 'periods':
      cleanup = lazyView(() => import('./views/periods').then((m) => () => m.periodsPage(main, route.params)));
      break;
    case 'numbers':
      provenanceNumbers(main, route.params);
      break;
    case 'search':
      cleanup = searchPage(main, route.params);
      break;
    case 'changelog':
      cleanup = lazyView(() => import('./views/changelog').then((m) => () => m.changelogPage(main, route.params)));
      break;
    case 'stats':
      cleanup = lazyView(() => import('./views/stats').then((m) => () => m.statsPage(main)));
      break;
    case 'roadmap':
      cleanup = lazyView(() => import('./views/changelog').then((m) => () => m.roadmapPage(main)));
      break;
    case 'hands':
      handsPage(main, route.from, route.to);
      break;
    case 'not-found':
      render(main, html`<section class="page"><h1>Not found</h1><p><a href="/">Back to the start</a></p></section>`);
  }
}

start(onRoute);
