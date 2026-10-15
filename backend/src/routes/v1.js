const express = require('express');
const { apiPool } = require('../db');
const { router: entities } = require('./entities');
const map = require('./map');
const graph = require('./graph');
const { renderMarkdown, linkNames } = require('../markdown');
const { badRequest, notFound } = require('../http');

const router = express.Router();

// Content changes rarely (import / admin edits): let browsers and nginx reuse responses for a minute.
// Express adds a weak ETag, so revalidation after that is a cheap 304.
router.use((req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'public, max-age=60');
  next();
});

router.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await apiPool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('health: db check failed:', err.message);
    res.status(503).json({ status: 'degraded', db: 'unavailable' });
  }
});

// The relationship vocabulary: labels, categories (map/graph layers), allowed entity types.
router.get('/vocabulary', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT code, label, inverse_label, category, is_physical_presence, is_symmetric,
           subject_types::text[] AS subject_types, object_types::text[] AS object_types, description, derived
    FROM relationship_types ORDER BY sort_order`);
  res.json({ data: rows });
});

// One search box for everything: ?q=hokusai → best matches across all entity types.
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) return res.json({ data: [] });
  const { rows } = await apiPool.query(`
    SELECT type, slug, name, kind, range_json(period, period_label) AS period, sort_key,
           round(greatest(word_similarity(f_unaccent($1), f_unaccent(name)),
                          0.9 * word_similarity(f_unaccent($1), f_unaccent(coalesce(alt_text, ''))))::numeric, 2) AS score
    FROM entity_index
    WHERE f_unaccent(name) ILIKE f_unaccent($2) OR f_unaccent($1) <% f_unaccent(name)
       OR f_unaccent(coalesce(alt_text, '')) ILIKE f_unaccent($2) OR f_unaccent($1) <% f_unaccent(coalesce(alt_text, ''))
    ORDER BY score DESC, sort_key COLLATE sort_natural
    LIMIT 20`, [q, `%${q.replace(/[\\%_]/g, '\\$&')}%`]);
  res.json({ data: rows });
});

// Curated start views (migration 069): published ones, in their order. The query read through
// current_featured_query(), so a view follows renamed and merged entries even before it is saved again.
router.get('/featured', async (req, res) => {
  const { rows } = await apiPool.query(`
    SELECT slug, title, intro_md, current_featured_query(query) AS query
    FROM featured_views WHERE published ORDER BY sort_order, title COLLATE sort_natural, slug`);
  const env = { names: await linkNames(apiPool, rows.map((r) => r.intro_md)), used: new Set(), cited: new Set() };
  res.json({ data: rows.map(({ intro_md: md, ...v }) => ({ ...v, intro_html: md ? renderMarkdown(md, env) : null })) });
});

// Short addresses for long selections on the start map (migration 072): the site stores its query once it gets long
// and shows /?v=<code>. The code comes from the query's hash: the same selection, the same code. The API's role is
// read-only by default (setup-roles.sql); storing opens its transaction READ WRITE — the role may insert only here.
const MAX_QUERY = 20000;
const recent = new Map();  // ip → [timestamps]: at most 60 new links per 10 minutes and address
function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 600000);
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();  // a crude bound on memory
  return list.length > 60;
}
// The query in one form: the site's own switches out, keys sorted (so the same view gives the same code), values
// limited to what the site writes (slugs, commas, numbers, none / by-artists).
function canonicalQuery(text) {
  const params = new URLSearchParams(String(text || '').trim().replace(/^\?/, ''));
  const parts = [];
  for (const [k, v] of params) {
    if (['v', 'featured', 'all'].includes(k)) continue;
    if (!/^[a-z_]{1,24}$/.test(k) || !/^[a-z0-9,._:-]*$/i.test(v)) throw badRequest(`not a query of the site: "${k}"`);
    parts.push(`${k}=${v}`);
  }
  const q = parts.sort().join('&');
  if (!q) throw badRequest('an empty query needs no short address');
  if (q.length > MAX_QUERY) throw badRequest('query too long');
  return q;
}
router.post('/views', express.text({ type: '*/*', limit: '24kb' }), async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'too_many', message: 'too many new links — try again in a few minutes' });
  const q = canonicalQuery(req.body);
  const client = await apiPool.connect();
  try {
    await client.query('BEGIN READ WRITE');
    const { rows: [r] } = await client.query('SELECT save_shared_view($1) AS id', [q]);
    await client.query('COMMIT');
    res.status(201).json({ id: r.id, query: q });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
router.get('/views/:id', async (req, res) => {
  if (!/^[0-9a-f]{8,64}$/.test(req.params.id)) throw notFound('no such view');
  const { rows: [v] } = await apiPool.query('SELECT id, current_featured_query(query) AS query, last_used < current_date AS stale FROM shared_views WHERE id = $1', [req.params.id]);
  if (!v) throw notFound('no such view');
  if (v.stale) {  // remember that it is still used (once a day)
    apiPool.connect().then(async (c) => {
      try { await c.query('BEGIN READ WRITE'); await c.query('UPDATE shared_views SET last_used = current_date WHERE id = $1', [v.id]); await c.query('COMMIT'); } catch { await c.query('ROLLBACK').catch(() => {}); } finally { c.release(); }
    }).catch(() => {});
  }
  res.json({ id: v.id, query: v.query });
});

// Patrons became people (migration 024): old URLs keep working — /v1/patrons…, /v1/map/patrons/…, /v1/graph/patrons/…
router.use((req, res, next) => {
  const m = /^(\/(?:map\/|graph\/)?)patrons(\/.*)?$/.exec(req.path);
  if (!m) return next();
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  return res.redirect(301, `${req.baseUrl}${m[1]}people${m[2] || ''}${query}`);
});

router.use('/map', map);
router.use('/graph', graph);
router.use(entities);

module.exports = router;
