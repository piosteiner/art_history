// Detail pages: the fact rows per type (dates, makers, collection, numbers …), their source markers, the work's web page.
import {
  countryLink, countryName, creatorsOf, dateLabel, displayName, personDates, personWhat, ROLE_LABEL, otherNames, html, link, polityWithToday, type Html,
} from '../html';
import type {
  Artwork, Citation, CreatorRef, EntityType, ArtworkSummary, Country, Dimensions, Entity, Image, KindRef, PartDimensions, PolityLink, Term,
} from '../types';
import { partsGrid } from '../series';
import { STATUS_LABEL } from '../catalog';
import { cite } from '../cite';
import { backlinks, lastRecordedStep, provenanceSection, uncertain } from './detail-sections';

export type Fact = [label: string, value: Html | string | null | undefined | false];

/**
 * An artwork's date; with a design earlier than the making (API 074: a print pulled, a cast made later) both —
 * "designed 1893–1894, printed 1921".
 */
/** "destroyed · May 1945 — burnt in the Friedrichshain flak tower" (API 103); null while extant. */
function fateFact(e: Artwork): Html | null {
  const f = e.fate;
  if (!f) return null;
  return html`<span class="tag tag-fate tag-fate-${f.status}">${f.label}</span>${f.date ? ` ${f.date.label}` : ''}${f.note ? html` — ${f.note}` : ''}`;
}

// a span of years (API 135): worked on over the whole time, or made at some point in it — said only where the label
// itself doesn't ("c. 1882", "1880s" say it already)
function spanNote(e: Artwork): string {
  if (!e.created || e.created.from_year === e.created.to_year) return '';
  if (e.created_span === 'duration') return ' (worked on over these years)';
  return e.created_span === 'uncertain' && /^\d{3,4}\s*[–-]\s*\d{3,4}$/.test(e.created.label ?? '') ? ' (made at some point in these years)' : '';
}

function dateFact(e: Artwork): string | null {
  if (!e.conceived) return e.created ? `${dateLabel(e.created)}${spanNote(e)}` : null;
  const kind = `${e.kind ?? ''} ${e.medium ?? ''}`.toLowerCase();
  const made = /print|woodcut|woodblock|engraving|etching|lithograph|aquatint|mezzotint|ukiyo|holzschnitt|radierung|druck/.test(kind) ? 'printed'
    : /bronze|cast|guss/.test(kind) ? 'cast' : 'made';
  return e.created ? `designed ${e.conceived.label}, ${made} ${e.created.label}` : `designed ${e.conceived.label}`;
}

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
  // a part that is a glossary term (API 134: frame, mount …) links to it
  const part = (p: PartDimensions) => (p.term ? link('term', p.term.slug, cap(p.term.name)) : cap(p.part));
  return html`${first ?? ''}${rest.map((p, i) => html`${first || i ? html`<br>` : ''}<span class="dim-part">${part(p)}:</span> ${p.label}`)}`;
}

const refs = (type: Parameters<typeof link>[0], items: KindRef[]) =>
  items.length ? html`${items.map((r, i) => html`${i ? ', ' : ''}${link(type, r.slug, r.name)}`)}` : null;

// the terms directly under a glossary term (API 145), each with its short definition
const narrowerTerms = (terms: Term['narrower']) => (terms.length
  ? html`<section class="narrower-terms"><h2>Narrower terms</h2><ul class="plain-list">${terms.map((t) =>
    html`<li>${link('term', t.slug, t.name)}${t.definition ? html` <span class="muted">— ${t.definition}</span>` : ''}</li>`)}</ul></section>`
  : null);

const artworkList = (works: ArtworkSummary[], withCreator: boolean) => html`<ul class="plain-list">${works.map((w) => html`<li>
  ${link('artwork', w.slug, w.title)}${w.created ? html` <span class="muted">${w.created.label}</span>` : ''}
  ${withCreator && w.creator ? html` · ${link('artist', w.creator.slug, w.creator.name)}` : ''}
  ${w.co_creator ? html`<span class="tag">co-creator${w.role ? ` · ${w.role}` : ''}</span>` : ''}
</li>`)}</ul>`;

/**
 * Does the attribution name the creator itself ("Workshop of Rubens", "Rembrandt and workshop")? Else it is only the
 * qualifier ("Workshop of", "Circle of", "Attributed to" — as the Kunsthaus gives them) and the name goes after it.
 */
const namesCreator = (label: string, name: string) => {
  const words = new Set(label.toLowerCase().split(/[^\p{L}]+/u));
  return name.toLowerCase().split(/[^\p{L}]+/u).some((w) => w.length >= 4 && words.has(w));
};
/** "Workshop of Francisco Goya" from the qualifier "Workshop of"; a label naming the creator as it is. */
const attributed = (label: string, name: string) => (namesCreator(label, name) ? label : `${label} ${name}`);

/**
 * Who made it, one per line: the main creator first, then co-creators with their part ("landscape").
 * An attribution ("Workshop of Rubens") stands instead of the main creator's name, linked to the creator — a bare
 * qualifier ("Workshop of") before the linked name; without a creator it stands on its own.
 */
function creatorsFact(e: Artwork): Html | string | null {
  const all = creatorsOf(e);
  const label = e.attribution_label;
  const name = (c: CreatorRef) => (!c.main || !label ? link('artist', c.slug, c.name)
    : namesCreator(label, c.name) ? link('artist', c.slug, label) : html`${label} ${link('artist', c.slug, c.name)}`);
  const lines = all.map((c) => html`${name(c)}${c.role ? html` <span class="muted">(${c.role})</span>` : ''}${uncertain(c.certainty)}`);
  if (e.attribution_label && !all.some((c) => c.main)) lines.unshift(html`${e.attribution_label}`);
  return lines.length ? html`${lines.map((l, i) => html`${i ? html`<br>` : ''}${l}`)}` : null;
}

/** "the Kunsthaus Zürich", but "The Metropolitan Museum of Art" as it is. */
const withArticle = (name: string) => (/^the\s/i.test(name) ? '' : 'the ');

/**
 * Where the work is, as a credit line: the holding institution, or — on loan — the lender (the provenance's last recorded step)
 * "Foundation E.G. Bührle Collection, on loan to the Kunsthaus Zürich since 2021" (migration 048).
 */
function collectionFact(e: Artwork): Html | null {
  if (!e.institution) return null;
  const holder = link('institution', e.institution.slug, e.institution.name);
  if (!e.on_loan) return holder;
  const last = lastRecordedStep(e.provenance);
  const owner = last?.owner ? link(last.owner.type, last.owner.slug, last.owner.name) : last?.owner_label ?? last?.owner_name ?? null;
  const since = e.on_loan_since ? html` since ${e.on_loan_since.label}` : '';
  return owner
    ? html`${owner}, on loan to ${withArticle(e.institution.name)}${holder}${since}`
    : html`On loan to ${withArticle(e.institution.name)}${holder}${since}`;
}

/**
 * The inventory number of the institution where it is, then the further numbers, each with whose number it is:
 * "Inventory no. 18 (Foundation E.G. Bührle Collection)", "Rewald (catalogue raisonné) 658" — a further number with the
 * markers of its own sources.
 */
function numberFacts(e: Artwork): Fact[] {
  const more = e.numbers ?? [];
  const whose = (i: { slug: string; name: string } | null, type: 'institution' | 'source') => (i ? html` <span class="muted">(${link(type, i.slug, i.name)})</span>` : '');
  return [
    ['Inventory no.', e.inventory_number ? html`${e.inventory_number}${more.length ? whose(e.institution, 'institution') : ''}` : null],
    ...more.map((n): Fact => [n.label ?? (n.source ? 'Catalogue no.' : n.institution ? 'Inventory no.' : 'Number'),
      html`${n.number}${whose(n.institution, 'institution')}${whose(n.source, 'source')}${cite(n.sources, e.bibliography)}`]),  // each its own sources (API 081)
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
        title: e.name, subtitle: personDates(e), text: e.biography_html, images: e.images,
        facts: [
          ['Born', dateLabel(e.birth)], ['Died', dateLabel(e.death)],
          ['Active', e.birth || e.death ? '' : dateLabel(e.active)],  // API 147: dates of life unknown
          ...polityFacts(e, 'nationality', 'Nationality', 'Country of birth'),
          ['Born as', otherNames(e, (n) => cite(n.sources, e.bibliography), (n) => n.kind === 'birth')],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography), (n) => n.kind !== 'birth')],
        ],
        extra: e.artworks.length ? [html`<section><h2>Artworks</h2>${artworkList(e.artworks, false)}</section>`] : [],
      };
    case 'artwork': {
      const coCreators = creatorsOf(e).filter((c) => !c.main);
      const byline = [e.creator ? (e.attribution_label ? attributed(e.attribution_label, e.creator.name) : e.creator.name) : e.attribution_label, ...coCreators.map((c) => c.name)];
      return {
        title: displayName(e).text, // an official translation preferred, an own one in [brackets]
        // destroyed or lost (API 103): said at once, under the title — "…, c. 1817 · destroyed 1945"
        subtitle: [[...byline, e.created?.label].filter(Boolean).join(', '),
          e.fate ? [e.fate.label, e.fate.date?.label].filter(Boolean).join(' ') : null].filter(Boolean).join(' · '),
        text: e.description_html, images: e.images,
        facts: [
          [creatorsOf(e).length > 1 ? 'Artists' : 'Artist', creatorsFact(e)],
          ['Date', dateFact(e)],
          ['Fate', fateFact(e)],
          // glossary terms (API 071): linked to their entries, which explain them and carry the translations
          ['Type', e.kind_term ? link('term', e.kind_term.slug, e.kind ?? e.kind_term.name) : e.kind],
          ['Medium', e.medium],
          ['Materials', e.materials.length ? html`${e.materials.map((m, i) => {
            const t = (e.material_terms ?? []).find((x) => x.name === m);
            return html`${i ? ', ' : ''}${t ? link('term', t.slug, m) : m}`;
          })}` : null],
          ['Dimensions', dimensionsFact(e.dimensions, e.other_dimensions ?? [])],
          ...polityFacts(e, 'created_in_polity', 'Made in', 'Country of origin'),
          ['Collection', collectionFact(e)],
          ...numberFacts(e),
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
        ],
        extra: [partsGrid(e), provenanceSection(e.provenance ?? [], e.bibliography, e.provenance_status, e.sources?.provenance_status, e.provenance_coverage)].filter((x): x is Html => !!x),
      };
    }
    case 'place':
      return {
        // what it is: the precise designation ("canton of Switzerland", API 158), else the kind
        title: e.name, subtitle: [e.designation ?? e.kind, e.country_code].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Existed', e.existed?.label ?? null],   // a dissolved unit, a merged city (API 159)
          // the states it belonged to over time (API 161), each with its years; inherited ones say from where
          ['Belonged to', e.polities?.length ? html`${e.polities.map((x, i) => html`${i ? ' · ' : ''}${link('polity', x.polity.slug, x.polity.name)}${x.period?.label ? html` <span class="muted">${x.period.label}</span>` : ''}`)}` : null],
          ['Part of', refs('place', [...e.ancestors].reverse())],
          // the division its point lies in (Natural Earth), when it isn't among the places it is part of already
          ['Region', e.within && !e.ancestors.some((a) => a.name === e.within!.name) ? e.within.name : null],
          ['Includes', refs('place', e.children)],
          ['Institutions', refs('institution', e.institutions)],
          ['Coordinates', e.location ? `${e.location.coordinates[1].toFixed(4)}, ${e.location.coordinates[0].toFixed(4)}` : null],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
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
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
        ],
        extra: [],
      };
    case 'institution':
      return {
        title: e.name, subtitle: [e.kind, e.place?.name].filter(Boolean).join(' · '), text: e.description_html, images: e.images,
        facts: [
          ['Founded', dateLabel(e.founded)],
          ['Closed', dateLabel(e.dissolved ?? null)],
          ['Address', e.address],
          ['Location', e.place ? html`${link('place', e.place.slug, e.place.name)}${e.country ? html`, ${countryLink(e.country)}` : ''}` : null],
          ...(e.polities.some((p) => p.relationship === 'located_in_polity') ? polityFacts(e, 'located_in_polity', 'Historically in', '') : []),
          ['Website', e.website_url ? html`<a href="${e.website_url}" target="_blank" rel="noopener">${e.website_url.replace(/^https?:\/\/(www\.)?/, '')}</a>` : null],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
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
          ['Born as', otherNames(e, (n) => cite(n.sources, e.bibliography), (n) => n.kind === 'birth')],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography), (n) => n.kind !== 'birth')],
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
        facts: [
          ['Category', html`<a href="/glossary?category=${e.category}">${e.category}</a>`],
          // API 145: the chain of broader terms, widest first — Performing arts › Noh
          ['Broader term', (e.broader ?? []).length ? html`${[...e.broader].reverse().map((t, i) => html`${i ? ' › ' : ''}${link('term', t.slug, t.name)}`)}` : null],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
        ],
        extra: [narrowerTerms(e.narrower ?? []), backlinks('Used in', 'Entries whose texts mention this term.', e.used_in)].filter((x): x is Html => !!x),
      };
    case 'event':
      return {
        title: e.name, subtitle: [e.kind, e.period?.label, e.place?.name].filter(Boolean).join(' · '), text: e.description_html, images: e.images,
        facts: [
          ['Date', dateLabel(e.period)],
          ['Kind', e.kind],
          ['Place', e.place ? html`${link('place', e.place.slug, e.place.name)}${e.country && e.country.name !== e.place.name ? html`, ${countryLink(e.country)}` : ''}` : null],
          ['Part of', e.part_of ? link('event', e.part_of.slug, e.part_of.name) : null],
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
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
          ['Also known as', otherNames(e, (n) => cite(n.sources, e.bibliography))],
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
  artwork: { creator: ['Artist', 'Artists'], attribution_label: ['Artist', 'Artists'], created: ['Date'], conceived: ['Date'], kind: ['Type'], medium: ['Medium'], materials: ['Materials'],
    dimensions: ['Dimensions'], institution: ['Collection'], on_loan: ['Collection'], inventory_number: ['Inventory no.'], fate: ['Fate'] },
  institution: { founded: ['Founded'], dissolved: ['Closed'], address: ['Address', 'Location'], location: ['Address', 'Location'], place: ['Location'] },
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
    if (field === 'title_status' || field === 'provenance_status') continue; // shown beside the heading / under Provenance
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
