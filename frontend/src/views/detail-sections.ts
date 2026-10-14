// Detail pages: the sections below the facts — provenance, relationships by category, backlinks, crossed paths.
import { getPresence, listAll } from '../api';
import { compareUrl, crossedLine, encounterLine } from '../crossings';
import { encounterKeys, findEncounters } from '../encounters';
import { creatorsOf, impliedEnd, html, link, render, trusted, TYPE_LABEL, type Html } from '../html';
import type { SourceHint, Category, Entity, EntryRef, Price, ProvenanceStep, Relationship } from '../types';
import { cite } from '../cite';

// categories, plus the relationship types an event's page groups by (participated_in, concerns)
const CATEGORY_ORDER: (Category | 'participated_in' | 'concerns')[] = [
  'glossary', 'presence', 'association', 'event', 'participated_in', 'concerns', 'architecture', 'polity', 'influence', 'education', 'collaboration', 'membership', 'patronage', 'publication', 'depiction', 'provenance',
];
const CATEGORY_LABEL: Record<string, string> = {
  presence: 'Places (physically there)',
  association: 'Associations',
  influence: 'Influence',
  education: 'Education',
  collaboration: 'Collaboration',
  membership: 'Membership',
  patronage: 'Patronage',
  depiction: 'Depictions',
  provenance: 'Provenance',
  polity: 'States and nationality',
  glossary: 'Related terms',
  architecture: 'Buildings',
  publication: 'Publication',
  event: 'Events',
  // on an event's page its links are split by type (relationshipSections)
  participated_in: 'Participants',
  concerns: 'What it concerns',
};

export const uncertain = (certainty: string | null | undefined) => (certainty && certainty !== 'attested' ? html`<span class="tag">${certainty}</span>` : '');

const METHOD_LABEL: Record<string, string> = { forced_sale: 'forced sale' };
// roles shown as a tag next to the holder; an owner needs none, an estate is in the name ("Estate of …")
const ROLE_TAG: Record<string, [string, string]> = {
  dealer: ['dealer', 'Bought it to sell'],
  agent: ['agent', 'Held it on consignment, did not own it'],
  custodian: ['custodian', 'Held it without owning it: a loan, a deposit'],
};

/** "Leo Stein", "A and B", "A, B and C" — linked where they have an entry. */
function holders(s: ProvenanceStep): Html {
  const first = s.owner
    ? html`${link(s.owner.type, s.owner.slug, s.owner.name)}${s.owner_label && s.owner_label !== s.owner.name ? html` <span class="muted">(${s.owner_label})</span>` : ''}`
    : html`${s.owner_label ?? s.owner_name ?? 'Unknown owner'}`;
  const all = [first, ...(s.co_owners ?? []).map((c) => link(c.type, c.slug, c.name))];
  return html`${s.role === 'estate' ? 'Estate of ' : ''}${all.map((h, i) => html`${i ? (i === all.length - 1 ? ' and ' : ', ') : ''}${h}`)}`;
}

/** "200 FRF", "ca. 18,000 USD". */
const priceLabel = (p: Price) => `${p.note ? `${p.note} ` : ''}${p.amount.toLocaleString('en')} ${p.currency}`;

/** The holder the work is lent from: the last recorded step (the `loan` line after it is computed). */
export const lastRecordedStep = (steps: ProvenanceStep[] | undefined) => steps?.filter((s) => s.kind !== 'loan').at(-1);

/**
 * The holders in order, as recorded. A period whose end is only implied by the next acquisition is marked; a handover
 * that isn't documented as direct gets a dashed connector ("possibly other owners in between"). The lines the API
 * computes — the artist from the creation date, the current loan — are in italics, without sources.
 */
export function provenanceSection(steps: ProvenanceStep[], bibliography?: Record<string, SourceHint>): Html | null {
  if (!steps.some((s) => !s.implied)) return null; // the computed lines alone are no provenance
  return html`<section class="provenance">
    <h2>Provenance</h2>
    <p class="muted small">Holders in order, as the sources record them. A dashed line: the handover isn't documented, there may have been owners in between. In italics: not recorded, but following from the creation or the loan.</p>
    <ol class="provenance-list">${steps.map((s, i) => {
      const gap = i > 0 && !s.direct && s.kind !== 'loan'; // a loan is no handover of ownership
      const role = s.role && ROLE_TAG[s.role];
      const how = [
        s.kind === 'creation' ? html`the artist` : s.method && s.method !== 'unknown' ? html`${METHOD_LABEL[s.method] ?? s.method}` : null,
        s.label ? html`${s.label}` : null,
        s.price ? html`${priceLabel(s.price)}` : null,
        s.place ? html`in ${link('place', s.place.slug, s.place.name)}` : null,
      ].filter((x): x is Html => !!x);
      return html`<li class="provenance-step${gap ? ' undocumented' : ''}${s.implied ? ' implied' : ''}">
        ${gap ? html`<div class="provenance-gap">handover not documented</div>` : ''}
        <div class="provenance-owner">${holders(s)}${role ? html` <span class="tag" title="${role[1]}">${role[0]}</span>` : ''}${s.period ? html` <span class="muted">${s.period.label}</span>` : ''}${impliedEnd(s.end_basis)}${uncertain(s.certainty)}${s.implied ? '' : cite(s.sources, bibliography)}</div>
        ${how.length ? html`<div class="provenance-how">${how.map((h, j) => html`${j ? ' · ' : ''}${h}`)}</div>` : ''}
        ${s.notes_html ? html`<div class="rel-note">${trusted(s.notes_html)}</div>` : ''}
      </li>`;
    })}</ol>
  </section>`;
}

const HELD = new Set(['owned_by', 'held_by', 'commissioned']);
const firstFrom = (rs: Relationship[]) => rs.map((r) => r.period?.from ?? r.period?.to ?? '9999').sort()[0];

/**
 * A holder's side of the provenance (a collector, a dealer, a museum): what it held, one line per artwork with its
 * periods (its own and, say, its estate's), then whom it acquired from and passed works on to, one line per
 * counterpart with how often and when — a dealer's network at a glance. The rest of the Provenance group as usual.
 * Null when the page holds nothing.
 */
export function holdingsSections(rels: Relationship[], bibliography?: Record<string, SourceHint>): { html: Html; rest: Relationship[] } | null {
  const held = rels.filter((r) => r.derived && r.direction === 'incoming' && r.entity.type === 'artwork' && HELD.has(r.type)
    || r.derived && r.type === 'commissioned' && r.direction === 'outgoing');
  if (!held.length) return null;
  const transfers = rels.filter((r) => r.derived && r.type === 'transferred_to');
  const rest = rels.filter((r) => !held.includes(r) && !transfers.includes(r));

  const works = new Map<string, Relationship[]>();
  for (const r of held) works.set(r.entity.slug, [...(works.get(r.entity.slug) ?? []), r]);
  const rows = [...works.values()].sort((a, b) => firstFrom(a).localeCompare(firstFrom(b)));
  const tags = (rs: Relationship[]) => html`${rs.some((r) => r.type === 'commissioned') ? html` <span class="tag" title="Ordered the work from the artist">commissioned</span>` : ''}${
    rs.some((r) => r.type === 'held_by') && !rs.some((r) => r.type === 'owned_by') ? html` <span class="tag" title="Held it without owning it: as a dealer's agent, a loan, a deposit">held, not owned</span>` : ''}`;

  const counterparts = (direction: 'incoming' | 'outgoing') => {
    const by = new Map<string, Relationship[]>();
    for (const r of transfers.filter((t) => t.direction === direction)) {
      const key = `${r.entity.type}/${r.entity.slug}`;
      by.set(key, [...(by.get(key) ?? []), r]);
    }
    return [...by.values()].sort((a, b) => b.length - a.length || a[0].entity.name.localeCompare(b[0].entity.name));
  };
  const network = (title: string, groups: Relationship[][]) => (groups.length ? html`<h3>${title}</h3>
    <ul class="rel-list">${groups.map((g) => html`<li>${link(g[0].entity.type, g[0].entity.slug, g[0].entity.name)}
      ${g.length > 1 ? html`<span class="tag">${String(g.length)} works</span>` : ''}
      <span class="muted">${[...new Set(g.map((r) => r.period?.label).filter(Boolean))].join(' · ')}</span></li>`)}</ul>` : '');

  return {
    rest,
    html: html`<section class="rel-group rel-holdings">
      <h2>Works held</h2>
      <p class="muted small">Works held, from the provenance of each work, in the order they came.</p>
      <ul class="rel-list">${rows.map((rs) => html`<li>
        ${link('artwork', rs[0].entity.slug, rs[0].entity.name)}${tags(rs)}
        ${rs.filter((r) => r.period).map((r, i) => html`${i ? html`<span class="muted">,</span>` : ''}<span class="muted">${r.period!.label}</span>${impliedEnd(r.end_basis)}`)}
        ${uncertain(rs.find((r) => r.certainty && r.certainty !== 'attested')?.certainty)}${cite(rs.flatMap((r) => r.sources ?? []), bibliography)}
      </li>`)}</ul>
      ${network('Acquired from', counterparts('incoming'))}
      ${network('Passed on to', counterparts('outgoing'))}
    </section>`,
  };
}

/** Backlinks: the entries whose texts link this one. */
export const backlinks = (title: string, hint: string, refs: EntryRef[] | undefined) => (refs?.length
  ? html`<section class="backlinks"><h2>${title}</h2><p class="muted small">${hint}</p><ul class="plain-list">${refs.map((u) =>
    html`<li>${link(u.type, u.slug, u.name)} <span class="muted">${TYPE_LABEL[u.type]}</span></li>`)}</ul></section>`
  : null);

/**
 * Relationships listed elsewhere on the page: an artwork's co-creators (under Artist) and its owners and places
 * from the provenance, a commission too (under Provenance); an artist's co-created works (under Artworks).
 */
export function shownElsewhere(e: Entity, r: Relationship) {
  if (r.type === 'co_creator') return e.type === 'artwork' || e.type === 'artist';
  return e.type === 'artwork' && !!r.derived && ['owned_by', 'held_by', 'kept_in', 'commissioned'].includes(r.type);
}

/**
 * Relationships grouped by category. On an event's page its own links are split by type — "Participants" (with their
 * role: "defendant", "judge"), "What it concerns" — and the label every row would repeat is left out; elsewhere a
 * participation reads "took part in The Bührle trial (defendant)".
 */
export function relationshipSections(rels: Relationship[], pageType?: string, bibliography?: Record<string, SourceHint>): Html {
  const keyOf = (r: Relationship) => (pageType === 'event' && r.category === 'event' ? r.type : r.category);
  const groups = new Map<string, Relationship[]>();
  for (const r of rels) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const order = [...groups.keys()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a as Category) + 1 || 99) - (CATEGORY_ORDER.indexOf(b as Category) + 1 || 99),
  );
  const byDate = (a: Relationship, b: Relationship) =>
    (a.period?.from ?? '9999').localeCompare(b.period?.from ?? '9999');
  const role = (r: Relationship) => r.type === 'participated_in' && !!r.note;
  const heading = (cat: string) => (pageType === 'event' && cat === 'depiction' ? 'Works depicting it' : CATEGORY_LABEL[cat] ?? cat);
  return html`${order.map((cat) => html`<section class="rel-group rel-${cat}">
    <h2>${heading(cat)}</h2>
    <ul class="rel-list">${groups.get(cat)!.sort(byDate).map((r) => html`<li>
      ${cat === r.type || (pageType === 'event' && cat === 'depiction') ? '' : html`<span class="rel-label">${r.label}</span>`}
      ${link(r.entity.type, r.entity.slug, r.entity.name)}${role(r) ? html` <span class="rel-role">(${r.note})</span>` : ''}
      ${r.period ? html`<span class="muted">${r.period.label}</span>` : ''}${impliedEnd(r.end_basis)}
      ${uncertain(r.certainty)}${cite(r.sources, bibliography)}
      ${r.note && !role(r) ? html`<div class="rel-note">${r.note}</div>` : ''}
      ${r.notes_html ? html`<div class="rel-note">${trusted(r.notes_html)}</div>` : ''}
    </li>`)}</ul>
  </section>`)}`;
}

/**
 * Who this entry crossed paths with (same place, overlapping dates), or for a place: who met there. Uses all dated
 * presence links (one request, shared with the start map) and the artworks list (to leave out a work and its artist).
 */
export function crossedPaths(el: HTMLElement, type: string, slug: string, current: () => boolean) {
  Promise.all([getPresence(-3000, new Date().getFullYear() + 1), listAll('artworks')])
    .then(([presence, artworks]) => {
      if (!current() || !el.isConnected) return;
      const artists = new Map(artworks.data.map((a) => [a.slug, creatorsOf(a).map((c) => c.slug)]));
      const all = findEncounters(presence.features.map((f) => f.properties), { artistsOf: (a) => artists.get(a) });
      const self = `${type}/${slug}`;
      const mine = type === 'place'
        ? all.filter((x) => x.place.slug === slug)
        : all.filter((x) => encounterKeys(x).includes(self));
      if (!mine.length) return;
      el.hidden = false;
      render(el, html`<h2>${type === 'place' ? 'Crossed paths here' : 'Crossed paths'}</h2>
        <p class="muted small">${type === 'place' ? 'People and works here at the same time.' : 'At the same place at the same time, from the dated places on this site.'}</p>
        <ul class="plain-list encounters-list">${mine.map((x) => (type === 'place' ? encounterLine(x, { withPlace: false, actions: html`<div class="encounter-actions"><a href="${compareUrl(x)}">both on the map →</a></div>` }) : crossedLine(x, self)))}</ul>`);
    })
    .catch(() => { /* optional section: leave it out when the data can't be loaded */ });
}
