// Creating a place from one search box (migration 032): OpenStreetMap's Nominatim finds the candidates; picking one
// fills the new-place form — name and names in other languages, kind, country code, boundary code (countries and
// regions: the outline comes from Natural Earth), a point for everything smaller (from Wikidata, CC0, when the place
// has an item — else Nominatim's), the Wikidata id, and the parent: the smallest of our places whose outline contains
// it (PostGIS ST_Covers), else the Natural Earth region/country it lies in — created along with the place on Create.
// OSM is used for finding only: its outlines are ODbL and are not stored.
//
// Nominatim's usage policy: at most 1 request per second, an identifying User-Agent — nominatim() keeps both and is
// shared with the map picker's /geocode. NOMINATIM_BASE is configurable for the end-to-end tests.
const NOMINATIM = process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org';
const UA = 'arthistory-admin/1.0 (+https://arthistory.piogino.ch)';
let last = 0;

async function nominatim(params) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = new URL('/search', NOMINATIM);
  url.search = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'en', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

// OSM classification → our place kind
function kindOf(h) {
  const t = h.addresstype || h.type;
  if (t === 'country') return 'country';
  if (['state', 'province', 'region', 'county', 'state_district', 'prefecture', 'archipelago', 'island'].includes(t)) return 'region';
  if (['city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'quarter', 'neighbourhood', 'city_district', 'borough'].includes(t)) return 'settlement';
  if (['building', 'amenity', 'tourism', 'historic', 'religion'].includes(h.category)) return h.type === 'archaeological_site' ? 'site' : 'building';
  return 'site';
}

// the language of a country's own names (for "original" among the names); none where several are equal
const COUNTRY_LANG = { JP: 'ja', CN: 'zh', TW: 'zh', KR: 'ko', FR: 'fr', DE: 'de', AT: 'de', IT: 'it', ES: 'es', NL: 'nl',
  RU: 'ru', PT: 'pt', GR: 'el', US: 'en', GB: 'en', IE: 'en', AU: 'en', MX: 'es', BR: 'pt', PL: 'pl', CZ: 'cs', TR: 'tr', IR: 'fa', EG: 'ar' };
const LANGS = ['en', 'ja', 'zh', 'ko', 'fr', 'de', 'it', 'nl', 'es', 'ru', 'pt'];

// → [{ label, name, kind, country_code, region_codes, lat, lon, wikidata, names: "lines" }]
async function candidates(q) {
  const hits = await nominatim({ q, limit: '8', addressdetails: '1', extratags: '1', namedetails: '1' });
  return hits.map((h) => {
    const a = h.address || {};
    const nd = h.namedetails || {};
    const cc = (a.country_code || '').toUpperCase() || null;
    const name = nd['name:en'] || nd.name || h.name || String(h.display_name).split(',')[0];
    const own = COUNTRY_LANG[cc];
    const lines = [];
    for (const lang of LANGS) {
      const v = nd[`name:${lang}`];
      if (v && v !== name && !lines.some((l) => l.startsWith(`${v} |`))) lines.push(`${v} | ${lang} | ${lang === own ? 'original' : 'translation'}`);
    }
    return {
      label: h.display_name, name, kind: kindOf(h), country_code: /^[A-Z]{2}$/.test(cc || '') ? cc : null,
      region_codes: ['ISO3166-2-lvl4', 'ISO3166-2-lvl3', 'ISO3166-2-lvl5', 'ISO3166-2-lvl6'].map((k) => a[k]).filter(Boolean),
      lat: Number(h.lat), lon: Number(h.lon), wikidata: /^Q\d+$/.test((h.extratags || {}).wikidata || '') ? h.extratags.wikidata : null,
      names: lines.join('\n'),
    };
  });
}

// A picked candidate (as posted back by the page, so re-checked here) → the new-place form (flat keys), plus what
// to say about it. coordsOf(qid) → [lon, lat] | null (Wikidata, CC0).
async function draftFor(db, c, coordsOf, slugify) {
  const cc = /^[A-Z]{2}$/.test(c.country_code || '') ? c.country_code : null;
  const lat = Number(c.lat);
  const lon = Number(c.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('no position');
  const kind = ['country', 'region', 'settlement', 'building', 'site'].includes(c.kind) ? c.kind : 'site';
  // a boundary for countries and regions
  let boundary = null;
  if (kind === 'country' && cc) boundary = (await db.query('SELECT code, name FROM boundaries WHERE code = $1', [cc])).rows[0] || null;
  if (kind === 'region') {
    const codes = [].concat(c.region_codes || []).filter((x) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(x));
    boundary = (await db.query('SELECT code, name FROM boundaries WHERE code = ANY ($1) ORDER BY array_position($1, code) LIMIT 1', [codes])).rows[0] || null;
  }
  // a point for everything without a boundary: Wikidata's when there is an item, else Nominatim's
  let point = null;
  if (!boundary) point = (c.wikidata && await coordsOf(c.wikidata).catch(() => null)) || [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  // the parent: our smallest place whose outline contains the spot …
  const at = point || [lon, lat];
  const { rows: inside } = await db.query(`
    SELECT p.slug, p.name FROM places p JOIN place_geo g ON g.id = p.id
    WHERE g.outline IS NOT NULL AND ST_Covers(g.outline, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
      AND p.boundary_code IS DISTINCT FROM $3
    ORDER BY ST_Area(g.outline) LIMIT 1`, [at[0], at[1], boundary ? boundary.code : null]);
  let parent = inside[0] ? { slug: inside[0].slug, name: inside[0].name, isNew: false } : null;
  // … else the Natural Earth region / country it lies in (region for a town, country for a region) — created with it
  if (!parent && kind !== 'country') {
    const { rows } = await db.query(`
      SELECT b.code, b.name FROM boundaries b
      WHERE ST_Covers(b.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AND b.code IS DISTINCT FROM $3
        AND b.level <= $4 ORDER BY b.level DESC LIMIT 1`, [at[0], at[1], boundary ? boundary.code : null, kind === 'region' ? 0 : 1]);
    if (rows[0]) parent = { slug: null, name: rows[0].name, isNew: true, code: rows[0].code };
  }
  const name = String(c.name || '').trim().slice(0, 200);
  const form = {
    slug: slugify(name), 'f.name': name, 'f.kind': kind, 'f.country_code': cc || '', 'f.boundary_code': boundary ? boundary.code : '',
    'f.location_lon': point ? String(point[0]) : '', 'f.location_lat': point ? String(point[1]) : '',
    'f.wikidata_id': /^Q\d+$/.test(c.wikidata || '') ? c.wikidata : '', 'f.names': String(c.names || '').slice(0, 2000),
    'f.parent': parent ? parent.slug || parent.name : '',
  };
  return { form, boundary, parent };
}

module.exports = { nominatim, candidates, draftFor };
