// Periods (/periods; API 100): when and where styles, movements and periods were active — one lane per region
// (Europe as a whole, Italy, France, the Low Countries, Germany, Japan …), phases under their style, approximate edges
// fading out, drafts not yet reviewed outlined. The collection's works are dots on the bars — in the lane of the region
// where they were made (else Europe as a whole, else the period's first lane) —, hollow and red when dated outside the
// bar's span (an outlier, listed below the timeline). A bar or a dragged window lists the works of those years.
// Switched to artists (?show=artists, API 112): under each period its artists, one thin row each from birth to death —
// in the lane of where they lived and worked then —, their works of the period as dots on it; a life wholly outside
// the period's span outlined red. An artist of two periods appears under both, like a work.
import { getPeriods, getPreviews } from '../api';
import { href, html, render } from '../html';
import { replaceUrl } from '../router';
import { renderTimeline, type TimelineRow, type YearWindow } from '../timeline';
import { entryPreview, openFor, show } from '../glossary';
import type { DateRange, Period, PeriodArtist, Periods, PeriodWork } from '../types';
import { guard, showError } from './common';

const workHref = (w: PeriodWork) => (w.public_id ? `/artworks/${w.public_id}/${w.slug}` : href('artworks', w.slug));
const artistHref = (a: PeriodArtist) => (a.public_id ? `/artists/${a.public_id}/${a.slug}` : href('artists', a.slug));
type Show = 'works' | 'artists';
const year = (d: DateRange | null) => d?.from_year ?? d?.to_year ?? null;
const overlaps = (d: DateRange | null, w: YearWindow) => {
  const a = d?.from_year ?? d?.to_year; const b = d?.to_year ?? d?.from_year;
  return a != null && b != null && a <= w.to && b >= w.from;
};

const yearsOf = (d: DateRange | null) => {
  const a = d?.from_year ?? d?.to_year; const b = d?.to_year ?? d?.from_year;
  return a != null && b != null ? [a, b] as const : null;
};
/** The lane a work of the period is drawn in: where it was made, if the period has a span there; else Europe as a whole, else the first. */
function laneOf(p: Period, w: { places: string[] }) {
  const here = p.spans.find((s) => (w.places ?? []).includes(s.place));
  return (here ?? p.spans.find((s) => s.place === 'europe') ?? p.spans[0])?.place;
}
/** A work dated wholly outside the span (its outer limits) — an outlier there. */
const outside = (w: PeriodWork, span: DateRange) => {
  const wy = yearsOf(w.created); const sy = yearsOf(span);
  return !!(wy && sy && (wy[1] < sy[0] || wy[0] > sy[1]));
};
/** Where an artist lived and worked during the period — else where their works of it were made: for the lane. */
const artistPlaces = (p: Period, a: PeriodArtist) => ({
  places: a.places.length ? a.places : p.works.filter((w) => w.creator_slug === a.slug).flatMap((w) => w.places ?? []),
});
/** An artist whose life lies wholly outside the span: before or after the period there. */
const lifeOutside = (a: PeriodArtist, span: DateRange) => {
  const ly = yearsOf(a.life); const sy = yearsOf(span);
  return !!(ly && sy && (ly[1] < sy[0] || ly[0] > sy[1]));
};
const workLabel = (w: PeriodWork) => `${w.title}${w.creator ? `, ${w.creator}` : ''}${w.created ? ` (${w.created.label})` : ''}${w.made_in ? ` · made in ${w.made_in}` : ''}`;

/** Periods with a span in the lane, parents first and their parts under them (depth for the indent). */
function laneRows(data: Periods, lane: string, phases: boolean, show: Show): TimelineRow[] {
  const here = data.periods.filter((p) => p.spans.some((s) => s.place === lane));
  const bySlug = new Map(here.map((p) => [p.slug, p]));
  const start = (p: Period) => p.spans.find((s) => s.place === lane)!.period.from_year ?? 0;
  const roots = here.filter((p) => !p.parent || !bySlug.has(p.parent)).sort((a, b) => start(a) - start(b));
  const rows: TimelineRow[] = [];
  const add = (p: Period, depth: number) => {
    if (depth && !phases) return;
    const s = p.spans.find((x) => x.place === lane)!;
    const group = data.lanes.find((l) => l.slug === lane)!.name;
    const dot = (w: PeriodWork) => {
      const [a, b] = yearsOf(w.created)!;
      const out = outside(w, s.period);
      return { year: (a + b) / 2, label: `${workLabel(w)}${out ? ` — dated outside ${p.name} here (${s.period.label})` : ''}`, href: workHref(w), outlier: out };
    };
    const dots = show === 'works' ? p.works.filter((w) => laneOf(p, w) === lane && yearsOf(w.created)).map(dot) : [];
    rows.push({
      group, label: p.name, href: href('movements', p.slug),
      from: s.period, to: s.period, fade: s.fuzzy, draft: !p.reviewed, indent: depth, key: `movement/${p.slug}`, dots,
    });
    if (show === 'artists') {
      // its artists in this lane — those of a phase shown under the phase, not again under its style
      const inPhase = new Set(phases ? here.filter((c) => c.parent === p.slug).flatMap((c) => c.artists.filter((a) => laneOf(c, artistPlaces(c, a)) === lane).map((a) => a.slug)) : []);
      for (const a of p.artists.filter((x) => laneOf(p, artistPlaces(p, x)) === lane && x.life && !inPhase.has(x.slug))) {
        const out = lifeOutside(a, s.period);
        rows.push({
          group, label: a.name, href: artistHref(a), from: a.life, to: a.life, fade: a.fuzzy, thin: true, outside: out, indent: depth + 1,
          key: `artist/${a.slug}`,
          dots: p.works.filter((w) => w.creator_slug === a.slug && yearsOf(w.created)).map(dot),
        });
      }
    }
    here.filter((c) => c.parent === p.slug).sort((a, b) => start(a) - start(b)).forEach((c) => add(c, depth + 1));
  };
  roots.forEach((p) => add(p, 0));
  return rows;
}

/** Artists whose life lies outside the span of the period they are drawn under. */
function artistOutliers(data: Periods) {
  const out: { a: PeriodArtist; p: Period; lane: string; span: DateRange }[] = [];
  for (const p of data.periods) {
    for (const a of p.artists) {
      const lane = laneOf(p, artistPlaces(p, a));
      const s = p.spans.find((x) => x.place === lane);
      if (s && lifeOutside(a, s.period)) out.push({ a, p, lane: data.lanes.find((l) => l.slug === lane)?.name ?? lane ?? '', span: s.period });
    }
  }
  return out.sort((a, b) => a.p.name.localeCompare(b.p.name) || (yearsOf(a.a.life)?.[0] ?? 0) - (yearsOf(b.a.life)?.[0] ?? 0));
}

/** Works dated outside the span of the bar they are drawn on: [work, period, lane name, span]. */
function outliers(data: Periods) {
  const out: { w: PeriodWork; p: Period; lane: string; span: DateRange }[] = [];
  for (const p of data.periods) {
    for (const w of p.works) {
      const lane = laneOf(p, w);
      const s = p.spans.find((x) => x.place === lane);
      if (s && outside(w, s.period)) out.push({ w, p, lane: data.lanes.find((l) => l.slug === lane)?.name ?? lane ?? '', span: s.period });
    }
  }
  return out.sort((a, b) => a.p.name.localeCompare(b.p.name) || (yearsOf(a.w.created)?.[0] ?? 0) - (yearsOf(b.w.created)?.[0] ?? 0));
}

/**
 * A work's dot clicked: its preview (as on every link to an entry); clicked again — the dot or the preview — the work
 * opens in a new tab, and the periods stay where they are.
 */
function workDot(href: string, el: Element) {
  const openTab = () => window.open(href, '_blank', 'noopener');
  if (openFor() === el) return openTab();
  const slug = href.split('/').filter(Boolean).pop()!;
  const label = el.querySelector('title')?.textContent ?? slug;
  const fallback = html`<div class="popover-text"><div class="glossary-popover-head"><strong>${label}</strong></div><a href="${href}">Open →</a></div>`;
  const open = (content: typeof fallback, kind: string) => {
    show(el as HTMLElement, content, kind);
    const pop = document.getElementById('text-popover');
    if (!pop) return;
    pop.classList.add('popover-clickable');
    pop.title = 'Click to open in a new tab';
    pop.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    pop.addEventListener('click', (e) => {
      if ((e.target as Element).closest('a')) return; // its own link opens the new tab
      openTab();
    });
  };
  getPreviews([`artwork/${slug}`])
    .then((data) => {
      const hint = data[`artwork/${slug}`];
      open(hint ? entryPreview(hint, href) : fallback, hint?.image_url ? 'entry has-image' : 'entry');
    })
    .catch(() => open(fallback, 'entry'));
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
    <div id="periods-outliers"></div>
    <div id="periods-window" aria-live="polite"></div>
  </section>`);
  const controls = main.querySelector<HTMLElement>('#periods-controls')!;
  const box = main.querySelector<HTMLElement>('#periods-timeline')!;
  const out = main.querySelector<HTMLElement>('#periods-window')!;
  const odd = main.querySelector<HTMLElement>('#periods-outliers')!;
  const current = guard();

  getPeriods().then((data) => {
    if (!current()) return;
    const lanes = data.lanes.map((l) => l.slug);
    const wanted = (params.get('regions') || '').split(',').filter((x) => lanes.includes(x));
    const shown = new Set(wanted.length ? wanted : lanes);
    let phases = params.get('phases') !== '0';
    let show: Show = params.get('show') === 'artists' ? 'artists' : 'works';
    let windowSel: YearWindow | null = null;
    const from = Number(params.get('from')); const to = Number(params.get('to'));
    if (from && to) windowSel = { from: Math.min(from, to), to: Math.max(from, to) };

    const rows = () => data.lanes.filter((l) => shown.has(l.slug)).flatMap((l) => laneRows(data, l.slug, phases, show));
    const strays = outliers(data);
    const drawOutliers = () => {
      if (show === 'artists') {
        const lost = artistOutliers(data);
        render(odd, lost.length ? html`<details class="periods-outliers"><summary>Lived outside their period <span class="muted small">${String(lost.length)}</span></summary>
          <p class="muted small">Artists linked to a period (directly or through a work) whose life lies wholly before or after its span in the region where
            they lived — a revival, a link to check, or a span to widen.</p>
          <ul class="rel-list">${lost.map((x) => html`<li><a href="${artistHref(x.a)}">${x.a.name}</a> <span class="muted">${x.a.life?.label ?? ''}</span>
            — <a href="${href('movements', x.p.slug)}">${x.p.name}</a> <span class="muted small">${x.lane} ${x.span.label}</span></li>`)}</ul></details>` : html``);
        return;
      }
      render(odd, strays.length ? html`<details class="periods-outliers"><summary>Dated outside their period <span class="muted small">${String(strays.length)}</span></summary>
      <p class="muted small">Works of the collection linked to a period (directly or through their artist) but dated outside its span in the region where
        they were made — a work made before or after the style, a link to check, or a span to widen.</p>
      <ul class="rel-list">${strays.map((x) => html`<li><a href="${workHref(x.w)}">${x.w.title}</a>${x.w.creator ? html` · ${x.w.creator}` : ''}
        <span class="muted">${x.w.created?.label ?? ''}</span> — <a href="${href('movements', x.p.slug)}">${x.p.name}</a>
        <span class="muted small">${x.lane} ${x.span.label}</span></li>`)}</ul></details>` : html``);
    };
    drawOutliers();
    const keepUrl = () => {
      const q = new URLSearchParams();
      if (shown.size !== lanes.length) q.set('regions', [...shown].join(','));
      if (!phases) q.set('phases', '0');
      if (show === 'artists') q.set('show', 'artists');
      if (windowSel) { q.set('from', String(windowSel.from)); q.set('to', String(windowSel.to)); }
      replaceUrl(`/periods${q.size ? `?${q}` : ''}`);
    };

    function drawControls() {
      render(controls, html`<div class="category-filter periods-show" role="group" aria-label="Show">
          ${(['works', 'artists'] as const).map((k) => html`<button type="button" data-show="${k}" class="${show === k ? 'on' : ''}" aria-pressed="${String(show === k)}">${k === 'works' ? 'Works' : 'Artists'}</button>`)}
        </div>
        <div class="category-filter" role="group" aria-label="Regions">
          ${data.lanes.map((l) => html`<button type="button" data-lane="${l.slug}" class="${shown.has(l.slug) ? 'on' : ''}" aria-pressed="${String(shown.has(l.slug))}">${l.name}</button>`)}
        </div>
        <label class="periods-phases"><input type="checkbox" ${phases ? 'checked' : ''}> phases (Early, High, Late …)</label>
        <span class="periods-legend muted small"><span class="legend-bar legend-fade"></span> approximate limits
          <span class="legend-bar legend-draft"></span> not yet reviewed
          ${show === 'artists' ? html`<span class="legend-bar legend-life"></span> an artist's life <span class="legend-bar legend-life legend-life-out"></span> lived outside the period` : html``}
          <span class="legend-dot"></span> a work of the collection
          <span class="legend-dot legend-dot-out"></span> dated outside the period</span>`);
    }
    drawControls();
    controls.addEventListener('click', (e) => {
      const m = (e.target as Element).closest<HTMLButtonElement>('button[data-show]');
      if (m) {
        show = m.dataset.show as Show;
        drawControls(); drawOutliers(); timeline.setRows(rows()); keepUrl();
        if (windowSel) showWindow(windowSel);
        return;
      }
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
      const periodsLine = active.length ? html`<p class="periods-active">${active.map((p, i) => html`${i ? ' · ' : ''}<a href="${href('movements', p.slug)}">${p.name}</a> <span class="muted small">${p.spans.filter((s) => shown.has(s.place) && overlaps(s.period, w)).map((s) => `${data.lanes.find((l) => l.slug === s.place)?.name ?? s.place} ${s.period.label}`).join('; ')}</span>`)}</p>` : html`<p class="muted">No period of the timeline in these years.</p>`;
      if (show === 'artists') {
        // each artist alive in these years once, with the most specific of their periods
        const people = new Map<string, { a: PeriodArtist; periods: Period[] }>();
        for (const p of data.periods) {
          for (const a of p.artists.filter((x) => overlaps(x.life, w))) {
            const e = people.get(a.slug) ?? { a, periods: [] };
            e.periods.push(p);
            people.set(a.slug, e);
          }
        }
        const alive = [...people.values()].sort((a, b) => (yearsOf(a.a.life)?.[0] ?? 0) - (yearsOf(b.a.life)?.[0] ?? 0));
        render(out, html`<h2>${String(w.from)}–${String(w.to)}</h2>${periodsLine}
          <h3>Artists of the periods alive in these years <span class="muted small">${String(alive.length)}</span></h3>
          ${alive.length ? html`<ul class="rel-list periods-works">${alive.map((e) => html`<li><a href="${artistHref(e.a)}">${e.a.name}</a> <span class="muted">${e.a.life?.label ?? ''}</span>
            ${specific(e.periods).map((p) => html` <span class="tag">${p.name}</span>`)}</li>`)}</ul>`
          : html`<p class="muted">None of the artists linked to a period of the timeline lived in these years.</p>`}`);
        return;
      }
      const list = [...works.values()].sort((a, b) => (year(a.w.created) ?? 0) - (year(b.w.created) ?? 0));
      render(out, html`<h2>${String(w.from)}–${String(w.to)}</h2>
        ${periodsLine}
        <h3>Works of the collection from these years <span class="muted small">${String(list.length)}</span></h3>
        ${list.length ? html`<ul class="rel-list periods-works">${list.map((e) => html`<li><a href="${workHref(e.w)}">${e.w.title}</a>${e.w.creator ? html` · ${e.w.creator}` : ''}${e.w.created ? html` <span class="muted">${e.w.created.label}</span>` : ''}
          ${specific(e.periods).map((p) => html` <span class="tag">${p.name}</span>`)}</li>`)}</ul>`
        : html`<p class="muted">None of the works linked to a period of the timeline is dated in these years.</p>`}`);
    }

    box.innerHTML = '';
    // prehistory reaches back 100,000 years (API 174): open on the last 5,000 when it does — zooming out shows it all
    const starts = rows().map((r) => r.from?.from_year ?? r.to?.from_year ?? r.to?.to_year).filter((y): y is number => y != null);
    const deep = starts.length > 0 && Math.min(...starts) < -5000;
    const recent = starts.filter((y) => y >= -5000);
    const initialView = deep && !windowSel && recent.length ? { from: Math.floor(Math.min(...recent) / 100) * 100, to: new Date().getFullYear() } : null;
    const timeline = renderTimeline(box, rows(), { keepOrder: true, initialWindow: windowSel, initialView, onWindow: showWindow, onDot: workDot });
    if (windowSel) showWindow(windowSel);
  }).catch((err) => { if (current()) showError(box, err); });
}

