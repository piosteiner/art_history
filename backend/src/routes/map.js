// GeoJSON for the map (coordinates are [longitude, latitude], WGS 84). Basemap tiles come from MapTiler, not from here.
//
// GET /v1/map/places?from=&to=            every place, with how many relationships touch it (in the time window)
// GET /v1/map/presence?from=&to=&types=   who was physically where, overlapping the window (timeline slider)
// GET /v1/map/<plural>/:slug              one entity's places + its travel route (physical presence only)
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound, yearWindowRange, listParam } = require('../http');
const { ENTITIES } = require('./entities');

const router = express.Router();

// A place's marker: its point, or a point inside its outline for regions stored as areas only.
const MARKER = 'coalesce(p.location, ST_PointOnSurface(p.area::geometry)::geography)';

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
  const types = listParam(req.query, 'types') || ['artist', 'patron', 'artwork'];
  if (!types.every((t) => ['artist', 'patron', 'artwork'].includes(t))) throw badRequest('types: artist, patron, artwork');
  // Undated edges are left out: we can't say they overlap the window.
  const { rows } = await apiPool.query(`
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(${MARKER})::jsonb,
      'properties', jsonb_build_object(
        'entity', jsonb_build_object('type', e.type, 'slug', e.slug, 'name', e.name),
        'place', jsonb_build_object('slug', p.slug, 'name', p.name),
        'relationship', rt.code, 'label', rt.label, 'note', r.label, 'certainty', r.certainty,
        'period', range_json(r.period, r.period_label))) AS feature
    FROM relationships r
    JOIN relationship_types rt ON rt.code = r.relationship_type AND rt.is_physical_presence
    JOIN places p ON p.id = r.object_id
    JOIN entity_index e ON e.type = r.subject_type AND e.id = r.subject_id
    WHERE r.object_type = 'place' AND r.subject_type = ANY ($2::entity_type[]) AND r.period && $1::daterange
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
             r.certainty, p.slug, p.name, ${MARKER} AS point
      FROM relationships r
      JOIN relationship_types rt ON rt.code = r.relationship_type
      JOIN places p ON p.id = r.object_id
      WHERE r.subject_type = $1 AND r.subject_id = $2 AND r.object_type = 'place'
    )
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(point)::jsonb,
        'properties', jsonb_build_object(
          'layer', CASE WHEN is_physical_presence THEN 'presence' ELSE 'association' END,
          'place', jsonb_build_object('slug', slug, 'name', name),
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

module.exports = router;
