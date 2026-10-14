const express = require('express');
const { apiPool } = require('../db');
const { router: entities } = require('./entities');
const map = require('./map');
const graph = require('./graph');
const { renderMarkdown, linkNames } = require('../markdown');

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
