import './style.css';
import { mountThemeToggle } from './theme';
import { html, PLURAL_LABEL, render } from './html';
import { currentRoute, start, type Cleanup, type Route } from './router';
import { watchLinks } from './previews';
import { mountSearch } from './search';
import type { Plural } from './types';
import { detail } from './views/detail';
import { loading, showError } from './views/common';
import { list } from './views/list';
import { privacy } from './views/privacy';

// The same groups as the admin panel's menu: the collection · context (when and where) · reference
const NAV: { title: string; plurals: Plural[] }[] = [
  { title: 'The collection: works and who made, owned and kept them', plurals: ['artworks', 'artists', 'people', 'institutions'] },
  { title: 'Context: when and where', plurals: ['events', 'movements', 'places', 'polities'] },
  { title: 'Reference', plurals: ['glossary', 'bibliography'] },
];

const main = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
render(nav, html`<span class="nav-group"><a href="/">Explore</a><a href="/graph">Network</a></span>
  ${NAV.map((g) => html`<span class="nav-group" title="${g.title}">${g.plurals.map((p) => html`<a href="/${p}">${PLURAL_LABEL[p]}</a>`)}</span>`)}`);
mountSearch(document.getElementById('search')!);
watchLinks(main); // previews on the internal links of every page
// switching between light and dark re-renders the page so the maps load the matching base map
mountThemeToggle(document.getElementById('theme')!, () => onRoute(currentRoute()));

let cleanup: Cleanup;

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
  const section = route.name === 'list' || route.name === 'detail' ? route.plural : route.name === 'explore' ? '' : route.name === 'graph' ? 'graph' : null;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('current', a.getAttribute('href') === `/${section ?? '-'}`));

  switch (route.name) {
    case 'explore':
      cleanup = lazyView(() => import('./views/explore').then((m) => () => m.explore(main, route.params)));
      break;
    case 'list':
      document.title = `${PLURAL_LABEL[route.plural]} · Art History`;
      cleanup = list(main, route.plural);
      break;
    case 'detail':
      cleanup = detail(main, route.plural, route.slug);
      break;
    case 'graph':
      document.title = 'Network · Art History';
      cleanup = lazyView(() => import('./views/graph').then((m) => () => m.graph(main, route.plural, route.slug, route.params)));
      break;
    case 'privacy':
      privacy(main);
      break;
    case 'not-found':
      render(main, html`<section class="page"><h1>Not found</h1><p><a href="/">Back to the start</a></p></section>`);
  }
}

start(onRoute);
