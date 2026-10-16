// Network questions (migration 088), over graph_links = the edges view stored:
//   GET /v1/network/path?from=<entry>&to=<entry>[&via=person,artist&max=6]  shortest chain of relationships
//   GET /v1/network/hands?from=1933&to=1945                                through whose hands works went then
//   GET /v1/network/shared-hands?artwork=<entry>[&depth=2&current=1]       works that went through the same hands
// An <entry> is its public number (100476 — numbers are unique across types) or <plural>/<slug or number>.
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound, intParam, yearWindowRange, listParam } = require('../http');
const { ENTITIES } = require('./entities');

const router = express.Router();
const PLURAL = Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [v.type, k]));
const VIA_TYPES = ['artist', 'artwork', 'institution', 'person', 'event', 'movement', 'place', 'polity', 'term', 'source'];

async function resolve(key, name) {
  const s = typeof key === 'string' ? key.trim().replace(/^\/+|\/+$/g, '') : '';
  if (!s) throw badRequest(`${name}: an entry — its number (100476) or <plural>/<slug>`);
  let row;
  if (/^\d{1,15}$/.test(s)) {
    ({ rows: [row] } = await apiPool.query(`SELECT e.type::text AS type, e.id FROM entry_by_public_id($1) b
      JOIN entity_index e ON (e.type, e.slug) = (b.type, b.slug)`, [s]));
  } else {
    const [plural, k] = s.split('/');
    const e = ENTITIES[plural];
    if (!e || !k) throw badRequest(`${name}: an entry — its number (100476) or <plural>/<slug>`);
    ({ rows: [row] } = await apiPool.query(`SELECT type::text AS type, id FROM entity_index
      WHERE type = $1 AND (slug = $2 OR ($2 ~ '^\\d{1,15}$' AND public_id = $2::bigint)) ORDER BY slug = $2 DESC LIMIT 1`, [e.type, k]));
  }
  if (!row) throw notFound(`${name}: no entry "${s}"`);
  return { type: row.type, id: Number(row.id) };
}

// (type, id) pairs → references as everywhere in the API: { type, slug, public_id, name, kind, period, path }
async function refs(pairs) {
  const keys = [...new Map(pairs.filter((p) => p && p.id != null).map((p) => [`${p.type}:${p.id}`, p])).values()];
  if (!keys.length) return new Map();
  const { rows } = await apiPool.query(`
    SELECT e.type::text AS type, e.id, e.slug, e.public_id, e.name, e.kind, range_json(e.period, e.period_label) AS period
    FROM unnest($1::entity_type[], $2::bigint[]) k(t, i) JOIN entity_index e ON (e.type, e.id) = (k.t, k.i)`,
  [keys.map((k) => k.type), keys.map((k) => k.id)]);
  return new Map(rows.map(({ id, ...r }) => [`${r.type}:${id}`, {
    ...r, public_id: Number(r.public_id), path: `/${PLURAL[r.type]}/${r.public_id}/${r.slug}` }]));
}
const refOf = (map, type, id) => map.get(`${type}:${id}`) || null;

router.get('/path', async (req, res) => {
  const [from, to] = [await resolve(req.query.from, 'from'), await resolve(req.query.to, 'to')];
  const via = listParam(req.query, 'via') || ['artist', 'artwork', 'institution', 'person', 'event', 'movement'];
  const bad = via.filter((t) => !VIA_TYPES.includes(t));
  if (bad.length) throw badRequest(`via: types are ${VIA_TYPES.join(', ')}`);
  const max = intParam(req.query, 'max', { min: 1, max: 10, fallback: 6 });
  const { rows } = await apiPool.query(`
    SELECT p.a_type::text AS a_type, p.a_id, p.b_type::text AS b_type, p.b_id, p.relationship_type, p.forward,
           range_json(p.period, p.period_label) AS period, p.label, p.certainty, p.provenance_id,
           CASE WHEN p.forward THEN rt.label ELSE coalesce(rt.inverse_label, rt.label) END AS reads
    FROM entry_path($1, $2, $3, $4, $5::entity_type[], $6) p
    LEFT JOIN relationship_types rt ON rt.code = p.relationship_type
    ORDER BY p.step`, [from.type, from.id, to.type, to.id, via, max]);
  const m = await refs([from, to, ...rows.flatMap((r) => [{ type: r.a_type, id: r.a_id }, { type: r.b_type, id: r.b_id }])]);
  res.json({
    from: refOf(m, from.type, from.id), to: refOf(m, to.type, to.id),
    found: rows.length > 0 || (from.type === to.type && from.id === to.id),
    length: rows.length,
    // each step reads "<from> <reads> <to>": "La Petite Irène — owned by → Emil Bührle"
    steps: rows.map((r) => ({
      from: refOf(m, r.a_type, r.a_id), to: refOf(m, r.b_type, r.b_id), relationship_type: r.relationship_type,
      reads: r.reads, forward: r.forward, period: r.period, note: r.label, certainty: r.certainty,
      provenance_id: r.provenance_id && Number(r.provenance_id) })),
  });
});

router.get('/hands', async (req, res) => {
  const win = yearWindowRange(req.query);
  if (!win) throw badRequest('a window: ?from=1933&to=1945');
  const { rows: [{ n }] } = await apiPool.query('SELECT hands_network($1::daterange) AS n', [win]);
  const m = await refs([
    ...n.holders.flatMap((h) => [{ type: h.type, id: h.id }, ...h.artworks.map((id) => ({ type: 'artwork', id }))]),
    ...n.handovers.flatMap((x) => [{ type: x.from_type, id: x.from_id }, { type: x.to_type, id: x.to_id }])]);
  res.json({
    holders: n.holders.map((h) => ({ holder: refOf(m, h.type, h.id), roles: h.roles, flag: h.flag,
      artworks: h.artworks.map((id) => refOf(m, 'artwork', id)) })),
    handovers: n.handovers.map((x) => ({ from: refOf(m, x.from_type, x.from_id), to: refOf(m, x.to_type, x.to_id),
      artwork: refOf(m, 'artwork', x.artwork_id), period: x.period, note: x.label, certainty: x.certainty,
      provenance_id: x.provenance_id })),
  });
});

router.get('/shared-hands', async (req, res) => {
  const w = await resolve(req.query.artwork, 'artwork');
  if (w.type !== 'artwork') throw badRequest('artwork: an artwork');
  const depth = intParam(req.query, 'depth', { min: 1, max: 4, fallback: 2 });
  const current = ['1', 'true'].includes(String(req.query.current));
  const { rows } = await apiPool.query(`SELECT artwork_id, depth, via_artwork_id, holders, together
    FROM shared_hands($1, $2, $3) ORDER BY depth, artwork_id`, [w.id, depth, current]);
  const m = await refs([w, ...rows.flatMap((r) => [{ type: 'artwork', id: r.artwork_id }, { type: 'artwork', id: r.via_artwork_id },
    ...r.holders.map((h) => ({ type: h.type, id: h.id }))])]);
  const data = rows.map((r) => ({ artwork: refOf(m, 'artwork', r.artwork_id), depth: r.depth,
    via: refOf(m, 'artwork', r.via_artwork_id), together: r.together,
    holders: r.holders.map((h) => ({ ...refOf(m, h.type, h.id), together: h.together })) }));
  data.sort((a, b) => a.depth - b.depth || b.holders.length - a.holders.length || Number(b.together) - Number(a.together));
  res.json({ artwork: refOf(m, w.type, w.id), data });
});

module.exports = router;
