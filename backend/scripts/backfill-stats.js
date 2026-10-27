// Once, after migration 138: the numbers the database can't count back by itself, for every past day —
//   tests.*              the test definitions in the repository at the last commit of that day (git history)
//   documentation.words  the documentation's text at the end of that day (the page's history, audit_log)
// Existing days are kept (ON CONFLICT DO NOTHING); today is src/stats.js's.   DB_NAME=… node scripts/backfill-stats.js
const { execFileSync } = require('child_process');
const path = require('path');
const { adminPool } = require('../src/db');
const { words } = require('../src/pages');
const { TEST_SETS, countTests } = require('../src/stats');

const ROOT = path.join(__dirname, '..', '..');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const day = (d) => d.toISOString().slice(0, 10);

(async () => {
  const first = git('log', '--reverse', '--format=%cs').split('\n')[0];
  const today = day(new Date());
  const rows = [];
  for (let d = new Date(`${first}T12:00:00Z`); day(d) < today; d.setUTCDate(d.getUTCDate() + 1)) {
    const commit = git('rev-list', '-1', `--before=${day(d)} 23:59:59`, 'HEAD').trim();
    if (!commit) continue;
    const files = git('ls-tree', '-r', '--name-only', commit, '--', 'backend/test', 'frontend/tests').split('\n').filter(Boolean);
    for (const [metric, [dir, ending]] of Object.entries(TEST_SETS)) {
      const mine = files.filter((f) => path.dirname(f) === dir && f.endsWith(ending));
      if (!mine.length) continue;
      const n = mine.reduce((sum, f) => sum + countTests(git('show', `${commit}:${f}`)), 0);
      rows.push([metric, day(d), n]);
    }
  }
  // the documentation: its text after the last change of each day
  const { rows: revs } = await adminPool.query(`SELECT DISTINCT ON (changed_at::date) changed_at::date::text AS day, new_row->>'body_md' AS body
    FROM audit_log WHERE table_name = 'pages' AND row_id = (SELECT id FROM pages WHERE slug = 'projekt-dokumentation') AND new_row IS NOT NULL
    ORDER BY changed_at::date, id DESC`);
  let last = null;
  const byDay = new Map(revs.map((r) => [r.day, r.body]));
  if (revs.length) {
    for (let d = new Date(`${revs[0].day}T12:00:00Z`); day(d) < today; d.setUTCDate(d.getUTCDate() + 1)) {
      if (byDay.has(day(d))) last = byDay.get(day(d));
      if (last) rows.push(['documentation.words', day(d), words(last)]);
    }
  }
  let n = 0;
  for (const [metric, d, value] of rows) {
    n += (await adminPool.query('INSERT INTO site_stats (metric, day, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [metric, d, value])).rowCount;
  }
  console.log(`${n} values written (${rows.length} computed)`);
  await adminPool.end();
})().catch((e) => { console.error(e); process.exit(1); });
