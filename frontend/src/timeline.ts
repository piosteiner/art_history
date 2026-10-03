// A plain SVG timeline: one bar per lifespan/period, a year axis, and a draggable time window.
import { escape } from './html';
import type { DateRange } from './types';

export interface TimelineRow {
  group: string; // "Artists", "Movements", …
  label: string;
  href: string;
  from: DateRange | null;
  to: DateRange | null; // same object as `from` for single ranges (a movement's period)
}

export interface TimelineOptions {
  /** Called with whole years (inclusive) when a window is selected, or null when it is cleared. */
  onWindow?: (window: { from: number; to: number } | null) => void;
}

const NOW = new Date().getFullYear();
const ROW = 22;
const GROUP_GAP = 18;
const LABEL_W = 170;
const AXIS_H = 26;

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
    container.innerHTML = '<p class="muted">No dated entries yet.</p>';
    return;
  }

  const min = Math.floor(Math.min(...spans.map((s) => s.start)) / 10) * 10;
  const max = Math.ceil(Math.max(...spans.map((s) => s.end)) / 10) * 10;

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

  container.classList.add('timeline');
  container.innerHTML = `<div class="timeline-bar">
      <span class="timeline-hint">Drag across the timeline to pick a time window · click a bar to use its span</span>
      <span class="timeline-window" hidden></span>
      <button type="button" class="timeline-clear" hidden>Clear window</button>
    </div>
    <svg class="timeline-svg" role="img" aria-label="Timeline of lifespans and periods"></svg>`;
  const svg = container.querySelector('svg')!;
  const status = container.querySelector<HTMLElement>('.timeline-window')!;
  const clear = container.querySelector<HTMLButtonElement>('.timeline-clear')!;

  let windowSel: { from: number; to: number } | null = null;

  function draw() {
    const width = Math.max(container.clientWidth, 480);
    const plotW = width - LABEL_W - 16;
    const x = (year: number) => LABEL_W + ((year - min) / (max - min)) * plotW;
    const yearAt = (px: number) => min + ((px - LABEL_W) / plotW) * (max - min);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const span = max - min;
    const step = span > 600 ? 100 : span > 250 ? 50 : span > 100 ? 25 : 10;
    const ticks: string[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) {
      ticks.push(`<line class="tick" x1="${x(t)}" x2="${x(t)}" y1="${AXIS_H - 4}" y2="${height}"/>
        <text class="tick-label" x="${x(t)}" y="${AXIS_H - 10}">${t < 0 ? `${-t} BCE` : t}</text>`);
    }

    const groups = new Set<string>();
    const bars = placed.map((s, i) => {
      const heading = groups.has(s.group) ? '' : `<text class="group-label" x="4" y="${s.heading + 13}">${escape(s.group)}</text>`;
      groups.add(s.group);
      const x1 = x(s.start);
      const w = Math.max(x(s.end) - x1, 3);
      return `${heading}
        <a href="${escape(s.href)}"><text class="row-label" x="${LABEL_W - 8}" y="${s.y + 14}">${escape(s.label)}</text></a>
        <rect class="bar bar-${escape(s.group.toLowerCase())}${s.open ? ' bar-open' : ''}" data-i="${i}"
          x="${x1}" y="${s.y + 3}" width="${w}" height="${ROW - 8}" rx="3">
          <title>${escape(s.label)}: ${escape(s.from === s.to || !s.to ? s.from?.label ?? '' : `${s.from?.label ?? '?'} – ${s.to.label}`)}</title>
        </rect>`;
    });

    const win = windowSel
      ? `<rect class="window" x="${x(windowSel.from)}" y="${AXIS_H - 4}" width="${Math.max(x(windowSel.to + 1) - x(windowSel.from), 2)}" height="${height - AXIS_H + 4}"/>`
      : '';
    svg.innerHTML = `<g>${ticks.join('')}</g>${win}<g>${bars.join('')}</g>`;

    // dragging selects a window; a plain click on a bar uses the bar's span
    svg.onpointerdown = (e) => {
      const pt = (ev: PointerEvent) => ev.clientX - svg.getBoundingClientRect().left;
      const startPx = pt(e);
      if (startPx < LABEL_W) return;
      const target = e.target as Element;
      let moved = false;
      svg.setPointerCapture(e.pointerId);
      svg.onpointermove = (ev) => {
        if (Math.abs(pt(ev) - startPx) < 4) return;
        moved = true;
        const [a, b] = [yearAt(startPx), yearAt(pt(ev))].sort((p, q) => p - q);
        setWindow({ from: Math.floor(a), to: Math.floor(b) }, false);
      };
      svg.onpointerup = () => {
        svg.onpointermove = svg.onpointerup = null;
        if (moved) return setWindow(windowSel, true);
        const i = target.getAttribute('data-i');
        if (i !== null) {
          const s = placed[Number(i)];
          setWindow({ from: Math.floor(s.start), to: Math.floor(s.end - 1 / 365) }, true);
        }
      };
    };
  }

  function setWindow(w: { from: number; to: number } | null, notify: boolean) {
    windowSel = w;
    status.hidden = clear.hidden = !w;
    status.textContent = w ? (w.from === w.to ? `${w.from}` : `${w.from}–${w.to}`) : '';
    draw();
    if (notify) opts.onWindow?.(w);
  }

  clear.onclick = () => setWindow(null, true);
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  return {
    setWindow: (w: { from: number; to: number } | null) => setWindow(w, true),
    destroy: () => ro.disconnect(),
  };
}
