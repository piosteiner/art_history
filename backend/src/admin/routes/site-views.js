// An account's own start-map views (migration 227, owner 2026-11-05). Mounted under /site/views by
// routes/site-account.js — the site's origin only, form posts, the session's account in every query.
//   GET  /site/views              {views: [{id, name, description, description_html, query, created_at, updated_at}]}
//   POST /site/views              name, description, query → 201 {view}
//   POST /site/views/:id          name, description and/or query → {view}
//   POST /site/views/:id/delete   → 204
// The description is Markdown like a set's (src/markdown.js; preview: POST /site/sets/preview).
const express = require('express');
const { adminPool } = require('../../db');
const { renderMarkdown, linkNames } = require('../../markdown');

const router = express.Router();
const ID = /^[1-9][0-9]{0,17}$/;
const MAX_VIEWS = 200;
const { fail } = require('../site-http');
const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
// the start map's own query, nothing else: no address of another site, no script — its keys as the site writes them
const cleanQuery = (q) => {
  const p = new URLSearchParams(String(q ?? '').replace(/^\?/, ''));
  for (const k of ['v', 'featured', 'mine', 'all']) p.delete(k);
  const s = p.toString();
  return s.length <= 4000 ? s : null;
};
const COLS = 'id::text AS id, name, description, query, created_at, updated_at';

router.use((req, res, next) => (req.user ? (res.set('Cache-Control', 'no-store'), next()) : fail(res, 401, 'not_logged_in')));

async function rendered(views) {
  const env = { names: await linkNames(adminPool, views.map((v) => v.description)), used: new Set(), cited: new Set() };
  return views.map((v) => ({ ...v, description_html: v.description ? renderMarkdown(v.description, env) : null }));
}

router.get('/', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT ${COLS} FROM account_views WHERE owner_id = $1 ORDER BY updated_at DESC, id DESC`, [req.user.id]);
  res.json({ views: await rendered(rows) });
});

router.post('/', async (req, res) => {
  const name = text(req.body.name, 120);
  const query = cleanQuery(req.body.query);
  if (!name) return fail(res, 422, 'a view needs a name');
  if (query === null) return fail(res, 422, 'this selection is too long to save');
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM account_views WHERE owner_id = $1', [req.user.id]);
  if (n >= MAX_VIEWS) return fail(res, 422, `at most ${MAX_VIEWS} views`);
  const { rows: [v] } = await adminPool.query(`INSERT INTO account_views (owner_id, name, description, query) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
    [req.user.id, name, text(req.body.description, 10000) || null, query]);
  res.status(201).json({ view: (await rendered([v]))[0] });
});

router.post('/:id', async (req, res) => {
  if (!ID.test(req.params.id)) return fail(res, 404, 'not_found');
  const { rows: [old] } = await adminPool.query(`SELECT ${COLS} FROM account_views WHERE id = $1 AND owner_id = $2`, [req.params.id, req.user.id]);
  if (!old) return fail(res, 404, 'not_found');
  const name = req.body.name === undefined ? old.name : text(req.body.name, 120);
  const description = req.body.description === undefined ? old.description : text(req.body.description, 10000) || null;
  const query = req.body.query === undefined ? old.query : cleanQuery(req.body.query);
  if (!name) return fail(res, 422, 'a view needs a name');
  if (query === null) return fail(res, 422, 'this selection is too long to save');
  const { rows: [v] } = await adminPool.query(`UPDATE account_views SET name = $3, description = $4, query = $5 WHERE id = $1 AND owner_id = $2 RETURNING ${COLS}`,
    [old.id, req.user.id, name, description, query]);
  res.json({ view: (await rendered([v]))[0] });
});

router.post('/:id/delete', async (req, res) => {
  if (!ID.test(req.params.id)) return fail(res, 404, 'not_found');
  await adminPool.query('DELETE FROM account_views WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  res.status(204).end();
});

module.exports = router;
