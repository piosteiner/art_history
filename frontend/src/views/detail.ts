// Detail page for every entity type: facts, images with credits, long text, relationships by category, map.
import { getEntity, getEntityMap, getPresence, listEntities, PLURAL } from '../api';
import { compareUrl, crossedLine, encounterLine } from '../crossings';
import { encounterKeys, findEncounters } from '../encounters';
import { GROUPS, type Group } from '../selection';
import {
  countryLink, countryName, creatorsOf, dateLabel, displayName, impliedEnd, personDates, personWhat, ROLE_LABEL, langAttr, originalLine, otherNames, figure, html, link, PLURAL_LABEL, polityWithToday, render, spanLabel, trusted, TYPE_LABEL,
  wireImageFallbacks, wireLightbox, type Html,
} from '../html';
import { COLORS, createMap, showEntity, showOwnSite, showPoint } from '../map';
import type {
  Artwork, ArtworkSummary, Category, Country, DetailByPlural, Dimensions, Entity, EntryRef, Image, KindRef, PartDimensions, Plural, PolityLink, ProvenanceStep, Relationship,
} from '../types';
import { guard, loading, showError } from './common';
import { wireTextLinks } from '../glossary';
import { knownPreviews } from '../previews';
import { partNav, partsGrid, seriesLine } from '../series';
import { STATUS_LABEL } from '../catalog';

type Fact = [label: string, value: Html | string | null | undefined | false];

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

/**
 * Polity rows ("Soviet Union 1922–1991 (today Ukraine)") for one kind of link; null when there are none.
 * Without polities, today's country stands on its own under `fallback`.
 */
function polityFacts(e: { country: Country | null; polities: PolityLink[] }, rel: PolityLink['relationship'], label: string, fallback: string): Fact[] {
  const links = e.polities.filter((p) => p.relationship === rel);
  if (links.length) return [[label, html`${links.map((p, i) => html`${i ? html`<br>` : ''}${polityWithToday(p, e.country)}`)}`]];
  return [[fallback, e.country ? html`${countryLink(e.country)}${e.country.place && e.country.source === 'place' ? html` <span class="muted">(${e.country.place.name})</span>` : ''}` : null]];
}

/** "24.5 × 36.8 cm (image)" for the work itself, then one line per further measured part ("Mount: 180 × 95.5 cm"). */
function dimensionsFact(main: Dimensions | null, parts: PartDimensions[]) {
  const first = main?.label ? html`${main.label}${main.note ? html` <span class="muted">(${main.note})</span>` : ''}` : null;
  const rest = parts.filter((p) => p.label);
  if (!first && !rest.length) return null;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return html`${first ?? ''}${rest.map((p, i) => html`${first || i ? html`<br>` : ''}<span class="dim-part">${cap(p.part)}:</span> ${p.label}`)}`;
}

const refs = (type: Parameters<typeof link>[0], items: KindRef[]) =>
  items.length ? html`${items.map((r, i) => html`${i ? ', ' : ''}${link(type, r.slug, r.name)}`)}` : null;

const artworkList = (works: ArtworkSummary[], withCreator: boolean) => html`<ul class="plain-list">${works.map((w) => html`<li>
  ${link('artwork', w.slug, w.title)}${w.created ? html` <span class="muted">${w.created.label}</span>` : ''}
  ${withCreator && w.creator ? html` · ${link('artist', w.creator.slug, w.creator.name)}` : ''}
  ${w.co_creator ? html`<span class="tag">co-creator${w.role ? ` · ${w.role}` : ''}</span>` : ''}
</li>`)}</ul>`;

const uncertain = (certainty: string | null | undefined) => (certainty && certainty !== 'attested' ? html`<span class="tag">${certainty}</span>` : '');

/**
 * Who made it, one per line: the main creator first, then co-creators with their part ("landscape").
 * An attribution ("Workshop of Rubens") stands instead of the main creator's name, linked to the creator;
 * without a creator it stands on its own.
 */
function creatorsFact(e: Artwork): Html | string | null {
  const all = creatorsOf(e);
  const lines = all.map((c) => html`${link('artist', c.slug, c.main && e.attribution_label ? e.attribution_label : c.name)}${c.role ? html` <span class="muted">(${c.role})</span>` : ''}${uncertain(c.certainty)}`);
  if (e.attribution_label && !all.some((c) => c.main)) lines.unshift(html`${e.attribution_label}`);
  return lines.length ? html`${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}` : null;
}

const METHOD_LABEL: Record<string, string> = { forced_sale: 'forced sale' };

/** "the Kunsthaus Zürich", but "The Metropolitan Museum of Art" as it is. */
const withArticle = (name: string) => (/^the\s/i.test(name) ? '' : 'the ');

/**
 * Where the work is, as a credit line: the holding institution, or — on loan — the lender (the provenance's last owner)
 * "Foundation E.G. Bührle Collection, on loan to the Kunsthaus Zürich since 2021" (migration 048).
 */
function collectionFact(e: Artwork): Html | null {
  if (!e.institution) return null;
  const holder = link('institution', e.institution.slug, e.institution.name);
  if (!e.on_loan) return holder;
  const last = e.provenance?.at(-1);
  const owner = last?.owner ? link(last.owner.type, last.owner.slug, last.owner.name) : last?.owner_label ?? last?.owner_name ?? null;
  const since = e.on_loan_since ? html` since ${e.on_loan_since.label}` : '';
  return owner
    ? html`${owner}, on loan to ${withArticle(e.institution.name)}${holder}${since}`
    : html`On loan to ${withArticle(e.institution.name)}${holder}${since}`;
}

/**
 * The inventory number of the institution where it is, then the further numbers, each with whose number it is:
 * "Inventory no. 18 (Foundation E.G. Bührle Collection)", "Rewald (catalogue raisonné) 658".
 */
function numberFacts(e: Artwork): Fact[] {
  const more = e.numbers ?? [];
  const whose = (i: { slug: string; name: string } | null, type: 'institution' | 'source') => (i ? html` <span class="muted">(${link(type, i.slug, i.name)})</span>` : '');
  return [
    ['Inventory no.', e.inventory_number ? html`${e.inventory_number}${more.length ? whose(e.institution, 'institution') : ''}` : null],
    ...more.map((n): Fact => [n.label ?? (n.source ? 'Catalogue no.' : n.institution ? 'Inventory no.' : 'Number'),
      html`${n.number}${whose(n.institution, 'institution')}${whose(n.source, 'source')}`]),
  ];
}

/**
 * The owners in order, as recorded. A period whose end is only implied by the next acquisition is marked; a handover
 * that isn't documented as direct gets a dashed connector ("possibly other owners in between").
 */
function provenanceSection(steps: ProvenanceStep[]): Html | null {
  if (!steps.length) return null;
  const host = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; }
  };
  return html`<section class="provenance">
    <h2>Provenance</h2>
    <p class="muted small">Owners in order, as the sources record them. A dashed line: the handover isn't documented, there may have been owners in between.</p>
    <ol class="provenance-list">${steps.map((s, i) => {
      const owner = s.owner
        ? html`${link(s.owner.type, s.owner.slug, s.owner.name)}${s.owner_label && s.owner_label !== s.owner.name ? html` <span class="muted">(${s.owner_label})</span>` : ''}`
        : html`${s.owner_label ?? s.owner_name ?? 'Unknown owner'}`;
      const how = [s.method && s.method !== 'unknown' ? html`${METHOD_LABEL[s.method] ?? s.method}` : null, s.label ? html`${s.label}` : null,
        s.place ? html`in ${link('place', s.place.slug, s.place.name)}` : null].filter((x): x is Html => !!x);
      return html`<li class="provenance-step${i && !s.direct ? ' undocumented' : ''}">
        ${i && !s.direct ? html`<div class="provenance-gap">handover not documented</div>` : ''}
        <div class="provenance-owner">${owner}${s.period ? html` <span class="muted">${s.period.label}</span>` : ''}${impliedEnd(s.end_basis)}${uncertain(s.certainty)}</div>
        ${how.length ? html`<div class="provenance-how">${how.map((h, j) => html`${j ? ' · ' : ''}${h}`)}</div>` : ''}
        ${s.notes_html ? html`<div class="rel-note">${trusted(s.notes_html)}</div>` : ''}
        ${s.sources?.length ? html`<div class="provenance-sources">Sources: ${s.sources.map((u, j) => html`${j ? ', ' : ''}${/^https?:\/\//.test(u)
          ? html`<a href="${u}" target="_blank" rel="noopener">${host(u)}</a>` : u}`)}</div>` : ''}
      </li>`;
    })}</ol>
  </section>`;
}

/** Backlinks: the entries whose texts link this one. */
const backlinks = (title: string, hint: string, refs: EntryRef[] | undefined) => (refs?.length
  ? html`<section class="backlinks"><h2>${title}</h2><p class="muted small">${hint}</p><ul class="plain-list">${refs.map((u) =>
    html`<li>${link(u.type, u.slug, u.name)} <span class="muted">${TYPE_LABEL[u.type]}</span></li>`)}</ul></section>`
  : null);

/**
 * Relationships listed elsewhere on the page: an artwork's co-creators (under Artist) and its owners and places
 * from the provenance (under Provenance); an artist's co-created works (under Artworks).
 */
function shownElsewhere(e: Entity, r: Relationship) {
  if (r.type === 'co_creator') return e.type === 'artwork' || e.type === 'artist';
  return e.type === 'artwork' && !!r.derived && (r.type === 'owned_by' || r.type === 'kept_in');
}

// The work's own page elsewhere (the museum's object page …): the way to see it when we have no free image.
// Named after the holding institution, else the site's domain; "accessed" like a citation (the link may move).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function webPage(e: Entity): { url: string; where: string; accessed: string | null } | null {
  if (e.type !== 'artwork' || !e.web_url || !/^https?:\/\//.test(e.web_url)) return null;
  let host = e.web_url;
  try { host = new URL(e.web_url).hostname.replace(/^www\./, ''); } catch { /* keep the link as written */ }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.web_url_accessed ?? '');
  return { url: e.web_url, where: e.institution?.name ?? host, accessed: m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null };
}
function webPageLink(w: { url: string; where: string; accessed: string | null }) {
  return html`<a class="button-link web-link" href="${w.url}" target="_blank" rel="noopener">View at ${w.where} ↗</a>`;
}
const accessedNote = (w: { accessed: string | null }) => (w.accessed ? html`<span class="muted small web-accessed">link accessed ${w.accessed}</span>` : '');

function factsFor(e: Entity): { title: string; subtitle: string; facts: Fact[]; text: string | null; images: Image[]; extra: Html[]; lead?: string | null; leadHtml?: string | null } {
  switch (e.type) {
    case 'artist':
      return {
        title: e.name, subtitle: spanLabel(e.birth, e.death), text: e.biography_html, images: e.images,
        facts: [
          ['Born', dateLabel(e.birth)], ['Died', dateLabel(e.death)],
          ...polityFacts(e, 'nationality', 'Nationality', 'Country of birth'),
          ['Also known as', otherNames(e)],
        ],
        extra: e.artworks.length ? [html`<section><h2>Artworks</h2>${artworkList(e.artworks, false)}</section>`] : [],
      };
    case 'artwork': {
      const coCreators = creatorsOf(e).filter((c) => !c.main);
      const byline = [e.creator ? e.attribution_label ?? e.creator.name : e.attribution_label, ...coCreators.map((c) => c.name)];
      return {
        title: e.title,
        subtitle: [...byline, e.created?.label].filter(Boolean).join(', '),
        text: e.description_html, images: e.images,
        facts: [
          [creatorsOf(e).length > 1 ? 'Artists' : 'Artist', creatorsFact(e)],
          ['Date', dateLabel(e.created)],
          ['Type', e.kind],
          ['Medium', e.medium],
          ['Materials', e.materials.length ? e.materials.join(', ') : null],
          ['Dimensions', dimensionsFact(e.dimensions, e.other_dimensions ?? [])],
          ...polityFacts(e, 'created_in_polity', 'Made in', 'Country of origin'),
          ['Collection', collectionFact(e)],
          ...numberFacts(e),
          ['Also known as', otherNames(e)],
        ],
        extra: [partsGrid(e), provenanceSection(e.provenance ?? [])].filter((x): x is Html => !!x),
      };
    }
    case 'place':
      return {
        title: e.name, subtitle: [e.kind, e.country_code].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Part of', refs('place', [...e.ancestors].reverse())],
          ['Includes', refs('place', e.children)],
          ['Institutions', refs('institution', e.institutions)],
          ['Coordinates', e.location ? `${e.location.coordinates[1].toFixed(4)}, ${e.location.coordinates[0].toFixed(4)}` : null],
          ['Also known as', otherNames(e)],
        ],
        extra: [],
      };
    case 'movement':
      return {
        title: e.name, subtitle: [e.kind, e.period?.label].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Period', dateLabel(e.period)],
          ['Part of', refs('movement', [...e.ancestors].reverse())],
          ['Includes', refs('movement', e.children)],
          ['Also known as', otherNames(e)],
        ],
        extra: [],
      };
    case 'institution':
      return {
        title: e.name, subtitle: [e.kind, e.place?.name].filter(Boolean).join(' · '), text: e.description_html, images: e.images,
        facts: [
          ['Founded', dateLabel(e.founded)],
          ['Address', e.address],
          ['Location', e.place ? html`${link('place', e.place.slug, e.place.name)}${e.country ? html`, ${countryLink(e.country)}` : ''}` : null],
          ...(e.polities.some((p) => p.relationship === 'located_in_polity') ? polityFacts(e, 'located_in_polity', 'Historically in', '') : []),
          ['Website', e.website_url ? html`<a href="${e.website_url}" target="_blank" rel="noopener">${e.website_url.replace(/^https?:\/\/(www\.)?/, '')}</a>` : null],
          ['Also known as', otherNames(e)],
        ],
        extra: e.artworks.length ? [html`<section><h2>Artworks in the collection</h2>${artworkList(e.artworks, true)}</section>`] : [],
      };
    case 'person':
      return {
        title: e.name, subtitle: [personDates(e), personWhat(e)].filter(Boolean).join(' · '),
        text: e.description_html, images: [],
        facts: [
          ['Born', dateLabel(e.birth)], ['Died', dateLabel(e.death)],
          ['Active', e.birth || e.death ? '' : dateLabel(e.active)],
          ['Kind', e.kind && e.kind !== 'person' ? e.kind : null],
          ['Occupations', e.occupations.length ? e.occupations.join(', ') : null],
          ['Roles', e.roles.length ? e.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') : null],
          ...polityFacts(e, 'nationality', 'Nationality', 'Country of birth'),
          ['Also known as', otherNames(e)],
        ],
        extra: [],
      };
    case 'source':
      return {
        title: e.siglum || e.name, subtitle: ['Bibliography', e.kind, e.primary_source ? 'primary source' : null].filter(Boolean).join(' · '),
        leadHtml: e.citation, text: e.description_html, images: [],
        facts: [
          ['Authors', e.authors?.length ? e.authors.join(', ') : null],
          ['Year', e.year != null ? String(e.year) : null],
          ['Reading status', e.reading_status ? html`${STATUS_LABEL[e.reading_status]}${e.read_on ? html` <span class="muted">(${e.read_on.label})</span>` : ''}` : null],
          ['ISBN', e.isbn],
          ['DOI', e.doi ? html`<a href="https://doi.org/${e.doi}" target="_blank" rel="noopener">${e.doi}</a>` : null],
          ['Online', e.url ? html`<a href="${e.url}" target="_blank" rel="noopener">${e.url.replace(/^https?:\/\/(www\.)?/, '')}</a>` : null],
        ],
        extra: [],
      };
    case 'term':
      return {
        title: e.name, subtitle: `Glossary · ${e.category}`, lead: e.definition, text: e.description_html, images: e.images,
        facts: [['Category', html`<a href="/glossary?category=${e.category}">${e.category}</a>`], ['Also known as', otherNames(e)]],
        extra: [backlinks('Used in', 'Entries whose texts mention this term.', e.used_in)].filter((x): x is Html => !!x),
      };
    case 'event':
      return {
        title: e.name, subtitle: [e.kind, e.period?.label, e.place?.name].filter(Boolean).join(' · '), text: e.description_html, images: e.images,
        facts: [
          ['Date', dateLabel(e.period)],
          ['Kind', e.kind],
          ['Place', e.place ? html`${link('place', e.place.slug, e.place.name)}${e.country && e.country.name !== e.place.name ? html`, ${countryLink(e.country)}` : ''}` : null],
          ['Part of', e.part_of ? link('event', e.part_of.slug, e.part_of.name) : null],
          ['Also known as', otherNames(e)],
        ],
        // the parts in time order (the API sorts them): "Day 1 · fire · 2 March 1657"
        extra: e.parts.length ? [html`<section class="event-parts"><h2>Parts</h2><ul class="plain-list">${e.parts.map((p) => html`<li>
          ${link('event', p.slug, p.name)}${p.kind ? html` <span class="tag">${p.kind}</span>` : ''}${p.period ? html` <span class="muted">${p.period.label}</span>` : ''}</li>`)}</ul></section>`] : [],
      };
    case 'polity':
      return {
        title: e.name, subtitle: [e.kind, e.period?.label].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Existed', dateLabel(e.period)],
          ['Territory today', e.country_codes.length ? e.country_codes.map((c) => countryName(c) ?? c).join(', ') : null],
          ['Part of', refs('polity', [...e.ancestors].reverse())],
          ['Includes', refs('polity', e.children)],
          ['Also known as', otherNames(e)],
        ],
        extra: [],
      };
  }
}

/**
 * Relationships grouped by category. On an event's page its own links are split by type — "Participants" (with their
 * role: "defendant", "judge"), "What it concerns" — and the label every row would repeat is left out; elsewhere a
 * participation reads "took part in The Bührle trial (defendant)".
 */
function relationshipSections(rels: Relationship[], pageType?: string): Html {
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
      ${uncertain(r.certainty)}
      ${r.note && !role(r) ? html`<div class="rel-note">${r.note}</div>` : ''}
      ${r.notes_html ? html`<div class="rel-note">${trusted(r.notes_html)}</div>` : ''}
    </li>`)}</ul>
  </section>`)}`;
}

/**
 * Who this entry crossed paths with (same place, overlapping dates), or for a place: who met there. Uses all dated
 * presence links (one request, shared with the start map) and the artworks list (to leave out a work and its artist).
 */
function crossedPaths(el: HTMLElement, type: string, slug: string, current: () => boolean) {
  Promise.all([getPresence(-3000, new Date().getFullYear() + 1), listEntities('artworks', { limit: 500 })])
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

export function detail(main: HTMLElement, plural: Plural, slug: string) {
  loading(main);
  const current = guard();
  let cleanup: (() => void) | undefined;

  getEntity(plural, slug)
    .then((e: DetailByPlural[Plural]) => {
      if (!current()) return;
      const v = factsFor(e);
      document.title = `${v.title} · Art History`;
      const facts = v.facts.filter(([, value]) => value);
      const web = webPage(e);
      const hasMap = e.type === 'place' ? !!e.location : e.type === 'event' ? !!(e.area ?? e.location ?? e.place?.location) : e.type !== 'term' && e.type !== 'source';
      // an event on the start map: its years as the time window (the events layer follows it)
      const eventWindow = e.type === 'event' && e.period ? [e.period.from_year ?? e.period.to_year, e.period.to_year ?? e.period.from_year] : null;
      render(main, html`<article class="page detail detail-${e.type}">
        <p class="crumbs"><a href="/${plural}">${PLURAL_LABEL[plural]}</a> / ${TYPE_LABEL[e.type]}</p>
        <h1${langAttr(displayName(e).lang)}>${displayName(e).ruby ? trusted(displayName(e).ruby) : v.title}</h1>
        ${originalLine(e)}
        ${v.subtitle ? html`<p class="subtitle">${v.subtitle}</p>` : ''}
        ${e.type === 'artwork' ? html`${seriesLine(e)}${partNav(e)}` : ''}
        <p class="detail-actions">
          ${web ? html`<span class="web-top${v.images.length ? '' : ' narrow-only'}">${webPageLink(web)}${accessedNote(web)}</span>` : ''}
          ${GROUPS.includes(e.type as Group) ? html`<a class="button-link" href="/?${PLURAL[e.type]}=${encodeURIComponent(e.slug)}">Show on the map and timeline →</a>` : ''}
          ${eventWindow?.[0] != null ? html`<a class="button-link" href="/?from=${String(eventWindow[0])}&to=${String(eventWindow[1])}">Show on the map and timeline →</a>` : ''}
          ${e.type !== 'place' && e.type !== 'term' && e.type !== 'source' ? html`<a class="button-link" href="/graph/${plural}/${encodeURIComponent(e.slug)}?depth=2">Show the network →</a>` : ''}
        </p>
        <div class="detail-grid">
          <div class="detail-main">
            ${v.images.length ? html`<div class="gallery">${v.images.map((img) => figure(img, v.title))}</div>`
              : web ? html`<div class="web-panel"><p>There is no freely licensed image of this work we can show here.</p>
                  <p>${webPageLink(web)}</p>${web.accessed ? html`<p>${accessedNote(web)}</p>` : ''}</div>` : ''}
            ${v.lead ? html`<p class="lead">${v.lead}</p>` : ''}
            ${v.leadHtml ? html`<p class="lead citation">${trusted(v.leadHtml)}</p>` : ''}
            ${v.text ? html`<div class="prose">${trusted(v.text)}</div>` : ''}
            ${facts.length ? html`<dl class="facts">${facts.map(([k, value]) => html`<dt>${k}</dt><dd>${value}</dd>`)}</dl>` : ''}
            ${e.wikidata_id ? html`<p class="muted small">Wikidata: <a href="https://www.wikidata.org/wiki/${e.wikidata_id}" target="_blank" rel="noopener">${e.wikidata_id}</a></p>` : ''}
            ${v.extra}
            <section id="crossed" class="crossed" hidden></section>
            ${relationshipSections(e.relationships.filter((r) => (e.type === 'polity' || r.category !== 'polity') && !shownElsewhere(e, r)), e.type)}
            ${e.type === 'source'
              ? backlinks('Cited in', 'Entries whose texts cite this source.', e.mentioned_in)
              : backlinks('Mentioned in', 'Entries whose texts link to this one.', e.mentioned_in)}
          </div>
          ${hasMap ? html`<aside class="detail-side">
            <div class="map map-small" id="map"></div>
            <div class="legend" id="legend"></div>
          </aside>` : ''}
        </div>
      </article>`);
      wireImageFallbacks(main);
      wireLightbox(main);
      knownPreviews(e.entries);
      wireTextLinks(main, e.glossary, e.bibliography, e.entries);
      if (['artist', 'person', 'artwork', 'place'].includes(e.type)) crossedPaths(main.querySelector<HTMLElement>('#crossed')!, e.type, e.slug, current);
      if (!hasMap) return;

      const mapEl = main.querySelector<HTMLElement>('#map')!;
      const legend = main.querySelector<HTMLElement>('#legend')!;
      const map = createMap(mapEl);
      cleanup = () => map.remove();
      if (e.type === 'place') {
        showPoint(map, e.location!.coordinates, e.name);
        return;
      }
      if (e.type === 'event') {
        // where it happened: the drawn area or exact spot, else only its city
        const own = e.area ?? e.location;
        if (own) showOwnSite(map, own, e.name, true, COLORS.event);
        else showPoint(map, e.place!.location!.coordinates, e.place!.name);
        render(legend, own
          ? html`<span><i class="dot" style="background:${COLORS.event}"></i>${e.area ? 'the area it covered' : 'where it happened'}</span>`
          : html`<span><i class="dot" style="background:${COLORS.place}"></i>${e.place!.name} (no exact location recorded)</span>`);
        return;
      }
      getEntityMap(plural as Exclude<Plural, 'places'>, slug)
        .then((fc) => {
          if (!current()) return;
          const stops = fc.features.filter((f) => f.geometry.type === 'Point');
          // an institution's own point, or where an immovable artwork stands
          const own = e.type === 'institution' ? e.location ?? null : e.type === 'artwork' ? e.area ?? e.location ?? null : null;
          if (own) showOwnSite(map, own, v.title, !stops.length);
          if (!stops.length && own) {
            render(legend, html`<span><i class="dot" style="background:${COLORS.site}"></i>${e.type === 'artwork' ? 'where it stands' : 'its building'}</span>`);
            return;
          }
          if (!stops.length) {
            main.querySelector('.detail-side')?.remove();
            map.remove();
            cleanup = undefined;
            return;
          }
          const view = showEntity(map, fc);
          const layers = new Set(stops.map((f) => f.properties.layer));
          const both = layers.has('presence') && layers.has('association');
          render(legend, html`
            ${layers.has('presence') ? html`<span><i class="dot" style="background:${COLORS.presence}"></i>was there</span>` : ''}
            ${fc.features.some((f) => f.properties.layer === 'route') ? html`<span><i class="line" style="background:${COLORS.route}"></i>route, in date order</span>` : ''}
            ${layers.has('association') ? html`<span><i class="ring" style="border-color:${COLORS.association}"></i>association (not travel)</span>` : ''}
            ${own ? html`<span><i class="dot" style="background:${COLORS.site}"></i>${e.type === 'artwork' ? 'where it stands' : 'its building'}</span>` : ''}
            ${both ? html`<button type="button" class="link-button" data-fit="all">show associations</button>` : ''}`);
          legend.querySelector<HTMLButtonElement>('[data-fit]')?.addEventListener('click', (ev) => {
            const btn = ev.currentTarget as HTMLButtonElement;
            const all = btn.dataset.fit === 'all';
            if (all) view.fitAll();
            else view.fitPresence();
            btn.dataset.fit = all ? 'presence' : 'all';
            btn.textContent = all ? 'zoom to the route' : 'show associations';
          });
        })
        .catch((err) => showError(legend, err));
    })
    .catch((err) => current() && showError(main, err));

  return () => cleanup?.();
}
