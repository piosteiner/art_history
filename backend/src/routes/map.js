// GeoJSON for the map (coordinates are [longitude, latitude], WGS 84). Basemap tiles come from MapTiler, not from here.
//
// GET /v1/map/places?from=&to=            every place, with how many relationships touch it (in the time window)
// GET /v1/map/presence?from=&to=&types=   who was physically where, overlapping the window (timeline slider)
// GET /v1/map/<plural>/:slug              one entity's places + its travel route (physical presence only);
//                                         artworks also "provenance": the holders in the sources' order (below)
// GET /v1/map/sites                       institutions and immovable artworks with an exact location of their own
// GET /v1/map/events                      events: their area, spot or place (047)
//
// A location is a place, an institution (its own point, else its city's) or an immovable artwork (view site_geo,
// migration 034). Features carry the city it counts for as "place", and the institution / artwork when there is one:
// two people at the same institution at the same time could have met; in the same place, they were in the same city.
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound, yearWindowRange, listParam } = require('../http');
const { ENTITIES } = require('./entities');

const router = express.Router();

// A place's marker (view place_geo, migration 032): its point, else its boundary's label point, else a point inside
// its own outline.
const MARKER = '(SELECT g.marker FROM place_geo g WHERE g.id = p.id)';

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

router.get('/presence', async (req, res) => {
  const window = yearWindowRange(req.query);
  if (!window) throw badRequest('from and/or to is required');
  // "patron" is the old name of "person" (migration 024), still accepted
  const types = (listParam(req.query, 'types') || ['artist', 'person', 'artwork']).map((t) => (t === 'patron' ? 'person' : t));
  if (!types.every((t) => ['artist', 'person', 'artwork', 'institution'].includes(t))) {
    throw badRequest('types: artist, person, artwork, institution');
  }
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
    FROM edges r  -- stored + derived (provenance: kept_in), migration 031
    JOIN relationship_types rt ON rt.code = r.relationship_type AND rt.is_physical_presence
    ${SITE_JOINS}
    JOIN entity_index e ON e.type = r.subject_type AND e.id = r.subject_id
    WHERE r.subject_type = ANY ($2::entity_type[]) AND r.period && $1::daterange AND s.marker IS NOT NULL
    ORDER BY lower(r.period), e.sort_key COLLATE sort_natural`, [window, types]);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.feature) });
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
      FROM edges r  -- stored + derived (provenance: kept_in), migration 031
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
  const extra = e.type === 'artwork' ? { provenance: await provenanceRoute(id) } : {};
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
// row_number() numbers the chain once; lag() over the placed steps pairs each with the previous one — window
// functions instead of a loop in JavaScript.
async function provenanceRoute(artworkId) {
  const { rows: [r] } = await apiPool.query(`
    WITH chain AS (
      SELECT c.*, row_number() OVER (ORDER BY c.position) AS step, count(*) OVER () AS steps
      FROM provenance_chain c WHERE c.artwork_id = $1
    ), located AS (
      SELECT ch.*, coalesce(ch.location_id, made.place_id, seat.place_id) AS place_id,
             CASE WHEN ch.location_id IS NOT NULL THEN CASE WHEN ch.kind = 'loan' THEN 'holder_seat' ELSE 'recorded' END
                  ELSE coalesce(made.basis, seat.basis) END AS place_basis
      FROM chain ch
      -- where it was made: recorded (created_in, e.g. from Wikidata P1071), else the artist's single dated place then
      LEFT JOIN LATERAL (
        SELECT * FROM (
          (SELECT rel.object_id AS place_id, 'created_in' AS basis, 1 AS pref FROM relationships rel
           WHERE rel.subject_type = 'artwork' AND rel.subject_id = ch.artwork_id
             AND rel.relationship_type = 'created_in' AND rel.object_type = 'place' ORDER BY rel.id LIMIT 1)
          UNION ALL
          (SELECT min(x.object_id), 'artist_residence', 2 FROM artworks w
           JOIN edges x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                       AND x.period && w.created
           JOIN relationship_types rt ON rt.code = x.relationship_type AND rt.is_physical_presence
           WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
          UNION ALL
          -- a workshop artist's one place of work, undated ("worked in Ulm" — Wikidata P937 has no dates)
          (SELECT min(x.object_id), 'artist_workplace', 3 FROM artworks w
           JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                               AND x.relationship_type = 'worked_in' AND x.period IS NULL
           WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
        ) m ORDER BY pref LIMIT 1
      ) made ON ch.location_id IS NULL AND (ch.kind = 'creation' OR ch.method = 'creation')
      LEFT JOIN LATERAL (
        SELECT i.place_id, 'holder_seat' AS basis FROM institutions i WHERE i.id = ch.owner_id
      ) seat ON ch.location_id IS NULL AND ch.owner_type = 'institution' AND ch.kind <> 'creation'
    ), rows AS (
      SELECT l.*, pl.slug AS place_slug, pl.name AS place_name, pl.kind AS place_kind, g.marker,
             o.slug AS holder_slug,
             jsonb_build_object('step', l.step, 'steps', l.steps, 'kind', l.kind,
               'holder', CASE WHEN l.owner_id IS NOT NULL THEN jsonb_build_object('type', l.owner_type, 'slug', o.slug, 'name', l.owner_name) END,
               'holder_label', l.owner_label, 'role', l.role, 'method', l.method, 'certainty', l.certainty,
               'period', range_json(l.period, l.period_label), 'end_basis', l.end_basis, 'provenance_id', l.id) AS props
      FROM located l
      LEFT JOIN entity_index o ON (o.type, o.id) = (l.owner_type, l.owner_id)
      LEFT JOIN places pl ON pl.id = l.place_id
      LEFT JOIN site_geo g ON (g.type, g.id) = ('place', l.place_id)
    ), placed AS (
      SELECT r.*, lag(r.step) OVER w AS prev_step, lag(r.marker) OVER w AS prev_marker,
             lag(r.kind) OVER w AS prev_kind, lag(r.place_basis) OVER w AS prev_basis
      FROM rows r WHERE r.marker IS NOT NULL WINDOW w AS (ORDER BY r.step)
    )
    SELECT
      (SELECT coalesce(jsonb_agg(jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(p.marker)::jsonb,
         'properties', p.props || jsonb_build_object('layer', 'provenance_stop', 'place_basis', p.place_basis,
           'precision', p.place_kind, 'place', jsonb_build_object('slug', p.place_slug, 'name', p.place_name)))
         ORDER BY p.step), '[]') FROM placed p) AS stops,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('type', 'Feature',
         'geometry', ST_AsGeoJSON(ST_MakeLine(p.prev_marker::geometry, p.marker::geometry))::jsonb,
         'properties', jsonb_build_object('layer', 'provenance_segment', 'from_step', p.prev_step, 'to_step', p.step,
           'direct', h.direct,
           'implied', p.prev_kind <> 'step' OR p.kind <> 'step' OR p.prev_basis <> 'recorded' OR p.place_basis <> 'recorded',
           'between', h.between)) ORDER BY p.step), '[]')
       FROM placed p
       CROSS JOIN LATERAL (
         SELECT coalesce(bool_and(x.direct AND x.kind = 'step') FILTER (WHERE x.step > p.prev_step), false) AS direct,
                coalesce(jsonb_agg(x.props ORDER BY x.step) FILTER (WHERE x.marker IS NULL), '[]') AS between
         FROM rows x WHERE x.step > p.prev_step AND x.step <= p.step
       ) h
       WHERE p.prev_step IS NOT NULL AND NOT ST_Equals(p.prev_marker::geometry, p.marker::geometry)) AS segments,
      (SELECT coalesce(jsonb_agg(x.props ORDER BY x.step), '[]') FROM rows x WHERE x.marker IS NULL) AS unplaced`, [artworkId]);
  return { type: 'FeatureCollection', features: [...r.stops, ...r.segments], unplaced: r.unplaced };
}

// Institutions and immovable artworks with an exact location of their own (migration 034).
router.get('/sites', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object('type', 'Feature', 'geometry', ST_AsGeoJSON(x.geom)::jsonb,
      'properties', jsonb_build_object('type', x.type, 'slug', x.slug, 'name', x.name, 'kind', x.kind, 'address', x.address,
        'place', (SELECT jsonb_build_object('slug', c.slug, 'name', c.name) FROM places c WHERE c.id = x.place_id))) AS feature
    FROM (
      SELECT 'institution' AS type, i.slug, i.name, i.kind, i.address, i.location AS geom, i.place_id
      FROM institutions i WHERE i.location IS NOT NULL
      UNION ALL
      SELECT 'artwork', a.slug, a.title, a.kind, NULL, coalesce(a.area, a.location), entity_home_place('artwork', a.id)
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
