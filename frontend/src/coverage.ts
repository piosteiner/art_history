// Provenance coverage (API 078): where an artwork's provenance is silent. A bar from the creation until today —
// documented solid, presumed hatched, gaps open with a red edge, 1933–1945 shaded — and the wording of a gap, shared
// by the provenance list, the bar and the map.
import { html, type Html } from './html';
import type { CoverageSegment, ProvenanceCoverage, ProvenanceGap, Stretch } from './types';

// 30 January 1933 – 8 May 1945, as the API counts it (`in_1933_1945`)
const NS_FROM = Date.UTC(1933, 0, 30);
const NS_TO = Date.UTC(1945, 4, 8);

/** "1934–1946", "1934"; the API leaves the label of these stretches empty. */
export function years(p: Stretch | null): string {
  if (!p) return '';
  if (p.label) return p.label;
  const [a, b] = [p.from_year, p.to_year];
  return a != null && b != null ? (a === b ? `${a}` : `${a}–${b}`) : `${a ?? b ?? ''}`;
}

const possibly = (g: ProvenanceGap) => (g.candidates.length ? ` · possibly ${g.candidates.join(', ')}` : '');

/** "Gap 1934–1946 — no holder known · possibly Arthur Jeffress, Gerald Corcoran". */
export const gapText = (g: ProvenanceGap) => `Gap ${years(g.period)} — no holder known${possibly(g)}`;

/** "after Alfred Gold, before Arthur Byron" — the holders on either side. */
export const gapSides = (g: ProvenanceGap) =>
  [g.before ? `after ${g.before}` : '', g.after ? `before ${g.after}` : ''].filter(Boolean).join(', ');

const KIND_LABEL: Record<CoverageSegment['kind'], string> = { documented: 'Documented', presumed: 'Presumed (a holder is known, not the dates)', gap: 'Gap' };

function segmentTitle(s: CoverageSegment): string {
  if (s.kind !== 'gap') return `${KIND_LABEL[s.kind]} ${years(s.period)}`;
  const sides = gapSides(s);
  return `Gap ${years(s.period)}: no holder known${sides ? ` (${sides})` : ''}${s.candidates.length ? `. Possibly: ${s.candidates.join(', ')}` : ''}${s.in_1933_1945 ? '. Touches 1933–1945.' : ''}`;
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(`${iso}T00:00:00Z`) : NaN);

/**
 * The bar above the provenance: the stretches from the creation until today in proportion, 1933–1945 shaded behind.
 * Null without a recorded provenance (then it would be one long gap, which the list says better).
 */
export function coverageBar(cov: ProvenanceCoverage | null | undefined): Html | null {
  if (!cov?.has_provenance || !cov.segments.length) return null;
  const start = time(cov.segments[0].period?.from);
  const end = time(cov.segments.at(-1)!.period?.to);
  if (!(end > start)) return null;
  const pct = (t: number) => `${(((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((Math.min(b, end) - Math.max(a, start)) / (end - start)) * 100).toFixed(3)}%`;
  const ns = NS_TO > start && NS_FROM < end;
  const gaps = cov.segments.filter((s) => s.kind === 'gap');
  const summary = `${cov.documented_percent}% documented${cov.gap_years ? `, gaps ${Math.round(cov.gap_years)} years` : ''}${cov.gap_1933_1945_years ? `, ${Math.round(cov.gap_1933_1945_years)} of them in 1933–1945` : ''}`;
  return html`<figure class="coverage">
    <div class="coverage-bar" role="img" aria-label="Provenance coverage from ${String(cov.segments[0].period?.from_year ?? '')} until today: ${summary}">
      ${ns ? html`<span class="coverage-ns" style="left:${pct(NS_FROM)};width:${width(NS_FROM, NS_TO)}" title="30 January 1933 – 8 May 1945"></span>` : ''}
      ${cov.segments.map((s) => {
        const [a, b] = [time(s.period?.from), time(s.period?.to)];
        if (!(b >= a)) return '';
        return html`<span class="coverage-seg ${s.kind}${s.in_1933_1945 && s.kind === 'gap' ? ' ns' : ''}" style="left:${pct(a)};width:${width(a, b + 86_400_000)}" title="${segmentTitle(s)}"></span>`;
      })}
    </div>
    <div class="coverage-axis" aria-hidden="true">
      <span>${String(cov.segments[0].period?.from_year ?? '')}</span>
      ${ns ? html`<span class="coverage-ns-label" style="left:${pct(NS_FROM)}">1933–45</span>` : ''}
      <span>today</span>
    </div>
    <figcaption class="muted small">${summary}.
      <span class="coverage-key"><i class="documented"></i>documented <i class="presumed"></i>presumed <i class="gap"></i>gap${ns ? html` <i class="ns-key"></i>1933–1945` : ''}</span>
      ${gaps.length ? html`<span class="visually-hidden">${gaps.map((g) => `${segmentTitle(g)} `)}</span>` : ''}
    </figcaption>
  </figure>`;
}
