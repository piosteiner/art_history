// MapLibre setup and the three kinds of map content: one entity's places, all places, presence in a time window.
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a separate module; let Vite bundle it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { html, href, type Html } from './html';
import { encounterLine } from './crossings';
import { encounterKeys, type Encounter } from './encounters';
import { isDark } from './theme';
import type { EntityMap, EntityType, PlacesMap, PresenceMap, StopFeature } from './types';

setWorkerUrl(workerUrl);

// trimmed: a space or line break pasted along with the key makes MapTiler refuse it (403)
const KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined)?.trim() || undefined;
// MapTiler "dataviz" is a muted base map made for overlays. Without a key: OpenFreeMap (free, no key).
const style = () => {
  const dark = isDark();
  return KEY
    ? `https://api.maptiler.com/maps/${dark ? 'dataviz-dark' : 'dataviz'}/style.json?key=${encodeURIComponent(KEY)}`
    : `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
};

export const COLORS = {
  encounter: '#e0a800', // places where paths crossed
  presence: '#b4462b',
  route: '#b4462b',
  association: '#5b4fbf',
  place: '#2f6f73',
  empty: '#9aa3a8',
};

export function createMap(container: HTMLElement): MapLibre {
  const map = new MapLibre({
    container,
    style: style(),
    center: [60, 45], // between Europe and East Asia, the project's scope
    zoom: 1.6,
    attributionControl: { compact: true },
    cooperativeGestures: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  // development only: lets browser tests find places on screen (map.project); not in the production build
  if (import.meta.env.DEV) ((window as unknown as { __maps?: MapLibre[] }).__maps ??= []).push(map);
  return map;
}

/** Runs `fn` once the style is ready (immediately if it already is). */
export function whenReady(map: MapLibre, fn: () => void) {
  if (map.isStyleLoaded()) fn();
  else map.once('load', fn);
}

function fit(map: MapLibre, coords: [number, number][], maxZoom = 6) {
  if (!coords.length) return;
  const b = new LngLatBounds(coords[0], coords[0]);
  coords.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding: 50, maxZoom, duration: 0 });
}

function setData(map: MapLibre, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

function removeLayers(map: MapLibre, ids: string[]) {
  ids.forEach((id) => map.getLayer(id) && map.removeLayer(id));
}

/** Click popups listing every feature under the pointer (several links can share one place). */
function popupOnClick(map: MapLibre, layers: string[], content: (features: MapLayerMouseEvent['features']) => Html, unless: string[] = []) {
  // one handler for the whole group: a click on overlapping layers opens one popup, not one per layer
  map.on('click', (e) => {
    const present = layers.filter((l) => map.getLayer(l));
    if (!present.length) return;
    const features = map.queryRenderedFeatures(e.point, { layers: present });
    if (!features.length) return;
    const blockers = unless.filter((l) => map.getLayer(l));
    if (blockers.length && map.queryRenderedFeatures(e.point, { layers: blockers }).length) return; // that group's popup opens instead
    new Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(content(features).value).addTo(map);
  });
  for (const layer of layers) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }
}

// Layers are re-added when the data changes; their event handlers are bound only once per map.
const bound = new WeakMap<MapLibre, Set<string>>();
function once(map: MapLibre, key: string, fn: () => void) {
  const keys = bound.get(map) ?? new Set();
  bound.set(map, keys);
  if (!keys.has(key)) {
    keys.add(key);
    fn();
  }
}

/** A chevron drawn on a canvas (no sprite or font needed); SDF so each route can tint it in its own colour. */
function ensureArrow(map: MapLibre) {
  if (map.hasImage('route-arrow')) return;
  const size = 24;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#000';
  g.lineWidth = 3.5;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(8, 5);
  g.lineTo(16, 12);
  g.lineTo(8, 19);
  g.stroke();
  map.addImage('route-arrow', { width: size, height: size, data: new Uint8Array(g.getImageData(0, 0, size, size).data.buffer) }, { sdf: true });
}

/** Arrows along a route layer's lines, pointing in travel (date) order. */
function addArrows(map: MapLibre, id: string, source: string, color: ExpressionSpecification | string) {
  ensureArrow(map);
  map.addLayer({
    id, type: 'symbol', source,
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 140, 'icon-image': 'route-arrow', 'icon-size': 0.95,
      'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    },
    paint: { 'icon-color': color, 'icon-opacity': 0.9 },
  });
}

/** Numbers the dated presence stops in date order (the route's order) as `stop` / `stops` properties. */
function numberStops<T extends { properties: { layer: string; period: { from_year: number | null; from: string | null } | null } }>(stops: T[]) {
  const dated = stops
    .filter((f) => f.properties.layer === 'presence' && f.properties.period?.from_year != null)
    .sort((a, b) => a.properties.period!.from_year! - b.properties.period!.from_year! || (a.properties.period!.from ?? '').localeCompare(b.properties.period!.from ?? ''));
  return stops.map((f) => {
    const i = dated.indexOf(f);
    return i < 0 ? f : { ...f, properties: { ...f.properties, stop: i + 1, stops: dated.length } };
  });
}
const stopLabel = (p: Record<string, unknown>) => (p.stop ? html`<span class="tag">stop ${p.stop as number} of ${p.stops as number}</span> ` : '');

// MapLibre flattens nested properties to JSON strings.
const prop = <T>(v: unknown): T => (typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : v) as T;

// ---- one entity: presence stops, route, associations -------------------------------------------

/**
 * Presence stops are filled dots joined by the route. Associations (e.g. influenced by the culture
 * of Japan) are hollow rings in another colour and never part of the route: no travel is implied.
 */
export function showEntity(map: MapLibre, fc: EntityMap) {
  const stops = numberStops(fc.features.filter((f): f is StopFeature => f.geometry.type === 'Point'));
  const route = fc.features.filter((f) => f.properties.layer === 'route');
  whenReady(map, () => {
    setData(map, 'entity-route', { type: 'FeatureCollection', features: route as GeoJSON.Feature[] });
    setData(map, 'entity-stops', { type: 'FeatureCollection', features: stops as unknown as GeoJSON.Feature[] });
    map.addLayer({
      id: 'entity-route', type: 'line', source: 'entity-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': COLORS.route, 'line-width': 2.5, 'line-opacity': 0.75 },
    });
    addArrows(map, 'entity-arrows', 'entity-route', COLORS.route);
    map.addLayer({
      id: 'entity-association', type: 'circle', source: 'entity-stops',
      filter: ['==', ['get', 'layer'], 'association'],
      paint: {
        'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': COLORS.association, 'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'entity-presence', type: 'circle', source: 'entity-stops',
      filter: ['==', ['get', 'layer'], 'presence'],
      paint: {
        'circle-radius': 6, 'circle-color': COLORS.presence,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      },
    });
    popupOnClick(map, ['entity-presence', 'entity-association'], (features) => html`${(features ?? []).map((f) => {
      const p = f.properties;
      const place = prop<{ slug: string; name: string }>(p.place);
      const period = prop<{ label: string } | null>(p.period);
      return html`<div class="popup-row">
        <strong><a href="${href('place', place.slug)}">${place.name}</a></strong><br>
        ${stopLabel(p)}${p.label}${period ? html` · ${period.label}` : ''}
        ${p.note ? html`<br><em>${p.note}</em>` : ''}
        ${p.layer === 'association' ? html`<br><span class="tag tag-association">association, not travel</span>` : ''}
      </div>`;
    })}`);
    fitStops(false);
  });

  // Start on the places the entity was physically at; far-away associations (Van Gogh → Japan) would
  // otherwise zoom the route down to a few pixels. The legend offers zooming out to include them.
  function fitStops(includeAssociations: boolean) {
    const presence = stops.filter((f) => f.properties.layer === 'presence');
    const shown = includeAssociations || !presence.length ? stops : presence;
    fit(map, shown.map((f) => f.geometry.coordinates));
  }
  return { fitAll: () => fitStops(true), fitPresence: () => fitStops(false) };
}

/** A single place (its own detail page). */
export function showPoint(map: MapLibre, coords: [number, number], name: string) {
  whenReady(map, () => {
    setData(map, 'point', {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { name } }],
    });
    map.addLayer({
      id: 'point', type: 'circle', source: 'point',
      paint: { 'circle-radius': 7, 'circle-color': COLORS.place, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    });
    map.jumpTo({ center: coords, zoom: 5 });
  });
}

// ---- every place, with the selection's routes ----------------------------------------------------

// The explore map shows one of three overlays at a time; switching removes the others' layers.
const PLACE_LAYERS = ['places-areas', 'places-circles'];
const OVERVIEW_LAYERS = ['ov-routes', 'ov-arrows', 'ov-route-hover'];
const SELECTION_LAYERS = ['sel-route', 'sel-arrows', 'sel-association', 'sel-presence'];
const OVERLAY_LAYERS = ['enc-halo', ...OVERVIEW_LAYERS, ...PLACE_LAYERS, 'presence-circles', ...SELECTION_LAYERS];
const clearOverlays = (map: MapLibre) => removeLayers(map, OVERLAY_LAYERS);

/** Route colours on the start map: one per kind of entry (with hundreds of entries, one per entry wouldn't tell apart). */
export const TYPE_COLORS: Partial<Record<EntityType, string>> = { artist: '#b4462b', person: '#8a4f9e', artwork: '#c08a1e' };

type PresenceRow = PresenceMap['features'][number]['properties'];
const rowKey = (r: PresenceRow) => `${r.entity.type}/${r.entity.slug}`;
const byDate = (a: PresenceRow, b: PresenceRow) =>
  (a.period?.from_year ?? 1e9) - (b.period?.from_year ?? 1e9) || (a.period?.from ?? '').localeCompare(b.period?.from ?? '');

/** What happened at a place, in date order: "Vincent van Gogh · lived in · 1888–1889 · the Yellow House". */
/** The colour of each displayed route ("artist/vincent-van-gogh" → colour), for popup dots. */
const routeColorsOf = new WeakMap<MapLibre, Map<string, string>>();

function placeRows(rows: PresenceRow[], colors?: Map<string, string>) {
  return html`<ul class="popup-list popup-events">${[...rows].sort(byDate).map((r) => html`<li>
    <i class="dot" style="background:${colors?.get(rowKey(r)) ?? TYPE_COLORS[r.entity.type] ?? COLORS.presence}"></i>
    <a href="${href(r.entity.type, r.entity.slug)}">${r.entity.name}</a>
    <span class="muted">${r.label}${r.period ? ` · ${r.period.label}` : ''}</span>
    ${r.note ? html`<div class="popup-note">${r.note}</div>` : ''}
  </li>`)}</ul>`;
}

/**
 * Every place, sized by what the current selection did there, plus one route per selected entry through its dated
 * presence stops (the same stops as its own map, from /v1/map/presence). Click a place: what happened there.
 * Hover a route: it is highlighted and named; click it: its stops in date order.
 */
export function showPlaces(map: MapLibre, places: PlacesMap, presence: PresenceRow[], coords: (slug: string) => [number, number] | undefined): RouteInfo[] {
  const atPlace = new Map<string, PresenceRow[]>();
  for (const r of presence) atPlace.set(r.place.slug, [...(atPlace.get(r.place.slug) ?? []), r]);
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: places.features.map((f) => {
      const rows = atPlace.get(f.properties.slug) ?? [];
      return { ...f, properties: { ...f.properties, count: rows.length, rows: JSON.stringify(rows) } } as unknown as GeoJSON.Feature;
    }),
  };
  const routes = buildRoutes(presence, coords);
  const info = routeInfo(map, routes);

  whenReady(map, () => {
    clearOverlays(map);
    setData(map, 'places', fc);
    addRouteLayers(map, routes);
    const count: ExpressionSpecification = ['get', 'count'];
    const color: ExpressionSpecification = ['case', ['>', count, 0], COLORS.place, ['>', ['get', 'association_count'], 0], COLORS.association, COLORS.empty];
    const isArea: ExpressionSpecification = ['in', ['get', 'kind'], ['literal', ['country', 'region', 'empire', 'continent']]];
    // countries and regions are rings underneath, so a city inside them (Edo in Japan) stays visible and clickable
    map.addLayer({
      id: 'places-areas', type: 'circle', source: 'places', filter: isArea,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['+', count, ['get', 'association_count']], 0, 11, 10, 24], 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': color, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': 0.85,
      },
    });
    map.addLayer({
      id: 'places-circles', type: 'circle', source: 'places', filter: ['!', isArea],
      // smaller circles drawn last (on top), so a big one never hides a small neighbour
      layout: { 'circle-sort-key': ['-', 0, count] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], count, 0, 4, 10, 14], 'circle-color': color, 'circle-opacity': 0.9,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    });
    once(map, 'places', () => bindOverview(map));
    once(map, 'routes', () => bindRoutes(map));
  });
  return info;
}

function bindOverview(map: MapLibre) {
  popupOnClick(map, PLACE_LAYERS, (features) => {
    const seen = new Set<string>();
    const rows = (features ?? [])
      .filter((f) => !seen.has(f.properties.slug) && seen.add(f.properties.slug))
      .sort((a, b) => Number(a.layer.id === 'places-areas') - Number(b.layer.id === 'places-areas'));
    return html`${rows.map((f) => {
      const p = f.properties;
      const events = prop<PresenceRow[]>(p.rows);
      const assoc = Number(p.association_count);
      return html`<div class="popup-row"><strong><a href="${href('place', p.slug)}">${p.name}</a></strong>${p.kind ? html` <span class="muted">${p.kind}</span>` : ''}
        ${events.length ? placeRows(events, routeColorsOf.get(map)) : html`<div class="muted">Nobody and nothing in the current selection was here (with a date).</div>`}
        ${encountersHere(map, p.slug)}
        ${assoc ? html`<div class="popup-note"><a href="${href('place', p.slug)}">${assoc} ${assoc === 1 ? 'association' : 'associations'}</a> (influence, depictions …), not travel</div>` : ''}</div>`;
    })}`;
  });
}

// ---- routes (start map and time window) ----------------------------------------------------------

/** Layers whose features win over a route passing underneath (their popup opens, the route stays quiet). */
const ROUTE_BLOCKERS = [...PLACE_LAYERS, 'presence-circles'];

/** A displayed route, for the legend and the timeline colours. */
export interface RouteInfo { key: string; name: string; type: EntityType; slug: string; color: string }

const TYPE_ORDER: Partial<Record<EntityType, number>> = { artist: 0, person: 1, artwork: 2 };

/**
 * One line per entry through its dated stops in date order (repeated stays at the same place merged). Each route gets
 * its own colour, in a stable order (artists, people, artworks; by name), so the same selection always looks the same.
 */
function buildRoutes(presence: PresenceRow[], coords: (slug: string) => [number, number] | undefined): GeoJSON.Feature[] {
  const perEntity = new Map<string, PresenceRow[]>();
  for (const r of presence) perEntity.set(rowKey(r), [...(perEntity.get(rowKey(r)) ?? []), r]);
  const routes: GeoJSON.Feature[] = [];
  const ordered = [...perEntity].sort(([, a], [, b]) =>
    (TYPE_ORDER[a[0].entity.type] ?? 9) - (TYPE_ORDER[b[0].entity.type] ?? 9) || a[0].entity.name.localeCompare(b[0].entity.name));
  for (const [key, rows] of ordered) {
    const stops = rows.filter((r) => r.period?.from_year != null).sort(byDate)
      .filter((r, i, all) => i === 0 || r.place.slug !== all[i - 1].place.slug);
    const line = stops.map((r) => coords(r.place.slug)).filter((c): c is [number, number] => !!c);
    if (line.length < 2) continue;
    const e = rows[0].entity;
    routes.push({
      type: 'Feature', geometry: { type: 'LineString', coordinates: line },
      properties: {
        key, name: e.name, type: e.type, slug: e.slug, color: PALETTE[routes.length % PALETTE.length],
        stops: JSON.stringify(stops.map((st) => ({ place: st.place.name, slug: st.place.slug, label: st.label, period: st.period?.label ?? '' }))),
      },
    });
  }
  return routes;
}

function routeInfo(map: MapLibre, routes: GeoJSON.Feature[]): RouteInfo[] {
  const info = routes.map((r) => r.properties as RouteInfo);
  routeColorsOf.set(map, new Map(info.map((i) => [i.key, i.color])));
  return info;
}

/** Highlights one route (or several, or none) — for the legend under the map. */
export function highlightRoute(map: MapLibre, keys: string[]) {
  if (map.getLayer('ov-route-hover')) map.setFilter('ov-route-hover', ['in', ['get', 'key'], ['literal', keys]]);
}

/** Route lines with arrows and a highlight layer; call after clearOverlays, before the place circles. */
function addRouteLayers(map: MapLibre, routes: GeoJSON.Feature[]) {
  setData(map, 'ov-routes', { type: 'FeatureCollection', features: routes });
  map.addLayer({
    id: 'ov-routes', type: 'line', source: 'ov-routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2.6, 'line-opacity': 0.8 }, // own colour per route: strong enough to follow
  });
  addArrows(map, 'ov-arrows', 'ov-routes', ['get', 'color']);
  map.addLayer({
    id: 'ov-route-hover', type: 'line', source: 'ov-routes', filter: ['==', ['get', 'key'], ''],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4.5, 'line-opacity': 0.95 },
  });
}

/** Hover a route: highlighted and named; click it: its stops in date order (unless a place is under the pointer). */
function bindRoutes(map: MapLibre) {
  popupOnClick(map, ['ov-routes'], (features) => {
    const seenRoutes = new Set<string>();
    return html`${(features ?? []).filter((f) => !seenRoutes.has(f.properties.key) && seenRoutes.add(f.properties.key)).slice(0, 4).map((f) => {
      const p = f.properties;
      const stops = prop<{ place: string; slug: string; label: string; period: string }[]>(p.stops);
      return html`<div class="popup-row"><strong><a href="${href(p.type, p.slug)}">${p.name}</a></strong> <span class="muted">${stops.length} stops</span>
        <ol class="popup-list">${stops.map((st) => html`<li><a href="${href('place', st.slug)}">${st.place}</a> <span class="muted">${st.label}${st.period ? ` · ${st.period}` : ''}</span></li>`)}</ol></div>`;
    })}`;
  }, ROUTE_BLOCKERS);
  const tip = new Popup({ closeButton: false, closeOnClick: false, className: 'hover-tip', offset: 10 });
  const unhover = () => {
    if (map.getLayer('ov-route-hover')) map.setFilter('ov-route-hover', ['==', ['get', 'key'], '']);
    tip.remove();
  };
  map.on('mousemove', 'ov-routes', (e) => {
    const f = e.features?.[0];
    // over a place the place matters (its popup lists the routes passing through anyway)
    const onPlace = map.queryRenderedFeatures(e.point, { layers: ROUTE_BLOCKERS.filter((l) => map.getLayer(l)) }).length > 0;
    if (!f || onPlace) return unhover();
    map.setFilter('ov-route-hover', ['==', ['get', 'key'], f.properties.key]);
    tip.setLngLat(e.lngLat).setHTML(html`${f.properties.name}`.value).addTo(map);
  });
  map.on('mouseleave', 'ov-routes', unhover);
  map.on('click', () => tip.remove());
}

// ---- presence in a time window ----------------------------------------------------------------

/**
 * Groups presence features by place: one circle per place, sized by how many people/works were there; plus each
 * entry's route through its stops inside the window.
 */
export function showPresence(map: MapLibre, fc: PresenceMap): RouteInfo[] {
  const at = new Map(fc.features.map((x) => [x.properties.place.slug, x.geometry.coordinates] as const));
  const routes = buildRoutes(fc.features.map((x) => x.properties), (slug) => at.get(slug));
  const info = routeInfo(map, routes);
  const byPlace = new Map<string, { coords: [number, number]; name: string; slug: string; rows: PresenceMap['features'] }>();
  for (const f of fc.features) {
    const key = f.properties.place.slug;
    if (!byPlace.has(key)) byPlace.set(key, { coords: f.geometry.coordinates, name: f.properties.place.name, slug: key, rows: [] });
    byPlace.get(key)!.rows.push(f);
  }
  const grouped: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [...byPlace.values()].map((g) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: g.coords },
      properties: {
        slug: g.slug, name: g.name, count: g.rows.length,
        rows: JSON.stringify(g.rows.map((r) => r.properties)),
      },
    })),
  };
  whenReady(map, () => {
    clearOverlays(map);
    addRouteLayers(map, routes);
    setData(map, 'presence', grouped);
    map.addLayer({
      id: 'presence-circles', type: 'circle', source: 'presence',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 8, 18],
        'circle-color': COLORS.presence, 'circle-opacity': 0.85,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      },
    });
    once(map, 'presence', () => bindPresencePopups(map));
    once(map, 'routes', () => bindRoutes(map));
  });
  return info;
}

function bindPresencePopups(map: MapLibre) {
  popupOnClick(map, ['presence-circles'], (features) => html`${(features ?? []).slice(0, 1).map((f) => {
    const rows = JSON.parse(f.properties.rows as string) as PresenceMap['features'][number]['properties'][];
    return html`<div class="popup-row"><strong><a href="${href('place', f.properties.slug)}">${f.properties.name}</a></strong>
      ${placeRows(rows, routeColorsOf.get(map))}${encountersHere(map, f.properties.slug)}</div>`;
  })}`);
}

// ---- crossed paths: places where two entries were at the same time ---------------------------------

const encountersOf = new WeakMap<MapLibre, Encounter[]>();

/** A soft halo under every place where paths crossed; the place popups then list who met there. */
export function showEncounters(map: MapLibre, list: Encounter[], coords: (slug: string) => [number, number] | undefined) {
  encountersOf.set(map, list);
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const e of list) {
    const c = coords(e.place.slug);
    if (!c || seen.has(e.place.slug)) continue;
    seen.add(e.place.slug);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { slug: e.place.slug } });
  }
  whenReady(map, () => {
    setData(map, 'enc', { type: 'FeatureCollection', features });
    if (map.getLayer('enc-halo')) return;
    const below = ['places-areas', 'places-circles', 'presence-circles', 'sel-association', 'sel-presence'].find((l) => map.getLayer(l));
    map.addLayer({
      id: 'enc-halo', type: 'circle', source: 'enc',
      paint: {
        'circle-radius': 21, 'circle-color': COLORS.encounter, 'circle-opacity': 0.2, 'circle-blur': 0.4,
        'circle-stroke-color': COLORS.encounter, 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.75,
      },
    }, below);
  });
}

/** Flies to an encounter and highlights both routes (on the start map). */
export function focusEncounter(map: MapLibre, e: Encounter, coords: (slug: string) => [number, number] | undefined) {
  const c = coords(e.place.slug);
  if (c) map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 6), duration: 900 });
  if (map.getLayer('ov-route-hover')) map.setFilter('ov-route-hover', ['in', ['get', 'key'], ['literal', encounterKeys(e)]]);
}

/** "At the same time here" for a place popup. */
function encountersHere(map: MapLibre, slug: string) {
  const here = (encountersOf.get(map) ?? []).filter((e) => e.place.slug === slug);
  return here.length
    ? html`<div class="popup-encounters"><div class="popup-subhead">At the same time here</div>
        <ul class="popup-list encounters-list">${here.map((e) => encounterLine(e, { withPlace: false }))}</ul></div>`
    : '';
}

// ---- several chosen entities, one colour each -----------------------------------------------------

export interface ColoredEntityMap {
  fc: EntityMap;
  color: string;
}

/**
 * The routes and places of several entities at once, each in its own colour. Same encoding as a single
 * entity: filled dots + line = physically there, in date order; hollow rings = association, not travel.
 */
export function showSelection(map: MapLibre, items: ColoredEntityMap[]) {
  const tag = (item: ColoredEntityMap, f: EntityMap['features'][number]) => ({
    ...f,
    properties: { ...f.properties, color: item.color, entity: item.fc.entity },
  }) as unknown as GeoJSON.Feature;
  const routes = items.flatMap((i) => i.fc.features.filter((f) => f.properties.layer === 'route').map((f) => tag(i, f)));
  const stops = items.flatMap((i) => numberStops(i.fc.features.filter((f): f is StopFeature => f.geometry.type === 'Point')).map((f) => tag(i, f)));
  whenReady(map, () => {
    clearOverlays(map);
    setData(map, 'sel-routes', { type: 'FeatureCollection', features: routes });
    setData(map, 'sel-stops', { type: 'FeatureCollection', features: stops });
    map.addLayer({
      id: 'sel-route', type: 'line', source: 'sel-routes',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.75 },
    });
    addArrows(map, 'sel-arrows', 'sel-routes', ['get', 'color']);
    map.addLayer({
      id: 'sel-association', type: 'circle', source: 'sel-stops',
      filter: ['==', ['get', 'layer'], 'association'],
      paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 },
    });
    map.addLayer({
      id: 'sel-presence', type: 'circle', source: 'sel-stops',
      filter: ['==', ['get', 'layer'], 'presence'],
      paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    });
    once(map, 'selection', () => popupOnClick(map, ['sel-presence', 'sel-association'], (features) => html`${(features ?? []).map((f) => {
      const p = f.properties;
      const entity = prop<{ type: EntityType; slug: string; name: string }>(p.entity);
      const place = prop<{ slug: string; name: string }>(p.place);
      const period = prop<{ label: string } | null>(p.period);
      return html`<div class="popup-row">
        <i class="dot" style="background:${p.color}"></i> <a href="${href(entity.type, entity.slug)}">${entity.name}</a>
        ${stopLabel(p)}${p.label} <a href="${href('place', place.slug)}">${place.name}</a>${period ? html` · ${period.label}` : ''}
        ${p.note ? html`<br><em>${p.note}</em>` : ''}
        ${p.layer === 'association' ? html`<br><span class="tag tag-association">association, not travel</span>` : ''}
      </div>`;
    })}`));
    const presence = stops.filter((f) => f.properties?.layer === 'presence');
    fit(map, (presence.length ? presence : stops).map((f) => (f.geometry as GeoJSON.Point).coordinates as [number, number]));
  });
}

/** Distinguishable colours for chosen entities (map routes and their timeline bars). */
export const PALETTE = [
  '#e15759', '#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#d4a514',
  '#2f9e9a', '#ff7fa0', '#9c755f', '#3b4fa0', '#c2256c', '#7fb800',
];
