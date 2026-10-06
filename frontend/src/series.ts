// Series and other wholes (API migration 037): a print of a series, a panel of a triptych, a leaf of an album.
// A part's page says where it belongs ("No. 21 of 46 in Thirty-six Views of Mount Fuji") with previous/next links;
// a whole's page shows its parts as a grid.
import { html, link, thumb } from './html';
import type { DateRange } from './types';

export interface WholeRef { slug: string; title: string; kind: string | null; parts_count: number | null }
export interface SiblingRef { slug: string; title: string; part_number: string | null }
export interface PartRef { slug: string; title: string; part_number: string | null; kind: string | null; created: DateRange | null; image_url: string | null; parts: number | null }

/** "No. 21" for a number, "Left panel" for a description of the position. */
export const partLabel = (n: string | null | undefined) =>
  !n ? '' : /^\d+[a-z]?$/i.test(n.trim()) ? `No. ${n.trim()}` : n.charAt(0).toUpperCase() + n.slice(1);

/** "No. 21 of 46 in Thirty-six Views of Mount Fuji, part of …" — the chain of wholes, nearest first. */
export function seriesLine(e: { part_of?: WholeRef[]; part_number?: string | null }) {
  const chain = e.part_of ?? [];
  if (!chain.length) return '';
  const [whole, ...outer] = chain;
  const number = partLabel(e.part_number);
  return html`<p class="series-line">
    ${number ? html`<strong>${number}</strong>${whole.parts_count ? ` of ${whole.parts_count}` : ''} in ` : 'Part of '}${link('artwork', whole.slug, whole.title)}${outer.map((w) => html`, part of ${link('artwork', w.slug, w.title)}`)}
  </p>`;
}

/** "← No. 20 Title" · "No. 22 Title →" within the nearest whole. */
export function partNav(e: { previous_part?: SiblingRef | null; next_part?: SiblingRef | null }) {
  const { previous_part: prev, next_part: next } = e;
  if (!prev && !next) return '';
  const label = (p: SiblingRef) => html`<span class="muted">${partLabel(p.part_number)}</span> ${p.title}`;
  return html`<nav class="part-nav" aria-label="Previous and next part">
    ${prev ? html`<a class="part-prev" rel="prev" href="/artworks/${encodeURIComponent(prev.slug)}">← ${label(prev)}</a>` : html`<span></span>`}
    ${next ? html`<a class="part-next" rel="next" href="/artworks/${encodeURIComponent(next.slug)}">${label(next)} →</a>` : ''}
  </nav>`;
}

/** The parts of a whole, in order, as a grid (a sub-series shows how many parts it has itself). */
export function partsGrid(e: { slug: string; parts?: PartRef[]; parts_count?: number | null }) {
  const parts = e.parts ?? [];
  if (!parts.length) return null;
  const count = e.parts_count && e.parts_count !== parts.length ? `${parts.length} of ${e.parts_count}` : String(parts.length);
  return html`<section class="parts"><h2>Parts <span class="muted small">(${count})</span></h2>
    <p class="small"><a href="/artworks?part_of=${encodeURIComponent(e.slug)}">See them in the artworks list →</a></p>
    <ul class="parts-grid">${parts.map((p) => html`<li>
      <a class="part-card" href="/artworks/${encodeURIComponent(p.slug)}">
        ${p.image_url ? html`<img src="${thumb(p.image_url, 250)}" alt="" loading="lazy" crossorigin="anonymous">` : html`<span class="part-img-empty" aria-hidden="true"></span>`}
        <span class="part-number">${partLabel(p.part_number)}</span>
        <span class="part-title">${p.title}</span>
        <span class="muted small">${[p.created?.label, p.parts ? `${p.parts} parts` : ''].filter(Boolean).join(' · ')}</span>
      </a></li>`)}</ul></section>`;
}
