import './style.css';
import { mountThemeToggle } from './theme';
import { html, PLURAL_LABEL, render } from './html';
import { currentRoute, start, type Cleanup, type Route } from './router';
import { mountSearch } from './search';
import type { Plural } from './types';
import { detail } from './views/detail';
import { explore } from './views/explore';
import { graph } from './views/graph';
import { list } from './views/list';
import { privacy } from './views/privacy';

const NAV: Plural[] = ['artists', 'artworks', 'movements', 'polities', 'institutions', 'patrons', 'places'];

const main = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
render(nav, html`<a href="/">Explore</a><a href="/graph">Network</a>${NAV.map((p) => html`<a href="/${p}">${PLURAL_LABEL[p]}</a>`)}`);
mountSearch(document.getElementById('search')!);
// switching between light and dark re-renders the page so the maps load the matching base map
mountThemeToggle(document.getElementById('theme')!, () => onRoute(currentRoute()));

let cleanup: Cleanup;

function onRoute(route: Route) {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  document.title = 'Art History';
  const section = route.name === 'list' || route.name === 'detail' ? route.plural : route.name === 'explore' ? '' : route.name === 'graph' ? 'graph' : null;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('current', a.getAttribute('href') === `/${section ?? '-'}`));
  window.scrollTo(0, 0);

  switch (route.name) {
    case 'explore':
      cleanup = explore(main, route.params);
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
      cleanup = graph(main, route.plural, route.slug, route.params);
      break;
    case 'privacy':
      privacy(main);
      break;
    case 'not-found':
      render(main, html`<section class="page"><h1>Not found</h1><p><a href="/">Back to the start</a></p></section>`);
  }
}

start(onRoute);
