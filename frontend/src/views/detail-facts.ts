// Detail pages: the fact rows per type (dates, makers, collection, numbers …), their source markers, the work's web page.
import {
  countryLink, countryName, creatorsOf, dateLabel, displayName, personDates, personWhat, ROLE_LABEL, otherNames, html, link, polityWithToday, spanLabel, type Html,
} from '../html';
import type {
  Artwork, Citation, EntityType, ArtworkSummary, Country, Dimensions, Entity, Image, KindRef, PartDimensions, PolityLink,
} from '../types';
import { partsGrid } from '../series';
import { STATUS_LABEL } from '../catalog';
import { cite } from '../cite';
import { backlinks, provenanceSection, uncertain } from './detail-sections';

export type Fact = [label: string, value: Html | string | null | undefined | false];

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

// The work's own page elsewhere (the museum's object page …): the way to see it when we have no free image.
// Named after the holding institution, else the site's domain; "accessed" like a citation (the link may move).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function webPage(e: Entity): { url: string; where: string; accessed: string | null } | null {
  if (e.type !== 'artwork' || !e.web_url || !/^https?:\/\//.test(e.web_url)) return null;
  let host = e.web_url;
  try { host = new URL(e.web_url).hostname.replace(/^www\./, ''); } catch { /* keep the link as written */ }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.web_url_accessed ?? '');
  return { url: e.web_url, where: e.institution?.name ?? host, accessed: m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null };
}
export function webPageLink(w: { url: string; where: string; accessed: string | null }) {
  return html`<a class="button-link web-link" href="${w.url}" target="_blank" rel="noopener">View at ${w.where} ↗</a>`;
}
export const accessedNote = (w: { accessed: string | null }) => (w.accessed ? html`<span class="muted small web-accessed">link accessed ${w.accessed}</span>` : '');

export function factsFor(e: Entity): { title: string; subtitle: string; facts: Fact[]; text: string | null; images: Image[]; extra: Html[]; lead?: string | null; leadHtml?: string | null } {
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
        title: displayName(e).text, // an official translation preferred, an own one in [brackets]
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
        extra: [partsGrid(e), provenanceSection(e.provenance ?? [], e.bibliography)].filter((x): x is Html => !!x),
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

// Which fact row shows which field's sources (the API's `sources` keys); the first row with one of the labels.
// `names` (its translations, migration 052) on "Also known as" for every type; `title_status` beside the heading.
const NAMES_FACT: Record<string, string[]> = { names: ['Also known as'] };
const FIELD_FACT: Partial<Record<EntityType, Record<string, string[]>>> = {
  artist: { birth: ['Born'], death: ['Died'] },
  artwork: { creator: ['Artist', 'Artists'], created: ['Date'], kind: ['Type'], medium: ['Medium'], materials: ['Materials'],
    dimensions: ['Dimensions'], institution: ['Collection'], inventory_number: ['Inventory no.'] },
  institution: { founded: ['Founded'], address: ['Address', 'Location'], location: ['Address', 'Location'], place: ['Location'] },
  person: { birth: ['Born', 'Active'], death: ['Died'], kind: ['Kind'], occupations: ['Occupations'] },
  place: { parent: ['Part of'], location: ['Coordinates'] },
  movement: { period: ['Period'], parent: ['Part of'] },
  polity: { period: ['Existed'], country_codes: ['Territory today'], parent: ['Part of'] },
  event: { period: ['Date'], kind: ['Kind'], place: ['Place'], location: ['Place'], area: ['Place'], parent: ['Part of'] },
};

/**
 * Fact rows with their sources' markers. A sourced field without a row of its own (a place's kind) gets a row:
 * its value when it is plain text, under its name.
 */
export function withSources(e: Entity, facts: Fact[]): Fact[] {
  const by = new Map<number, Citation[]>();
  const extra: Fact[] = [];
  for (const [field, list] of Object.entries(e.sources ?? {})) {
    if (field === 'title_status') continue; // shown beside the heading
    const labels = FIELD_FACT[e.type]?.[field] ?? NAMES_FACT[field] ?? [];
    const i = facts.findIndex(([label]) => labels.includes(label));
    if (i >= 0) by.set(i, [...(by.get(i) ?? []), ...list]);
    else {
      const value = (e as unknown as Record<string, unknown>)[field];
      const text = typeof value === 'string' ? value : Array.isArray(value) && value.every((x) => typeof x === 'string') ? value.join(', ') : '';
      const marker = cite(list, e.bibliography);
      if (marker) extra.push([field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' '), html`${text}${marker}`]);
    }
  }
  return [...facts.map(([label, value], i): Fact => (by.has(i) ? [label, html`${value || ''}${cite(by.get(i), e.bibliography)}`] : [label, value])), ...extra];
}
