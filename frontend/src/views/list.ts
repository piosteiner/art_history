import { listEntities } from '../api';
import { dateLabel, href, html, PLURAL_LABEL, render, spanLabel, thumb, type Html } from '../html';
import type { ItemByPlural, Plural } from '../types';
import { guard, showError } from './common';
import { entries, saveSort, savedSort, sortEntries, sortOptions, type Entry } from '../catalog';

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
    <div class="list-tools">
      <input class="filter" type="search" placeholder="Search ${PLURAL_LABEL[plural].toLowerCase()}…" aria-label="Search">
      <label class="list-sort" hidden>Sort <select aria-label="Sort"></select></label>
    </div>
    <p class="muted" id="count"></p>
    <ul class="cards" id="items"></ul>
  </section>`);
  const items = main.querySelector<HTMLElement>('#items')!;
  const count = main.querySelector<HTMLElement>('#count')!;
  const filter = main.querySelector<HTMLInputElement>('.filter')!;
  const sortLabel = main.querySelector<HTMLLabelElement>('.list-sort')!;
  const sortSelect = sortLabel.querySelector('select')!;
  const current = guard();

  let sort = '';
  let shown: Entry<AnyItem>[] = [];

  function draw() {
    let last = '';
    render(items, shown.length
      ? html`${sortEntries(shown, sort).map((e) => {
          const h = e.sorts[sort]?.heading ?? '';
          const head = h !== last ? html`<li class="cards-heading">${h}</li>` : '';
          last = h;
          return html`${head}${card(plural, e.item)}`;
        })}`
      : html`<li class="muted">Nothing found.</li>`);
  }

  let request = 0;
  async function load(q: string) {
    const mine = ++request;
    try {
      // the API search is typo-tolerant ("hokusia"); sorting happens here
      const res = await listEntities(plural, { q, limit: 500 });
      if (mine !== request || !current()) return;
      shown = entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      if (!sort) {
        const options = sortOptions(plural, shown);
        sort = savedSort(plural, options);
        render(sortSelect, html`${options.map((o) => html`<option value="${o.id}" ${o.id === sort ? html`selected` : ''}>${o.label}</option>`)}`);
        sortLabel.hidden = options.length < 2;
      }
      count.textContent = `${res.total} ${res.total === 1 ? 'entry' : 'entries'}${res.total > res.data.length ? `, showing ${res.data.length}` : ''}`;
      draw();
    } catch (err) {
      showError(items, err);
    }
  }

  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value;
    saveSort(plural, sort);
    draw();
  });

  let timer: number | undefined;
  filter.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => load(filter.value.trim()), 200);
  });
  load('');
  return () => clearTimeout(timer);
}
