// Start page: map + timeline over what the pickers select (per type: all, none or chosen entries).
// - no time window, nothing chosen individually → every place, sized by its number of links
// - no time window, entries chosen             → their routes and places, one colour per entry
// - a time window on the timeline              → who/what of the selection was physically where (artworks: their provenance in the window)
// Museums and events are layers over that, with pickers of their own (selection.ts LAYERS): "auto" by default — museums
// linked to what the map shows (holders of the chosen works, venues of the chosen people's stays), events in the time
// window, else in the span of the chosen entries (their lives; an artwork from its making until today). In a time
// window only the museums that existed then (founded … dissolved, API 106) and the events in it.
// The state lives in the URL (/?artists=…&movements=none&institutions=all&from=1888&to=1889) and is remembered locally.
// The home page (/) shows curated views (/v1/featured, edited in the admin panel): the first one, others at
// /?featured=<slug>, everything at /?all. A view is a saved URL query; changing the picks or the window makes it your own.
import { getClusters, getEntityMap, getEventsMap, getFeatured, getPlacesMap, getPresence, getPreviews, getProvenances, getSites, getView, listAll, PLURAL } from '../api';
import { wireTextLinks } from '../glossary';
import { entries } from '../catalog';
import { creatorsOf, href, html, render, trusted } from '../html';
import { compareUrl, encounterLine } from '../crossings';
import { findEncounters, type Encounter, type Stay } from '../encounters';
import {
  CLUSTER_BELOW, COLORS, createMap, focusEncounter, showClusters, highlightRoute, PALETTE, placedProvenance, provenanceInWindow, showEncounters, showEvents, showPlaces, showPresence, showSelection,
  showSites, unplacedSteps, type ColoredEntityMap, type RouteInfo,
} from '../map';
import { overlaps } from '../map-core';
import { mountPickers, type PickerGroup } from '../picker';
import { replaceQuery } from '../router';
import { chosen, GROUPS, includes, layerIncludes, parseSelection, writeSelection, type Selection } from '../selection';
import { reducedMotion } from '../theme';
import { renderTimeline, type TimelineRow } from '../timeline';
import type { DateRange, EntityType, EventsMap, FeaturedView, Plural, PresenceMap, ProvenanceMap, SitesMap, StopProps } from '../types';
import { showError } from './common';

const STORAGE_KEY = 'arthistory:explore';
const MAX_ROUTES = 24; // one request each; beyond that, use a time window

type Window = { from: number; to: number } | null;

const THIS_YEAR = new Date().getFullYear();
/** An artwork still there: its timeline bar runs until today. */
const TODAY: DateRange = { label: 'today', from: null, to: null, from_year: THIS_YEAR, to_year: THIS_YEAR };
const yearsMeet = (from: number | null | undefined, to: number | null | undefined, w: NonNullable<Window>) =>
  (from ?? -Infinity) <= w.to && (to ?? Infinity) >= w.from;

function readWindow(params: URLSearchParams): Window {
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  return params.has('from') && params.has('to') && Number.isInteger(from) && Number.isInteger(to) && from <= to ? { from, to } : null;
}

function remembered(): URLSearchParams | null {
  try {
    const q = localStorage.getItem(STORAGE_KEY);
    return q ? new URLSearchParams(q) : null;
  } catch {
    return null;
  }
}

/** The curated views around the one shown; `home`: shown at a plain / (the first view). */
interface Curated { views: FeaturedView[]; view: FeaturedView; home: boolean }

export function explore(main: HTMLElement, params: URLSearchParams) {
  // a short address (/?v=<code>, API 072): the stored selection, shown under that address until it is changed
  const code = params.get('v');
  if (code) {
    let gone = false;
    let cleanup: (() => void) | undefined;
    render(main, html`<section class="explore"><p class="muted small">Loading…</p></section>`);
    getView(code).then((v) => {
      if (gone) return;
      cleanup = start(main, new URLSearchParams(v.query), null, false);  // the address stays /?v=… until a change
    }).catch(() => {
      if (gone) return;
      render(main, html`<section class="explore"><p class="flash">This short link is unknown — <a href="/?all">show everything</a>.</p></section>`);
    });
    return () => {
      gone = true;
      cleanup?.();
    };
  }
  const slug = params.get('featured');
  if ([...params.keys()].length && slug === null) return start(main, params, null);
  // the home page and /?featured=…: the curated views first; without any (or without the API) everything, as before
  let gone = false;
  let cleanup: (() => void) | undefined;
  render(main, html`<section class="explore"><p class="muted small">Loading…</p></section>`);
  getFeatured().catch(() => [] as FeaturedView[]).then((views) => {
    if (gone) return;
    const view = views.find((v) => v.slug === slug) ?? views[0];
    cleanup = view ? start(main, new URLSearchParams(view.query), { views, view, home: slug === null }) : start(main, new URLSearchParams(), null, slug === null);
  });
  return () => {
    gone = true;
    cleanup?.();
  };
}

/** `home`: shown at a plain / — offers the reader's last own view. */
function start(main: HTMLElement, params: URLSearchParams, curated: Curated | null, home = curated?.home ?? false) {
  let sel: Selection = parseSelection(params);
  let win: Window = readWindow(params);

  render(main, html`<section class="explore">
    <div class="intro">
      <h1>Art history on a map and a timeline</h1>
      <p>Where artists were born, lived and travelled, where their works were made and where they are now. Choose what to show, then pick a time window on the timeline to see who was where.</p>
    </div>
    <nav class="featured" id="featured" aria-label="Curated views" hidden></nav>
    <div class="featured-intro" id="featured-intro" hidden></div>
    <p class="restored" id="restored" hidden></p>
    <div id="pickers" class="pickers-wrap"><p class="muted small">Loading entries…</p></div>
    <div class="view-chips" id="chips" hidden></div>
    <div class="map-wrap">
      <div class="map" id="map"></div>
      <div class="legend" id="legend"></div>
      <div class="layer-toggles">
        <span class="sites-toggle" id="sites-toggle" hidden></span>
        <span class="sites-toggle" id="events-toggle" hidden></span>
      </div>
    </div>
    <p class="map-status muted" id="map-status"></p>
    <section class="encounters" id="encounters" hidden aria-live="polite"></section>
    <div id="timeline"></div>
  </section>`);

  const map = createMap(main.querySelector<HTMLElement>('#map')!);
  const status = main.querySelector<HTMLElement>('#map-status')!;
  const legend = main.querySelector<HTMLElement>('#legend')!;
  const encountersEl = main.querySelector<HTMLElement>('#encounters')!;

  // ---- layers: museums and sites, events (their own pickers; "auto" by default — see the top) ----------------------
  // museums and sites with their own location (institutions; buildings, which follow the artwork picker)
  const sitesKey = main.querySelector<HTMLElement>('#sites-toggle')!;
  const eventsKey = main.querySelector<HTMLElement>('#events-toggle')!;
  let sites: SitesMap | null = null;
  let events: EventsMap | null = null;
  let venues = new Set<string>(); // institutions at the stops the map shows (the exact venue of a stay)
  const useVenues = (refs: ({ slug: string } | null | undefined)[]) => { venues = new Set(refs.flatMap((r) => (r ? [r.slug] : []))); };
  const spanText = (w: NonNullable<Window>) => (w.from === w.to ? String(w.from) : `${w.from}–${w.to}`);

  /**
   * Without a time window: the years the chosen entries cover — null until the lists are in (then every event),
   * empty (no event) when nothing chosen has a date.
   */
  function selectionSpan(): Window {
    if (!lists) return null;
    const ranges = entityRows().flatMap((r) => [r.from, r.to]).filter((d): d is DateRange => !!d);
    const from = Math.min(...ranges.map((d) => d.from_year ?? Infinity));
    const to = Math.max(...ranges.map((d) => d.to_year ?? d.from_year ?? -Infinity));
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : { from: Infinity, to: -Infinity };
  }
  /** Museums linked to what the map shows: holders (now and before) of the works included, venues of the stays. */
  function linkedMuseums() {
    const linked = new Set(venues);
    for (const a of lists?.artworks ?? []) {
      if (!a.holders || !includes(sel, 'artwork', a.slug, artistsOf)) continue;
      for (const h of [...a.holders.now, ...a.holders.before]) linked.add(h.slug);
    }
    return linked;
  }
  const existed = (f: SitesMap['features'][number]) => !win || yearsMeet(f.properties.from_year, f.properties.to_year, win);
  function shownSites() {
    if (!sites) return [];
    const linked = linkedMuseums();
    return sites.features.filter((f) => existed(f) && (f.properties.type === 'artwork'
      ? includes(sel, 'artwork', f.properties.slug, artistsOf)
      : layerIncludes(sel, 'institution', f.properties.slug, (slug) => linked.has(slug))));
  }
  /** Events in the window; "auto" without one: in the chosen entries' span (all of them before the lists are in). */
  function eventShown(f: EventsMap['features'][number], span: Window) {
    if (win && !overlaps(f.properties.period, win)) return false;
    return layerIncludes(sel, 'event', f.properties.slug, () => !span || overlaps(f.properties.period, span));
  }
  /** What "auto" picks in the pickers, so their ticks and counts show it. */
  function autoPicks() {
    const linked = linkedMuseums();
    const span = win ?? selectionSpan();
    return {
      institution: new Set((sites?.features ?? []).filter((f) => f.properties.type === 'institution' && existed(f) && linked.has(f.properties.slug)).map((f) => f.properties.slug)),
      event: new Set((events?.features ?? []).filter((f) => !span || overlaps(f.properties.period, span)).map((f) => f.properties.slug)),
    };
  }
  let autoNow = { institution: new Set<string>(), event: new Set<string>() }; // drawLayers() fills it

  function drawLayers() {
    autoNow = autoPicks();
    pickers?.refresh();
    if (sites?.features.length) {
      const shown = shownSites();
      showSites(map, { ...sites, features: shown }, true);
      sitesKey.hidden = false;
      sitesKey.innerHTML = html`<i class="dot" style="background:${COLORS.site}"></i> Museums and sites (${String(shown.length)}${win ? ` that existed in ${spanText(win)}` : ''})`.value;
    }
    if (events?.features.length) {
      const span = win ?? selectionSpan();
      const shown = events.features.filter((f) => eventShown(f, span));
      showEvents(map, { ...events, features: shown }, { visible: true, window: null });
      eventsKey.hidden = false;
      const range = span && Number.isFinite(span.from) && (win || sel.event.mode === 'auto') ? ` in ${spanText(span)}` : '';
      eventsKey.innerHTML = html`<i class="dot" style="background:${COLORS.event}"></i> Events (${String(shown.length)}${range})`.value;
    }
  }
  getSites().then((fc) => {
    if (!main.contains(sitesKey)) return;
    sites = fc;
    drawLayers();
  }).catch(() => { /* optional layer */ });
  getEventsMap().then((fc) => {
    if (!main.contains(eventsKey)) return;
    events = fc;
    drawLayers();
    drawTimeline();
  }).catch(() => { /* optional layer */ });

  // ---- curated views: a switcher (links: each view has its address), the shown one's intro; "Explore everything" ----
  const featuredEl = main.querySelector<HTMLElement>('#featured')!;
  const featuredIntro = main.querySelector<HTMLElement>('#featured-intro')!;
  let own = !curated; // the picks or the window were changed: the view is the reader's own now
  function drawFeatured() {
    if (!curated) return;
    featuredEl.hidden = false;
    const at = (v: FeaturedView) => (v === curated.views[0] ? '/' : `/?featured=${encodeURIComponent(v.slug)}`);
    render(featuredEl, html`${curated.views.map((v) => html`<a class="chip${!own && v === curated.view ? ' on' : ''}" href="${at(v)}"${!own && v === curated.view ? html` aria-current="page"` : ''}>${v.title}</a>`)}
      <a class="featured-all" href="/?all">Explore everything →</a>`);
    featuredIntro.hidden = own;
    if (own) return;
    render(featuredIntro, html`<h2>${curated.view.title}</h2>${curated.view.intro_html ? html`<div class="prose">${trusted(curated.view.intro_html)}</div>` : ''}`);
    // its [[links]]: the same previews as in an entry's text (the API sends the intro without them)
    const refs = [...new Set([...featuredIntro.querySelectorAll<HTMLAnchorElement>('a.entry-link:not(.missing)')].map((a) => a.dataset.entry!).filter(Boolean))];
    wireTextLinks(featuredIntro, undefined); // missing entries → plain text at once
    if (refs.length) getPreviews(refs).then((entries) => {
      if (own) return;
      wireTextLinks(featuredIntro, undefined, undefined, entries);
      // a link hovered before the previews came: open it now (a further pointerenter would only come on the next hover)
      featuredIntro.querySelector('a.entry-link:hover')?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    }).catch(() => { /* plain links */ });
  }
  drawFeatured();

  // the reader's last own view, one click away from the home page (no longer restored by itself)
  const restoredEl = main.querySelector<HTMLElement>('#restored')!;
  const last = home ? remembered() : null;
  if (last && [...last.keys()].some((k) => k !== 'all')) {
    const w = readWindow(last);
    const parts = [w ? `time window ${w.from === w.to ? w.from : `${w.from}–${w.to}`}` : '', [...last.keys()].some((k) => !['from', 'to', 'all'].includes(k)) ? 'your selection' : '']
      .filter(Boolean).join(' and ');
    render(restoredEl, html`<a href="/?${last.toString()}">Continue where you left off</a>${parts ? ` (${parts})` : ''}`);
    restoredEl.hidden = false;
  }

  // ---- crossed paths: entries at the same place at the same time, listed under the map ----
  const SHOW_FIRST = 6;
  let crossed: Encounter[] = [];
  let crossedCoords: (slug: string) => [number, number] | undefined = () => undefined;
  let showAllCrossed = false;
  // they need each artwork's artists (a work with its own artist is no encounter): held back until the lists are in
  let artistsKnown = false;
  let pendingCrossings: Parameters<typeof crossings> | null = null;
  function crossings(stays: Stay[], coords: (slug: string) => [number, number] | undefined) {
    if (!artistsKnown) {
      pendingCrossings = [stays, coords];
      return;
    }
    crossed = findEncounters(stays, { artistsOf, window: win });
    crossedCoords = coords;
    showEncounters(map, crossed, coords);
    drawCrossings();
  }
  function drawCrossings() {
    encountersEl.hidden = !crossed.length;
    if (!crossed.length) return;
    const shown = showAllCrossed ? crossed : crossed.slice(0, SHOW_FIRST);
    render(encountersEl, html`<h2>Crossed paths <span class="muted small">at the same place at the same time, marked with a yellow halo on the map${win ? ` · ${win.from === win.to ? win.from : `${win.from}–${win.to}`}` : ''}</span></h2>
      <ul class="encounters-list">${shown.map((e, i) => encounterLine(e, { actions: html`<div class="encounter-actions">
        <button type="button" class="link-button" data-encounter="${String(i)}">show on the map</button>
        <a href="${compareUrl(e)}">only these two →</a></div>` }))}</ul>
      ${crossed.length > SHOW_FIRST ? html`<button type="button" class="link-button" data-crossed-all>${showAllCrossed ? 'show fewer' : `show all ${crossed.length}`}</button>` : ''}`);
  }
  encountersEl.addEventListener('click', (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.crossedAll !== undefined) {
      showAllCrossed = !showAllCrossed;
      return drawCrossings();
    }
    const e = crossed[Number(b.dataset.encounter)];
    if (e) {
      focusEncounter(map, e, crossedCoords);
      main.querySelector('#map')!.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    }
  });
  const timelineEl = main.querySelector<HTMLElement>('#timeline')!;
  const pickersEl = main.querySelector<HTMLElement>('#pickers')!;

  const colorOf = (() => {
    let index = new Map<string, string>();
    return {
      reset() {
        index = new Map(chosen(sel).map((c, i) => [`${c.type}/${c.slug}`, PALETTE[i % PALETTE.length]]));
      },
      get: (type: EntityType, slug: string) => index.get(`${type}/${slug}`) ?? routeColors.get(`${type}/${slug}`),
    };
  })();
  colorOf.reset();

  // ---- routes on the start map / in a time window: one colour each, named in the legend ----
  let routeColors = new Map<string, string>();
  const LEGEND_FIRST = 12;
  let legendAll = false;
  let lastRoutes: RouteInfo[] = [];
  /** Keeps the colours and redraws the timeline when they changed (its bars use the same colours). */
  function useRoutes(info: RouteInfo[]) {
    lastRoutes = info;
    const next = new Map(info.map((i) => [i.key, i.color]));
    const changed = next.size !== routeColors.size || [...next].some(([k, c]) => routeColors.get(k) !== c);
    routeColors = next;
    if (changed) timeline?.redraw(); // repaint only: a rebuild would wipe years being typed
  }
  const routeLegend = () => {
    const shown = legendAll ? lastRoutes : lastRoutes.slice(0, LEGEND_FIRST);
    return html`${shown.map((r) => html`<span class="route-key" data-route="${r.key}" tabindex="0" title="Highlight ${r.name}'s route"><i class="line" style="background:${r.color}"></i>${r.name}</span>`)}
      ${lastRoutes.length > LEGEND_FIRST ? html`<button type="button" class="link-button" data-legend-all>${legendAll ? 'fewer' : `+ ${lastRoutes.length - LEGEND_FIRST} more`}</button>` : ''}`;
  };
  // hover or focus a name: its route stands out; click: stays highlighted until clicked again
  let pinned: string | null = null;
  const routeKeyOf = (ev: Event) => (ev.target as Element).closest<HTMLElement>('[data-route]')?.dataset.route ?? null;
  const showRoute = (key: string | null) => {
    highlightRoute(map, key ? [key] : pinned ? [pinned] : []);
    legend.querySelectorAll<HTMLElement>('[data-route]').forEach((el) => el.classList.toggle('on', el.dataset.route === (key ?? pinned)));
  };
  legend.addEventListener('mouseover', (ev) => { const k = routeKeyOf(ev); if (k) showRoute(k); });
  legend.addEventListener('mouseout', (ev) => { if (routeKeyOf(ev)) showRoute(null); });
  legend.addEventListener('focusin', (ev) => { const k = routeKeyOf(ev); if (k) showRoute(k); });
  legend.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-legend-all]')) {
      legendAll = !legendAll;
      return redrawLegend();
    }
    const k = routeKeyOf(ev);
    if (!k) return;
    pinned = pinned === k ? null : k;
    showRoute(null);
  });
  let redrawLegend = () => {};

  // ---- the time window, above the map: on a phone the timeline that set it is far below; ✕ clears it ----
  // (the picks are named by the pickers' own buttons right above)
  const chipsEl = main.querySelector<HTMLElement>('#chips')!;
  function drawChips() {
    chipsEl.hidden = !win;
    if (!win) return;
    const span = win.from === win.to ? String(win.from) : `${win.from}–${win.to}`;
    render(chipsEl, html`<button type="button" class="chip" title="Show all times again" aria-label="Remove the time window ${span}">Time window ${span} <span aria-hidden="true">✕</span></button>`);
  }
  chipsEl.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('.chip')) return;
    if (timeline) return timeline.setWindow(null); // reports back through onWindow
    win = null;
    persist();
    updateMap();
  });

  function persist() {
    drawChips();
    if (!own) {
      own = true;
      drawFeatured();
    }
    const p = new URLSearchParams();
    writeSelection(sel, p);
    if (win) {
      p.set('from', String(win.from));
      p.set('to', String(win.to));
    }
    if (![...p.keys()].length) p.set('all', ''); // a plain / is the home page
    replaceQuery(p);
    try {
      localStorage.setItem(STORAGE_KEY, p.toString());
    } catch {
      /* private mode: the URL still has it */
    }
  }

  // ---- map -----------------------------------------------------------------------------------------

  let request = 0; // a slower, older response must not overwrite a newer one
  async function updateMap() {
    const mine = ++request;
    const stale = () => mine !== request;
    status.textContent = 'Loading…';
    try {
      if (win) await presence(win, stale);
      else if (chosen(sel).length) await routes(stale);
      else await overview(stale);
    } catch (err) {
      if (!stale()) showError(status, err);
    }
    if (!stale()) drawLayers(); // the overlays were re-added: museums and events back on top, filtered by the window
    if (!stale()) void drawClusters();
  }

  // zoomed out without single picks: numbered bubbles of nearby places (API 091) instead of every dot — they count
  // every stay, not the selection, so not when entries are chosen; refetched per (rounded) zoom and window
  let clusterRequest = 0;
  async function drawClusters() {
    const mine = ++clusterRequest;
    const zoom = Math.round(map.getZoom());
    if (zoom >= CLUSTER_BELOW || chosen(sel).length) return showClusters(map, null);
    try {
      const fc = await getClusters(zoom, win);
      if (mine === clusterRequest) showClusters(map, fc);
    } catch {
      if (mine === clusterRequest) showClusters(map, null); // the dots stay
    }
  }
  map.on('zoomend', () => void drawClusters());

  /**
   * The artworks among the rows with a placed provenance step ("artwork/slug" → provenance): drawn in its order instead
   * of a route by date, as on their own page — all in one request (API /v1/map/provenances; cached).
   */
  async function provenancesOf(rows: { entity: { type: EntityType; slug: string } }[]) {
    const artworks = [...new Set(rows.filter((r) => r.entity.type === 'artwork').map((r) => r.entity.slug))].sort();
    const all = artworks.length ? await getProvenances(artworks).catch(() => ({} as Awaited<ReturnType<typeof getProvenances>>)) : {};
    // as placedProvenance(): only one with a placed step replaces the route
    return new Map(Object.entries(all).flatMap(([slug, prov]) =>
      prov.features.some((f) => f.properties.layer === 'provenance_stop') ? [[`artwork/${slug}`, prov] as const] : []));
  }
  const PROVENANCE_KEY = 'artworks: their provenance in its order (dashed: handover not documented, dotted: implied)';
  let knownProvenances = new Map<string, ProvenanceMap>();  // the overview's last provenances (artwork/slug → map)

  // Start map without single picks or a time window: every place plus the routes of everything selected, from all
  // dated presence links (one request; /v1/map/presence fails below year -4713, PostgreSQL's oldest date).
  const ALL_TIME = { from: -3000, to: new Date().getFullYear() + 1 };
  async function overview(stale: () => boolean) {
    const types = (['artist', 'person', 'artwork'] as const).filter((t) => sel[t].mode !== 'none');
    const [places, all] = await Promise.all([
      getPlacesMap(),
      types.length ? getPresence(ALL_TIME.from, ALL_TIME.to, [...types]) : Promise.resolve({ type: 'FeatureCollection', features: [] } as PresenceMap),
    ]);
    if (stale()) return;
    const rows = all.features.filter((f) => includes(sel, f.properties.entity.type, f.properties.entity.slug, artistsOf))
      .map((f) => ({ ...f.properties, point: f.geometry.coordinates }));
    const where = new Map(places.features.map((f) => [f.properties.slug, f.geometry.coordinates] as const));
    // drawn at once with routes by date; the artworks' provenances (one request for all, the slowest part) replace
    // their routes when they come — the map is usable meanwhile
    const draw = (provenances: Map<string, ProvenanceMap>) => {
      useRoutes(showPlaces(map, places, rows, (slug) => where.get(slug), provenances));
      redrawLegend = () => render(legend, html`${routeLegend()}
        <span class="legend-key"><i class="dot" style="background:${COLORS.place}"></i> someone or something of the selection was there ·
          <i class="dot" style="background:${COLORS.association}"></i> associations only ·
          <i class="ring" style="border-color:${COLORS.place}"></i> country or region · lines = routes in date order${provenances.size ? `; ${PROVENANCE_KEY}` : ''}</span>`);
      redrawLegend();
    };
    // the provenances already in (an earlier run, or the cache) at once — a redraw must never put the routes by date back
    draw(knownProvenances);
    useVenues(rows.map((r) => r.institution));
    crossings(rows, (slug) => where.get(slug));
    pinned = null;
    const entries = new Set(rows.map((r) => `${r.entity.type}/${r.entity.slug}`)).size;
    status.textContent = rows.length
      ? `${entries} ${entries === 1 ? 'entry' : 'entries'} at ${new Set(rows.map((r) => r.place.slug)).size} places. Click a place to see what happened there; hover or click a route to follow it.`
      : 'Nothing in the selection has dated places yet.';
    const provenances = await provenancesOf(rows);
    if (!provenances.size) return;
    knownProvenances = provenances;
    if (stale()) return;
    draw(provenances);
  }

  async function routes(stale: () => boolean) {
    useRoutes([]);
    const picks = chosen(sel);
    const shown = picks.slice(0, MAX_ROUTES);
    const maps = await Promise.all(shown.map((c) =>
      getEntityMap(PLURAL[c.type] as Exclude<Plural, 'places'>, c.slug).catch(() => null)));
    if (stale()) return;
    const items: ColoredEntityMap[] = maps.flatMap((fc, i) =>
      fc ? [{ fc, color: colorOf.get(shown[i].type, shown[i].slug) ?? PALETTE[0], gone: gone(shown[i].type, shown[i].slug) }] : []);
    showSelection(map, items);
    const at = new Map<string, [number, number]>();
    const stays: Stay[] = items.flatMap((i) => i.fc.features.flatMap((f) => {
      if (f.geometry.type !== 'Point' || f.properties.layer !== 'presence') return [];
      const p = f.properties as StopProps;
      at.set(p.place.slug, f.geometry.coordinates as [number, number]);
      return [{ entity: i.fc.entity, place: p.place, label: p.label, period: p.period, note: p.note, institution: p.institution, artwork: p.artwork, point: f.geometry.coordinates as [number, number] }];
    }));
    useVenues(items.flatMap((i) => i.fc.features.map((f) => (f.properties as StopProps).institution)));
    crossings(stays, (slug) => at.get(slug));
    const withPlaces = items.filter((i) => i.fc.features.some((f) => f.geometry.type === 'Point') || placedProvenance(i.fc));
    // artworks with a placed provenance step look as on their own page: numbered holders in the chain's order
    const held = items.flatMap((i) => { const prov = placedProvenance(i.fc); return prov ? [{ i, prov }] : []; });
    render(legend, html`${items.map((i) => html`<span><i class="dot" style="background:${i.color}"></i>
        <a href="${href(i.fc.entity.type, i.fc.entity.slug)}">${i.fc.entity.name}</a></span>`)}
      <span class="legend-key">filled dot + line = was there, in date order · ring = association, not travel</span>
      ${held.length ? html`<span class="legend-key">numbers = an artwork's holders, in the provenance's order (not by date) ·
        line solid: handover documented, dashed: not documented, dotted: implied · hollow: probably</span>` : ''}
      ${held.filter(({ prov }) => prov.unplaced.length).map(({ i, prov }) => html`<div class="legend-note unplaced">
        <i class="dot" style="background:${i.color}"></i> ${i.fc.entity.name} — not on the map (place not recorded): ${unplacedSteps(prov)}</div>`)}`);
    const missing = items.length - withPlaces.length;
    status.textContent = [
      `${withPlaces.length} of ${picks.length} chosen entries on the map.`,
      missing > 0 ? `${missing} without places yet.` : '',
      picks.length > MAX_ROUTES ? `Only the first ${MAX_ROUTES} are drawn; pick a time window to see all.` : '',
    ].filter(Boolean).join(' ');
  }

  async function presence(w: NonNullable<Window>, stale: () => boolean) {
    const types = (['artist', 'person', 'artwork'] as const).filter((t) => sel[t].mode !== 'none');
    const span = w.from === w.to ? `${w.from}` : `${w.from}–${w.to}`;
    pinned = null;
    let provenances = new Map<string, ProvenanceMap>();
    redrawLegend = () => render(legend, html`${routeLegend()}
      <span class="legend-key"><i class="dot" style="background:${COLORS.presence}"></i> physically there in ${span} · lines = routes through the stops in ${span}, in date order${provenances.size
        ? `; ${PROVENANCE_KEY}, its steps dated in ${span}` : ''}</span>`);
    if (!types.length) {
      useRoutes(showPresence(map, { type: 'FeatureCollection', features: [] }));
      useVenues([]);
      redrawLegend();
      status.textContent = 'Artists, people and artworks are all hidden, so there is nothing to place on the map.';
      return;
    }
    const fc = await getPresence(w.from, w.to, [...types]);
    if (stale()) return;
    // the API filters by type; single picks are filtered here (backend wish: an `entities=` parameter)
    const features = fc.features.filter((f) => includes(sel, f.properties.entity.type, f.properties.entity.slug, artistsOf));
    // an artwork that was somewhere in the window: its provenance's steps dated in the window, in the chain's order
    const all = await provenancesOf(features.map((f) => f.properties));
    if (stale()) return;
    provenances = new Map([...all].map(([key, prov]) => [key, provenanceInWindow(prov, w)]));
    useRoutes(showPresence(map, { ...fc, features }, provenances));
    redrawLegend();
    const at = new Map(features.map((f) => [f.properties.place.slug, f.geometry.coordinates] as const));
    useVenues(features.map((f) => f.properties.institution));
    crossings(features.map((f) => ({ ...f.properties, point: f.geometry.coordinates })), (slug) => at.get(slug));
    const who = new Set(features.map((f) => `${f.properties.entity.type}/${f.properties.entity.slug}`));
    const where = new Set(features.map((f) => f.properties.place.slug));
    status.textContent = features.length
      ? `${who.size} ${who.size === 1 ? 'entry' : 'people and works'} at ${where.size} ${where.size === 1 ? 'place' : 'places'} in ${span}. Click a circle for details.`
      : `Nothing in the selection is dated in ${span}.`;
  }

  // ---- timeline + pickers (need the entry lists) ---------------------------------------------------

  // an artwork's artists (main creator and co-creators), for "works by the chosen artists" (known once the lists are loaded)
  const artists = new Map<string, string[]>();
  const artistsOf = (artwork: string) => artists.get(artwork);

  let timeline: ReturnType<typeof renderTimeline> | undefined;
  let lists: Awaited<ReturnType<typeof loadLists>> | undefined;
  // an artwork destroyed or lost (not partly destroyed): its map's end is the last known place, not "today"
  const fates = new Map<string, string>();
  const gone = (type: EntityType, slug: string) => type === 'artwork' && !!fates.get(slug) && fates.get(slug) !== 'partly_destroyed';

  function loadLists() {
    return Promise.all([
      listAll('artists'), listAll('artworks'), listAll('movements'), listAll('polities'), listAll('people'),
      listAll('institutions'), listAll('events'),
    ]).then(([artists, artworks, movements, polities, people, institutions, events]) => ({
      artists: artists.data, artworks: artworks.data, movements: movements.data, polities: polities.data, people: people.data,
      institutions: institutions.data, events: events.data,
    }));
  }

  /** The chosen entries' rows on the timeline (and their span, for the events' "auto"). */
  function entityRows(): TimelineRow[] {
    if (!lists) return [];
    const keep = <T extends { slug: string }>(type: EntityType, items: T[]) => items.filter((i) => includes(sel, type, i.slug, artistsOf));
    // artworks: from their making until today (destroyed or lost: until the last known; we have only the making) —
    // the provenance runs on long after the artists' deaths. Rows only for works picked (all 100+ would bury the rest).
    const artworkRows = sel.artwork.mode === 'all' ? [] : keep('artwork', lists.artworks).filter((a) => a.created)
      .map((a) => ({ group: 'Artworks', label: a.title, href: href('artwork', a.slug), key: `artwork/${a.slug}`, from: a.created, to: gone('artwork', a.slug) ? a.created : TODAY, color: colorOf.get('artwork', a.slug) }));
    return [
      ...keep('polity', lists.polities).map((p) => ({ group: 'Polities', label: p.name, href: href('polity', p.slug), key: `polity/${p.slug}`, from: p.period, to: p.period, color: colorOf.get('polity', p.slug) })),
      ...keep('movement', lists.movements).map((m) => ({ group: 'Movements', label: m.name, href: href('movement', m.slug), key: `movement/${m.slug}`, from: m.period, to: m.period, color: colorOf.get('movement', m.slug) })),
      ...keep('artist', lists.artists).map((a) => ({ group: 'Artists', label: a.name, href: href('artist', a.slug), key: `artist/${a.slug}`, from: a.birth, to: a.death, color: colorOf.get('artist', a.slug) })),
      ...keep('person', lists.people).map((p) => ({ group: 'People', label: p.name, href: href('person', p.slug), key: `person/${p.slug}`, from: p.birth ?? p.active, to: p.birth || p.death ? p.death : p.active, color: colorOf.get('person', p.slug) })),
      ...artworkRows,
    ];
  }

  /** Built once; when the picks or the events layer change only its rows are replaced (zoom and typed years stay). */
  function drawTimeline() {
    if (!lists) return;
    // events as the picker has them, in the chosen entries' span — not the window: the timeline is where it is picked
    const span = selectionSpan();
    const rows: TimelineRow[] = [
      ...entityRows(),
      ...(events ? events.features.filter((f) => f.properties.period && layerIncludes(sel, 'event', f.properties.slug, () => !span || overlaps(f.properties.period, span)))
        .map((f) => ({ group: 'Events', label: f.properties.name, href: href('event', f.properties.slug), from: f.properties.period, to: f.properties.period })) : []),
    ];
    if (timeline) return timeline.setRows(rows);
    timeline = renderTimeline(timelineEl, rows, {
      initialWindow: win,
      colorFor: (r) => (r.key ? routeColors.get(r.key) : undefined),
      onWindow: (w) => {
        win = w;
        persist();
        updateMap();
      },
    });
  }

  let pickers: ReturnType<typeof mountPickers> | undefined;
  loadLists()
    .then((l) => {
      if (!main.contains(timelineEl)) return;
      lists = l;
      l.artworks.forEach((a) => {
        artists.set(a.slug, creatorsOf(a).map((c) => c.slug));
        if (a.fate) fates.set(a.slug, a.fate);
      });
      const redraw = !win && chosen(sel).some((c) => gone(c.type, c.slug)); // drawn before the fates were known
      artistsReady();
      if (redraw && sel.artwork.mode !== 'by-artists') updateMap();
      const groups: PickerGroup[] = [
        { group: 'artist', plural: 'artists', label: 'Artists', entries: entries('artists', l.artists) },
        { group: 'artwork', plural: 'artworks', label: 'Artworks', entries: entries('artworks', l.artworks) },
        { group: 'movement', plural: 'movements', label: 'Movements', entries: entries('movements', l.movements) },
        { group: 'polity', plural: 'polities', label: 'Polities', entries: entries('polities', l.polities) },
        { group: 'person', plural: 'people', label: 'People', entries: entries('people', l.people) },
        // only museums with a place of their own on the map (the sites layer); events with a position
        { group: 'institution', plural: 'institutions', label: 'Museums', autoLabel: 'the museums linked to what the map shows — holding or having held the works, or where the people stayed — and in a time window only those that existed then',
          entries: entries('institutions', l.institutions.filter((i) => !sites || sites.features.some((f) => f.properties.type === 'institution' && f.properties.slug === i.slug))) },
        { group: 'event', plural: 'events', label: 'Events', autoLabel: 'the events in the time window — without one, in the years of what is chosen (the artists’ lives, the works until today)',
          entries: entries('events', l.events.filter((e) => !events || events.features.some((f) => f.properties.slug === e.slug))) },
      ];
      pickers = mountPickers(pickersEl, groups, sel, (next) => {
        const entitiesChanged = GROUPS.some((g) => JSON.stringify(next[g]) !== JSON.stringify(sel[g]));
        sel = next;
        persist();
        drawTimeline();
        if (!entitiesChanged) return drawLayers(); // only museums or events: the map's routes stay
        colorOf.reset();
        updateMap();
      }, (layer, slug) => (layer === 'institution' || layer === 'event') && autoNow[layer].has(slug));
      drawTimeline();
      drawLayers(); // the lists know the works' holders and the selection's span
    })
    .catch((err) => {
      showError(pickersEl, err);
      showError(timelineEl, err);
      artistsReady(); // crossed paths without the artists rather than none
    });

  /** The artworks' artists are known: "works by the chosen artists" can be drawn, crossed paths listed. */
  function artistsReady() {
    artistsKnown = true;
    if (sel.artwork.mode === 'by-artists') return updateMap(); // the map itself waited for them
    if (pendingCrossings) crossings(...pendingCrossings);
    pendingCrossings = null;
  }

  drawChips();
  // drawn at once, without waiting for the entry lists — unless the selection itself needs them
  if (sel.artwork.mode !== 'by-artists') updateMap();
  else status.textContent = 'Loading…';

  return () => {
    pickers?.destroy();
    timeline?.destroy();
    map.remove();
  };
}
