// Detail page for every entity type: facts, images with credits, long text, relationships by category, map.
import { getEntity, getEntityMap, PLURAL } from '../api';
import { navigate, replaceUrl } from '../router';
import { asOfView } from './asof';
import { keepInView, markWords, wordsToMark } from '../highlight';
import { citeSection, connectSection, sharedHandsSection } from './detail-network';
import { GROUPS, type Group } from '../selection';
import {
  titleStatusLine, displayName, langAttr, originalLine, figure, html, PLURAL_LABEL, render, trusted, TYPE_LABEL, wireImageFallbacks, wireLightbox,
} from '../html';
import { COLORS } from '../colors';
import type { DetailByPlural, Plural } from '../types';
import { guard, loading, showError } from './common';
import { wireTextLinks } from '../glossary';
import { knownPreviews } from '../previews';
import { partNav, seriesLine } from '../series';
import { cite, resetCitations, wireCitations } from '../cite';
import { accessedNote, factsFor, webPage, webPageLink, withSources } from './detail-facts';
import { backlinks, crossedPaths, holdingsSections, relationshipSections, shownElsewhere } from './detail-sections';

/** `key`: a slug or a public number (API 085); the page then moves to the entry's canonical address (`path`). */
export function detail(main: HTMLElement, plural: Plural, key: string) {
  // a version as recorded then (API 089): its own, simpler page
  const asOf = new URLSearchParams(location.search).get('as_of');
  if (asOf) return asOfView(main, plural, key, asOf);
  loading(main);
  const current = guard();
  let cleanup: (() => void) | undefined;
  let observer: IntersectionObserver | undefined;
  // started together with the entry rather than after it: one round trip less (terms and sources have no map,
  // places and events show their own point; the route data is for the others)
  const mapModule = plural === 'glossary' || plural === 'bibliography' ? null : import('../map');
  // the map API knows slugs only: by number, it waits for the entry (backend wish: maps by number)
  const entry = getEntity(plural, key);
  const byNumber = /^\d+$/.test(key);
  const mapData = mapModule && plural !== 'places' && plural !== 'events'
    ? (byNumber ? entry.then((e) => getEntityMap(plural as Exclude<Plural, 'places'>, e.slug)) : getEntityMap(plural, key)) : null;
  mapModule?.catch(() => {}); // handled where they are used; no unhandled rejection when the entry fails first
  mapData?.catch(() => {});

  entry
    .then((e: DetailByPlural[Plural]) => {
      if (!current()) return;
      // the canonical address (API 085): from an old slug address, a renamed slug, or a number of another type
      if (e.path && location.pathname !== e.path) {
        const to = e.path + location.search + location.hash;
        if (PLURAL[e.type] !== plural) { navigate(to, { replace: true }); return; } // another type: its own page
        replaceUrl(to);
      }
      resetCitations();
      const v = factsFor(e);
      document.title = `${v.title} · Art History`;
      const facts = withSources(e, v.facts.filter(([, value]) => value));
      // a holder (collector, dealer, museum): what it held, one line per work, instead of every provenance link
      const listed = e.relationships.filter((r) => (e.type === 'polity' || r.category !== 'polity') && !shownElsewhere(e, r));
      const holdings = e.type === 'artwork' ? null : holdingsSections(listed, e.bibliography);
      const web = webPage(e);
      const hasMap = e.type === 'place' ? !!e.location : e.type === 'event' ? !!(e.area ?? e.location ?? e.place?.location) : e.type !== 'term' && e.type !== 'source';
      // an event on the start map: its years as the time window (the events layer follows it)
      const eventWindow = e.type === 'event' && e.period ? [e.period.from_year ?? e.period.to_year, e.period.to_year ?? e.period.from_year] : null;
      render(main, html`<article class="page detail detail-${e.type}">
        <p class="crumbs"><a href="/${plural}">${PLURAL_LABEL[plural]}</a> / ${TYPE_LABEL[e.type]}</p>
        <h1${langAttr(displayName(e).lang)}>${displayName(e).ruby ? trusted(displayName(e).ruby) : v.title}</h1>
        ${originalLine(e)}
        ${titleStatusLine(e) ? html`<p class="title-status muted small">${titleStatusLine(e)}${cite(e.sources?.[displayName(e).swapped ? 'names' : 'title_status'], e.bibliography)}</p>` : ''}
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
            <div id="crossed-anchor"></div><section id="crossed" class="crossed" hidden></section>
            ${e.type === 'artwork' ? html`<section id="shared-hands" class="shared" hidden></section>` : ''}
            ${holdings?.html ?? ''}
            ${relationshipSections(holdings?.rest ?? listed, e.type, e.bibliography)}
            ${e.type === 'source'
              ? backlinks('Cited in', 'Entries whose texts cite this source.', e.mentioned_in)
              : backlinks('Mentioned in', 'Entries whose texts link to this one.', e.mentioned_in)}
            <section id="connect" class="connect"></section>
            <section id="cite-version" class="cite-version" hidden></section>
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
      wireCitations(main);
      // all-time presence + the artworks list is a heavy download: only once the section is about to come into view
      if (['artist', 'person', 'artwork', 'place'].includes(e.type)) {
        observer = new IntersectionObserver((seen) => {
          if (!seen.some((x) => x.isIntersecting)) return;
          observer?.disconnect();
          crossedPaths(main.querySelector<HTMLElement>('#crossed')!, e.type, e.slug, current);
        }, { rootMargin: '800px 0px' });
        observer.observe(main.querySelector('#crossed-anchor')!);
      }
      // network questions and versions (API 088/089)
      if (e.type === 'artwork') sharedHandsSection(main.querySelector<HTMLElement>('#shared-hands')!, e, current);
      connectSection(main.querySelector<HTMLElement>('#connect')!, e, current);
      citeSection(main.querySelector<HTMLElement>('#cite-version')!, plural, e, v.title, current);
      // a search hit (src/views/search.ts): its provenance step, else the Provenance section, with the matched words
      // (?hl=) marked there — or, for a hit in the texts, marked on the page and the first one in view
      const step = location.hash.startsWith('#provenance-') ? main.querySelector(`[id="${CSS.escape(location.hash.slice(1))}"]`) : null;
      step?.classList.add('search-target');
      const scope = step ?? (location.hash.startsWith('#provenance') ? main.querySelector('#provenance') : null);
      const marks = markWords(scope ?? main.querySelector('.detail-main') ?? main, wordsToMark());
      const target = step ?? marks[0] ?? scope;
      if (target) keepInView(target, main);
      if (!hasMap) return;

      const mapEl = main.querySelector<HTMLElement>('#map')!;
      const legend = main.querySelector<HTMLElement>('#legend')!;
      // MapLibre loads only for pages with a map (terms and sources have none)
      mapModule!.then(({ createMap, gapList, showEntity, showOwnSite, showPoint, showProvenance, unplacedSteps, placedProvenance, probable }) => {
        if (!current()) return;
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
        mapData!
          .then((fc) => {
            if (!current()) return;
            // an artwork with a placed provenance step: the provenance replaces its route and kept_in dots
            const prov = placedProvenance(fc);
            const provStops = prov?.features.flatMap((f) => (f.properties.layer === 'provenance_stop' ? [f.properties] : [])) ?? [];
            const provSegments = prov?.features.flatMap((f) => (f.properties.layer === 'provenance_segment' ? [f.properties] : [])) ?? [];
            const stops = fc.features.filter((f) => f.geometry.type === 'Point'
              && !(prov && f.properties.layer === 'presence' && ['kept_in', 'created_in'].includes(f.properties.relationship)));
            // an institution's own point, or where an immovable artwork stands
            const own = e.type === 'institution' ? e.location ?? null : e.type === 'artwork' ? e.area ?? e.location ?? null : null;
            if (own) showOwnSite(map, own, v.title, !stops.length && !prov);
            if (!stops.length && !prov && own) {
              render(legend, html`<span><i class="dot" style="background:${COLORS.site}"></i>${e.type === 'artwork' ? 'where it stands' : 'its building'}</span>`);
              return;
            }
            if (!stops.length && !prov) {
              main.querySelector('.detail-side')?.remove();
              map.remove();
              cleanup = undefined;
              return;
            }
            // what the dates imply (API 086), by step position: the distance a work travelled labels its segment
            const inferences = e.type === 'artwork'
              ? new Map((e.provenance ?? []).filter((s) => s.inferences?.length).map((s) => [s.position, s.inferences!])) : undefined;
            const view = prov ? showProvenance(map, fc, inferences, e.type === 'artwork' && !!e.fate && e.fate.status !== 'partly_destroyed') : showEntity(map, fc);
            const layers = new Set(stops.map((f) => f.properties.layer));
            const both = (layers.has('presence') || !!prov) && layers.has('association');
            const c = COLORS.provenance;
            render(legend, html`
              ${prov ? html`
                ${provStops.some((s) => !probable(s)) ? html`<span><i class="dot" style="background:${c}"></i>holders, numbered in the provenance's order</span>` : ''}
                ${provStops.some(probable) ? html`<span><i class="ring ring-dashed" style="border-color:${c}"></i>probably made here (where the artist lived or worked)</span>` : ''}
                ${provStops.some((s) => s.precision === 'region' || s.precision === 'country') ? html`<span><i class="ring ring-area" style="border-color:${c}"></i>only the region or country known</span>` : ''}
                ${provSegments.some((s) => !s.implied && s.direct) ? html`<span><i class="line" style="background:${c}"></i>handover documented</span>` : ''}
                ${provSegments.some((s) => !s.implied && !s.direct) ? html`<span><i class="line line-dashed" style="border-color:${c}"></i>handover not documented</span>` : ''}
                ${provSegments.some((s) => s.implied) ? html`<span><i class="line line-dotted" style="border-color:${c}"></i>implied</span>` : ''}
                ${provSegments.some((s) => s.gaps?.length) ? html`<span><i class="prov-gap prov-gap-key">?</i>gap: no holder known (red: 1933–1945)</span>` : ''}` : ''}
              ${layers.has('presence') ? html`<span><i class="dot" style="background:${COLORS.presence}"></i>was there</span>` : ''}
              ${!prov && fc.features.some((f) => f.properties.layer === 'route') ? html`<span><i class="line" style="background:${COLORS.route}"></i>route, in date order</span>` : ''}
              ${layers.has('association') ? html`<span><i class="ring" style="border-color:${COLORS.association}"></i>association (not travel)</span>` : ''}
              ${own ? html`<span><i class="dot" style="background:${COLORS.site}"></i>${e.type === 'artwork' ? 'where it stands' : 'its building'}</span>` : ''}
              ${both ? html`<button type="button" class="link-button" data-fit="all">show associations</button>` : ''}
              ${prov?.unplaced.length ? html`<div class="legend-note" id="unplaced">Not on the map (place not recorded):
                ${unplacedSteps(prov)}</div>` : ''}
              ${prov && e.type === 'artwork' && e.travel ? html`<div class="legend-note" id="travel" title="${String(e.travel.legs)} ${e.travel.legs === 1 ? 'move' : 'moves'} between different places, along the line through the provenance's stops">Travelled ≈ ${e.travel.km.toLocaleString('en')} km over ${String(e.travel.placed)} of ${String(e.travel.steps)} steps</div>` : ''}
              ${prov?.gaps?.length ? html`<div class="legend-note" id="gaps">Gaps in the provenance:
                ${gapList(prov)}</div>` : ''}`);
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
      }).catch((err) => current() && showError(legend, err));
    })
    .catch((err) => current() && showError(main, err));

  return () => {
    observer?.disconnect();
    cleanup?.();
  };
}
