// Detail page for all six entity types: facts, images with credits, long text, relationships by category, map.
import { getEntity, getEntityMap, PLURAL } from '../api';
import { GROUPS, type Group } from '../selection';
import {
  countryLink, countryName, dateLabel, figure, html, link, PLURAL_LABEL, polityWithToday, render, spanLabel, trusted, TYPE_LABEL,
  wireImageFallbacks, type Html,
} from '../html';
import { COLORS, createMap, showEntity, showPoint } from '../map';
import type { ArtworkSummary, Category, Country, DetailByPlural, Entity, Image, KindRef, Plural, PolityLink, Relationship } from '../types';
import { guard, loading, showError } from './common';

type Fact = [label: string, value: Html | string | null | undefined | false];

const CATEGORY_ORDER: Category[] = [
  'presence', 'association', 'polity', 'influence', 'education', 'collaboration', 'membership', 'patronage', 'provenance',
];
const CATEGORY_LABEL: Record<string, string> = {
  presence: 'Places (physically there)',
  association: 'Associations',
  influence: 'Influence',
  education: 'Education',
  collaboration: 'Collaboration',
  membership: 'Membership',
  patronage: 'Patronage',
  provenance: 'Provenance',
  polity: 'States and nationality',
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

const refs = (type: Parameters<typeof link>[0], items: KindRef[]) =>
  items.length ? html`${items.map((r, i) => html`${i ? ', ' : ''}${link(type, r.slug, r.name)}`)}` : null;

const artworkList = (works: ArtworkSummary[], withCreator: boolean) => html`<ul class="plain-list">${works.map((w) => html`<li>
  ${link('artwork', w.slug, w.title)}${w.created ? html` <span class="muted">${w.created.label}</span>` : ''}
  ${withCreator && w.creator ? html` · ${link('artist', w.creator.slug, w.creator.name)}` : ''}
</li>`)}</ul>`;

function factsFor(e: Entity): { title: string; subtitle: string; facts: Fact[]; text: string | null; images: Image[]; extra: Html[] } {
  const alt = (names: string[]) => (names.length ? names.join(' · ') : null);
  switch (e.type) {
    case 'artist':
      return {
        title: e.name, subtitle: spanLabel(e.birth, e.death), text: e.biography_html, images: e.images,
        facts: [
          ['Born', dateLabel(e.birth)], ['Died', dateLabel(e.death)],
          ...polityFacts(e, 'nationality', 'Nationality', 'Country of birth'),
          ['Also known as', alt(e.alt_names)],
        ],
        extra: e.artworks.length ? [html`<section><h2>Artworks</h2>${artworkList(e.artworks, false)}</section>`] : [],
      };
    case 'artwork':
      return {
        title: e.title,
        subtitle: [e.creator?.name ?? e.attribution_label, e.created?.label].filter(Boolean).join(', '),
        text: e.description_html, images: e.images,
        facts: [
          ['Artist', e.creator ? link('artist', e.creator.slug, e.creator.name) : e.attribution_label],
          ['Date', dateLabel(e.created)],
          ['Type', e.kind],
          ['Medium', e.medium],
          ['Materials', e.materials.length ? e.materials.join(', ') : null],
          ['Dimensions', e.dimensions?.label ? [e.dimensions.label, e.dimensions.note].filter(Boolean).join(' — ') : null],
          ...polityFacts(e, 'created_in_polity', 'Made in', 'Country of origin'),
          ['Collection', e.institution ? link('institution', e.institution.slug, e.institution.name) : null],
          ['Inventory no.', e.inventory_number],
          ['Also known as', alt(e.alt_titles)],
        ],
        extra: [],
      };
    case 'place':
      return {
        title: e.name, subtitle: [e.kind, e.country_code].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Part of', refs('place', [...e.ancestors].reverse())],
          ['Includes', refs('place', e.children)],
          ['Institutions', refs('institution', e.institutions)],
          ['Coordinates', e.location ? `${e.location.coordinates[1].toFixed(4)}, ${e.location.coordinates[0].toFixed(4)}` : null],
          ['Also known as', alt(e.alt_names)],
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
          ['Also known as', alt(e.alt_names)],
        ],
        extra: [],
      };
    case 'institution':
      return {
        title: e.name, subtitle: [e.kind, e.place?.name].filter(Boolean).join(' · '), text: e.description_html, images: e.images,
        facts: [
          ['Founded', dateLabel(e.founded)],
          ['Location', e.place ? html`${link('place', e.place.slug, e.place.name)}${e.country ? html`, ${countryLink(e.country)}` : ''}` : null],
          ...(e.polities.some((p) => p.relationship === 'located_in_polity') ? polityFacts(e, 'located_in_polity', 'Historically in', '') : []),
          ['Website', e.website_url ? html`<a href="${e.website_url}" target="_blank" rel="noopener">${e.website_url.replace(/^https?:\/\/(www\.)?/, '')}</a>` : null],
          ['Also known as', alt(e.alt_names)],
        ],
        extra: e.artworks.length ? [html`<section><h2>Artworks in the collection</h2>${artworkList(e.artworks, true)}</section>`] : [],
      };
    case 'patron':
      return {
        title: e.name, subtitle: [e.kind, e.active ? `active ${e.active.label}` : null].filter(Boolean).join(' · '),
        text: e.notes_html, images: [],
        facts: [['Active', dateLabel(e.active)], ...polityFacts(e, 'nationality', 'Nationality', 'Country of birth'), ['Also known as', alt(e.alt_names)]],
        extra: [],
      };
    case 'polity':
      return {
        title: e.name, subtitle: [e.kind, e.period?.label].filter(Boolean).join(' · '), text: e.description_html, images: [],
        facts: [
          ['Existed', dateLabel(e.period)],
          ['Territory today', e.country_codes.length ? e.country_codes.map((c) => countryName(c) ?? c).join(', ') : null],
          ['Part of', refs('polity', [...e.ancestors].reverse())],
          ['Includes', refs('polity', e.children)],
          ['Also known as', alt(e.alt_names)],
        ],
        extra: [],
      };
  }
}

function relationshipSections(rels: Relationship[]): Html {
  const groups = new Map<string, Relationship[]>();
  for (const r of rels) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  const order = [...groups.keys()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a as Category) + 1 || 99) - (CATEGORY_ORDER.indexOf(b as Category) + 1 || 99),
  );
  const byDate = (a: Relationship, b: Relationship) =>
    (a.period?.from ?? '9999').localeCompare(b.period?.from ?? '9999');
  return html`${order.map((cat) => html`<section class="rel-group rel-${cat}">
    <h2>${CATEGORY_LABEL[cat] ?? cat}</h2>
    <ul class="rel-list">${groups.get(cat)!.sort(byDate).map((r) => html`<li>
      <span class="rel-label">${r.label}</span>
      ${link(r.entity.type, r.entity.slug, r.entity.name)}
      ${r.period ? html`<span class="muted">${r.period.label}</span>` : ''}
      ${r.certainty && r.certainty !== 'attested' ? html`<span class="tag">${r.certainty}</span>` : ''}
      ${r.note ? html`<div class="rel-note">${r.note}</div>` : ''}
      ${r.notes_html ? html`<div class="rel-note">${trusted(r.notes_html)}</div>` : ''}
    </li>`)}</ul>
  </section>`)}`;
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
      const hasMap = e.type === 'place' ? !!e.location : true;
      render(main, html`<article class="page detail detail-${e.type}">
        <p class="crumbs"><a href="#/${plural}">${PLURAL_LABEL[plural]}</a> / ${TYPE_LABEL[e.type]}</p>
        <h1>${v.title}</h1>
        ${v.subtitle ? html`<p class="subtitle">${v.subtitle}</p>` : ''}
        ${GROUPS.includes(e.type as Group) ? html`<p class="detail-actions"><a class="button-link" href="#/?${PLURAL[e.type]}=${encodeURIComponent(e.slug)}">Show on the map and timeline →</a></p>` : ''}
        <div class="detail-grid">
          <div class="detail-main">
            ${v.images.length ? html`<div class="gallery">${v.images.map((img) => figure(img, v.title))}</div>` : ''}
            ${v.text ? html`<div class="prose">${trusted(v.text)}</div>` : ''}
            ${facts.length ? html`<dl class="facts">${facts.map(([k, value]) => html`<dt>${k}</dt><dd>${value}</dd>`)}</dl>` : ''}
            ${e.wikidata_id ? html`<p class="muted small">Wikidata: <a href="https://www.wikidata.org/wiki/${e.wikidata_id}" target="_blank" rel="noopener">${e.wikidata_id}</a></p>` : ''}
            ${v.extra}
            ${relationshipSections(e.type === 'polity' ? e.relationships : e.relationships.filter((r) => r.category !== 'polity'))}
          </div>
          ${hasMap ? html`<aside class="detail-side">
            <div class="map map-small" id="map"></div>
            <div class="legend" id="legend"></div>
          </aside>` : ''}
        </div>
      </article>`);
      wireImageFallbacks(main);
      if (!hasMap) return;

      const mapEl = main.querySelector<HTMLElement>('#map')!;
      const legend = main.querySelector<HTMLElement>('#legend')!;
      const map = createMap(mapEl);
      cleanup = () => map.remove();
      if (e.type === 'place') {
        showPoint(map, e.location!.coordinates, e.name);
        return;
      }
      getEntityMap(plural as Exclude<Plural, 'places'>, slug)
        .then((fc) => {
          if (!current()) return;
          const stops = fc.features.filter((f) => f.geometry.type === 'Point');
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
