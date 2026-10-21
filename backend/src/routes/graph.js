// GET /v1/graph/<plural>/:slug?depth=2&types=influenced_by,student_of
//
// The network around one entity, following edges in BOTH directions up to `depth` hops, as nodes + edges
// (ready for a force-directed graph). Default: every non-geographic relationship type; places are map material.
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound, intParam, listParam } = require('../http');
const { ENTITIES, edgeCategory } = require('./entities');

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

  // An artwork depicting another artwork or an event is a depiction like a portrait: stored as `depicts` (whose
  // places are map material, category association), it joins the graph — as category depiction — whenever the
  // depictions of people do (by default, or with types=depicts_person).
  const depicted = types.includes('depicts_person') && !types.includes('depicts');
  const inGraph = (r) => `(${r}.relationship_type = ANY ($4) OR ($5 AND ${r}.relationship_type = 'depicts' AND ${r}.object_type <> 'place'))`;

  const found = await apiPool.query(`SELECT id FROM ${e.table} WHERE slug = $1`, [req.params.slug]);
  if (!found.rows.length) throw notFound(`no ${e.type} "${req.params.slug}"`);

  // graph_links = the edges view (031) stored and kept up to date per change (088/126): the stored relationships +
  // derived ones: each artwork's main creator (029) and the
  // provenance (owned_by, kept_in, transferred_to).
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
        SELECT r.object_type, r.object_id FROM graph_links r
         WHERE r.subject_type = w.type AND r.subject_id = w.id AND ${inGraph('r')}
        UNION ALL
        SELECT r.subject_type, r.subject_id FROM graph_links r
         WHERE r.object_type = w.type AND r.object_id = w.id AND ${inGraph('r')}
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
              ORDER BY n.depth, ei.sort_key COLLATE sort_natural)
         FROM nodes n JOIN entity_index ei ON ei.type = n.type AND ei.id = n.id) AS nodes,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'source', s.type || '/' || s.slug, 'target', o.type || '/' || o.slug,
                'type', rt.code, 'label', rt.label, 'symmetric', rt.is_symmetric,
                'category', ${edgeCategory('r', 'rt')},
                'certainty', r.certainty, 'note', r.label, 'period', range_json(r.period, r.period_label),
                'derived', r.source <> 'relationship', 'end_basis', r.end_basis)
              ORDER BY rt.sort_order, s.sort_key COLLATE sort_natural), '[]')
         FROM graph_links r
         JOIN relationship_types rt ON rt.code = r.relationship_type
         JOIN nodes n1 ON n1.type = r.subject_type AND n1.id = r.subject_id
         JOIN nodes n2 ON n2.type = r.object_type  AND n2.id = r.object_id
         JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
         JOIN entity_index o ON o.type = r.object_type  AND o.id = r.object_id
         WHERE ${inGraph('r')}) AS edges`,
  [e.type, found.rows[0].id, depth, types, depicted]);

  res.json({
    root: `${e.type}/${req.params.slug}`, depth, types,
    truncated: graph.nodes.length >= MAX_NODES,
    nodes: graph.nodes, edges: graph.edges,
  });
});

module.exports = router;
