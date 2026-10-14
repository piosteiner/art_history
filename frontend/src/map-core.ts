// MapLibre setup and what every map view shares: the base style (light/dark), sources and layers we own, popups,
// route arrows. The views are in map.ts, an artwork's provenance in map-provenance.ts.
import { FullscreenControl, LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a separate module; let Vite bundle it and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Html } from './html';
import { isDark, THEME_EVENT } from './theme';
import type { EventMapProps } from './types';

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


/** `fullscreen`: what the full-screen button enlarges — by default the map's parent, so its legend and layer switches come along. */
export function createMap(container: HTMLElement, fullscreen: HTMLElement | null = container.parentElement): MapLibre {
  const map = new MapLibre({
    container,
    style: style(),
    center: [60, 45], // between Europe and East Asia, the project's scope
    zoom: 1.6,
    attributionControl: { compact: true },
    cooperativeGestures: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  // the Fullscreen API where there is one; elsewhere (iPhone) MapLibre fills the window instead (.maplibregl-pseudo-fullscreen)
  map.addControl(new FullscreenControl(fullscreen ? { container: fullscreen } : {}), 'top-right');
  // development only: lets browser tests find places on screen (map.project); not in the production build
  if (import.meta.env.DEV) ((window as unknown as { __maps?: MapLibre[] }).__maps ??= []).push(map);
  map.on('style.load', () => styled.add(map));
  // a new base style (light/dark) comes without our images: the route arrows are drawn again when asked for
  map.setMissingStyleImageResolver((id) => { if (id === 'route-arrow') ensureArrow(map); });
  live.add(map);
  return map;
}

const styled = new WeakSet<MapLibre>(); // maps whose (current) style has loaded
const live = new Set<MapLibre>(); // maps on the page, for theme switches
const ownSources = new WeakMap<MapLibre, Set<string>>(); // the overlay sources we added (not the base map's)

/** Runs `fn` once the style is ready (immediately if it already is; again-loading after a theme switch counts). */
export function whenReady(map: MapLibre, fn: () => void) {
  if (styled.has(map)) fn();
  else map.once('style.load', fn);
}

/**
 * Light ↔ dark: the base map changes under the overlays. Our sources (with their current data) and layers are carried
 * into the new style, so the page, its popups, highlights and the map's position all stay.
 */
function restyle() {
  for (const map of live) {
    if (!map.getContainer().isConnected) {
      live.delete(map); // removed with its page
      continue;
    }
    const ours = ownSources.get(map) ?? new Set();
    styled.delete(map);
    map.setStyle(style(), {
      diff: false,
      transformStyle: (prev, next) => prev ? {
        ...next,
        sources: { ...next.sources, ...Object.fromEntries(Object.entries(prev.sources).filter(([id]) => ours.has(id))) },
        layers: [...next.layers, ...prev.layers.filter((l) => 'source' in l && ours.has(l.source as string))],
      } : next,
    });
  }
}
window.addEventListener(THEME_EVENT, restyle);

export function fit(map: MapLibre, coords: [number, number][], maxZoom = 6) {
  if (!coords.length) return;
  const b = new LngLatBounds(coords[0], coords[0]);
  coords.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding: 50, maxZoom, duration: 0 });
}

export function setData(map: MapLibre, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else {
    map.addSource(id, { type: 'geojson', data });
    ownSources.set(map, (ownSources.get(map) ?? new Set()).add(id));
  }
}

export function removeLayers(map: MapLibre, ids: string[]) {
  ids.forEach((id) => map.getLayer(id) && map.removeLayer(id));
}

/** Click popups listing every feature under the pointer (several links can share one place). */
export function popupOnClick(map: MapLibre, layers: string[], content: (features: MapLayerMouseEvent['features']) => Html, unless: string[] = []) {
  // one handler for the whole group: a click on overlapping layers opens one popup, not one per layer
  map.on('click', (e) => {
    if ((e.originalEvent.target as Element | null)?.closest('.maplibregl-marker')) return; // a provenance stop: its own popup
    const present = layers.filter((l) => map.getLayer(l));
    if (!present.length) return;
    const features = map.queryRenderedFeatures(e.point, { layers: present });
    if (!features.length) return;
    // events lie on top of everything (a city's event next to the city's own marker): their popup opens instead
    const events = layers.some((l) => EVENT_LAYERS.includes(l)) ? [] : EVENT_LAYERS.filter((l) => map.getLayer(l));
    if (events.length && map.queryRenderedFeatures(e.point, { layers: events }).length) return;
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
export function once(map: MapLibre, key: string, fn: () => void) {
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
export function addArrows(map: MapLibre, id: string, source: string, color: ExpressionSpecification | string, opacity: ExpressionSpecification | number = 0.9) {
  ensureArrow(map);
  map.addLayer({
    id, type: 'symbol', source,
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 140, 'icon-image': 'route-arrow', 'icon-size': 0.95,
      'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    },
    paint: { 'icon-color': color, 'icon-opacity': opacity },
  });
}

/** The events layers (map.ts): on top of everything, so other popups give way to theirs. */
export const EVENT_LAYERS = ['events-area', 'events-outline', 'events-points', 'events-places'];

export const overlaps = (p: EventMapProps['period'], w: { from: number; to: number }) =>
  !!p && (p.from_year ?? -Infinity) <= w.to && (p.to_year ?? Infinity) >= w.from;

// MapLibre flattens nested properties to JSON strings.
export const prop = <T>(v: unknown): T => (typeof v === 'string' && /^[[{]/.test(v) ? JSON.parse(v) : v) as T;
