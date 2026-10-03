// MapLibre setup and the three kinds of map content: one entity's places, all places, presence in a time window.
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a separate module; let Vite bundle it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { html, href, type Html } from './html';
import type { EntityMap, PlacesMap, PresenceMap, StopFeature } from './types';

setWorkerUrl(workerUrl);

const KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
// MapTiler "dataviz" is a muted base map made for overlays. Without a key: OpenFreeMap (free, no key).
const STYLE = KEY
  ? `https://api.maptiler.com/maps/dataviz/style.json?key=${encodeURIComponent(KEY)}`
  : 'https://tiles.openfreemap.org/styles/positron';

export const COLORS = {
  presence: '#b4462b',
  route: '#b4462b',
  association: '#5b4fbf',
  place: '#2f6f73',
  empty: '#9aa3a8',
};

export function createMap(container: HTMLElement): MapLibre {
  const map = new MapLibre({
    container,
    style: STYLE,
    center: [60, 45], // between Europe and East Asia, the project's scope
    zoom: 1.6,
    attributionControl: { compact: true },
    cooperativeGestures: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
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
function popupOnClick(map: MapLibre, layers: string[], content: (features: MapLayerMouseEvent['features']) => Html) {
  for (const layer of layers) {
    map.on('click', layer, (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers });
      new Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(content(features).value).addTo(map);
    });
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

// MapLibre flattens nested properties to JSON strings.
const prop = <T>(v: unknown): T => (typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : v) as T;

// ---- one entity: presence stops, route, associations -------------------------------------------

/**
 * Presence stops are filled dots joined by the route. Associations (e.g. influenced by the culture
 * of Japan) are hollow rings in another colour and never part of the route: no travel is implied.
 */
export function showEntity(map: MapLibre, fc: EntityMap) {
  const stops = fc.features.filter((f): f is StopFeature => f.geometry.type === 'Point');
  const route = fc.features.filter((f) => f.properties.layer === 'route');
  whenReady(map, () => {
    setData(map, 'entity-route', { type: 'FeatureCollection', features: route as GeoJSON.Feature[] });
    setData(map, 'entity-stops', { type: 'FeatureCollection', features: stops as unknown as GeoJSON.Feature[] });
    map.addLayer({
      id: 'entity-route', type: 'line', source: 'entity-route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': COLORS.route, 'line-width': 2.5, 'line-opacity': 0.75 },
    });
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
        ${p.label}${period ? html` · ${period.label}` : ''}
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

// ---- every place ---------------------------------------------------------------------------------

const PLACE_LAYERS = ['places-circles'];
const PRESENCE_LAYERS = ['presence-circles', 'presence-counts'];

export function showPlaces(map: MapLibre, fc: PlacesMap) {
  whenReady(map, () => {
    removeLayers(map, [...PRESENCE_LAYERS, ...PLACE_LAYERS]);
    setData(map, 'places', fc as unknown as GeoJSON.FeatureCollection);
    const total: ExpressionSpecification = ['+', ['get', 'presence_count'], ['get', 'association_count']];
    map.addLayer({
      id: 'places-circles', type: 'circle', source: 'places',
      paint: {
        'circle-radius': ['interpolate', ['linear'], total, 0, 4, 10, 14],
        'circle-color': ['case', ['>', ['get', 'presence_count'], 0], COLORS.place, ['>', ['get', 'association_count'], 0], COLORS.association, COLORS.empty],
        'circle-opacity': 0.8,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    });
    once(map, 'places', () => bindPlacesPopups(map));
  });
}

function bindPlacesPopups(map: MapLibre) {
  popupOnClick(map, PLACE_LAYERS, (features) => html`${(features ?? []).slice(0, 1).map((f) => {
    const p = f.properties;
    return html`<div class="popup-row"><strong><a href="${href('place', p.slug)}">${p.name}</a></strong><br>
      ${p.presence_count} presence · ${p.association_count} association</div>`;
  })}`);
}

// ---- presence in a time window ----------------------------------------------------------------

/** Groups presence features by place: one circle per place, sized by how many people/works were there. */
export function showPresence(map: MapLibre, fc: PresenceMap) {
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
    removeLayers(map, [...PRESENCE_LAYERS, ...PLACE_LAYERS]);
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
  });
}

function bindPresencePopups(map: MapLibre) {
  popupOnClick(map, ['presence-circles'], (features) => html`${(features ?? []).slice(0, 1).map((f) => {
    const rows = JSON.parse(f.properties.rows as string) as PresenceMap['features'][number]['properties'][];
    return html`<div class="popup-row"><strong><a href="${href('place', f.properties.slug)}">${f.properties.name}</a></strong>
      <ul class="popup-list">${rows.map((r) => html`<li>
        <a href="${href(r.entity.type, r.entity.slug)}">${r.entity.name}</a> ${r.label}${r.period ? html` · ${r.period.label}` : ''}
      </li>`)}</ul></div>`;
  })}`);
}
