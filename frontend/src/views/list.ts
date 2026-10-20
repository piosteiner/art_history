import { applySuggestion, listAll, listEntities, suggest } from '../api';
import { describeQuery, parseQuery } from '../query';
import { replaceUrl } from '../router';
import { partLabel } from '../series';
import { countryName, countryText, creatorNames, creatorsOf, dateLabel, displayName, link, personDates, personWhat, href, html, langAttr, PLURAL_LABEL, render, spanLabel, thumb, type Html } from '../html';
import type { NameEntry } from '../types';

/** The original-language name, shown small on the card ("神奈川沖浪裏"). */
const original = (item: unknown) => (item as { names?: NameEntry[] }).names?.find((n) => n.role === 'original');
import type { ArtworkItem, InstitutionItem, ItemByPlural, Plural } from '../types';
import { guard, showError } from './common';
import { entries, explain, fold, highlight, PROVENANCE_CATEGORY_LABEL, STATUS_LABEL, matches, ordered, saveSort, savedSort, sortEntries, sortOptions, type Entry } from '../catalog';

type AnyItem = ItemByPlural[Plural];

/** What a card shows: name, a date line, a detail line and an optional thumbnail. */
export function cardParts(plural: Plural, item: AnyItem) {
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
      [name, date, image] = [displayName(a).text, dateLabel(a.created), a.image_url];
      detail = [a.part_of ? [partLabel(a.part_number), a.part_of.title].filter(Boolean).join(' · ') : '', a.kind, creatorNames(a), countryText(a.country)].filter(Boolean).join(' · ');
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
    case 'bibliography': {
      const s = item as ItemByPlural['bibliography'];
      [name, date, detail] = [s.siglum || s.name, s.reading_status ? STATUS_LABEL[s.reading_status] : '', s.citation.replace(/<[^>]+>/g, '')];
      break;
    }
    case 'glossary': {
      const t = item as ItemByPlural['glossary'];
      [name, date, detail, image] = [t.name, t.category, t.definition ?? '', t.image_url];
      break;
    }
    case 'events': {
      const e = item as ItemByPlural['events'];
      [name, date, detail, image] = [e.name, dateLabel(e.period), [e.kind, e.place?.name, countryText(e.country), e.part_of ? `part of ${e.part_of.name}` : ''].filter(Boolean).join(' · '), e.image_url];
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
export function card(plural: Plural, item: AnyItem, words: string[] = [], why: Html | null = null, typeLabel = '', extra: Html | null = null): Html {
  const { name, date, detail, image } = cardParts(plural, item);
  return html`<li class="card">
    <a class="card-link" href="${href(plural, item.slug)}">
      ${image ? html`<img class="card-img" src="${thumb(image, 250)}" alt="" loading="lazy" crossorigin="anonymous">` : html`<span class="card-img card-img-empty" aria-hidden="true"></span>`}
      <span class="card-text">
        ${typeLabel ? html`<span class="card-type">${typeLabel}</span>` : ''}
        <span class="card-name"${langAttr(displayName(item as never).lang)}>${highlight(name, words)}</span>
        ${original(item) ? html`<span class="card-original"${langAttr(original(item)!.lang)}>${highlight(original(item)!.text, words)}</span>` : ''}
        ${date ? html`<span class="card-date">${highlight(date, words)}</span>` : ''}
        ${detail ? html`<span class="card-detail">${highlight(detail, words)}</span>` : ''}
        ${why ? html`<span class="card-why">${why}</span>` : ''}
      </span>
    </a>
    ${extra ? html`<div class="card-extra">${extra}</div>` : ''}
  </li>`;
}

export function list(main: HTMLElement, plural: Plural) {
  render(main, html`<section class="page">
    <h1>${PLURAL_LABEL[plural]}</h1>
    <div class="list-tools">
      <input class="filter" type="search" placeholder="Search ${PLURAL_LABEL[plural].toLowerCase()}…" aria-label="Search">
      <label class="list-sort" hidden>Sort <select aria-label="Sort"></select></label>
    </div>
    <p class="muted small" id="stats"></p>
    <div class="category-filter" id="categories" hidden role="group" aria-label="Filter"></div>
    <div class="category-filter" id="gap-filter" hidden></div>
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
  // typos (API 113): nothing found as typed → the corrected query is searched instead (`corrected`, with a way back);
  // few found → "Did you mean …?" (`suggested`). `literal`: the visitor asked for the query as typed.
  let corrected: string | null = null;
  let suggested: string | null = null;
  let literal = '';
  // one value of a field at a time: glossary by category (`?category=technique`), bibliography by reading status
  // (`?status=read`), events by kind (`?kind=trial`), artworks by their 1933–1945 provenance category (`?provenance=D`,
  // shown once any work is assessed); "All" shows everything
  const FILTER = ({ glossary: { field: 'category', param: 'category' }, bibliography: { field: 'reading_status', param: 'status' },
    events: { field: 'kind', param: 'kind' }, artworks: { field: 'provenance_category', param: 'provenance' } } as Record<string, { field: string; param: string }>)[plural];
  const fieldOf = (e: Entry<AnyItem>) => String((e.item as unknown as Record<string, unknown>)[FILTER?.field ?? ''] ?? 'other');
  const labelOf = (v: string) => (plural === 'bibliography' ? STATUS_LABEL[v] ?? v : plural === 'artworks' ? PROVENANCE_CATEGORY_LABEL[v] ?? v : v);
  let category = FILTER ? new URLSearchParams(location.search).get(FILTER.param) : null;
  // artworks: the parts of one whole (`?part_of=<slug>`, linked from the series page), in their order
  const partOf = plural === 'artworks' ? new URLSearchParams(location.search).get('part_of') : null;
  // artworks: what one museum holds and held (`?institution=<slug>`), optionally of one artist (`&artist=<slug>`) —
  // linked from the museums list ("12 works by Vincent van Gogh"); there now first, then formerly there
  const heldBy = plural === 'artworks' ? new URLSearchParams(location.search).get('institution') : null;
  const byArtist = heldBy ? new URLSearchParams(location.search).get('artist') : null;
  const holding = (e: Entry<AnyItem>) => {
    const h = (e.item as ArtworkItem).holders;
    return h?.now.some((x) => x.slug === heldBy) ? 'now' : h?.before.some((x) => x.slug === heldBy) ? 'before' : null;
  };
  const inHolding = (e: Entry<AnyItem>) => !!holding(e) && (!byArtist || creatorsOf(e.item as ArtworkItem).some((c) => c.slug === byArtist));
  const museumName = () => all.flatMap((e) => { const h = (e.item as ArtworkItem).holders; return h ? [...h.now, ...h.before] : []; })
    .find((x) => x.slug === heldBy)?.name ?? heldBy ?? '';
  const holdingSections = (hits: Entry<AnyItem>[]) => {
    const sorted = sortEntries(hits, sort);
    return [...sorted.filter((e) => holding(e) === 'now').map((entry) => ({ entry, heading: `In the ${museumName()} now` })),
      ...sorted.filter((e) => holding(e) === 'before').map((entry) => ({ entry, heading: 'Formerly there' }))];
  };
  const categoriesEl = main.querySelector<HTMLElement>('#categories')!;
  // artworks: works with no holder known somewhere in 1933–1945 (API 078, `?provenance_gap=1933-1945`)
  const gapEl = main.querySelector<HTMLElement>('#gap-filter')!;
  let gapOnly = plural === 'artworks' && new URLSearchParams(location.search).get('provenance_gap') === '1933-1945';
  const openQuestion = (e: Entry<AnyItem>) => !!(e.item as { provenance_coverage?: { gap_1933_1945: boolean } | null }).provenance_coverage?.gap_1933_1945;
  const urlNow = () => {
    const q = new URLSearchParams();
    if (category && FILTER) q.set(FILTER.param, category);
    if (gapOnly) q.set('provenance_gap', '1933-1945');
    if (heldBy) q.set('institution', heldBy);
    if (byArtist) q.set('artist', byArtist);
    return `/${plural}${q.size ? `?${q}` : ''}`;
  };
  function drawGapFilter() {
    const n = all.filter(openQuestion).length;
    gapEl.hidden = !n && !gapOnly;
    render(gapEl, html`<button type="button" class="${gapOnly ? 'on' : ''}" aria-pressed="${String(gapOnly)}"
      title="No holder known for some time between 30 January 1933 and 8 May 1945">Works with open questions 1933–1945 <span class="muted">${String(n)}</span></button>
      <a class="gap-filter-link" href="/provenance/1933-1945">Through whose hands, 1933–1945 →</a>`);
  }
  gapEl.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('button')) return;
    gapOnly = !gapOnly;
    replaceUrl(urlNow());
    drawGapFilter();
    draw();
  });
  function drawCategories() {
    const counts = new Map<string, number>();
    for (const e of all) { const c = fieldOf(e); counts.set(c, (counts.get(c) ?? 0) + 1); }
    if (category && !counts.has(category)) category = null;
    categoriesEl.hidden = counts.size < 2 && !category;
    render(categoriesEl, html`${plural === 'artworks' ? html`<span class="category-filter-label" title="Categories of the Swiss Federal Office of Culture">Provenance 1933–1945</span>` : ''}<button type="button" data-category="" class="${category ? '' : 'on'}" aria-pressed="${String(!category)}">All <span class="muted">${String(all.length)}</span></button>
      ${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => html`<button type="button" data-category="${c}" class="${c === category ? 'on' : ''}" aria-pressed="${String(c === category)}">${labelOf(c)} <span class="muted">${String(n)}</span></button>`)}`);
  }
  categoriesEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-category]');
    if (!b) return;
    category = b.dataset.category || null;
    replaceUrl(urlNow());
    drawCategories();
    draw();
  });

  /** Museums: the artists of their works whose names the search matches (every word), most works first. */
  const artistsMatched = (e: Entry<AnyItem>, words: string[]) => (plural !== 'institutions' || !words.length ? []
    : ((e.item as InstitutionItem).artists_held ?? []).filter((a) => words.every((w) => fold(a.name).includes(w))));
  const worksLink = (e: Entry<AnyItem>, a: NonNullable<InstitutionItem['artists_held']>[number]) => {
    const n = a.now + a.before;
    return html`<a href="/artworks?${new URLSearchParams({ artist: a.slug, institution: e.slug }).toString()}">${String(n)} ${n === 1 ? 'work' : 'works'} by ${a.name}</a>${
      a.before ? html` <span class="muted">(${a.now ? `${a.now} there now, ` : ''}${String(a.before)} formerly)</span>` : ''}`;
  };

  function draw() {
    const asked = query;
    const query_ = corrected ?? query;
    const parsed = parseQuery(query_);
    const words = parsed.words;
    const inWhole = partOf ? all.filter((e) => (e.item as { part_of?: { slug: string } | null }).part_of?.slug === partOf) : all;
    const pool = (category ? inWhole.filter((e) => fieldOf(e) === category) : inWhole).filter((e) => !gapOnly || openQuestion(e))
      .filter((e) => !heldBy || inHolding(e));
    const hits = query_ ? pool.filter((e) => matches(e, parsed)) : pool;
    let last = '';
    const row = (e: Entry<AnyItem>) => {
      const p = cardParts(plural, e.item);
      const byArtist = artistsMatched(e, words);
      // a museum found through an artist: how many of their works, linked to them (instead of "Works by: …")
      return card(plural, e.item, words, query_ && !byArtist.length ? explain(e, query_, `${p.date} ${p.detail} ${original(e.item)?.text ?? ""}`).why : null, '',
        byArtist.length ? html`${byArtist.map((a, i) => html`${i ? ' · ' : ''}${worksLink(e, a)}`)}` : null);
    };
    const worksOf = (e: Entry<AnyItem>) => artistsMatched(e, words).reduce((n, a) => n + a.now + a.before, 0);
    const list = heldBy ? holdingSections(hits) : ordered(hits, query_, sort);
    // museums found through an artist: those with the most of their works first
    if (plural === 'institutions' && words.length) {
      const tier = list.filter((x) => x.heading === 'With works by a matching artist').sort((a, b) => worksOf(b.entry) - worksOf(a.entry));
      list.splice(list.length - tier.length, tier.length, ...tier);
    }
    render(items, html`
      ${list.map(({ entry: e, heading: h }) => {
        const head = h !== last ? html`<li class="cards-heading">${h}</li>` : '';
        last = h;
        return html`${head}${row(e)}`;
      })}
      ${similar.length ? html`<li class="cards-heading cards-heading-similar">Similar names</li>${similar.map((e) => card(plural, e.item))}` : ''}
      ${!hits.length && !similar.length ? html`<li class="muted">${query_ ? `Nothing found for “${query_}”.` : 'No entries yet.'}</li>` : ''}`);
    const total = pool.length;
    render(count, query_
      ? html`${hits.length} of ${total} match${similar.length ? `, ${similar.length} similar ${similar.length === 1 ? 'name' : 'names'}` : ''}${
        parsed.special ? html` <span class="query-read" title="How the search was read">· ${describeQuery(parsed)}</span>` : ''}${
        corrected ? html`<span class="query-fix"> — nothing for “${asked}”, showing “${corrected}”. <button type="button" class="link-button" data-literal>Search for “${asked}” instead</button></span>` : ''}${
        suggested ? html`<span class="query-fix"> — did you mean <button type="button" class="link-button" data-suggest="${suggested}">${suggested}</button>?</span>` : ''}`
      : html`${total} ${total === 1 ? 'entry' : 'entries'}`);
  }

  // same search as the explore pickers: every word in name, details or hidden fields (type, birthplace …)
  let request = 0;
  async function search(q: string) {
    query = q;
    similar = [];
    corrected = null;
    suggested = null;
    draw();
    const positive = parseQuery(q).positive;
    if (positive.length < 3) return;
    const mine = ++request;
    const local = all.filter((e) => matches(e, q)).length;
    // a misspelt word (API 113): nothing found → search the correction; few found → offer it
    if (local < 3 && literal !== q) {
      suggest(positive).then((s) => {
        if (mine !== request || !current() || query !== q || !s.query) return;
        const fixed = applySuggestion(q, s);
        if (fixed === q) return;
        const found = all.filter((e) => matches(e, fixed)).length;
        if (!found) return;
        if (local) suggested = fixed; else { corrected = fixed; similar = []; }
        draw();
      }).catch(() => { /* no suggestion: the search as typed stands */ });
    }
    try {
      const res = await listEntities(plural, { q: positive, limit: 20 });
      if (mine !== request || !current() || query !== q || corrected) return;
      // typo-tolerant name matches only when nothing matched as typed (otherwise mostly noise, see search.ts)
      similar = local ? [] : entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      if (similar.length) draw();
    } catch {
      /* the field search above still stands */
    }
  }
  // "Search for … instead" / "did you mean …?"
  count.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button[data-literal], button[data-suggest]');
    if (!b) return;
    if (b.dataset.suggest) filter.value = b.dataset.suggest;
    else literal = query;
    void search(filter.value.trim());
  });

  listAll(plural)
    .then((res) => {
      if (!current()) return;
      all = entries(plural, res.data as ItemByPlural[typeof plural][]) as Entry<AnyItem>[];
      if (FILTER) drawCategories();
      if (plural === 'artworks') drawGapFilter();
      if (partOf) {
        const whole = all.find((x) => x.slug === partOf);
        render(main.querySelector('#stats')!, html`Parts of ${whole ? link('artwork', partOf, whole.name) : partOf} · <a href="/artworks">all artworks</a>`);
        if (sortSelect.querySelector('option[value=series]')) { sort = 'series'; sortSelect.value = 'series'; }
      }
      if (heldBy) {
        const artist = byArtist ? all.flatMap((e) => creatorsOf(e.item as ArtworkItem)).find((c) => c.slug === byArtist) : null;
        render(main.querySelector('#stats')!, html`${byArtist ? html`Works by ${link('artist', byArtist, artist?.name ?? byArtist)} held` : 'Works held'} by
          ${link('institution', heldBy, museumName())}, now or before · <a href="/artworks">all artworks</a>`);
      }
      const stats = (res as unknown as { stats?: { total: number; read: number; reading: number; to_read: number } }).stats;
      if (stats && stats.total) render(main.querySelector('#stats')!, html`${String(stats.read)} read · ${String(stats.reading)} reading · ${String(stats.to_read)} to read`);
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
