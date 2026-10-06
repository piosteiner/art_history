// How "crossed paths" read on the page: under the explore map, in place popups and on detail pages.
import { PLURAL } from './api';
import { duration, type Encounter, type Stay } from './encounters';
import { html, link, type Html } from './html';
import { GROUPS, type Group } from './selection';

const who = (s: Stay) => html`${link(s.entity.type, s.entity.slug, s.entity.name)} <span class="muted">(${s.label})</span>`;
const overlap = (e: Encounter) => html`${e.when}${e.approximate
  ? html` <span class="tag" title="At least one of the dates is only known to the year, so they may have missed each other">possibly</span>`
  : html` <span class="muted">· ${duration(e.days)}</span>`}`;

/** "Kunsthaus Zürich, Zürich" when they were at the same venue, else the city. */
const where = (e: Encounter) => (e.venue
  ? html`${link(e.venue.type, e.venue.slug, e.venue.name)}, ${link('place', e.place.slug, e.place.name)}`
  : link('place', e.place.slug, e.place.name));
const kindOf = (e: Encounter) => (e.venue ? 'could have met there' : 'in the same city at the same time');

/** Explore page link showing both entries in the years of their overlap. */
export function compareUrl(e: Encounter) {
  const p = new URLSearchParams();
  for (const s of [e.a, e.b]) {
    if (!GROUPS.includes(s.entity.type as Group)) continue;
    const k = PLURAL[s.entity.type];
    p.set(k, [p.get(k), s.entity.slug].filter(Boolean).join(','));
  }
  const year = (n: number) => new Date(n * 86_400_000).getUTCFullYear();
  p.set('from', String(year(e.from)));
  p.set('to', String(year(e.to)));
  return `/?${p.toString().replace(/%2C/g, ',')}`;
}

/** One line: "Arles · 23 October – 25 December 1888 · 9 weeks — Paul Gauguin (lived in) and Vincent van Gogh (lived in)". */
export function encounterLine(e: Encounter, opts: { withPlace?: boolean; actions?: Html } = {}) {
  return html`<li class="encounter${e.approximate ? ' approximate' : ''}">
    <div class="encounter-head">${opts.withPlace !== false ? html`<strong>${where(e)}</strong> · ` : ''}${overlap(e)}</div>
    <div>${who(e.a)} and ${who(e.b)} <span class="muted">· ${kindOf(e)}</span></div>
    ${opts.actions ?? ''}
  </li>`;
}

/** For a detail page: the other entry, where and when, plus a link to see both on the map. */
export function crossedLine(e: Encounter, self: string) {
  const other = `${e.a.entity.type}/${e.a.entity.slug}` === self ? e.b : e.a;
  return html`<li class="encounter${e.approximate ? ' approximate' : ''}">
    ${link(other.entity.type, other.entity.slug, other.entity.name)} <span class="muted">(${other.label})</span>
    ${e.venue ? 'at' : 'in'} ${where(e)} · ${overlap(e)} <span class="muted">· ${kindOf(e)}</span>
    <a class="small encounter-map" href="${compareUrl(e)}">both on the map →</a>
  </li>`;
}

