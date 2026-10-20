// The search page (/search?q=…&type=artwork): full-text search over names and texts (API 087) — biographies,
// descriptions, definitions, sources, provenance steps. One row per entry: its name, why it matched (name · text ·
// provenance) and the matching passage. Filtered by type; more results load while scrolling (no pages). The query is
// read by src/query.ts ("gauguin but not in kunsthaus zürich"); a misspelt word is corrected (API 113: nothing found →
// the correction is searched, with a way back; few found → "did you mean …?"). The header's completion (src/search.ts)
// stays the quick name search.
import { applySuggestion, PLURAL, searchText, suggest } from '../api';
import { describeQuery, parseQuery, textQuery } from '../query';
import { markedWords } from '../highlight';
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

/**
 * The hit's address: the entry with the matched words to mark (?hl=, src/highlight.ts); a provenance hit at its step.
 * A name hit needs no marks: the name is the page's title.
 */
function hitHref(h: TextHit): string {
  const words = h.matched_in === 'name' ? [] : markedWords(h.headline_html);
  const query = words.length ? `?${String(new URLSearchParams({ hl: words.join(' ') }))}` : '';
  return `${h.path}${query}${h.matched_in === 'provenance' ? `#provenance${h.provenance_ids[0] ? `-${h.provenance_ids[0]}` : ''}` : ''}`;
}

export function searchPage(main: HTMLElement, params: URLSearchParams) {
  let query = (params.get('q') ?? '').trim();
  // ?type=artwork; also the plural older search links used (?type=artworks)
  const asked = params.get('type');
  let type = TYPES.find((t) => t === asked || PLURAL[t] === asked) ?? null;
  let loaded = 0;
  let total = 0;
  let loading = false;
  let corrected: string | null = null;   // nothing for the query as typed: its correction is shown
  let suggested: string | null = null;   // few for it: the correction offered
  let literal = '';                      // "search for … instead": no correction for this query
  render(main, html`<section class="page search-page">
    <h1>Search</h1>
    <form class="search-page-form" role="search">
      <input type="search" name="q" class="filter" aria-label="Search" placeholder="Search names and texts…" value="${query}" autocomplete="off">
      <button type="submit">Search</button>
    </form>
    <p class="muted small search-help">Names and texts — biographies, descriptions, provenance. <code>"a phrase"</code>, <code>-without</code>, <code>or</code>,
      or in words: <code>gauguin but not in kunsthaus zürich</code>; “paintings” finds “painted”, “Irene” finds “Irène”, “hokusia” finds Hokusai.</p>
    <div class="category-filter" id="types" role="group" aria-label="Type"></div>
    <p class="muted" id="count"></p>
    <ol class="text-hits" id="items"></ol>
    <p class="muted small" id="more" aria-live="polite"></p>
  </section>`);
  const form = main.querySelector('form')!;
  const input = form.querySelector('input')!;
  const typesEl = main.querySelector<HTMLElement>('#types')!;
  const count = main.querySelector<HTMLElement>('#count')!;
  const items = main.querySelector<HTMLElement>('#items')!;
  const more = main.querySelector<HTMLElement>('#more')!;
  let request = 0;
  let alive = true;
  let timer: number | undefined;

  const urlNow = () => {
    if (!query) return '/search';
    const q = new URLSearchParams({ q: query });
    if (type) q.set('type', type);
    return `/search?${q}`;
  };

  function drawTypes() {
    render(typesEl, html`<button type="button" data-type="" class="${type ? '' : 'on'}" aria-pressed="${String(!type)}">All</button>
      ${TYPES.map((t) => html`<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}" aria-pressed="${String(t === type)}">${PLURAL_LABEL[PLURAL[t]]}</button>`)}`);
  }

  const hitRow = (h: TextHit) => html`<li class="text-hit">
      <a class="text-hit-name" href="${hitHref(h)}">${h.name}</a>
      <span class="tag tag-matched tag-matched-${h.matched_in}" title="${MATCHED[h.matched_in][1]}">${MATCHED[h.matched_in][0]}</span>
      <span class="muted small">${[TYPE_LABEL[h.type], h.kind, h.period?.label].filter(Boolean).join(' · ')}</span>
      ${h.headline_html ? html`<p class="text-hit-passage">${trusted(h.headline_html)}</p>` : ''}
    </li>`;
  const among = () => (type ? ` among ${PLURAL_LABEL[PLURAL[type]].toLowerCase()}` : '');

  /** One batch: the first (from = 0) replaces the list, the next ones are added while scrolling. */
  async function fetchBatch(asked: string, from: number) {
    const parsed = parseQuery(asked);
    const tq = textQuery(parsed);
    return { parsed, res: tq.q.length < 2 ? { total: 0, data: [] as TextHit[] } : await searchText(tq.q, type, PER_PAGE, from, tq.notIn) };
  }

  function drawCount(parsed: ReturnType<typeof parseQuery>) {
    const shown = corrected ?? query;
    render(count, html`${total ? `${total} ${total === 1 ? 'result' : 'results'} for “${shown}”${among()}` : `Nothing found for “${shown}”${among()}.`}${
      parsed.special ? html` <span class="query-read" title="How the search was read">· ${describeQuery(parsed)}</span>` : ''}${
      corrected ? html`<span class="query-fix"> — nothing for “${query}”. <button type="button" class="link-button" data-literal>Search for “${query}” instead</button></span>` : ''}${
      suggested ? html`<span class="query-fix"> — did you mean <button type="button" class="link-button" data-suggest="${suggested}">${suggested}</button>?</span>` : ''}${
      /\d/.test(query) ? html` · <a href="/provenance-numbers?${String(new URLSearchParams({ number: query }))}">“${query}” as a provenance number</a>` : ''}`);
  }

  async function draw() {
    const mine = ++request;
    document.title = query ? `“${query}” · Search · Art History` : 'Search · Art History';
    drawTypes();
    loaded = 0; total = 0; corrected = null; suggested = null;
    render(more, html``);
    if (query.length < 2) {
      render(items, html``);
      render(count, html`${query ? 'Type at least two letters.' : 'Search names and texts of every entry.'}`);
      return;
    }
    render(count, html`Searching…`);
    let batch;
    try {
      batch = await fetchBatch(query, 0);
      // a misspelt word (API 113): nothing → the correction; few → offer it
      if (batch.res.total < 3 && literal !== query) {
        const s = await suggest(batch.parsed.positive).catch(() => null);
        const fixed = s && s.query ? applySuggestion(query, s) : null;
        if (fixed && fixed !== query) {
          if (!batch.res.total) {
            const again = await fetchBatch(fixed, 0);
            if (again.res.total) { batch = again; corrected = fixed; }
          } else suggested = fixed;
        }
      }
    } catch (err) {
      if (alive && mine === request) showError(items, err);
      return;
    }
    if (!alive || mine !== request) return;
    total = batch.res.total;
    loaded = batch.res.data.length;
    drawCount(batch.parsed);
    render(items, html`${batch.res.data.map(hitRow)}`);
    drawMore();
  }

  /** The next batch when the end of the list comes into view. */
  async function loadMore() {
    if (loading || loaded >= total || !query) return;
    loading = true;
    const mine = request;
    render(more, html`Loading more…`);
    try {
      const { res } = await fetchBatch(corrected ?? query, loaded);
      if (!alive || mine !== request) return;
      items.insertAdjacentHTML('beforeend', res.data.map((h) => String(hitRow(h))).join(''));
      loaded += res.data.length;
      if (!res.data.length) total = loaded;
    } catch (err) {
      if (alive && mine === request) showError(more, err);
    } finally {
      loading = false;
      if (alive && mine === request) drawMore();
    }
  }
  function drawMore() {
    render(more, loaded < total ? html`${String(loaded)} of ${String(total)} shown — more load as you scroll` : html``);
    // still on screen after this batch (a tall window): the next one at once
    if (loaded < total && more.getBoundingClientRect().top < window.innerHeight + 400) void loadMore();
  }
  const observer = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) void loadMore(); }, { rootMargin: '400px' });
  observer.observe(more);

  typesEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-type]');
    if (!b) return;
    type = (b.dataset.type || null) as EntityType | null;
    replaceUrl(urlNow());
    void draw();
  });
  count.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-literal], button[data-suggest]');
    if (!b) return;
    if (b.dataset.suggest) input.value = b.dataset.suggest; else literal = query;
    update();
  });
  const update = () => {
    query = input.value.trim();
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
    observer.disconnect();
  };
}

