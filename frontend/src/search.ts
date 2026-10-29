// Header search across all types: the same field search as the pickers and list pages (name, details and hidden
// fields such as type or birthplace, with the reason shown), plus the API's typo-tolerant name matches
// (/v1/search, "hokusia" → Hokusai) for whatever the field search missed.
import { listAll, search } from './api';
import { entries, explain, matches, type Entry, type Match } from './catalog';
import { href, html, langAttr, render, TYPE_LABEL, type Html } from './html';
import { navigate, ROUTE_EVENT } from './router';
import type { EntityType, Plural, SearchHit } from './types';

const PLURALS: Plural[] = ['artists', 'artworks', 'movements', 'polities', 'events', 'institutions', 'people', 'places', 'glossary', 'bibliography'];
const MAX = 20;

interface Hit {
  type: EntityType;
  slug: string;
  name: Html;
  lang?: string | null;
  meta: Html | string;
  why: Html | null;
}

let library: Promise<Entry[]> | undefined;
let libraryAt = 0;
/** Every entry of every type, loaded on first use and again after 5 minutes (a tab left open sees new entries). */
const loadLibrary = () => {
  if (Date.now() - libraryAt > 5 * 60 * 1000) library = undefined;
  if (!library) libraryAt = Date.now();
  return (library ??= Promise.all(PLURALS.map((p) => listAll(p).then((r) => entries(p, r.data as never) as Entry[])))
    .then((lists) => lists.flat())
    .catch((err) => {
      library = undefined;
      throw err;
    }));
};

const lastIfSource = (type: string) => (type === 'source' ? 1 : 0);

/**
 * Every match for a query, best first: the field search over all entries (3 = the name starts with it, 2 = the name
 * contains it, 1 = found elsewhere — an artwork by its artist, a person by their birthplace), then, only when that
 * found nothing, the API's typo-tolerant name matches ("hokusia"). Shared by the header and the "Connect to…" picker.
 */
export async function findAll(q: string): Promise<{ local: { e: Entry; m: Match }[]; similar: SearchHit[] }> {
  const [lib, fuzzy] = await Promise.all([loadLibrary().catch(() => [] as Entry[]), search(q).catch(() => [] as SearchHit[])]);
  const local = lib
    .filter((e) => matches(e, q))
    .map((e) => ({ e, m: explain(e, q) }))
    // sources after every other entry: the sculptor Kleomenes before the lexicon article "Kleomenes" (as the API, 2026-10-28)
    .sort((a, b) => lastIfSource(a.e.type) - lastIfSource(b.e.type) || b.m.score - a.m.score || a.e.name.localeCompare(b.e.name, 'en', { numeric: true }));
  const seen = new Set(local.map(({ e }) => `${e.type}/${e.slug}`));
  // the API's fuzzy matches only help when nothing matched as typed ("hokusia"); otherwise they are noise
  // ("theo" also scores every "The …" title about as high as a real typo)
  return { local, similar: local.length ? [] : fuzzy.filter((h) => !seen.has(`${h.type}/${h.slug}`))
    .sort((a, b) => lastIfSource(a.type) - lastIfSource(b.type)) };
}

export const searchUrl = (q: string) => `/search?${new URLSearchParams({ q })}`;

export function mountSearch(root: HTMLElement) {
  render(root, html`<form class="search-form" role="search">
    <input type="search" placeholder="Search artists, works, places…" aria-label="Search" autocomplete="off"
      aria-controls="search-results" aria-expanded="false">
    <ul class="search-results" id="search-results" role="listbox" hidden></ul>
  </form>`);
  const form = root.querySelector('form')!;
  const input = root.querySelector('input')!;
  const results = root.querySelector<HTMLElement>('ul')!;
  let hits: Hit[] = [];
  let active = -1;
  let timer: number | undefined;
  let request = 0;

  const close = () => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  let query = '';
  let total = 0;
  function show(similarFrom: number) {
    // Enter without choosing a hit opens the search page with every result (also when there are more than shown)
    const all = html`<li class="hit-all"><a href="${searchUrl(query)}"><span class="hit-name">${total > hits.length ? `All ${total} results` : 'All results'} for “${query}” →</span>
      <span class="hit-meta">with images and details · Enter</span></a></li>`;
    // a query with a digit may be a lot, stock, ERR, Munich … number (API 077): offer the lookup after the hits
    const number = /\d/.test(query) ? html`<li class="hit-number"><a href="/provenance-numbers?${String(new URLSearchParams({ number: query }))}">
      <span class="hit-name">“${query}” as a provenance number</span><span class="hit-meta">lot, stock, ERR, Munich, Linz, Lugt …</span></a></li>` : '';
    render(results, hits.length
      ? html`${hits.map((h, i) => html`${i === similarFrom ? html`<li class="hit-heading" aria-hidden="true">Similar names</li>` : ''}
        <li role="option" aria-selected="${String(i === active)}" class="${i === active ? 'active' : ''}">
          <a href="${href(h.type, h.slug)}"><span class="hit-name"${langAttr(h.lang)}>${h.name}</span>
          <span class="hit-meta">${TYPE_LABEL[h.type]}${h.meta ? html` · ${h.meta}` : ''}</span>
          ${h.why ? html`<span class="hit-why">${h.why}</span>` : ''}</a>
        </li>`)}${number}${all}`
      : html`${number ? '' : html`<li class="muted hit-empty">No matches</li>`}${number}`);
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  let similarFrom = -1;
  async function run(q: string) {
    const mine = ++request;
    query = q;
    const found = await findAll(q);
    if (mine !== request) return;
    total = found.local.length + found.similar.length;
    const local = found.local.slice(0, MAX);
    const extra = found.similar.slice(0, MAX);
    hits = [
      ...local.map(({ e, m }) => toHit(e, m)),
      ...extra.map((h) => ({ type: h.type, slug: h.slug, name: html`${h.name}`, meta: h.subtitle || [h.kind, h.period?.label].filter(Boolean).join(' · '), why: null })),
    ];
    similarFrom = extra.length && local.length ? local.length : -1;
    active = -1;
    show(similarFrom);
  }

  input.addEventListener('focus', () => void loadLibrary().catch(() => {}), { once: true });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = window.setTimeout(() => run(q), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden || !hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      show(similarFrom);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // a hit opened from the list: the page it was opened from keeps the query, so "back" shows the search again
  const remember = () => history.replaceState({ ...history.state, headerSearch: query }, '');

  // Enter: the hit chosen with the arrow keys — else the search page with all results, as search boxes usually do
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const hit = hits[active];
    const q = input.value.trim();
    if (hit && !results.hidden) {
      remember();
      navigate(href(hit.type, hit.slug));
    }
    else if (q) navigate(searchUrl(q));
    close();
  });

  results.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    if (a.closest('[role=option]')) remember();
    close();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) close();
  });
  window.addEventListener(ROUTE_EVENT, () => {
    close();
    const back = (history.state as { headerSearch?: string } | null)?.headerSearch;
    input.value = back ?? '';
    if (back) void run(back);
  });
}

function toHit(e: Entry, m: Match): Hit {
  return { type: e.type, slug: e.slug, name: m.name, lang: e.lang, meta: m.meta, why: m.why };
}
