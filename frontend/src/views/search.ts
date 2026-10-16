// The search page (/search?q=…&type=artworks): every match of the header search (src/search.ts, findAll), as cards
// with image, dates and details — names that match first, then entries found by something else (an artwork by its
// artist, a person by their birthplace, with the reason). Filtered by type; the query follows the typing.
import { PLURAL } from '../api';
import { explain, queryWords } from '../catalog';
import { html, href, PLURAL_LABEL, render, TYPE_LABEL } from '../html';
import { replaceUrl } from '../router';
import { findAll } from '../search';
import type { Plural } from '../types';
import { showError } from './common';
import { card, cardParts } from './list';

export function searchPage(main: HTMLElement, params: URLSearchParams) {
  let query = (params.get('q') ?? '').trim();
  let type = params.get('type') as Plural | null;
  render(main, html`<section class="page search-page">
    <h1>Search</h1>
    <form class="search-page-form" role="search">
      <input type="search" name="q" class="filter" aria-label="Search" placeholder="Search artists, works, places…" value="${query}" autocomplete="off">
      <button type="submit">Search</button>
    </form>
    <div class="category-filter" id="types" hidden role="group" aria-label="Type"></div>
    <p class="muted" id="count"></p>
    <ul class="cards" id="items"></ul>
    <div id="similar"></div>
  </section>`);
  const form = main.querySelector('form')!;
  const input = form.querySelector('input')!;
  const typesEl = main.querySelector<HTMLElement>('#types')!;
  const count = main.querySelector<HTMLElement>('#count')!;
  const items = main.querySelector<HTMLElement>('#items')!;
  const similarEl = main.querySelector<HTMLElement>('#similar')!;
  let request = 0;
  let alive = true;
  let timer: number | undefined;

  const urlNow = () => (query ? `/search?${new URLSearchParams({ q: query, ...(type ? { type } : {}) })}`.replace(/%2C/g, ',') : '/search');

  async function draw() {
    const mine = ++request;
    document.title = query ? `“${query}” · Search · Art History` : 'Search · Art History';
    if (query.length < 2) {
      for (const el of [typesEl, items, similarEl]) render(el, html``);
      typesEl.hidden = true;
      render(count, html`${query ? 'Type at least two letters.' : 'Search names, titles, places, dates, types — and artworks by their artist.'}`);
      return;
    }
    render(count, html`Searching…`);
    let found;
    try {
      found = await findAll(query);
    } catch (err) {
      if (alive && mine === request) showError(items, err);
      return;
    }
    if (!alive || mine !== request) return;
    const { local, similar } = found;
    // the type buttons: how many of each, in the menu's order
    const counts = new Map<Plural, number>();
    for (const { e } of local) counts.set(PLURAL[e.type], (counts.get(PLURAL[e.type]) ?? 0) + 1);
    if (type && !counts.has(type)) type = null;
    typesEl.hidden = counts.size < 2;
    render(typesEl, html`<button type="button" data-type="" class="${type ? '' : 'on'}" aria-pressed="${String(!type)}">All <span class="muted">${String(local.length)}</span></button>
      ${(Object.keys(PLURAL_LABEL) as Plural[]).filter((p) => counts.has(p)).map((p) => html`<button type="button" data-type="${p}" class="${p === type ? 'on' : ''}" aria-pressed="${String(p === type)}">${PLURAL_LABEL[p]} <span class="muted">${String(counts.get(p))}</span></button>`)}`);
    const shown = type ? local.filter(({ e }) => PLURAL[e.type] === type) : local;
    const words = queryWords(query);
    render(count, html`${local.length ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'} for “${query}”${type ? ` among ${PLURAL_LABEL[type].toLowerCase()}` : ''}`
      : similar.length ? `Nothing matches “${query}” as typed — similar names:` : `Nothing found for “${query}”.`}
      ${/\d/.test(query) ? html` · <a href="/provenance-numbers?${String(new URLSearchParams({ number: query }))}">“${query}” as a provenance number</a>` : ''}`);
    render(items, html`${shown.map(({ e }) => {
      const plural = PLURAL[e.type];
      const parts = cardParts(plural, e.item as never);
      // the reason (a hidden field that matched), unless the card shows the words already (name, dates, details)
      const { why } = explain(e, query, `${parts.date} ${parts.detail}`);
      return card(plural, e.item as never, words, why, TYPE_LABEL[e.type]);
    })}`);
    render(similarEl, similar.length ? html`<ul class="rel-list search-similar">${similar.map((h) => html`<li>
        <a href="${href(h.type, h.slug)}">${h.name}</a> <span class="muted">${[TYPE_LABEL[h.type], h.kind, h.period?.label].filter(Boolean).join(' · ')}</span></li>`)}</ul>` : html``);
  }

  typesEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-type]');
    if (!b) return;
    type = (b.dataset.type || null) as Plural | null;
    replaceUrl(urlNow());
    void draw();
  });
  const update = () => {
    query = input.value.trim();
    replaceUrl(urlNow());
    void draw();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(update, 250);
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
