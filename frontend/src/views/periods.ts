// Periods (/periods; API 100): when and where styles, movements and periods were active — one lane per region
// (Europe as a whole, Italy, France, the Low Countries, Germany, Japan …), phases under their style, approximate edges
// fading out, drafts not yet reviewed outlined. Below the lanes, the collection: the span of each period's works with a
// dot per work. A bar or a dragged window lists the works of those years.
import { getPeriods } from '../api';
import { href, html, render } from '../html';
import { replaceUrl } from '../router';
import { renderTimeline, type TimelineRow, type YearWindow } from '../timeline';
import type { DateRange, Period, Periods, PeriodWork } from '../types';
import { guard, showError } from './common';

const COLLECTION = 'In the collection';
const workHref = (w: PeriodWork) => (w.public_id ? `/artworks/${w.public_id}/${w.slug}` : href('artworks', w.slug));
const year = (d: DateRange | null) => d?.from_year ?? d?.to_year ?? null;
const overlaps = (d: DateRange | null, w: YearWindow) => {
  const a = d?.from_year ?? d?.to_year; const b = d?.to_year ?? d?.from_year;
  return a != null && b != null && a <= w.to && b >= w.from;
};

/** Periods with a span in the lane, parents first and their parts under them (depth for the indent). */
function laneRows(data: Periods, lane: string, phases: boolean): TimelineRow[] {
  const here = data.periods.filter((p) => p.spans.some((s) => s.place === lane));
  const bySlug = new Map(here.map((p) => [p.slug, p]));
  const start = (p: Period) => p.spans.find((s) => s.place === lane)!.period.from_year ?? 0;
  const roots = here.filter((p) => !p.parent || !bySlug.has(p.parent)).sort((a, b) => start(a) - start(b));
  const rows: TimelineRow[] = [];
  const add = (p: Period, depth: number) => {
    if (depth && !phases) return;
    const s = p.spans.find((x) => x.place === lane)!;
    rows.push({
      group: data.lanes.find((l) => l.slug === lane)!.name, label: p.name, href: href('movements', p.slug),
      from: s.period, to: s.period, fade: s.fuzzy, draft: !p.reviewed, indent: depth, key: `movement/${p.slug}`,
    });
    here.filter((c) => c.parent === p.slug).sort((a, b) => start(a) - start(b)).forEach((c) => add(c, depth + 1));
  };
  roots.forEach((p) => add(p, 0));
  return rows;
}

/** The collection: per period with works, the span of their dates and a dot per work. */
function collectionRows(data: Periods, phases: boolean): TimelineRow[] {
  return data.periods
    .filter((p) => p.works.length && (phases || !p.parent))
    .map((p) => {
      const ys = p.works.flatMap((w) => [w.created?.from_year, w.created?.to_year]).filter((y): y is number => y != null);
      if (!ys.length) return null;
      const span: DateRange = { label: `${Math.min(...ys)}–${Math.max(...ys)}`, from: `${Math.min(...ys)}-01-01`, to: `${Math.max(...ys)}-12-31`, from_year: Math.min(...ys), to_year: Math.max(...ys) };
      return {
        group: COLLECTION, label: `${p.name} (${p.works.length})`, href: href('movements', p.slug), from: span, to: span, thin: true,
        dots: p.works.filter((w) => year(w.created) != null).map((w) => ({ year: year(w.created)!, label: `${w.title}${w.creator ? `, ${w.creator}` : ''}${w.created ? ` (${w.created.label})` : ''}`, href: workHref(w) })),
      } as TimelineRow;
    })
    .filter((r): r is TimelineRow => !!r)
    .sort((a, b) => (a.from!.from_year ?? 0) - (b.from!.from_year ?? 0));
}

export function periodsPage(main: HTMLElement, params: URLSearchParams) {
  document.title = 'Periods · Art History';
  render(main, html`<section class="page periods-page">
    <h1>Periods</h1>
    <p class="muted">When and where styles, movements and periods were active. Their limits are not fixed: they differ from
      region to region and between authors — each lane shows a region, each bar cites its source on the entry's page.
      Approximate limits (“c. 1720”, “late 18th century”) fade out.</p>
    <div class="periods-controls" id="periods-controls"></div>
    <div id="periods-timeline"><p class="muted small">Loading…</p></div>
    <div id="periods-window" aria-live="polite"></div>
  </section>`);
  const controls = main.querySelector<HTMLElement>('#periods-controls')!;
  const box = main.querySelector<HTMLElement>('#periods-timeline')!;
  const out = main.querySelector<HTMLElement>('#periods-window')!;
  const current = guard();

  getPeriods().then((data) => {
    if (!current()) return;
    const lanes = [...data.lanes.map((l) => l.slug), 'collection'];
    const wanted = (params.get('regions') || '').split(',').filter((x) => lanes.includes(x));
    const shown = new Set(wanted.length ? wanted : lanes);
    let phases = params.get('phases') !== '0';
    let windowSel: YearWindow | null = null;
    const from = Number(params.get('from')); const to = Number(params.get('to'));
    if (from && to) windowSel = { from: Math.min(from, to), to: Math.max(from, to) };

    const rows = () => [
      ...data.lanes.filter((l) => shown.has(l.slug)).flatMap((l) => laneRows(data, l.slug, phases)),
      ...(shown.has('collection') ? collectionRows(data, phases) : []),
    ];
    const keepUrl = () => {
      const q = new URLSearchParams();
      if (shown.size !== lanes.length) q.set('regions', [...shown].join(','));
      if (!phases) q.set('phases', '0');
      if (windowSel) { q.set('from', String(windowSel.from)); q.set('to', String(windowSel.to)); }
      replaceUrl(`/periods${q.size ? `?${q}` : ''}`);
    };

    function drawControls() {
      render(controls, html`<div class="category-filter" role="group" aria-label="Regions">
          ${data.lanes.map((l) => html`<button type="button" data-lane="${l.slug}" class="${shown.has(l.slug) ? 'on' : ''}" aria-pressed="${String(shown.has(l.slug))}">${l.name}</button>`)}
          <button type="button" data-lane="collection" class="${shown.has('collection') ? 'on' : ''}" aria-pressed="${String(shown.has('collection'))}">${COLLECTION}</button>
        </div>
        <label class="periods-phases"><input type="checkbox" ${phases ? 'checked' : ''}> phases (Early, High, Late …)</label>
        <span class="periods-legend muted small"><span class="legend-bar legend-fade"></span> approximate limits
          <span class="legend-bar legend-draft"></span> not yet reviewed <span class="legend-dot"></span> a work of the collection</span>`);
    }
    drawControls();
    controls.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-lane]');
      if (!b) return;
      const lane = b.dataset.lane!;
      if (shown.has(lane) && shown.size > 1) shown.delete(lane); else shown.add(lane);
      drawControls(); timeline.setRows(rows()); keepUrl();
    });
    controls.addEventListener('change', (e) => {
      if (!(e.target as HTMLInputElement).matches('.periods-phases input')) return;
      phases = (e.target as HTMLInputElement).checked;
      timeline.setRows(rows()); keepUrl();
    });

    // the works and periods of a window
    function showWindow(w: YearWindow | null) {
      windowSel = w;
      keepUrl();
      if (!w) { render(out, html``); return; }
      const active = data.periods.filter((p) => p.spans.some((s) => shown.has(s.place) && overlaps(s.period, w)));
      // each work once, with the most specific of its periods (not the parent style when a phase has it too)
      const works = new Map<string, { w: PeriodWork; periods: Period[] }>();
      for (const p of data.periods) {
        for (const x of p.works.filter((x) => overlaps(x.created, w))) {
          const e = works.get(x.slug) ?? { w: x, periods: [] };
          e.periods.push(p);
          works.set(x.slug, e);
        }
      }
      const specific = (ps: Period[]) => ps.filter((p) => !ps.some((c) => c.parent === p.slug));
      const list = [...works.values()].sort((a, b) => (year(a.w.created) ?? 0) - (year(b.w.created) ?? 0));
      render(out, html`<h2>${String(w.from)}–${String(w.to)}</h2>
        ${active.length ? html`<p class="periods-active">${active.map((p, i) => html`${i ? ' · ' : ''}<a href="${href('movements', p.slug)}">${p.name}</a> <span class="muted small">${p.spans.filter((s) => shown.has(s.place) && overlaps(s.period, w)).map((s) => `${data.lanes.find((l) => l.slug === s.place)?.name ?? s.place} ${s.period.label}`).join('; ')}</span>`)}</p>` : html`<p class="muted">No period of the timeline in these years.</p>`}
        <h3>Works of the collection from these years <span class="muted small">${String(list.length)}</span></h3>
        ${list.length ? html`<ul class="rel-list periods-works">${list.map((e) => html`<li><a href="${workHref(e.w)}">${e.w.title}</a>${e.w.creator ? html` · ${e.w.creator}` : ''}${e.w.created ? html` <span class="muted">${e.w.created.label}</span>` : ''}
          ${specific(e.periods).map((p) => html` <span class="tag">${p.name}</span>`)}</li>`)}</ul>`
        : html`<p class="muted">None of the works linked to a period of the timeline is dated in these years.</p>`}`);
    }

    box.innerHTML = '';
    const timeline = renderTimeline(box, rows(), { keepOrder: true, initialWindow: windowSel, onWindow: showWindow });
    if (windowSel) showWindow(windowSel);
  }).catch((err) => { if (current()) showError(box, err); });
}

