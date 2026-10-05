import { listEntities } from '../api';
import { countryName, countryText, dateLabel, displayName, href, html, langAttr, PLURAL_LABEL, render, spanLabel, thumb, type Html } from '../html';
import type { NameEntry } from '../types';

/** The original-language name, shown small on the card ("神奈川沖浪裏"). */
const original = (item: unknown) => (item as { names?: NameEntry[] }).names?.find((n) => n.role === 'original');
import type { ItemByPlural, Plural } from '../types';
import { guard, showError } from './common';
import { entries, explain, highlight, matches, queryWords, saveSort, savedSort, sortEntries, sortOptions, type Entry } from '../catalog';

type AnyItem = ItemByPlural[Plural];

/** What a card shows: name, a date line, a detail line and an optional thumbnail. */
function cardParts(plural: Plural, item: AnyItem) {
  let name = '';
  let date = '';
  let detail = '';
  let image: string | null = null;
  switch (plural) {
    case 'artists': {
      const a = item as ItemByPlural['artists'];
      [name, date, image] = [a.name, spanLabel(a.birth, a.death), a.image_url];
      detail = countryText(a.country) ?? '';
      break;
    }
    case 'artworks': {
      const a = item as ItemByPlural['artworks'];
      [name, date, image] = [a.title, dateLabel(a.created), a.image_url];
      detail = [a.kind, a.creator?.name, countryText(a.country)].filter(Boolean).join(' · ');
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
      [name, date, detail, image] = [i.name, i.founded ? `founded ${i.founded.label}` : '', [i.kind, countryText(i.country)].filter(Boolean).join(' · '), i.image_url];
      break;
    }
    case 'patrons': {
      const p = item as ItemByPlural['patrons'];
      [name, date, detail] = [p.name, p.active ? `active ${p.active.label}` : '', [p.kind, countryText(p.country)].filter(Boolean).join(' · ')];
      break;
    }
    case 'polities': {
      const p = item as ItemByPlural['polities'];
      [name, date, detail] = [p.name, dateLabel(p.period), [p.kind, p.country_codes.map((c) => countryName(c) ?? c).join(', ')].filter(Boolean).join(' · ')];
      break;
    }
  }
  return { name, date, detail, image };
}

/**
 * One card. While searching, the matched words are highlighted and `why` names the hidden field that matched
 * ("Born in: Zundert").
 */
function card(plural: Plural, item: AnyItem, words: string[] = [], why: Html | null = null): Html {
  const { name, date, detail, image } = cardParts(plural, item);
  return html`<li class="card">
    <a class="card-link" href="${href(plural, item.slug)}">
      ${image ? html`<img class="card-img" src="${thumb(image, 250)}" alt="" loading="lazy" crossorigin="anonymous">` : html`<span class="card-img card-img-empty" aria-hidden="true"></span>`}
      <span class="card-text">
        <span class="card-name"${langAttr(displayName(item as never).lang)}>${highlight(name, words)}</span>
        ${original(item) ? html`<span class="card-original"${langAttr(original(item)!.lang)}>${highlight(original(item)!.text, words)}</span>` : ''}
        ${date ? html`<span class="card-date">${highlight(date, words)}</span>` : ''}
        ${detail ? html`<span class="card-detail">${highlight(detail, words)}</span>` : ''}
        ${why ? html`<span class="card-why">${why}</span>` : ''}
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
  let all: Entry<AnyItem>[] = [];
  let similar: Entry<AnyItem>[] = []; // typo-tolerant name matches from the API that the field search missed
  let query = '';

  function draw() {
    const words = queryWords(query);
    const hits = query ? all.filter((e) => matches(e, query)) : all;
    let last = '';
    const row = (e: Entry<AnyItem>) => {
      const p = cardParts(plural, e.item);
      return card(plural, e.item, words, query ? explain(e, query, `${p.date} ${p.detail} ${original(e.item)?.text ?? ""}`).why : null);
    };
    render(items, html`
      ${sortEntries(hits, sort).map((e) => {
        const h = e.sorts[sort]?.heading ?? '';
        const head = h !== last ? html`<li class="cards-heading">${h}</li>` : '';
        last = h;
        return html`${head}${row(e)}`;
      })}
      ${similar.length ? html`<li class="cards-heading cards-heading-similar">Similar names</li>${similar.map((e) => card(plural, e.item))}` : ''}
      ${!hits.length && !similar.length ? html`<li class="muted">Nothing found for “${query}”.</li>` : ''}`);
    const total = all.length;
    count.textContent = query
      ? `${hits.length} of ${total} match${similar.length ? `, ${similar.length} similar ${similar.length === 1 ? 'name' : 'names'}` : ''}`
      : `${total} ${total === 1 ? 'entry' : 'entries'}`;
  }

  // same search as the explore pickers: every word in name, details or hidden fields (type, birthplace …)
  let request = 0;
  async function search(q: string) {
    query = q;
    similar = [];
    draw();
    if (q.length < 3) return;
    const mine = ++request;
    try {
      const res = await listEntities(plural, { q, limit: 20 });
      if (mine !== request || !current() || query !== q) return;
      const local = new Set(all.filter((e) => matches(e, q)).map((e) => e.slug));
      similar = entries(plural, res.data as ItemByPlural[typeof plural][]).filter((e) => !local.has(e.slug)) as Entry<AnyItem>[];
      if (similar.length) draw();
    } catch {
      /* the field search above still stands */
    }
  }

  listEntities(plural, { limit: 500 })
    .then((res) => {
      if (!current()) return;
      all = entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      const options = sortOptions(plural, all);
      sort = savedSort(plural, options);
      render(sortSelect, html`${options.map((o) => html`<option value="${o.id}" ${o.id === sort ? html`selected` : ''}>${o.label}</option>`)}`);
      sortLabel.hidden = options.length < 2;
      search(filter.value.trim());
    })
    .catch((err) => showError(items, err));

  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value;
    saveSort(plural, sort);
    draw();
  });

  let timer: number | undefined;
  filter.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => search(filter.value.trim()), 150);
  });
  return () => clearTimeout(timer);
}
