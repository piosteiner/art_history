// The project's numbers day by day (migration 138, table site_stats; API /v1/stats; site /statistik). The database
// counts its own (record_site_stats(): entries per kind, provenance steps, citations, images, migrations); the app adds
// what lives in files — the tests, counted as their definitions (test(…) in the backend's unit and end-to-end tests and
// the site's) — and the words of the documentation. Today's values are rewritten at start and every hour, so the last
// one of a day stays.
const fs = require('fs');
const path = require('path');
const { words } = require('./pages');

const ROOT = path.join(__dirname, '..', '..');   // the repository
const TEST = /^\s*test\(/gm;
// metric → the folder and file ending of its tests
const TEST_SETS = {
  'tests.backend_unit': ['backend/test', '.test.js'],
  'tests.backend_e2e': ['backend/test/e2e', '.spec.js'],
  'tests.site': ['frontend/tests', '.spec.ts'],
};
const countTests = (text) => (text.match(TEST) || []).length;

function testCounts() {
  const out = {};
  for (const [metric, [dir, ending]] of Object.entries(TEST_SETS)) {
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ending)); } catch { continue; }
    out[metric] = files.reduce((n, f) => n + countTests(fs.readFileSync(path.join(ROOT, dir, f), 'utf8')), 0);
  }
  return out;
}

async function record(pool) {
  await pool.query('SELECT record_site_stats()');
  const extra = testCounts();
  const doc = (await pool.query("SELECT body_md FROM pages WHERE slug = 'projekt-dokumentation'")).rows[0];
  if (doc) extra['documentation.words'] = words(doc.body_md);
  for (const [metric, value] of Object.entries(extra)) {
    await pool.query(`INSERT INTO site_stats (metric, day, value) VALUES ($1, current_date, $2)
      ON CONFLICT (metric, day) DO UPDATE SET value = EXCLUDED.value`, [metric, value]);
  }
}

// at server start (src/server.js) and then hourly
function start(pool) {
  const run = () => record(pool).catch((err) => console.error('stats:', err.message));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { start, record, testCounts, countTests, TEST_SETS };
