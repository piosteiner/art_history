// Header search box over /v1/search (all types, typo-tolerant).
import { search } from './api';
import { href, html, render, TYPE_LABEL } from './html';
import type { SearchHit } from './types';

export function mountSearch(root: HTMLElement) {
  render(root, html`<form class="search-form" role="search">
    <input type="search" placeholder="Search artists, works, places…" aria-label="Search" autocomplete="off"
      aria-controls="search-results" aria-expanded="false">
    <ul class="search-results" id="search-results" role="listbox" hidden></ul>
  </form>`);
  const form = root.querySelector('form')!;
  const input = root.querySelector('input')!;
  const results = root.querySelector<HTMLElement>('ul')!;
  let hits: SearchHit[] = [];
  let active = -1;
  let timer: number | undefined;
  let request = 0;

  const close = () => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  function show() {
    render(results, hits.length
      ? html`${hits.map((h, i) => html`<li role="option" aria-selected="${String(i === active)}" class="${i === active ? 'active' : ''}">
          <a href="${href(h.type, h.slug)}"><span class="hit-name">${h.name}</span>
          <span class="hit-meta">${TYPE_LABEL[h.type]}${h.kind ? ` · ${h.kind}` : ''}${h.period ? ` · ${h.period.label}` : ''}</span></a>
        </li>`)}`
      : html`<li class="muted hit-empty">No matches</li>`);
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = window.setTimeout(async () => {
      const mine = ++request;
      try {
        const res = await search(q);
        if (mine !== request) return;
        hits = res;
        active = -1;
        show();
      } catch {
        hits = [];
        close();
      }
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden || !hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      show();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const hit = hits[active] ?? hits[0];
    if (hit) location.hash = href(hit.type, hit.slug);
  });

  results.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) close();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) close();
  });
  window.addEventListener('hashchange', () => {
    close();
    input.value = '';
  });
}
