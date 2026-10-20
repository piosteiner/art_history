// Detail pages: the sections below the facts — provenance, relationships by category, backlinks, crossed paths.
import { getEncounters, getPresence, listAll, PLURAL } from '../api';
import { compareUrl, crossedLine, encounterLine } from '../crossings';
import { encounterKeys, findEncounters, fromApi, type Encounter } from '../encounters';
import { creatorsOf, impliedEnd, html, link, render, trusted, TYPE_LABEL, type Html } from '../html';
import type {
  Citation, SourceHint, Category, CoverageSegment, Entity, EntityType, EntryRef, Inference, Price, ProvenanceAlternative, ProvenanceCoverage, ProvenanceRecord, ProvenanceStatus, ProvenanceStep, Relationship,
} from '../types';
import { cite } from '../cite';
import { coverageBar, gapSides, gapText } from '../coverage';

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

const METHOD_LABEL: Record<string, string> = { forced_sale: 'forced sale', theft: 'stolen' };
const METHOD_TITLE: Record<string, string> = { settlement: 'Kept after an agreement with the claimants (a “just and fair solution”)' };
const method = (m: string) => (METHOD_TITLE[m] ? html`<span class="explained" title="${METHOD_TITLE[m]}">${METHOD_LABEL[m] ?? m}</span>` : html`${METHOD_LABEL[m] ?? m}`);

/** "1933–1945: D — looted art …", coloured by category, the source's own wording and its sources after it. */
function statusLine(st: ProvenanceStatus, sources: Citation[] | undefined, bibliography?: Record<string, SourceHint>) {
  return html`<p class="provenance-status prov-cat-${st.category}">
    <span class="prov-badge" title="Provenance 1933–1945, category of the Swiss Federal Office of Culture">${st.category}</span>
    <span><span class="muted">1933–1945:</span> ${st.label}${st.note ? html` <span class="muted">— “${st.note}”</span>` : ''}${cite(sources, bibliography)}
      <a class="small" href="/provenance/1933-1945">Through whose hands works went then →</a></span>
  </p>`;
}
// roles shown as a tag next to the holder; an owner needs none, an estate is in the name ("Estate of …")
const ROLE_TAG: Record<string, [string, string]> = {
  dealer: ['dealer', 'Bought it to sell'],
  agent: ['agent', 'Held it on consignment, did not own it'],
  custodian: ['custodian', 'Held it without owning it: a loan, a deposit'],
  publisher: ['publisher', 'Published the edition'],
  foundry: ['foundry', 'Cast it, did not own it'],
  trustee: ['trustee', 'Held it in trust or as security, did not own it'],
  possessor: ['without title', 'Held it without good title: seized, looted, stolen, or received from those who took it. The owner kept the title.'],
};
/** How a possessor came by it (API 083): taken, or passed on by those who took it. */
const TAKEN = new Set(['confiscation', 'theft', 'forced_sale']);

/**
 * "exchanged for a Florentine tondo" — linked when the other work has an entry (API 084); left out when it's only text
 * the step's label already says ("exchanged by Göring for a Florentine tondo").
 */
function exchangedFor(s: ProvenanceStep): Html | null {
  const x = s.exchanged_for;
  if (!x || (!x.artwork && x.text && s.label?.toLowerCase().includes(x.text.toLowerCase()))) return null;
  return html`exchanged for ${x.artwork ? link('artwork', x.artwork.slug, x.artwork.title) : x.text ?? 'another work'}`;
}

/** What the holders' lives imply about the step (API 086): in italics, tagged "derived" — no source says it. */
export const inferenceLine = (i: Inference) => html`<div class="provenance-inference inference-${i.kind}">
  <span class="tag tag-derived" title="Derived from the holders' lives and whereabouts — not stated by a source">derived</span> <i>${i.text}</i>
</div>`;

/** Another source's reading of the step (API 084): right under it, not part of the chain, the periods or the map. */
function alternative(a: ProvenanceAlternative, bibliography?: Record<string, SourceHint>): Html {
  const who = a.owner ? link(a.owner.type, a.owner.slug, a.owner.name) : html`${a.owner_label ?? 'an unknown holder'}`;
  const role = a.role && ROLE_TAG[a.role];
  const when = [a.acquired?.label, a.ended?.label].filter(Boolean).join(' – ');
  const how = [a.method && a.method !== 'unknown' ? method(a.method) : null, a.label ? html`${a.label}` : null].filter((x): x is Html => !!x);
  return html`<div class="provenance-alt">
    <span class="provenance-alt-label" title="The sources disagree about this step; it can't be settled">Another reading (sources disagree):</span>
    ${a.role === 'estate' ? 'Estate of ' : ''}${who}${role ? html` <span class="tag" title="${role[1]}">${role[0]}</span>` : ''}${when ? html` <span class="muted">${when}</span>` : ''}${uncertain(a.certainty)}${cite(a.sources, bibliography)}
    ${how.length ? html`<div class="provenance-how">${how.map((h, j) => html`${j ? ' · ' : ''}${h}`)}</div>` : ''}
    ${a.notes_html ? html`<div class="rel-note">${trusted(a.notes_html)}</div>` : ''}
  </div>`;
}

/** "Munich no. 4317" — linked to the works sharing it only when there are any (API 113: within its reach — any holder's
 *  for ERR, Munich …, the same holder's for an inventory, lot or stock number). Alone, it is just the number. */
export const numberHref = (n: { kind: string; number: string; id?: number }) =>
  `/provenance-numbers?${new URLSearchParams({ number: n.number, kind: n.kind, ...(n.id ? { of: `n${n.id}` } : {}) })}`;
const shareTitle = (k: number) => `Also recorded for ${k} other ${k === 1 ? 'work' : 'works'}`;
const numbers = (s: ProvenanceStep) => (s.numbers ?? []).map((n) => (n.shared
  ? html`${n.label} <a href="${numberHref(n)}" title="${shareTitle(n.shared)}">${n.number}</a>` : html`${n.label} ${n.number}`));

/** The records under a step (API 104): "1700 · inventory of the Real Alcázar · Real Alcázar, summer office · no. 286" —
 *  the source's doubts as tags ("no. 411 possible"); more than three folded. */
const RECORD_KIND: Record<string, string> = { inventory: 'inventory', catalogue: 'catalogue', exhibition: 'exhibition', sighting: 'seen there', document: 'document', other: 'record' };
function records(s: ProvenanceStep): Html | null {
  const list = s.records ?? [];
  if (!list.length) return null;
  const line = (r: ProvenanceRecord) => {
    const where = [r.place ? link('place', r.place.slug, r.place.name) : null, r.room ? html`${r.room}` : null].filter((x): x is Html => !!x);
    return html`<li class="provenance-record"><span class="muted">${r.date?.label ?? 'undated'}</span> · ${r.document ?? RECORD_KIND[r.kind]}${uncertain(r.certainty)}${where.length ? html` · ${where.map((w, i) => html`${i ? ', ' : ''}${w}`)}` : ''}${r.number
      ? html` · no. ${r.shared && r.id ? html`<a href="/provenance-numbers?${String(new URLSearchParams({ number: r.number, of: `r${r.id}` }))}" title="${shareTitle(r.shared)}">${r.number}</a>` : r.number}${uncertain(r.number_certainty)}` : ''}${r.note ? html` <span class="muted">— ${r.note}</span>` : ''}</li>`;
  };
  const items = html`<ul class="provenance-records">${list.map(line)}</ul>`;
  return list.length > 3 ? html`<details class="provenance-records-fold"><summary>${String(list.length)} records — inventories, catalogues, sightings</summary>${items}</details>` : items;
}

/** "in Köln → Berlin → Geneva" (the further places in order, API 077). */
function places(s: ProvenanceStep): Html | null {
  const further = (s.further_places ?? []).map((p) => html` → ${link('place', p.slug, p.name)}${p.period ? html` <span class="muted">(${p.period.label})</span>` : ''}`);
  if (!s.place && !further.length) return null;
  return html`${s.place ? html`in ${link('place', s.place.slug, s.place.name)}` : ''}${further}`;
}

/** An event in the chain (API 077: a claim, a settlement between others, a collection dissolved): a note, not a holder. */
function eventStep(s: ProvenanceStep, bibliography?: Record<string, SourceHint>): Html {
  const party = s.owner ? link(s.owner.type, s.owner.slug, s.owner.name) : null;
  const text = s.label
    ? html`${s.label}${party && !s.label.includes(s.owner!.name) ? html` — ${party}` : ''}`
    : html`${s.method && s.method !== 'unknown' ? method(s.method) : 'event'}${party ? html` — ${party}` : s.owner_label ? ` — ${s.owner_label}` : ''}`;
  const more = [s.event ? html`${link('event', s.event.slug, s.event.name)}` : null, places(s), ...numbers(s)].filter((x): x is Html => !!x);
  return html`<li class="provenance-step provenance-event">
    <div class="provenance-event-line">• ${text}${s.period ? html` <span class="muted">${s.period.label}</span>` : ''}${uncertain(s.certainty)}${cite(s.sources, bibliography)}</div>
    ${more.length ? html`<div class="provenance-how">${more.map((h, j) => html`${j ? ' · ' : ''}${h}`)}</div>` : ''}
    ${s.notes_html ? html`<div class="rel-note">${trusted(s.notes_html)}</div>` : ''}
  </li>`;
}

/** "Leo Stein", "A and B", "A, B and C" — linked where they have an entry. */
function holders(s: ProvenanceStep): Html {
  const first = s.owner
    ? html`${link(s.owner.type, s.owner.slug, s.owner.name)}${s.owner_label && s.owner_label !== s.owner.name ? html` <span class="muted">(${s.owner_label})</span>` : ''}`
    : html`${s.owner_label ?? s.owner_name ?? 'Unknown owner'}`;
  const all = [first, ...(s.co_owners ?? []).map((c) => link(c.type, c.slug, c.name))];
  return html`${s.role === 'estate' ? 'Estate of ' : ''}${all.map((h, i) => html`${i ? (i === all.length - 1 ? ' and ' : ', ') : ''}${h}`)}`;
}

// currencies whose code says little: named instead (API 090; `chf_today` stays unshown until rates are loaded)
const CURRENCY_NAME: Record<string, string> = { AFRF: 'French francs (before 1960)' };
/** "200 FRF", "ca. 18,000 USD", "20,000 French francs (before 1960)". */
const priceLabel = (p: Price) => `${p.note ? `${p.note} ` : ''}${p.amount.toLocaleString('en')} ${CURRENCY_NAME[p.currency] ?? p.currency}`;

/** The holder the work is lent from: the last recorded owner (the `loan` line after it is computed; agents and custodians held it beside the owner). */
export const lastRecordedStep = (steps: ProvenanceStep[] | undefined) => steps?.filter((s) => s.kind !== 'loan' && s.in_chain !== false).at(-1);

/**
 * The holders in order, as recorded. A period whose end is only implied by the next acquisition is marked; a handover
 * that isn't documented as direct gets a dashed connector ("possibly other owners in between"). The lines the API
 * computes — the artist from the creation date, the current loan — are in italics, without sources. Agents and
 * custodians (`in_chain: false`, API 074) held the work alongside its owner: indented and muted, "held by …", never a
 * new owner. The 1933–1945 status (A–D) stands above the list, also when there are no steps.
 */
export function provenanceSection(steps: ProvenanceStep[], bibliography?: Record<string, SourceHint>,
  status?: ProvenanceStatus | null, statusSources?: Citation[], coverage?: ProvenanceCoverage | null): Html | null {
  const recorded = steps.some((s) => !s.implied); // the computed lines alone are no provenance
  if (!recorded && !status) return null;
  // gaps (API 078) go after the step they follow — the last one dated before them, which may be an agent's (an unsold
  // auction splits a gap: API 079 `show_after`); one before anyone known goes first
  const gaps = (coverage?.segments ?? []).filter((g) => g.kind === 'gap');
  const after = (g: (typeof gaps)[number]) => g.show_after ?? g.before_position;
  const gapsAfter = (position: number | null) => gaps.filter((g) => after(g) === position).map(gapLine);
  const known = new Set(steps.map((s) => s.position));
  const leading = gaps.filter((g) => after(g) === null || !known.has(after(g)!)).map(gapLine);
  return html`<section class="provenance" id="provenance">
    <h2>Provenance</h2>
    ${status ? statusLine(status, statusSources, bibliography) : ''}
    ${recorded ? coverageBar(coverage) ?? '' : ''}
    ${recorded ? html`<p class="muted small">Holders in order, as the sources record them. A dashed line: the handover isn't documented, there may have been owners in between. Indented: held alongside the owner (an agent, a deposit, a loan), not owned; in red: held without title (seized, looted, stolen) — the owner's period runs on until the restitution. A bullet: an event, not a holder. In italics: not recorded, but following from the creation or the loan.</p>
    <ol class="provenance-list">${leading}${steps.map((s, i) => html`${stepItem(s, i)}${gapsAfter(s.position)}`)}</ol>` : ''}
  </section>`;

  function stepItem(s: ProvenanceStep, i: number): Html {
    if (s.role === 'event') return eventStep(s, bibliography);
    const custody = s.in_chain === false;
    const gap = i > 0 && !s.direct && !custody && s.kind !== 'loan'; // custody and loans are no handover of ownership
    const afterGapLine = i > 0 && gaps.some((g) => after(g) === steps[i - 1].position); // it says more already
    const stolen = s.method === 'theft'; // "taken by …", no custodian's tag
    const possessor = s.role === 'possessor'; // held without title (API 083): never an owner, not a deposit either
    const role = !stolen && s.role && ROLE_TAG[s.role];
    const prefix = stolen || (possessor && TAKEN.has(s.method ?? '')) ? 'taken by' : 'held by';
    const how = [
      s.kind === 'creation' ? html`the artist`
        : s.method === 'theft' ? html`stolen${s.ended ? html` — recovered ${s.ended.label}` : ''}`
        : s.method === 'exchange' && exchangedFor(s) ? null // "exchanged for …" says it
        : s.method && s.method !== 'unknown' ? method(s.method) : null,
      s.via ? html`via ${s.via}` : null,
      exchangedFor(s),
      s.event ? html`at ${link('event', s.event.slug, s.event.name)}` : null,
      s.label ? html`${s.label}` : null,
      s.price ? html`${priceLabel(s.price)}` : null,
      places(s),
      ...numbers(s),
    ].filter((x): x is Html => !!x);
    return html`<li ${s.id ? html`id="provenance-${String(s.id)}" ` : ''}class="provenance-step${gap ? ' undocumented' : ''}${s.implied ? ' implied' : ''}${custody ? ' custody' : ''}${possessor ? ' possession' : ''}">
      ${gap && !afterGapLine ? html`<div class="provenance-gap">handover not documented</div>` : ''}
      <div class="provenance-owner">${custody ? html`<span class="provenance-alongside" title="${stolen ? 'Stolen: the owner kept the title' : possessor ? 'Taken from its owner, or received from those who took it — held without title' : 'Held alongside the owner, did not own it'}">${prefix}</span> ` : ''}${holders(s)}${role ? html` <span class="tag" title="${role[1]}">${role[0]}</span>` : ''}${s.not_sold ? html` <span class="tag tag-not-sold" title="Bought in, withdrawn or returned: the owner kept it">not sold</span>` : ''}${s.planned_until ? html` <span class="tag tag-planned" title="Announced, not yet a fact — as planned for ${s.planned_until}">planned</span>` : ''}${s.period ? html` <span class="muted">${s.period.label}</span>` : ''}${impliedEnd(s.end_basis)}${uncertain(s.certainty)}${s.implied ? '' : cite(s.sources, bibliography)}</div>
      ${how.length ? html`<div class="provenance-how">${how.map((h, j) => html`${j ? ' · ' : ''}${h}`)}</div>` : ''}
      ${records(s) ?? ''}
      ${s.notes_html ? html`<div class="rel-note">${trusted(s.notes_html)}</div>` : ''}
      ${(s.inferences ?? []).map(inferenceLine)}
      ${(s.alternatives ?? []).map((a) => alternative(a, bibliography))}
    </li>`;
  }
}

/** "Gap 1934–1946 — no holder known · possibly …" between the steps; marked when it touches 1933–1945. */
const gapLine = (g: CoverageSegment) => html`<li class="provenance-gap-line${g.in_1933_1945 ? ' ns' : ''}" title="${gapSides(g)}">
  ${gapText(g)}${g.in_1933_1945 ? html` <span class="tag tag-ns" title="The gap touches 30 January 1933 – 8 May 1945">1933–1945</span>` : ''}
</li>`;

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
    rs.some((r) => r.type === 'held_by' && r.note?.startsWith('possessor')) ? html` <span class="tag tag-ns" title="Seized, looted, stolen, or received from those who took it">held without title</span>`
    : rs.some((r) => r.type === 'held_by') && !rs.some((r) => r.type === 'owned_by') ? html` <span class="tag" title="Held it without owning it: as a dealer's agent, a loan, a deposit">held, not owned</span>` : ''}`;

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
  return e.type === 'artwork' && !!r.derived && (['owned_by', 'held_by', 'kept_in', 'commissioned'].includes(r.type)
    || (r.type === 'exchanged_for' && r.direction === 'outgoing')); // in its step ("exchanged for …"); the other work lists it
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
 * Who this entry crossed paths with (same place, overlapping dates), or for a place: who met there. Entries ask the
 * database (API 091: `/v1/map/encounters`, also "nearby, ≤ 50 km"); a place — the API has no place filter yet — and any
 * failure use the browser's own search over all dated presence links (one request, shared with the start map).
 */
export function crossedPaths(el: HTMLElement, type: string, slug: string, current: () => boolean) {
  if (type === 'place') return crossedPathsHere(el, type, slug, current);
  const self = `${type}/${slug}`;
  const entity = `${PLURAL[type as EntityType]}/${slug}`;
  let nearby = false;
  const draw = (list: Encounter[], note = '') => {
    el.hidden = false;
    render(el, html`<h2>Crossed paths</h2>
      <p class="muted small">At the same place at the same time, from the dated places on this site.${note ? html` ${note}` : ''}</p>
      <label class="crossed-nearby"><input type="checkbox" ${nearby ? html`checked` : ''}> nearby too (≤ 50 km)</label>
      ${list.length ? html`<ul class="plain-list encounters-list">${list.map((x) => crossedLine(x, self))}</ul>` : html`<p class="muted">Nobody nearby either.</p>`}`);
    el.querySelector<HTMLInputElement>('.crossed-nearby input')!.addEventListener('change', (ev) => {
      nearby = (ev.target as HTMLInputElement).checked;
      void load();
    });
  };
  const load = async () => {
    try {
      let list = (await getEncounters(entity, nearby ? 50 : undefined)).map(fromApi);
      if (!current()) return;
      // none at the same place: perhaps nearby — offered at once, so the section isn't simply missing
      if (!list.length && !nearby) {
        list = (await getEncounters(entity, 50)).map(fromApi);
        if (!current()) return;
        if (!list.length) { el.hidden = true; return; }
        nearby = true;
        return draw(list, 'None at the same place — nearby (≤ 50 km):');
      }
      draw(list);
    } catch {
      if (current()) crossedPathsHere(el, type, slug, current); // the browser's own search
    }
  };
  void load();
}

/** The browser's own search (src/encounters.ts) over all dated presence links: place pages, and the fallback. */
function crossedPathsHere(el: HTMLElement, type: string, slug: string, current: () => boolean) {
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
