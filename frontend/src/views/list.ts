import { listEntities } from '../api';
import { countryName, countryText, creatorNames, dateLabel, displayName, personDates, personWhat, href, html, langAttr, PLURAL_LABEL, render, spanLabel, thumb, type Html } from '../html';
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
      detail = [a.kind, creatorNames(a), countryText(a.country)].filter(Boolean).join(' · ');
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
    case 'people': {
      const p = item as ItemByPlural['people'];
      [name, date, detail] = [p.name, personDates(p), [personWhat(p), countryText(p.country)].filter(Boolean).join(' · ')];
      break;
    }
    case 'glossary': {
      const t = item as ItemByPlural['glossary'];
      [name, date, detail, image] = [t.name, t.category, t.definition ?? '', t.image_url];
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
    <div class="category-filter" id="categories" hidden role="group" aria-label="Category"></div>
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
  // glossary: one category at a time (`?category=technique`); "All" shows every term
  let category = plural === 'glossary' ? new URLSearchParams(location.search).get('category') : null;
  const categoriesEl = main.querySelector<HTMLElement>('#categories')!;
  function drawCategories() {
    const counts = new Map<string, number>();
    for (const e of all) { const c = (e.item as { category?: string }).category ?? 'other'; counts.set(c, (counts.get(c) ?? 0) + 1); }
    if (category && !counts.has(category)) category = null;
    categoriesEl.hidden = counts.size < 2 && !category;
    render(categoriesEl, html`<button type="button" data-category="" class="${category ? '' : 'on'}" aria-pressed="${String(!category)}">All <span class="muted">${String(all.length)}</span></button>
      ${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => html`<button type="button" data-category="${c}" class="${c === category ? 'on' : ''}" aria-pressed="${String(c === category)}">${c} <span class="muted">${String(n)}</span></button>`)}`);
  }
  categoriesEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-category]');
    if (!b) return;
    category = b.dataset.category || null;
    history.replaceState(null, '', `/glossary${category ? `?category=${encodeURIComponent(category)}` : ''}`);
    drawCategories();
    draw();
  });

  function draw() {
    const words = queryWords(query);
    const pool = category ? all.filter((e) => (e.item as { category?: string }).category === category) : all;
    const hits = query ? pool.filter((e) => matches(e, query)) : pool;
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
      ${!hits.length && !similar.length ? html`<li class="muted">${query ? `Nothing found for “${query}”.` : 'No entries yet.'}</li>` : ''}`);
    const total = pool.length;
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
      // typo-tolerant matches only when nothing matched as typed (otherwise mostly noise, see search.ts)
      similar = local.size ? [] : entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      if (similar.length) draw();
    } catch {
      /* the field search above still stands */
    }
  }

  listEntities(plural, { limit: 500 })
    .then((res) => {
      if (!current()) return;
      all = entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      if (plural === 'glossary') drawCategories();
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
