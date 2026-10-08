// Header search across all types: the same field search as the pickers and list pages (name, details and hidden
// fields such as type or birthplace, with the reason shown), plus the API's typo-tolerant name matches
// (/v1/search, "hokusia" → Hokusai) for whatever the field search missed.
import { listEntities, search } from './api';
import { entries, explain, matches, type Entry, type Match } from './catalog';
import { href, html, langAttr, render, TYPE_LABEL, type Html } from './html';
import { navigate, ROUTE_EVENT } from './router';
import type { EntityType, Plural } from './types';

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
/** Every entry of every type (≤ 500 per type), loaded once on first use; the API caches the lists. */
const loadLibrary = () =>
  (library ??= Promise.all(PLURALS.map((p) => listEntities(p, { limit: 500 }).then((r) => entries(p, r.data as never) as Entry[])))
    .then((lists) => lists.flat())
    .catch((err) => {
      library = undefined;
      throw err;
    }));

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

  function show(similarFrom: number) {
    render(results, hits.length
      ? html`${hits.map((h, i) => html`${i === similarFrom ? html`<li class="hit-heading" aria-hidden="true">Similar names</li>` : ''}
        <li role="option" aria-selected="${String(i === active)}" class="${i === active ? 'active' : ''}">
          <a href="${href(h.type, h.slug)}"><span class="hit-name"${langAttr(h.lang)}>${h.name}</span>
          <span class="hit-meta">${TYPE_LABEL[h.type]}${h.meta ? html` · ${h.meta}` : ''}</span>
          ${h.why ? html`<span class="hit-why">${h.why}</span>` : ''}</a>
        </li>`)}`
      : html`<li class="muted hit-empty">No matches</li>`);
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  let similarFrom = -1;
  async function run(q: string) {
    const mine = ++request;
    const [lib, fuzzy] = await Promise.all([loadLibrary().catch(() => [] as Entry[]), search(q).catch(() => [])]);
    if (mine !== request) return;
    const local = lib
      .filter((e) => matches(e, q))
      .map((e) => ({ e, m: explain(e, q) }))
      .sort((a, b) => b.m.score - a.m.score || a.e.name.localeCompare(b.e.name, 'en', { numeric: true }))
      .slice(0, MAX);
    const seen = new Set(local.map(({ e }) => `${e.type}/${e.slug}`));
    // the API's fuzzy matches only help when nothing matched as typed ("hokusia"); otherwise they are noise
    // ("theo" also scores every "The …" title about as high as a real typo)
    const extra = local.length ? [] : fuzzy.filter((h) => !seen.has(`${h.type}/${h.slug}`)).slice(0, MAX);
    hits = [
      ...local.map(({ e, m }) => toHit(e, m)),
      ...extra.map((h) => ({ type: h.type, slug: h.slug, name: html`${h.name}`, meta: [h.kind, h.period?.label].filter(Boolean).join(' · '), why: null })),
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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const hit = hits[active] ?? hits[0];
    if (hit) navigate(href(hit.type, hit.slug));
  });

  results.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) close();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) close();
  });
  window.addEventListener(ROUTE_EVENT, () => {
    close();
    input.value = '';
  });
}

function toHit(e: Entry, m: Match): Hit {
  return { type: e.type, slug: e.slug, name: m.name, lang: e.lang, meta: m.meta, why: m.why };
}
