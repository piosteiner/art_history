// Map picker for place forms (browser code, bundled by `npm run build:admin` → static/map.js + static/map.css).
// Loaded on demand by editor.js when a page has a <div class="map-picker">.
//
// - Location: click the map (or drag the marker) → the longitude/latitude inputs; typing in them moves the marker.
// - Area: draw / edit / cut / remove polygons (Geoman) → GeoJSON Polygon or MultiPolygon in the area textarea.
// - Search: the server proxies OpenStreetMap's Nominatim (GET /geocode); a result can set the location and, when
//   Nominatim knows the boundary, take over its outline as the area.
// The inputs stay the source of truth: without JavaScript the form still works exactly as before.
import './leaflet-global';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

const L = window.L;
const round = (n) => Math.round(n * 1e5) / 1e5;  // 5 decimals ≈ 1 m — plenty for a map marker or an outline

const markerIcon = L.divIcon({ className: 'map-pin', iconSize: [18, 18], iconAnchor: [9, 9] });

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  if (text !== undefined) e.textContent = text;
  return e;
}

function init(box) {
  const form = box.closest('form');
  const prefix = box.dataset.point;  // e.g. "f.location"
  const lonInput = form.querySelector(`[name="${prefix}_lon"]`);
  const latInput = form.querySelector(`[name="${prefix}_lat"]`);
  const areaInput = box.dataset.area ? form.querySelector(`[name="${box.dataset.area}"]`) : null;

  // --- search bar -------------------------------------------------------------------------------------------
  const bar = el('div', { className: 'map-search' });
  const q = el('input', { type: 'search', placeholder: 'Search a place (OpenStreetMap), e.g. Arles or Provence' });
  const go = el('button', { type: 'button', className: 'secondary' }, 'Search');
  const results = el('div', { className: 'map-results' });
  bar.append(q, go);
  const mapDiv = el('div', { className: 'map-canvas' });
  const help = el('div', { className: 'hint' });
  help.textContent = areaInput
    ? 'Click the map to set the location (drag the pin to adjust). Draw the area with the polygon tool on the left; edit, cut holes or delete with the tools below it.'
    : 'Click the map to set the location (drag the pin to adjust).';
  box.append(bar, results, mapDiv, help);

  // --- map --------------------------------------------------------------------------------------------------
  const map = L.map(mapDiv, { worldCopyJump: true }).setView([48, 8], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    // OSM's tile policy requires a Referer; the admin pages send none to other sites (Referrer-Policy: same-origin,
    // app.js) and OSM then serves an "Access blocked" tile. For tiles only: send our origin, never the page's path.
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // Location marker ↔ lon/lat inputs
  let marker = null;
  function setPoint(latlng, { fromInputs = false } = {}) {
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, icon: markerIcon, pmIgnore: true }).addTo(map);
      marker.on('dragend', () => setPoint(marker.getLatLng()));
    } else {
      marker.setLatLng(latlng);
    }
    if (!fromInputs) {
      const ll = latlng.wrap();  // keep longitude within -180…180 after panning around the globe
      lonInput.value = round(ll.lng);
      latInput.value = round(ll.lat);
      // Tell listeners (the shared working copy, drafts) — setting .value fires no event by itself.
      lonInput.dispatchEvent(new Event('input', { bubbles: true }));
      latInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function pointFromInputs() {
    const lon = Number(lonInput.value);
    const lat = Number(latInput.value);
    if (lonInput.value.trim() && latInput.value.trim() && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
      setPoint(L.latLng(lat, lon), { fromInputs: true });
      return true;
    }
    if (marker) { marker.remove(); marker = null; }
    return false;
  }
  lonInput.addEventListener('change', pointFromInputs);
  latInput.addEventListener('change', pointFromInputs);

  map.on('click', (e) => {
    if (map.pm.globalDrawModeEnabled() || map.pm.globalEditModeEnabled() || map.pm.globalRemovalModeEnabled()
      || map.pm.globalCutModeEnabled?.()) return;
    setPoint(e.latlng);
  });

  // Area: all polygons drawn on the map ↔ GeoJSON in the textarea
  const areaLayer = L.featureGroup().addTo(map);
  function polygonsOnMap() {
    return map.pm.getGeomanLayers().filter((l) => l instanceof L.Polygon);
  }
  function writeArea() {
    if (!areaInput) return;
    const polys = polygonsOnMap().map((l) => l.toGeoJSON(6).geometry)
      .flatMap((g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]))
      .map((rings) => rings.map((ring) => ring.map(([x, y]) => [round(x), round(y)])));
    areaInput.value = !polys.length ? ''
      : JSON.stringify(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
    areaInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function watch(layer) {
    layer.on('pm:edit pm:dragend pm:cut pm:remove', writeArea);
  }
  function loadArea(geojson) {
    areaLayer.clearLayers();
    if (!geojson) return;
    const polys = geojson.type === 'MultiPolygon' ? geojson.coordinates : geojson.type === 'Polygon' ? [geojson.coordinates] : [];
    for (const rings of polys) {
      const layer = L.polygon(rings.map((ring) => ring.map(([x, y]) => [y, x])), { color: '#b0561d' });
      layer.addTo(areaLayer);
      watch(layer);
    }
  }
  if (areaInput) {
    try { loadArea(areaInput.value.trim() ? JSON.parse(areaInput.value) : null); } catch { /* invalid JSON: leave the map empty */ }
    areaInput.addEventListener('change', () => {
      try { loadArea(areaInput.value.trim() ? JSON.parse(areaInput.value) : null); } catch { /* shown as an error on save */ }
    });
    map.pm.setGlobalOptions({ layerGroup: areaLayer, pathOptions: { color: '#b0561d' }, snappable: true });
    map.pm.addControls({
      position: 'topleft',
      drawPolygon: true, drawRectangle: true, cutPolygon: true, editMode: true, dragMode: true, removalMode: true,
      drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawCircle: false, drawText: false, rotateMode: false,
    });
    map.on('pm:create', (e) => { watch(e.layer); writeArea(); });
    map.on('pm:remove', writeArea);
    map.on('pm:cut', (e) => { watch(e.layer); writeArea(); });
  }

  // Initial view: the point, else the area, else Europe.
  const hasPoint = pointFromInputs();
  if (areaLayer.getLayers().length) map.fitBounds(areaLayer.getBounds(), { padding: [20, 20], maxZoom: 12 });
  else if (hasPoint) map.setView(marker.getLatLng(), 11);

  // --- search -----------------------------------------------------------------------------------------------
  async function search() {
    const text = q.value.trim();
    if (!text) return;
    results.textContent = 'Searching…';
    try {
      const res = await fetch(`/geocode?q=${encodeURIComponent(text)}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const hits = await res.json();
      results.textContent = '';
      if (!hits.length) { results.textContent = 'Nothing found.'; return; }
      for (const h of hits) {
        const row = el('div', { className: 'map-result' });
        const name = el('span', {}, h.name);
        const actions = el('span', { className: 'actions' });
        const show = el('button', { type: 'button', className: 'link' }, 'Set location');
        show.addEventListener('click', () => {
          setPoint(L.latLng(h.lat, h.lon));
          if (h.bbox) map.fitBounds([[h.bbox[0], h.bbox[2]], [h.bbox[1], h.bbox[3]]], { maxZoom: 13 });
          else map.setView([h.lat, h.lon], 12);
        });
        actions.append(show);
        if (areaInput && h.geojson && /Polygon$/.test(h.geojson.type)) {
          const outline = el('button', { type: 'button', className: 'link' }, 'Use outline as area');
          outline.addEventListener('click', () => {
            loadArea(h.geojson);
            writeArea();
            map.fitBounds(areaLayer.getBounds(), { padding: [20, 20] });
          });
          actions.append(outline);
        }
        row.append(name, actions);
        results.append(row);
      }
    } catch (err) {
      results.textContent = err.message;
    }
  }
  go.addEventListener('click', search);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });  // don't submit the form

  // The form may have been laid out after the map was created.
  setTimeout(() => map.invalidateSize(), 0);
}

document.querySelectorAll('.map-picker').forEach(init);
