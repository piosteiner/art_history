// GeoJSON for the map (coordinates are [longitude, latitude], WGS 84). Basemap tiles come from MapTiler, not from here.
//
// GET /v1/map/places?from=&to=            every place, with how many relationships touch it (in the time window)
// GET /v1/map/presence?from=&to=&types=   who was physically where, overlapping the window (timeline slider)
// GET /v1/map/<plural>/:slug              one entity's places + its travel route (physical presence only);
//                                         artworks also "provenance": the holders in the sources' order (below)
// GET /v1/map/sites                       institutions and immovable artworks with an exact location of their own;
//                                         an institution's branches (154) too, at their place, with `branch`
// GET /v1/map/events                      events: their area, spot or place (047)
//
// A location is a place, an institution (its own point, else its city's) or an immovable artwork (view site_geo,
// migration 034). Features carry the city it counts for as "place", and the institution / artwork when there is one:
// two people at the same institution at the same time could have met; in the same place, they were in the same city.
const express = require('express');
const { apiPool } = require('../db');
const cache = require('../cache');
const { versioned } = cache;
const { badRequest, notFound, yearWindowRange, listParam } = require('../http');
const { ENTITIES } = require('./entities');

const router = express.Router();

// A place's marker (view place_geo, migration 032): its point, else its boundary's label point, else a point inside
// its own outline.
const MARKER = '(SELECT g.marker FROM place_geo g WHERE g.id = p.id)';
// a reference { type, slug, public_id, name } to (type, id) columns, from entity_index
const REF = (alias, t, id) => `(SELECT jsonb_build_object('type', ${alias}.type, 'slug', ${alias}.slug, 'public_id', ${alias}.public_id, 'name', ${alias}.name)
  FROM entity_index ${alias} WHERE (${alias}.type, ${alias}.id) = (${t}, ${id}))`;

// Joins for an edge's object as a location: s = site_geo row, o = the object's name, c = the city it counts for.
const SITE_JOINS = `
    JOIN site_geo s ON (s.type, s.id) = (r.object_type, r.object_id)
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id)
    LEFT JOIN places c ON c.id = s.place_id`;
const SITE_PROPS = `'place', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('slug', c.slug, 'name', c.name) END,
        'institution', CASE WHEN r.object_type = 'institution' THEN jsonb_build_object('slug', o.slug, 'name', o.name) END,
        'artwork', CASE WHEN r.object_type = 'artwork' THEN jsonb_build_object('slug', o.slug, 'name', o.name) END,
        'event', CASE WHEN r.object_type = 'event' THEN jsonb_build_object('slug', o.slug, 'name', o.name) END`;

router.get('/places', async (req, res) => {
  const window = yearWindowRange(req.query);
  // Aggregate FILTER (WHERE …) counts two things in one pass over the edges.
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(${MARKER})::jsonb,
      'properties', jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'kind', p.kind, 'country_code', p.country_code,
        'presence_count',    count(r.id) FILTER (WHERE rt.is_physical_presence),
        'association_count', count(r.id) FILTER (WHERE NOT rt.is_physical_presence))) AS feature
    FROM places p
    LEFT JOIN relationships r
      ON r.object_type = 'place' AND r.object_id = p.id
     AND ($1::daterange IS NULL OR r.period && $1::daterange)
    LEFT JOIN relationship_types rt ON rt.code = r.relationship_type
    GROUP BY p.id
    ORDER BY p.name COLLATE sort_natural`, [window]);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.feature) });
});

// Presence answers cached per window and types (src/cache.js: per data version, while the derived data is current)
const presenceCache = versioned(20);

router.get('/presence', async (req, res) => {
  const window = yearWindowRange(req.query);
  if (!window) throw badRequest('from and/or to is required');
  // "patron" is the old name of "person" (migration 024), still accepted
  const types = (listParam(req.query, 'types') || ['artist', 'person', 'artwork']).map((t) => (t === 'patron' ? 'person' : t));
  if (!types.every((t) => ['artist', 'person', 'artwork', 'institution'].includes(t))) {
    throw badRequest('types: artist, person, artwork, institution');
  }
  res.type('json').send(await presenceAnswer(window, types));
});

// The presence answer for a window and types, as JSON text — cached (src/cache.js).
function presenceAnswer(window, types) {
  return presenceCache(`${window}|${[...types].sort().join(',')}`, async () => {
    // Undated edges are left out: we can't say they overlap the window.
    const { rows } = await apiPool.query(`
      SELECT jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(s.marker)::jsonb,
        'properties', jsonb_build_object(
          'entity', jsonb_build_object('type', e.type, 'slug', e.slug, 'name', e.name),
          ${SITE_PROPS},
          'relationship', rt.code, 'label', rt.label, 'note', r.label, 'certainty', r.certainty,
          'period', range_json(r.period, r.period_label))) AS feature
      FROM graph_links r  -- stored + derived (provenance: kept_in, 031) — stored, kept up to date per change (126)
      JOIN relationship_types rt ON rt.code = r.relationship_type AND rt.is_physical_presence
      ${SITE_JOINS}
      JOIN entity_index e ON e.type = r.subject_type AND e.id = r.subject_id
      WHERE r.subject_type = ANY ($2::entity_type[]) AND r.period && $1::daterange AND s.marker IS NOT NULL
      ORDER BY lower(r.period), e.sort_key COLLATE sort_natural`, [window, types]);
    return { type: 'FeatureCollection', features: rows.map((r) => r.feature) };
  });
}
// The start map's overview asks for all time and every kind (frontend explore.ts ALL_TIME): computed ahead after a
// change (1.3 s at 10× today's data).
cache.warm('presence, all time', () => presenceAnswer(yearWindowRange({ from: '-3000', to: String(new Date().getFullYear() + 1) }), ['artist', 'person', 'artwork']));

// Several artworks' provenance on the map at once (?artworks=slug,slug … — at most 300): {data: {slug: provenance}},
// each as in an artwork's map (`provenance`). The start map's overview draws every artwork's provenance: one request
// instead of one per artwork (≈ 110 requests queued behind each other made the start page take 10 s and more).
// The overview takes what is cached, even from before the last change (the warm-up below brings it up to date within
// moments); only maps never computed are computed here. ≈ 100 ms of database time per artwork: 350 artworks computed
// on every visit ran into the API's 5 s statement timeout (2026-10-20).
router.get('/provenances', async (req, res) => {
  const slugs = [...new Set(listParam(req.query, 'artworks', /^[a-z0-9-]+$/) || [])];
  if (slugs.length > 300) throw badRequest('at most 300 artworks');
  const { rows } = await apiPool.query('SELECT id, slug FROM artworks WHERE slug = ANY ($1::text[])', [slugs]);
  const data = {};
  const missing = [];
  for (const r of rows) { const hit = provenanceCache.get(String(r.id)); if (hit) data[r.slug] = hit.value; else missing.push(r); }
  for (let i = 0; i < missing.length; i += 4) {  // a few at a time: the pool is shared with every other request
    await Promise.all(missing.slice(i, i + 4).map(async (r) => { data[r.slug] = await cachedProvenanceRoute(r.id, await dataVersion()); }));
  }
  warmSoon();
  res.json({ data });
});

router.get('/:plural/:slug', async (req, res) => {
  const e = ENTITIES[req.params.plural];
  if (!e || e.type === 'place') throw notFound();
  const found = await apiPool.query(`SELECT id, slug, ${e.name} AS name FROM ${e.table} WHERE slug = $1`, [req.params.slug]);
  if (!found.rows.length) throw notFound(`no ${e.type} "${req.params.slug}"`);
  const { id, ...entity } = found.rows[0];

  const { rows: [result] } = await apiPool.query(`
    WITH stops AS (
      SELECT r.period, rt.code, rt.label, rt.category, rt.is_physical_presence, r.period_label, r.label AS note,
             r.certainty, o.name, s.marker AS point, jsonb_build_object(${SITE_PROPS}) AS site
      FROM graph_links r  -- stored + derived (provenance: kept_in, 031) — stored, kept up to date per change (126)
      JOIN relationship_types rt ON rt.code = r.relationship_type
      ${SITE_JOINS}
      WHERE r.subject_type = $1 AND r.subject_id = $2 AND s.marker IS NOT NULL
        AND (r.object_type = 'place'                                              -- every link to a place, as before
             OR r.object_type = 'institution' AND rt.is_physical_presence          -- was at an institution
             OR r.object_type = 'artwork' AND r.relationship_type = 'depicts'      -- shows an immovable work
             OR r.object_type = 'event')                                            -- took part in, depicts (047)
    )
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(point)::jsonb,
        'properties', site || jsonb_build_object(
          'layer', CASE WHEN is_physical_presence THEN 'presence' ELSE 'association' END,
          'relationship', code, 'label', label, 'category', category, 'note', note, 'certainty', certainty,
          'period', range_json(period, period_label)))
        ORDER BY period NULLS LAST, name COLLATE sort_natural), '[]') AS stops,
      -- The route: an ordered aggregate over the dated physical-presence stops only.
      -- Associations (e.g. "influenced by the culture of Japan") are never drawn as travel.
      -- ST_RemoveRepeatedPoints: "lived in Auvers" followed by "died in Auvers" is one stop, not a zero-length hop.
      -- ORDER BY the range itself, not lower(period): an open start ("until 1912") sorts as -infinity, first,
      -- where lower() would be NULL and last; ties go by the upper bound.
      ST_AsGeoJSON(ST_RemoveRepeatedPoints(ST_MakeLine(point::geometry ORDER BY period)
                   FILTER (WHERE is_physical_presence AND period IS NOT NULL)))::jsonb AS route
    FROM stops`, [e.type, id]);

  const features = result.stops;
  if (result.route && result.route.coordinates.length > 1) {
    features.push({ type: 'Feature', geometry: result.route, properties: { layer: 'route' } });
  }
  const extra = e.type === 'artwork' ? { provenance: await cachedProvenanceRoute(id, await dataVersion()) } : {};
  res.json({ type: 'FeatureCollection', entity: { type: e.type, ...entity }, features, ...extra });
});

// An artwork's provenance on the map, in the order of the chain (view provenance_chain: the creation, the recorded
// steps by position, the loan) — not by date: the sources' order is what every provenance has, dates often not.
// Every step is in it, however patchy; how sure each part is travels along instead of being hidden:
//   points    one per step with a place: place_basis 'recorded' (the step's own place), 'holder_seat' (an institution
//             holder without a place: its seat), 'created_in' / 'artist_residence' / 'artist_workplace' (creation:
//             the artwork's recorded place of creation, else the one place the artist is recorded at while it was
//             made, else the artist's one undated place of work); precision = the place's kind (site / settlement /
//             region / country)
//   segments  between consecutive placed steps: direct (every handover on it documented as direct), implied (an end
//             not recorded: the creation, the loan, or a place not recorded), between (the steps it passes over that
//             have no place)
//   unplaced  every step without a place, so a list beside the map can name them
// Where each step was: provenance_stops() (091, in SQL — the travel distance uses it too). lag() over the placed
// steps pairs each with the previous one — window functions instead of a loop in JavaScript.
// Artworks' provenance maps, cached per artwork with the data version they were computed at — the change counter
// every commit to the content raises (sequence quality_changes, migrations 058/122). An artwork's own map is always
// current (computed again when the counter moved); the overview may serve one from before the last change while the
// warm-up recomputes them, one artwork at a time, after each change.
const provenanceCache = new Map();  // artwork id → { version, value }
const dataVersion = async () => (await apiPool.query('SELECT last_value::text AS v FROM quality_changes')).rows[0].v;
async function cachedProvenanceRoute(artworkId, version) {
  const key = String(artworkId);
  const hit = provenanceCache.get(key);
  if (hit && hit.version === version) return hit.value;
  const value = await provenanceRoute(artworkId);
  provenanceCache.set(key, { version, value });
  return value;
}
let warming = null;
let warmTimer = null;
async function warm() {
  const version = await dataVersion();
  const { rows } = await apiPool.query('SELECT id FROM artworks');
  const ids = new Set(rows.map((r) => String(r.id)));
  for (const id of provenanceCache.keys()) if (!ids.has(id)) provenanceCache.delete(id);   // deleted artworks
  for (const r of rows) {
    if (await dataVersion() !== version) return warm();   // changed meanwhile: start over with the new version
    await cachedProvenanceRoute(r.id, version);
  }
}
function warmSoon() {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    if (warming) return;
    warming = warm().catch((err) => console.error('map: provenance warm-up —', err.message)).finally(() => { warming = null; });
  }, 1000);
  warmTimer.unref?.();
}
// after a start (deploy, restart) the cache is empty: fill it before the first visitor needs it
if (process.env.NODE_ENV === 'production') setTimeout(warmSoon, 5000).unref();

async function provenanceRoute(artworkId) {
  const { rows: [r] } = await apiPool.query(`
    -- the stops: provenance_stops() (091) — the same the travel distance is measured along
    WITH located AS (
      SELECT c.*, s.step, s.steps, s.place_id, s.place_basis, s.part, s.part_label
      FROM provenance_stops($1) s
      JOIN provenance_chain c ON c.artwork_id = $1 AND c.kind = s.chain_kind AND c.id IS NOT DISTINCT FROM s.provenance_id
    ), rows AS (
      SELECT l.*, pl.slug AS place_slug, pl.name AS place_name, pl.kind AS place_kind, g.marker,
             o.slug AS holder_slug,
             jsonb_build_object('step', l.step, 'steps', l.steps, 'kind', l.kind,
               'holder', CASE WHEN l.owner_id IS NOT NULL THEN jsonb_build_object('type', l.owner_type, 'slug', o.slug, 'name', l.owner_name) END,
               'holder_label', l.owner_label, 'role', l.role, 'method', l.method, 'certainty', l.certainty,
               'period', range_json(l.period, l.period_label), 'end_basis', l.end_basis, 'provenance_id', l.id,
               'part', l.part, 'part_label', l.part_label, 'position', l.position) AS props
      FROM located l
      LEFT JOIN entity_index o ON (o.type, o.id) = (l.owner_type, l.owner_id)
      LEFT JOIN places pl ON pl.id = l.place_id
      LEFT JOIN site_geo g ON (g.type, g.id) = ('place', l.place_id)
    ), placed AS (
      SELECT r.*, lag(r.step) OVER w AS prev_step, lag(r.marker) OVER w AS prev_marker,
             lag(r.kind) OVER w AS prev_kind, lag(r.place_basis) OVER w AS prev_basis
      FROM rows r WHERE r.marker IS NOT NULL WINDOW w AS (ORDER BY r.step, r.part)
    )
    SELECT
      (SELECT coalesce(jsonb_agg(jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(p.marker)::jsonb,
         'properties', p.props || jsonb_build_object('layer', 'provenance_stop', 'place_basis', p.place_basis,
           'precision', p.place_kind, 'place', jsonb_build_object('slug', p.place_slug, 'name', p.place_name)))
         ORDER BY p.step, p.part), '[]') FROM placed p) AS stops,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('type', 'Feature',
         'geometry', ST_AsGeoJSON(ST_MakeLine(p.prev_marker::geometry, p.marker::geometry))::jsonb,
         'properties', jsonb_build_object('layer', 'provenance_segment', 'from_step', p.prev_step, 'to_step', p.step,
           -- within one step: the holder took it from one place to the next (077)
           'move', p.prev_step = p.step, 'direct', CASE WHEN p.prev_step = p.step THEN true ELSE h.direct END,
           'implied', p.prev_kind <> 'step' OR p.kind <> 'step' OR p.prev_basis <> 'recorded' OR p.place_basis <> 'recorded',
           'between', h.between)) ORDER BY p.step, p.part), '[]')
       FROM placed p
       CROSS JOIN LATERAL (
         SELECT coalesce(bool_and(x.direct AND x.kind = 'step') FILTER (WHERE x.step > p.prev_step), false) AS direct,
                coalesce(jsonb_agg(x.props ORDER BY x.step) FILTER (WHERE x.marker IS NULL AND x.part = 0), '[]') AS between
         FROM rows x WHERE x.step > p.prev_step AND x.step <= p.step
       ) h
       WHERE p.prev_step IS NOT NULL AND NOT ST_Equals(p.prev_marker::geometry, p.marker::geometry)) AS segments,
      (SELECT coalesce(jsonb_agg(x.props ORDER BY x.step), '[]') FROM rows x WHERE x.marker IS NULL AND x.part = 0) AS unplaced`, [artworkId]);
  // where nothing is known (078): each gap on the segment it falls into — after the segment's first stop, before its
  // last — and all gaps beside the features, for the text under the map
  const { rows: gaps } = await apiPool.query(`SELECT range_json(period) AS period, in_1933_1945, before_name AS before, after_name AS after,
      coalesce(candidates, '{}') AS candidates, before_position, after_position FROM provenance_coverage($1) WHERE kind = 'gap' ORDER BY period`, [artworkId]);
  const posOf = new Map(r.stops.map((f) => [f.properties.step, f.properties.position]));
  for (const seg of r.segments) {
    const [from, to] = [posOf.get(seg.properties.from_step), posOf.get(seg.properties.to_step)];
    seg.properties.gaps = seg.properties.move ? [] : gaps.filter((g) => g.before_position !== null && g.before_position >= from
      && (g.after_position === null || g.after_position <= to))
      .map(({ before_position: _b, after_position: _a, ...g }) => g);
  }
  return { type: 'FeatureCollection', features: [...r.stops, ...r.segments], unplaced: r.unplaced,
    gaps: gaps.map(({ before_position: _b, after_position: _a, ...g }) => g) };
}

// Who was near whom (091): pairs of dated stays at the same place — or within ?within_km= (≤ 500) — at the same
// time; ?from=&to= a window, ?entity=<plural>/<slug> or a public number for one entry's encounters. Sorted: same
// venue first, certain before approximate, then by date.
router.get('/encounters', async (req, res) => {
  const window = yearWindowRange(req.query);
  const km = req.query.within_km === undefined ? 0 : Number(req.query.within_km);
  if (!(km >= 0 && km <= 500)) throw badRequest('within_km: 0–500');
  let focus = [null, null];
  if (req.query.entity) {
    const key = String(req.query.entity).trim();
    const { rows: [hit] } = /^\d{1,15}$/.test(key)
      ? await apiPool.query('SELECT e.type::text AS type, e.id FROM entity_index e WHERE e.public_id = $1', [key])
      : await apiPool.query('SELECT e.type::text AS type, e.id FROM entity_index e WHERE e.type = $1 AND e.slug = $2',
        [(ENTITIES[key.split('/')[0]] || {}).type || null, key.split('/')[1] || '']);
    if (!hit) throw notFound(`no entry "${key}"`);
    focus = [hit.type, hit.id];
  }
  const { rows } = await apiPool.query(`
    SELECT ${REF('a', 'e.a_type', 'e.a_id')} AS a, ${REF('b', 'e.b_type', 'e.b_id')} AS b,
           jsonb_build_object('slug', pa.slug, 'name', pa.name) AS place,
           CASE WHEN e.b_place <> e.a_place THEN jsonb_build_object('slug', pb.slug, 'name', pb.name) END AS other_place,
           CASE WHEN e.venue_id IS NOT NULL THEN ${REF('v', 'e.venue_type', 'e.venue_id')} END AS venue,
           range_json(e.overlap) AS overlap, upper(e.overlap) - lower(e.overlap) AS days, e.km, e.approximate,
           e.a_relationship, e.b_relationship
    FROM encounters($1::daterange, $2, $3::entity_type, $4) e
    JOIN places pa ON pa.id = e.a_place JOIN places pb ON pb.id = e.b_place
    ORDER BY e.venue_id IS NULL, e.approximate, e.km, lower(e.overlap)
    LIMIT 1000`, [window, km, focus[0], focus[1]]);
  res.json({ data: rows });
});

// Places grouped for a map at low zoom (091, ST_ClusterDBSCAN): ?zoom= (0–20), ?radius= pixels (10–120, default 40),
// ?from=&to=. A FeatureCollection of points: count of places, presence, the biggest places (≤ 5), bbox to zoom into.
router.get('/clusters', async (req, res) => {
  const zoom = Number(req.query.zoom);
  if (!(zoom >= 0 && zoom <= 20)) throw badRequest('zoom: 0–20');
  const radius = req.query.radius === undefined ? 40 : Number(req.query.radius);
  if (!(radius >= 10 && radius <= 120)) throw badRequest('radius: 10–120 pixels');
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(center, 5)::jsonb,
      'bbox', (SELECT jsonb_build_array(ST_XMin(bbox), ST_YMin(bbox), ST_XMax(bbox), ST_YMax(bbox))),
      'properties', jsonb_build_object('cluster', cluster, 'places', places, 'presence', presence,
        'top', (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(top) x LIMIT 5) t))) AS f
    FROM place_clusters($1, $2::daterange, $3) ORDER BY presence DESC`, [zoom, yearWindowRange(req.query), radius]);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.f) });
});

// Institutions and immovable artworks with an exact location of their own (migration 034).
router.get('/sites', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(x.geom)::jsonb,
      'properties', jsonb_build_object('type', x.type, 'slug', x.slug, 'name', x.name, 'kind', x.kind, 'address', x.address,
        'place', (SELECT jsonb_build_object('slug', c.slug, 'name', c.name) FROM places c WHERE c.id = x.place_id),
        -- when it existed, in years (106): from its founding (a building: its making), to its closing or destruction;
        -- null = not known / still there — the start map shows it in a time window only then
        'from_year', extract(year FROM lower(x.since))::int, 'to_year', extract(year FROM upper(x.until) - 1)::int,
        'branch', x.branch)) AS feature
    FROM (
      SELECT 'institution' AS type, i.slug, i.name, i.kind, i.address, i.location AS geom, i.place_id, i.founded AS since, i.dissolved AS until,
             NULL::jsonb AS branch
      FROM institutions i WHERE i.location IS NOT NULL
      UNION ALL
      -- a branch (154): at its place's marker (a city, or a building with its own point), for its period — bounded by the
      -- institution's own existence; its label is the branch's name or address
      SELECT 'institution', i.slug, i.name, i.kind, r.label, g.marker, CASE WHEN c.kind IN ('settlement', 'region', 'country', 'continent') THEN c.id ELSE c.parent_id END,
             CASE WHEN lower(r.period) IS NOT NULL THEN daterange(lower(r.period), lower(r.period) + 1) ELSE i.founded END,
             CASE WHEN upper(r.period) IS NOT NULL THEN daterange(upper(r.period) - 1, upper(r.period)) ELSE i.dissolved END,
             jsonb_build_object('place', jsonb_build_object('slug', c.slug, 'name', c.name), 'period', range_json(r.period, r.period_label))
      FROM relationships r JOIN institutions i ON i.id = r.subject_id JOIN places c ON c.id = r.object_id
      JOIN place_geo g ON g.id = r.object_id
      WHERE r.relationship_type = 'branch_in' AND r.subject_type = 'institution' AND g.marker IS NOT NULL
      UNION ALL
      SELECT 'artwork', a.slug, a.title, a.kind, NULL, coalesce(a.area, a.location), entity_home_place('artwork', a.id), a.created,
        CASE WHEN a.fate = 'destroyed' THEN a.fate_date END, NULL
      FROM artworks a WHERE a.location IS NOT NULL OR a.area IS NOT NULL
    ) x ORDER BY x.name COLLATE sort_natural`);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.feature) });
});

// Events (migration 047): the area it covered, else its exact spot, else the marker of its place — with the period,
// so a client can filter the map by time.
router.get('/events', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(coalesce(v.area, v.location, g.marker))::jsonb,
      'properties', jsonb_build_object('type', 'event', 'slug', v.slug, 'name', v.name, 'kind', v.kind,
        'period', range_json(v.period, v.period_label), 'precision', CASE WHEN v.area IS NOT NULL THEN 'area' WHEN v.location IS NOT NULL THEN 'spot' ELSE 'place' END,
        'place', (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = v.place_id))) AS feature
    FROM events v LEFT JOIN place_geo g ON g.id = v.place_id
    WHERE coalesce(v.area, v.location, g.marker) IS NOT NULL
    ORDER BY lower(v.period) NULLS LAST, v.name COLLATE sort_natural`);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.feature) });
});

module.exports = router;
