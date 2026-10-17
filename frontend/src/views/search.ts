// The search page (/search?q=…&type=artwork&page=2): full-text search over names and texts (API 087) — biographies,
// descriptions, definitions, sources, provenance steps. One row per entry: its name, why it matched (name · text ·
// provenance) and the matching passage. Filtered by type, 20 per page. The header's completion (src/search.ts) stays
// the quick name search.
import { PLURAL, searchText } from '../api';
import { html, PLURAL_LABEL, render, trusted, TYPE_LABEL } from '../html';
import { replaceUrl } from '../router';
import type { EntityType, TextHit } from '../types';
import { showError } from './common';

const PER_PAGE = 20;
// the types in the menu's order (src/main.ts NAV)
const TYPES: EntityType[] = ['artwork', 'artist', 'person', 'institution', 'event', 'movement', 'place', 'polity', 'term', 'source'];
const MATCHED: Record<TextHit['matched_in'], [string, string]> = {
  name: ['name', 'The name, another name, or a close one'],
  text: ['text', 'Found in its texts: biography, description, definition …'],
  provenance: ['provenance', 'Found in its provenance: a holder, a note, the method'],
};

/** The hit's address; a provenance hit opens the artwork at its provenance (the step, once steps carry ids). */
const hitHref = (h: TextHit) => (h.matched_in === 'provenance' ? `${h.path}#provenance${h.provenance_ids[0] ? `-${h.provenance_ids[0]}` : ''}` : h.path);

export function searchPage(main: HTMLElement, params: URLSearchParams) {
  let query = (params.get('q') ?? '').trim();
  // ?type=artwork; also the plural older search links used (?type=artworks)
  const asked = params.get('type');
  let type = TYPES.find((t) => t === asked || PLURAL[t] === asked) ?? null;
  let page = Math.max(1, Number(params.get('page')) || 1);
  render(main, html`<section class="page search-page">
    <h1>Search</h1>
    <form class="search-page-form" role="search">
      <input type="search" name="q" class="filter" aria-label="Search" placeholder="Search names and texts…" value="${query}" autocomplete="off">
      <button type="submit">Search</button>
    </form>
    <p class="muted small search-help">Names and texts — biographies, descriptions, provenance. <code>"a phrase"</code>, <code>-without</code>, <code>or</code>; “paintings” finds “painted”, “Irene” finds “Irène”.</p>
    <div class="category-filter" id="types" role="group" aria-label="Type"></div>
    <p class="muted" id="count"></p>
    <ol class="text-hits" id="items"></ol>
    <nav class="pager" id="pager" aria-label="Pages"></nav>
  </section>`);
  const form = main.querySelector('form')!;
  const input = form.querySelector('input')!;
  const typesEl = main.querySelector<HTMLElement>('#types')!;
  const count = main.querySelector<HTMLElement>('#count')!;
  const items = main.querySelector<HTMLElement>('#items')!;
  const pager = main.querySelector<HTMLElement>('#pager')!;
  let request = 0;
  let alive = true;
  let timer: number | undefined;

  const urlNow = () => {
    if (!query) return '/search';
    const q = new URLSearchParams({ q: query });
    if (type) q.set('type', type);
    if (page > 1) q.set('page', String(page));
    return `/search?${q}`;
  };

  function drawTypes() {
    render(typesEl, html`<button type="button" data-type="" class="${type ? '' : 'on'}" aria-pressed="${String(!type)}">All</button>
      ${TYPES.map((t) => html`<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}" aria-pressed="${String(t === type)}">${PLURAL_LABEL[PLURAL[t]]}</button>`)}`);
  }

  async function draw() {
    const mine = ++request;
    document.title = query ? `“${query}” · Search · Art History` : 'Search · Art History';
    drawTypes();
    if (query.length < 2) {
      render(items, html``);
      render(pager, html``);
      render(count, html`${query ? 'Type at least two letters.' : 'Search names and texts of every entry.'}`);
      return;
    }
    render(count, html`Searching…`);
    let res;
    try {
      res = await searchText(query, type, PER_PAGE, (page - 1) * PER_PAGE);
    } catch (err) {
      if (alive && mine === request) showError(items, err);
      return;
    }
    if (!alive || mine !== request) return;
    const first = (page - 1) * PER_PAGE + 1;
    const last = first + res.data.length - 1;
    render(count, html`${res.total ? `${res.total > PER_PAGE ? `${first}–${last} of ` : ''}${res.total} ${res.total === 1 ? 'result' : 'results'} for “${query}”${type ? ` among ${PLURAL_LABEL[PLURAL[type]].toLowerCase()}` : ''}`
      : `Nothing found for “${query}”${type ? ` among ${PLURAL_LABEL[PLURAL[type]].toLowerCase()}` : ''}.`}
      ${/\d/.test(query) ? html` · <a href="/provenance-numbers?${String(new URLSearchParams({ number: query }))}">“${query}” as a provenance number</a>` : ''}`);
    render(items, html`${res.data.map((h) => html`<li class="text-hit">
      <a class="text-hit-name" href="${hitHref(h)}">${h.name}</a>
      <span class="tag tag-matched tag-matched-${h.matched_in}" title="${MATCHED[h.matched_in][1]}">${MATCHED[h.matched_in][0]}</span>
      <span class="muted small">${[TYPE_LABEL[h.type], h.kind, h.period?.label].filter(Boolean).join(' · ')}</span>
      ${h.headline_html ? html`<p class="text-hit-passage">${trusted(h.headline_html)}</p>` : ''}
    </li>`)}`);
    items.setAttribute('start', String(first));
    const pages = Math.ceil(res.total / PER_PAGE);
    render(pager, pages > 1 ? html`
      ${page > 1 ? html`<button type="button" data-page="${String(page - 1)}">← Previous</button>` : ''}
      <span class="muted">Page ${String(page)} of ${String(pages)}</span>
      ${page < pages ? html`<button type="button" data-page="${String(page + 1)}">Next →</button>` : ''}` : html``);
  }

  typesEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-type]');
    if (!b) return;
    type = (b.dataset.type || null) as EntityType | null;
    page = 1;
    replaceUrl(urlNow());
    void draw();
  });
  pager.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-page]');
    if (!b) return;
    page = Number(b.dataset.page);
    replaceUrl(urlNow());
    void draw().then(() => main.querySelector('h1')?.scrollIntoView());
  });
  const update = () => {
    query = input.value.trim();
    page = 1;
    replaceUrl(urlNow());
    void draw();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(update, 300);
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(timer);
    update();
  });
  if (!query) input.focus();
  void draw();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

