const express = require('express');
const { apiPool } = require('../db');
const { router: entities } = require('./entities');
const map = require('./map');
const graph = require('./graph');

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
           subject_types::text[] AS subject_types, object_types::text[] AS object_types, description
    FROM relationship_types ORDER BY sort_order`);
  res.json({ data: rows });
});

// One search box for everything: ?q=hokusai → best matches across all entity types.
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) return res.json({ data: [] });
  const { rows } = await apiPool.query(`
    SELECT type, slug, name, kind, range_json(period, period_label) AS period,
           round(word_similarity(f_unaccent($1), f_unaccent(name))::numeric, 2) AS score
    FROM entity_index
    WHERE f_unaccent(name) ILIKE f_unaccent($2) OR f_unaccent($1) <% f_unaccent(name)
    ORDER BY score DESC, name
    LIMIT 20`, [q, `%${q.replace(/[\\%_]/g, '\\$&')}%`]);
  res.json({ data: rows });
});

router.use('/map', map);
router.use('/graph', graph);
router.use(entities);

module.exports = router;
