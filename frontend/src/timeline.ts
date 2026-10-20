// A plain SVG timeline: one bar per lifespan/period, a year axis that zooms and pans, and a time window that is
// picked by dragging across the bars, by clicking a bar, or by typing years into the from/to fields.
//   zoom: − / + buttons, Ctrl+wheel or trackpad pinch (at the pointer), keys + and −; "Fit" or 0 shows everything
//   pan:  ◀ ▶ buttons, horizontal wheel or Shift+wheel, dragging the year axis (also on touch), arrow keys
import { escape } from './html';
import type { DateRange } from './types';

export interface TimelineRow {
  group: string; // "Artists", "Movements", …
  label: string;
  href: string;
  from: DateRange | null;
  to: DateRange | null; // same object as `from` for single ranges (a movement's period)
  color?: string; // matches the entity's colour on the map when it was picked individually
  key?: string; // "artist/vincent-van-gogh", for colorFor
  /** An edge known only roughly ("c. 1720", "late 18th century"): drawn fading out instead of ending hard. */
  fade?: { start?: boolean; end?: boolean };
  /** Not yet reviewed: drawn with a dashed outline. */
  draft?: boolean;
  /** A part of the row above (a phase of a style): its label indented. */
  indent?: number;
  /** Works of the collection on the bar, as dots at their year. */
  dots?: { year: number; label: string; href: string; outlier?: boolean }[];
  /** A thin bar (e.g. the span of the collection's works). */
  thin?: boolean;
  /** Lies wholly outside the row it belongs to (an artist who lived before or after their period): outlined red. */
  outside?: boolean;
}

export type YearWindow = { from: number; to: number };

export interface TimelineOptions {
  /** Called with whole years (inclusive) when a window is selected, or null when it is cleared. */
  onWindow?: (window: YearWindow | null) => void;
  /** A click on a work's dot (TimelineRow.dots), instead of following its link; `el` is the dot's link. */
  onDot?: (href: string, el: Element) => void;
  /** Window to start with (e.g. from the URL); not reported through onWindow. */
  initialWindow?: YearWindow | null;
  /** Zoom/pan to start with, e.g. kept from before the rows changed; reported through onView. */
  initialView?: { from: number; to: number } | null;
  onView?: (view: { from: number; to: number }) => void;
  /** Colour of a bar without its own `color` (e.g. its route on the map); asked on every repaint, see redraw(). */
  colorFor?: (row: TimelineRow) => string | undefined;
  /** Keep the rows' order (groups in the order they first appear) instead of sorting by group and start. */
  keepOrder?: boolean;
  /** The time axis' fixed extent instead of the rows' (e.g. so a filtered timeline keeps its scale). */
  extent?: { from: number; to: number };
}

const NOW = new Date().getFullYear();
const ROW = 22;
const GROUP_GAP = 18;
const AXIS_H = 26;
const MIN_SPAN = 5; // years visible at the deepest zoom
const STEPS = [1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000];

/** Decimal year of the start (`edge = 'from'`) or inclusive end (`'to'`) of a date. */
function decimalYear(d: DateRange | null, edge: 'from' | 'to'): number | null {
  if (!d) return null;
  const iso = d[edge];
  const year = d[`${edge}_year`];
  if (!iso) return year ?? null;
  const m = /^(-?\d+)-(\d\d)-(\d\d)/.exec(iso);
  if (!m) return year ?? null;
  const y = Number(m[1]) + (Number(m[2]) - 1) / 12 + (Number(m[3]) - 1) / 365;
  return edge === 'to' ? y + 1 / 365 : y; // `to` is inclusive
}

const yearLabel = (t: number) => (t < 0 ? `${-t} BCE` : String(t));

/** Bars with decimal years, stacked by group: the timeline's extent (`min`–`max`) and height. */
function layout(rows: TimelineRow[], keepOrder = false, extent?: { from: number; to: number }) {
  const spans = rows
    .map((r) => {
      const start = decimalYear(r.from, 'from') ?? decimalYear(r.to, 'from');
      let end = decimalYear(r.to, 'to');
      const open = end === null;
      if (end === null) end = r.to || r.from ? NOW : start;
      return { ...r, start, end, open };
    })
    .filter((r): r is typeof r & { start: number; end: number } => r.start !== null && r.end !== null)
    .sort((a, b) => (keepOrder ? 0 : a.group.localeCompare(b.group) || a.start - b.start));
  if (keepOrder) { // groups together, in the order they first appear
    const firstSeen = new Map<string, number>();
    spans.forEach((s, i) => { if (!firstSeen.has(s.group)) firstSeen.set(s.group, i); });
    spans.sort((a, b) => firstSeen.get(a.group)! - firstSeen.get(b.group)!);
  }
  if (!spans.length) return { min: 0, max: MIN_SPAN, placed: [], height: 0 };

  const min = extent ? extent.from : Math.floor(Math.min(...spans.map((s) => s.start)) / 10) * 10;
  const max = extent ? extent.to : Math.max(Math.ceil(Math.max(...spans.map((s) => s.end)) / 10) * 10, min + MIN_SPAN);

  // groups stacked, rows inside
  let y = AXIS_H + 6;
  let lastGroup = '';
  const placed = spans.map((s) => {
    if (s.group !== lastGroup) {
      if (lastGroup) y += GROUP_GAP;
      y += 18; // group heading
      lastGroup = s.group;
    }
    const row = { ...s, y, heading: y - 18 };
    y += ROW;
    return row;
  });
  return { min, max, placed, height: y + 8 };
}

export function renderTimeline(container: HTMLElement, rows: TimelineRow[], opts: TimelineOptions = {}) {
  let { min, max, placed, height } = layout(rows, opts.keepOrder, opts.extent);
  const clipId = `tl-clip-${Math.random().toString(36).slice(2)}`;

  container.classList.add('timeline');
  container.innerHTML = `<p class="muted timeline-empty" hidden>Nothing selected for the timeline.</p><div class="timeline-bar">
      <form class="timeline-form" novalidate>
        <label>From <input type="number" name="from" step="1" inputmode="numeric" placeholder="year"></label>
        <label>to <input type="number" name="to" step="1" inputmode="numeric" placeholder="year"></label>
        <button type="submit">Apply</button>
        <button type="button" class="timeline-clear" hidden>Clear</button>
      </form>
      <div class="timeline-zoom" role="group" aria-label="Zoom and move the timeline">
        <button type="button" data-zoom="pan-left" aria-label="Move earlier" title="Earlier (←)">◀</button>
        <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" data-zoom="pan-right" aria-label="Move later" title="Later (→)">▶</button>
        <button type="button" data-zoom="fit" title="Show everything (0)">Fit</button>
        <span class="timeline-view muted"></span>
      </div>
    </div>
    <p class="timeline-hint muted">Drag across the bars to pick a time window, or click a bar to use its span. Drag the year axis to move; Ctrl + wheel to zoom.</p>
    <svg class="timeline-svg" tabindex="0" role="img" aria-label="Timeline of lifespans and periods. Arrow keys move, plus and minus zoom, 0 shows everything."></svg>`;
  const svg = container.querySelector('svg')!;
  const form = container.querySelector<HTMLFormElement>('.timeline-form')!;
  const fromInput = form.elements.namedItem('from') as HTMLInputElement;
  const toInput = form.elements.namedItem('to') as HTMLInputElement;
  const clear = container.querySelector<HTMLButtonElement>('.timeline-clear')!;
  const viewLabel = container.querySelector<HTMLElement>('.timeline-view')!;
  const empty = container.querySelector<HTMLElement>('.timeline-empty')!;
  const parts = [container.querySelector<HTMLElement>('.timeline-bar')!, container.querySelector<HTMLElement>('.timeline-hint')!, svg];

  let windowSel: YearWindow | null = opts.initialWindow ?? null;
  let v0 = min; // visible range in (decimal) years
  let v1 = max;

  // narrow screens get a narrower name column (long names are shortened, the full name is in the tooltip)
  const svgWidth = () => Math.max(container.clientWidth - 16, 280);
  const labelW = () => (svgWidth() < 560 ? 112 : 170);
  const plotWidth = () => svgWidth() - labelW() - 8;
  const x = (year: number) => labelW() + ((year - v0) / (v1 - v0)) * plotWidth();
  const yearAt = (px: number) => v0 + ((px - labelW()) / plotWidth()) * (v1 - v0);

  function setView(a: number, b: number) {
    let span = Math.min(Math.max(b - a, MIN_SPAN), max - min);
    span = Math.max(span, Math.min(MIN_SPAN, max - min));
    let start = Math.min(Math.max(a, min), max - span);
    if (!Number.isFinite(start)) start = min;
    v0 = start;
    v1 = start + span;
    draw();
    opts.onView?.({ from: v0, to: v1 });
  }
  const zoom = (factor: number, center = (v0 + v1) / 2) => {
    const share = (center - v0) / (v1 - v0);
    const span = (v1 - v0) * factor;
    setView(center - share * span, center - share * span + span);
  };
  const pan = (share: number) => setView(v0 + (v1 - v0) * share, v1 + (v1 - v0) * share);

  function draw() {
    // nothing to show: only the note (the controls come back with the rows, typed years and all)
    empty.hidden = placed.length > 0;
    parts.forEach((el) => el.toggleAttribute('hidden', !placed.length));
    if (!placed.length) return;
    const width = svgWidth();
    const plotW = plotWidth();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const span = v1 - v0;
    const step = STEPS.find((s) => (plotW / span) * s >= 70) ?? STEPS[STEPS.length - 1];
    const ticks: string[] = [];
    for (let t = Math.ceil(v0 / step) * step; t <= v1; t += step) {
      ticks.push(`<line class="tick" x1="${x(t)}" x2="${x(t)}" y1="${AXIS_H - 4}" y2="${height}"/>
        ${x(t) - labelW() < 16 ? '' : `<text class="tick-label" x="${x(t)}" y="${AXIS_H - 10}">${yearLabel(t)}</text>`}`); // too close to the edge: would be cut in half
    }

    const groups = new Set<string>();
    const labels: string[] = [];
    const bars: string[] = [];
    placed.forEach((s, i) => {
      if (!groups.has(s.group)) labels.push(`<text class="group-label" x="4" y="${s.heading + 13}">${escape(s.group)}</text>`);
      groups.add(s.group);
      const maxChars = Math.floor((labelW() - 12) / 6.6) - (s.indent ?? 0) * 2;
      const short = s.label.length > maxChars ? `${s.label.slice(0, maxChars - 1)}…` : s.label;
      labels.push(`<a href="${escape(s.href)}"><text class="row-label${s.indent ? ' row-label-sub' : ''}" x="${labelW() - 8}" y="${s.y + 14}">${s.indent ? '· '.repeat(s.indent) : ''}${escape(short)}<title>${escape(s.label)}</title></text></a>`);
      if (s.end < v0 || s.start > v1) return;
      const x1 = x(s.start);
      const w = Math.max(x(s.end) - x1, 3);
      const fade = s.fade && (s.fade.start || s.fade.end) ? `fade-${s.fade.start ? 's' : ''}${s.fade.end ? 'e' : ''}` : '';
      const fill = s.color ?? opts.colorFor?.(s);
      const [by, bh] = s.thin ? [s.y + 8, 6] : [s.y + 3, ROW - 8];
      bars.push(`<rect class="bar bar-${escape(s.group.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}${s.open ? ' bar-open' : ''}${s.draft ? ' bar-draft' : ''}${s.thin ? ' bar-thin' : ''}${s.outside ? ' bar-outside' : ''}" data-i="${i}"${fill ? ` style="fill:${escape(fill)};opacity:.9"` : ''}
          ${fade ? `mask="url(#${clipId}-${fade})"` : ''} x="${x1}" y="${by}" width="${w}" height="${bh}" rx="3">
          <title>${escape(s.label)}: ${escape(s.from === s.to || !s.to ? s.from?.label ?? '' : `${s.from?.label ?? '?'} – ${s.to.label}`)}${s.draft ? ' (not yet reviewed)' : ''}</title>
        </rect>`);
      for (const d of s.dots ?? []) {
        if (d.year < v0 || d.year > v1) continue;
        bars.push(`<a href="${escape(d.href)}" class="tl-dot-link"><circle class="tl-dot${d.outlier ? ' tl-dot-out' : ''}" cx="${x(d.year + 0.5)}" cy="${s.y + 11}" r="${d.outlier ? 4 : 3.5}"><title>${escape(d.label)}</title></circle></a>`);
      }
    });

    const win = windowSel
      ? `<rect class="window" x="${x(windowSel.from)}" y="${AXIS_H - 4}" width="${Math.max(x(windowSel.to + 1) - x(windowSel.from), 2)}" height="${height - AXIS_H + 4}"/>`
      : '';
    // fading edges (TimelineRow.fade): masks over the bar's own box, a fifth of it at each rough end
    const ramp = (id: string, stops: [number, number][]) => `<linearGradient id="${clipId}-g${id}">${stops.map(([o, a]) => `<stop offset="${o}" stop-color="#fff" stop-opacity="${a}"/>`).join('')}</linearGradient>
      <mask id="${clipId}-fade-${id}" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#${clipId}-g${id})"/></mask>`;
    svg.innerHTML = `<defs><clipPath id="${clipId}"><rect x="${labelW()}" y="0" width="${plotW + 8}" height="${height}"/></clipPath>
      ${ramp('s', [[0, 0], [0.2, 1], [1, 1]])}${ramp('e', [[0, 1], [0.8, 1], [1, 0]])}${ramp('se', [[0, 0], [0.2, 1], [0.8, 1], [1, 0]])}</defs>
      <rect class="axis-band" x="${labelW()}" y="0" width="${plotW + 8}" height="${AXIS_H}"/>
      <g clip-path="url(#${clipId})">${ticks.join('')}${win}${bars.join('')}</g>
      <g>${labels.join('')}</g>`;

    const zoomed = v0 > min + 0.01 || v1 < max - 0.01;
    viewLabel.textContent = zoomed ? `showing ${yearLabel(Math.round(v0))}–${yearLabel(Math.round(v1))}` : '';
    container.querySelector<HTMLButtonElement>('[data-zoom="pan-left"]')!.disabled = v0 <= min + 0.01;
    container.querySelector<HTMLButtonElement>('[data-zoom="pan-right"]')!.disabled = v1 >= max - 0.01;
    container.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.disabled = !zoomed;
    container.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.disabled = v1 - v0 <= MIN_SPAN + 0.01;
  }

  // a work's dot: onDot instead of following the link (Ctrl/Cmd/middle click still open it in a new tab)
  svg.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<SVGAElement>('.tl-dot-link');
    if (!a || !opts.onDot || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    opts.onDot(a.getAttribute('href')!, a);
  });

  // ---- pointer: drag the axis to pan, drag across the bars to pick a window, click a bar for its span ----
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('.tl-dot-link')) return; // a work's dot: its own click (onDot), no drag

    const rect = svg.getBoundingClientRect();
    const px = (ev: PointerEvent) => ev.clientX - rect.left;
    const startPx = px(e);
    if (startPx < labelW()) return;
    const onAxis = e.clientY - rect.top < AXIS_H;
    const target = e.target as Element;
    const startView = [v0, v1];
    let moved = false;
    svg.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (Math.abs(px(ev) - startPx) < 4 && !moved) return;
      moved = true;
      if (onAxis) {
        const dy = ((px(ev) - startPx) / plotWidth()) * (startView[1] - startView[0]);
        setView(startView[0] - dy, startView[1] - dy);
      } else {
        const [a, b] = [yearAt(startPx), yearAt(px(ev))].sort((p, q) => p - q);
        setWindow({ from: Math.floor(a), to: Math.floor(b) }, false);
      }
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
      if (onAxis) return;
      if (moved) return setWindow(windowSel, true);
      const i = target.getAttribute('data-i');
      if (i !== null) {
        const s = placed[Number(i)];
        setWindow({ from: Math.floor(s.start), to: Math.floor(s.end - 1 / 365) }, true);
      }
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  });

  // Ctrl+wheel (and trackpad pinch, which arrives as Ctrl+wheel) zooms at the pointer; sideways scrolling pans.
  svg.addEventListener('wheel', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0025), px > labelW() ? yearAt(px) : undefined);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      pan(((e.shiftKey ? e.deltaY : e.deltaX) / plotWidth()) * 1.2);
    }
  }, { passive: false });

  svg.addEventListener('keydown', (e) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(-0.2), ArrowRight: () => pan(0.2),
      '+': () => zoom(0.6), '=': () => zoom(0.6), '-': () => zoom(1 / 0.6), '0': () => setView(min, max),
    };
    const act = actions[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  });

  container.querySelector('.timeline-zoom')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-zoom]');
    if (!b) return;
    ({ in: () => zoom(0.6), out: () => zoom(1 / 0.6), fit: () => setView(min, max), 'pan-left': () => pan(-0.3), 'pan-right': () => pan(0.3) } as Record<string, () => void>)[b.dataset.zoom!]();
  });

  // ---- typed window -------------------------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = fromInput.value.trim() === '' ? NaN : Number(fromInput.value);
    const b = toInput.value.trim() === '' ? NaN : Number(toInput.value);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return setWindow(null, true);
    const from = Math.round(Number.isFinite(a) ? a : b);
    const to = Math.round(Number.isFinite(b) ? b : a);
    const w = from <= to ? { from, to } : { from: to, to: from };
    setWindow(w, true);
    // bring the window into view
    if (w.from < v0 || w.to + 1 > v1) {
      const pad = Math.max((w.to - w.from) * 0.5, 5);
      setView(Math.min(v0, w.from - pad), Math.max(v1, w.to + 1 + pad));
    }
  });

  function setWindow(w: YearWindow | null, notify: boolean) {
    windowSel = w;
    clear.hidden = !w;
    if (document.activeElement !== fromInput) fromInput.value = w ? String(w.from) : '';
    if (document.activeElement !== toInput) toInput.value = w ? String(w.to) : '';
    draw();
    if (notify) opts.onWindow?.(w);
  }

  clear.onclick = () => {
    fromInput.value = toInput.value = '';
    setWindow(null, true);
  };
  if (opts.initialView) setView(opts.initialView.from, opts.initialView.to);
  setWindow(windowSel, false);
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  return {
    setWindow: (w: YearWindow | null) => setWindow(w, true),
    /** Repaints (e.g. new colours) without rebuilding the controls, so half-typed years stay. */
    redraw: () => draw(),
    /** New rows (the selection changed): same controls, window and typed years; a zoomed view stays where it was. */
    setRows(next: TimelineRow[]) {
      const zoomed = v0 > min + 0.01 || v1 < max - 0.01;
      ({ min, max, placed, height } = layout(next, opts.keepOrder, opts.extent));
      if (zoomed) setView(v0, v1);
      else setView(min, max);
    },
    destroy: () => ro.disconnect(),
  };
}
