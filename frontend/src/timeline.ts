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
}

export type YearWindow = { from: number; to: number };

export interface TimelineOptions {
  /** Called with whole years (inclusive) when a window is selected, or null when it is cleared. */
  onWindow?: (window: YearWindow | null) => void;
  /** Window to start with (e.g. from the URL); not reported through onWindow. */
  initialWindow?: YearWindow | null;
  /** Zoom/pan to start with, e.g. kept from before the rows changed; reported through onView. */
  initialView?: { from: number; to: number } | null;
  onView?: (view: { from: number; to: number }) => void;
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

export function renderTimeline(container: HTMLElement, rows: TimelineRow[], opts: TimelineOptions = {}) {
  const spans = rows
    .map((r) => {
      const start = decimalYear(r.from, 'from') ?? decimalYear(r.to, 'from');
      let end = decimalYear(r.to, 'to');
      const open = end === null;
      if (end === null) end = r.to || r.from ? NOW : start;
      return { ...r, start, end, open };
    })
    .filter((r): r is typeof r & { start: number; end: number } => r.start !== null && r.end !== null)
    .sort((a, b) => a.group.localeCompare(b.group) || a.start - b.start);

  if (!spans.length) {
    container.classList.remove('timeline');
    container.innerHTML = '<p class="muted">Nothing selected for the timeline.</p>';
    return { setWindow: () => {}, destroy: () => {} };
  }

  const min = Math.floor(Math.min(...spans.map((s) => s.start)) / 10) * 10;
  const max = Math.max(Math.ceil(Math.max(...spans.map((s) => s.end)) / 10) * 10, min + MIN_SPAN);

  // layout: groups stacked, rows inside
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
  const height = y + 8;
  const clipId = `tl-clip-${Math.random().toString(36).slice(2)}`;

  container.classList.add('timeline');
  container.innerHTML = `<div class="timeline-bar">
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
      const maxChars = Math.floor((labelW() - 12) / 6.6);
      const short = s.label.length > maxChars ? `${s.label.slice(0, maxChars - 1)}…` : s.label;
      labels.push(`<a href="${escape(s.href)}"><text class="row-label" x="${labelW() - 8}" y="${s.y + 14}">${escape(short)}<title>${escape(s.label)}</title></text></a>`);
      if (s.end < v0 || s.start > v1) return;
      const x1 = x(s.start);
      const w = Math.max(x(s.end) - x1, 3);
      bars.push(`<rect class="bar bar-${escape(s.group.toLowerCase())}${s.open ? ' bar-open' : ''}" data-i="${i}"${s.color ? ` style="fill:${escape(s.color)};opacity:.9"` : ''}
          x="${x1}" y="${s.y + 3}" width="${w}" height="${ROW - 8}" rx="3">
          <title>${escape(s.label)}: ${escape(s.from === s.to || !s.to ? s.from?.label ?? '' : `${s.from?.label ?? '?'} – ${s.to.label}`)}</title>
        </rect>`);
    });

    const win = windowSel
      ? `<rect class="window" x="${x(windowSel.from)}" y="${AXIS_H - 4}" width="${Math.max(x(windowSel.to + 1) - x(windowSel.from), 2)}" height="${height - AXIS_H + 4}"/>`
      : '';
    svg.innerHTML = `<defs><clipPath id="${clipId}"><rect x="${labelW()}" y="0" width="${plotW + 8}" height="${height}"/></clipPath></defs>
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

  // ---- pointer: drag the axis to pan, drag across the bars to pick a window, click a bar for its span ----
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
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
    destroy: () => ro.disconnect(),
  };
}
