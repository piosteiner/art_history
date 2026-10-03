import { listEntities } from '../api';
import { dateLabel, href, html, PLURAL_LABEL, render, spanLabel, thumb, type Html } from '../html';
import type { ItemByPlural, Plural } from '../types';
import { guard, showError } from './common';

type AnyItem = ItemByPlural[Plural];

/** One row of a list: name, a date line, a detail line and an optional thumbnail. */
function card(plural: Plural, item: AnyItem): Html {
  let name = '';
  let date = '';
  let detail: Html | string = '';
  let image: string | null = null;
  switch (plural) {
    case 'artists': {
      const a = item as ItemByPlural['artists'];
      [name, date, image] = [a.name, spanLabel(a.birth, a.death), a.image_url];
      break;
    }
    case 'artworks': {
      const a = item as ItemByPlural['artworks'];
      [name, date, image] = [a.title, dateLabel(a.created), a.image_url];
      detail = html`${a.kind ?? ''}${a.kind && a.creator ? ' · ' : ''}${a.creator ? a.creator.name : ''}`;
      break;
    }
    case 'places': {
      const p = item as ItemByPlural['places'];
      [name, detail] = [p.name, [p.kind, p.country_code].filter(Boolean).join(' · ')];
      break;
    }
    case 'movements': {
      const m = item as ItemByPlural['movements'];
      [name, date, detail] = [m.name, dateLabel(m.period), m.kind ?? ''];
      break;
    }
    case 'institutions': {
      const i = item as ItemByPlural['institutions'];
      [name, date, detail, image] = [i.name, i.founded ? `founded ${i.founded.label}` : '', i.kind ?? '', i.image_url];
      break;
    }
    case 'patrons': {
      const p = item as ItemByPlural['patrons'];
      [name, date, detail] = [p.name, p.active ? `active ${p.active.label}` : '', p.kind ?? ''];
      break;
    }
  }
  return html`<li class="card">
    <a class="card-link" href="${href(plural, item.slug)}">
      ${image ? html`<img class="card-img" src="${thumb(image, 250)}" alt="" loading="lazy">` : html`<span class="card-img card-img-empty" aria-hidden="true"></span>`}
      <span class="card-text">
        <span class="card-name">${name}</span>
        ${date ? html`<span class="card-date">${date}</span>` : ''}
        ${detail ? html`<span class="card-detail">${detail}</span>` : ''}
      </span>
    </a>
  </li>`;
}

export function list(main: HTMLElement, plural: Plural) {
  render(main, html`<section class="page">
    <h1>${PLURAL_LABEL[plural]}</h1>
    <input class="filter" type="search" placeholder="Filter ${PLURAL_LABEL[plural].toLowerCase()}…" aria-label="Filter">
    <p class="muted" id="count"></p>
    <ul class="cards" id="items"></ul>
  </section>`);
  const items = main.querySelector<HTMLElement>('#items')!;
  const count = main.querySelector<HTMLElement>('#count')!;
  const filter = main.querySelector<HTMLInputElement>('.filter')!;
  const current = guard();

  let request = 0;
  async function load(q: string) {
    const mine = ++request;
    try {
      const res = await listEntities(plural, { q, limit: 500 });
      if (mine !== request || !current()) return;
      count.textContent = `${res.total} ${res.total === 1 ? 'entry' : 'entries'}${res.total > res.data.length ? `, showing ${res.data.length}` : ''}`;
      render(items, res.data.length
        ? html`${res.data.map((item) => card(plural, item))}`
        : html`<li class="muted">Nothing found.</li>`);
    } catch (err) {
      showError(items, err);
    }
  }

  let timer: number | undefined;
  filter.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => load(filter.value.trim()), 200);
  });
  load('');
  return () => clearTimeout(timer);
}

