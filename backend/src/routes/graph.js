// GET /v1/graph/<plural>/:slug?depth=2&types=influenced_by,student_of
//
// The network around one entity, following edges in BOTH directions up to `depth` hops, as nodes + edges
// (ready for a force-directed graph). Default: every non-geographic relationship type; places are map material.
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound, intParam, listParam } = require('../http');
const { ENTITIES } = require('./entities');

const MAX_NODES = 500;
const router = express.Router();

router.get('/:plural/:slug', async (req, res) => {
  const e = ENTITIES[req.params.plural];
  if (!e) throw notFound();
  const depth = intParam(req.query, 'depth', { min: 1, max: 4, fallback: 2 });
  const requested = listParam(req.query, 'types');

  const vocab = (await apiPool.query('SELECT code, category FROM relationship_types')).rows;
  let types;
  if (requested) {
    const unknown = requested.filter((t) => !vocab.some((v) => v.code === t));
    if (unknown.length) throw badRequest(`unknown relationship type(s): ${unknown.join(', ')}`);
    types = requested;
  } else {
    types = vocab.filter((v) => !['presence', 'association'].includes(v.category)).map((v) => v.code);
  }

  const found = await apiPool.query(`SELECT id FROM ${e.table} WHERE slug = $1`, [req.params.slug]);
  if (!found.rows.length) throw notFound(`no ${e.type} "${req.params.slug}"`);

  // Breadth-first walk. A recursive CTE may reference itself only once, so both directions go into a
  // LATERAL subquery. UNION (not UNION ALL) drops rows already produced, and the depth cap guarantees termination
  // even in cyclic data (A influenced B influenced A). min(depth) per node = its distance from the start.
  const { rows: [graph] } = await apiPool.query(`
    WITH RECURSIVE walk (type, id, depth) AS (
      SELECT $1::entity_type, $2::bigint, 0
      UNION
      SELECT n.type, n.id, w.depth + 1
      FROM walk w
      CROSS JOIN LATERAL (
        SELECT r.object_type, r.object_id FROM relationships r
         WHERE r.subject_type = w.type AND r.subject_id = w.id AND r.relationship_type = ANY ($4)
        UNION ALL
        SELECT r.subject_type, r.subject_id FROM relationships r
         WHERE r.object_type = w.type AND r.object_id = w.id AND r.relationship_type = ANY ($4)
      ) AS n (type, id)
      WHERE w.depth < $3
    ),
    nodes AS (
      SELECT type, id, min(depth) AS depth FROM walk GROUP BY type, id
      ORDER BY min(depth) LIMIT ${MAX_NODES}
    )
    SELECT
      (SELECT jsonb_agg(jsonb_build_object(
                'id', ei.type || '/' || ei.slug, 'type', ei.type, 'slug', ei.slug, 'name', ei.name,
                'kind', ei.kind, 'depth', n.depth, 'period', range_json(ei.period, ei.period_label))
              ORDER BY n.depth, ei.name)
         FROM nodes n JOIN entity_index ei ON ei.type = n.type AND ei.id = n.id) AS nodes,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'source', s.type || '/' || s.slug, 'target', o.type || '/' || o.slug,
                'type', rt.code, 'label', rt.label, 'category', rt.category, 'symmetric', rt.is_symmetric,
                'certainty', r.certainty, 'note', r.label, 'period', range_json(r.period, r.period_label))
              ORDER BY rt.sort_order, s.name), '[]')
         FROM relationships r
         JOIN relationship_types rt ON rt.code = r.relationship_type
         JOIN nodes n1 ON n1.type = r.subject_type AND n1.id = r.subject_id
         JOIN nodes n2 ON n2.type = r.object_type  AND n2.id = r.object_id
         JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
         JOIN entity_index o ON o.type = r.object_type  AND o.id = r.object_id
         WHERE r.relationship_type = ANY ($4)) AS edges`,
  [e.type, found.rows[0].id, depth, types]);

  res.json({
    root: `${e.type}/${req.params.slug}`, depth, types,
    truncated: graph.nodes.length >= MAX_NODES,
    nodes: graph.nodes, edges: graph.edges,
  });
});

module.exports = router;
