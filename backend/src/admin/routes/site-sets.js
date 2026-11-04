// Study sets on the site (migration 218, owner 2026-11-04): an account's own lists of entries of any type, and index
// cards to learn them. Mounted under /site/sets by routes/site-account.js — the site's origin only (CORS with
// credentials), writes only from the site's pages, the session's account in every query: a set is only ever its
// owner's. Writes are form posts (application/x-www-form-urlencoded: a "simple" request, no CORS preflight).
//   GET  /site/sets                       {sets: [{id, name, description, count, updated_at}]}
//   POST /site/sets                       name, description → {set}
//   GET  /site/sets/of?type=&slug=        {sets: [{id, name, has}]} — every set, and whether it holds this entry
//   GET  /site/sets/:id                   {set, items: [{type, slug, name, subtitle, image, own, added_at}]}
//   POST /site/sets/:id                   name, description → {set}
//   POST /site/sets/:id/delete            → 204
//   POST /site/sets/:id/items             type, slug → {count}   (adding twice changes nothing)
//   POST /site/sets/:id/items/remove      type, slug → {count}
//   GET  /site/sets/:id/cards             {set, cards: [card + progress {forward, reverse}]} (src/study.js)
//   POST /site/sets/progress              type, slug, direction (forward|reverse), known (1|0) → {box}
const express = require('express');
const { adminPool } = require('../../db');
const { adminOrigin } = require('../auth');
const { cards } = require('../../study');

const router = express.Router();
const ID = /^[1-9][0-9]{0,17}$/;
const TYPES = ['artwork', 'artist', 'person', 'institution', 'event', 'movement', 'place', 'polity', 'literature', 'term', 'source'];
const MAX_SETS = 300;
const MAX_ITEMS = 3000;

router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  res.set('Cache-Control', 'no-store');
  next();
});
const fail = (res, status, error) => res.status(status).json({ error });
const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
/** The account's set `id`, or null. */
async function ownSet(req) {
  if (!ID.test(req.params.id)) return null;
  const { rows } = await adminPool.query('SELECT id, name, description, created_at, updated_at FROM study_sets WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  return rows[0] || null;
}
/** type + slug → the entry's id (entity_index), or null */
async function entryId(type, slug) {
  if (!TYPES.includes(type) || typeof slug !== 'string' || !slug) return null;
  const { rows } = await adminPool.query('SELECT id FROM entity_index WHERE type = $1::entity_type AND slug = $2', [type, slug]);
  return rows[0] ? rows[0].id : null;
}
const countOf = async (setId) => (await adminPool.query('SELECT count(*)::int AS n FROM study_set_items WHERE set_id = $1', [setId])).rows[0].n;

router.get('/', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT s.id, s.name, s.description, s.updated_at, count(i.*)::int AS count
    FROM study_sets s LEFT JOIN study_set_items i ON i.set_id = s.id WHERE s.owner_id = $1
    GROUP BY s.id ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id]);
  res.json({ sets: rows });
});

router.post('/', async (req, res) => {
  const name = text(req.body.name, 120);
  if (!name) return fail(res, 422, 'a set needs a name');
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_sets WHERE owner_id = $1', [req.user.id]);
  if (n >= MAX_SETS) return fail(res, 422, `at most ${MAX_SETS} sets`);
  const { rows: [set] } = await adminPool.query(`INSERT INTO study_sets (owner_id, name, description) VALUES ($1, $2, $3)
    RETURNING id, name, description, created_at, updated_at`, [req.user.id, name, text(req.body.description, 2000) || null]);
  res.status(201).json({ set: { ...set, count: 0 } });
});

// the answer to one card (Leitner): known → one box up (at most 5), not known → back to box 1
router.post('/progress', async (req, res) => {
  const direction = req.body.direction === 'reverse' ? 'reverse' : req.body.direction === 'forward' ? 'forward' : null;
  const id = await entryId(req.body.type, req.body.slug);
  if (!direction || !id) return fail(res, 422, 'which card?');
  const known = req.body.known === '1' || req.body.known === 'true';
  const { rows: [p] } = await adminPool.query(`INSERT INTO study_progress AS p (owner_id, entity_type, entity_id, direction, box, seen, known)
      VALUES ($1, $2::entity_type, $3, $4, CASE WHEN $5 THEN 2 ELSE 1 END, 1, CASE WHEN $5 THEN 1 ELSE 0 END)
    ON CONFLICT (owner_id, entity_type, entity_id, direction) DO UPDATE SET
      box = CASE WHEN $5 THEN least(p.box + 1, 5) ELSE 1 END, seen = p.seen + 1, known = p.known + (CASE WHEN $5 THEN 1 ELSE 0 END), last_seen_at = now()
    RETURNING box, seen, known`, [req.user.id, req.body.type, id, direction, known]);
  res.json(p);
});

router.get('/of', async (req, res) => {
  const id = await entryId(String(req.query.type || ''), String(req.query.slug || ''));
  if (!id) return fail(res, 404, 'not_found');
  const { rows } = await adminPool.query(`SELECT s.id, s.name, EXISTS (SELECT 1 FROM study_set_items i WHERE i.set_id = s.id
      AND i.entity_type = $2::entity_type AND i.entity_id = $3) AS has
    FROM study_sets s WHERE s.owner_id = $1 ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id, req.query.type, id]);
  res.json({ sets: rows });
});

router.get('/:id', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  // its entries as the lists show them (entry_previews: name, the line under it, a picture; an artwork without a public
  // picture: this account's reference image) — those deleted since are left out
  const { rows } = await adminPool.query(`SELECT i.entity_type::text AS type, e.slug, coalesce(p.name, e.name) AS name, p.subtitle, p.image_url AS image,
      CASE WHEN i.entity_type = 'artwork' AND p.image_url IS NULL THEN (SELECT x.id FROM private_images x WHERE x.artwork_id = i.entity_id AND x.owner_id = $2
        ORDER BY x.position, x.id LIMIT 1) END AS own_image, i.added_at
    FROM study_set_items i JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id)
    LEFT JOIN entry_previews p ON (p.type, p.slug) = (e.type, e.slug)
    WHERE i.set_id = $1 ORDER BY i.added_at, e.slug`, [set.id, req.user.id]);
  const origin = adminOrigin(req);
  res.json({ set: { ...set, count: rows.length }, items: rows.map(({ own_image: own, ...r }) => (own ? { ...r, image: `${origin}/private-images/${own}?w=250`, own: true } : { ...r, own: false })) });
});

router.post('/:id', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const name = text(req.body.name ?? set.name, 120);
  if (!name) return fail(res, 422, 'a set needs a name');
  const description = req.body.description === undefined ? set.description : text(req.body.description, 2000) || null;
  const { rows: [s] } = await adminPool.query('UPDATE study_sets SET name = $3, description = $4 WHERE id = $1 AND owner_id = $2 RETURNING id, name, description, created_at, updated_at',
    [set.id, req.user.id, name, description]);
  res.json({ set: s });
});

router.post('/:id/delete', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  await adminPool.query('DELETE FROM study_sets WHERE id = $1 AND owner_id = $2', [set.id, req.user.id]);
  res.status(204).end();
});

router.post('/:id/items', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const id = await entryId(req.body.type, req.body.slug);
  if (!id) return fail(res, 422, 'no such entry');
  if (await countOf(set.id) >= MAX_ITEMS) return fail(res, 422, `at most ${MAX_ITEMS} entries in a set`);
  await adminPool.query('INSERT INTO study_set_items (set_id, entity_type, entity_id) VALUES ($1, $2::entity_type, $3) ON CONFLICT DO NOTHING', [set.id, req.body.type, id]);
  res.json({ count: await countOf(set.id) });
});

router.post('/:id/items/remove', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const id = await entryId(req.body.type, req.body.slug);
  if (id) await adminPool.query('DELETE FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]);
  res.json({ count: await countOf(set.id) });
});

router.get('/:id/cards', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { rows: entries } = await adminPool.query(`SELECT i.entity_type::text AS type, i.entity_id AS id,
      (SELECT jsonb_object_agg(p.direction, jsonb_build_object('box', p.box, 'seen', p.seen, 'known', p.known))
         FROM study_progress p WHERE p.owner_id = $2 AND (p.entity_type, p.entity_id) = (i.entity_type, i.entity_id)) AS progress
    FROM study_set_items i WHERE i.set_id = $1 ORDER BY i.added_at`, [set.id, req.user.id]);
  const progress = new Map(entries.map((e) => [`${e.type}:${e.id}`, e.progress || {}]));
  const list = await cards(adminPool, entries, req.user.id, adminOrigin(req));
  res.json({ set, cards: list.map(({ key, ...c }) => ({ ...c, progress: progress.get(key) || {} })) });
});

module.exports = router;
