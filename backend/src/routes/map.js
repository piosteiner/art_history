// GeoJSON for the map (coordinates are [longitude, latitude], WGS 84). Basemap tiles come from MapTiler, not from here.
//
// GET /v1/map/places?from=&to=            every place, with how many relationships touch it (in the time window)
// GET /v1/map/presence?from=&to=&types=   who was physically where, overlapping the window (timeline slider)
// GET /v1/map/<plural>/:slug              one entity's places + its travel route (physical presence only)
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
    ORDER BY p.name`, [window]);
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
    ORDER BY lower(r.period), e.name`, [window, types]);
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
        ORDER BY lower(period) NULLS LAST, name), '[]') AS stops,
      -- The route: an ordered aggregate over the dated physical-presence stops only.
      -- Associations (e.g. "influenced by the culture of Japan") are never drawn as travel.
      -- ST_RemoveRepeatedPoints: "lived in Auvers" followed by "died in Auvers" is one stop, not a zero-length hop.
      ST_AsGeoJSON(ST_RemoveRepeatedPoints(ST_MakeLine(point::geometry ORDER BY lower(period), upper(period))
                   FILTER (WHERE is_physical_presence AND period IS NOT NULL)))::jsonb AS route
    FROM stops`, [e.type, id]);

  const features = result.stops;
  if (result.route && result.route.coordinates.length > 1) {
    features.push({ type: 'Feature', geometry: result.route, properties: { layer: 'route' } });
  }
  res.json({ type: 'FeatureCollection', entity: { type: e.type, ...entity }, features });
});

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
    ) x ORDER BY x.name`);
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
    ORDER BY lower(v.period) NULLS LAST, v.name`);
  res.json({ type: 'FeatureCollection', features: rows.map((r) => r.feature) });
});

module.exports = router;
