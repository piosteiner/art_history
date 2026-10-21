// npm run perf — the time budgets (perf/budgets.json) checked on scale_test, ten times today's data
// (perf/make-scale-db.sh). Migrates scale_test to this checkout, starts a server of it on scale_test (port 3015, never the live process), waits
// until its worker has every derived row current, then times the API's heavy requests (a first request, then the
// median of three), whole lists, one change through the worker and the global part. Exit code 1 if a budget is
// exceeded or a request fails. Takes a few minutes; run it before deploying changes to queries, views or the worker.
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

process.env.DB_NAME = 'scale_test';
const BACKEND = path.join(__dirname, '..');
const config = require('../src/config');
const { Client } = require('pg');
const budgets = require('./budgets.json');

const PORT = 3015;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function get(p) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.get({ host: '127.0.0.1', port: PORT, path: `/v1${p}`, headers: { Host: 'api.localhost' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
  });
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function until(what, test, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (!(await test())) {
    if (Date.now() > end) throw new Error(`gave up waiting: ${what}`);
    await sleep(1000);
  }
}

async function main() {
  // the schema of this checkout first (a budget measured on an older schema says nothing)
  execFileSync(process.execPath, ['scripts/migrate.js'], { cwd: BACKEND, env: { ...process.env, DB_NAME: 'scale_test' }, stdio: 'inherit' });
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND,
    env: { ...process.env, DB_NAME: 'scale_test', PORT: String(PORT), NODE_ENV: 'development', DB_ADMIN_POOL_MAX: '2', DB_API_POOL_MAX: '4' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const db = new Client({ connectionString: config.db.adminUrl, application_name: 'arthistory-perf' });
  const results = [];
  const check = (group, name, ms, budget, note = '') => results.push({ group, name, ms: Math.round(ms), budget, ok: ms <= budget, note });
  try {
    await until('the server', async () => (await get('/health').catch(() => ({ status: 0 }))).status === 200, 30000);
    await db.connect();
    const pending = async () => Number((await db.query('SELECT (SELECT count(*) FROM derived_queue) + (SELECT count(*) FROM list_queue) AS n')).rows[0].n);
    const fresh = async () => (await db.query('SELECT quality_fresh() AS f')).rows[0].f;
    process.stdout.write('waiting for the worker (derived data, list rows) … ');
    await until('derived data current', fresh, 20 * 60000);
    console.log('current');

    for (const [name, r] of Object.entries(budgets.requests)) {
      const first = await get(r.path);
      const times = [];
      for (let i = 0; i < 3; i++) times.push((await get(r.path)).ms);
      const failed = [first, ...times].some((x) => x.status !== undefined && x.status !== 200);
      const status = (await get(r.path)).status;
      check('request', name, median(times), r.budget, `first ${Math.round(first.ms)} ms${status !== 200 ? ` · HTTP ${status}` : ''}`);
      if (status !== 200 || failed) results[results.length - 1].ok = false;
    }
    // a whole list, page after page — three times, the median (one pass can meet the worker's global part)
    const wholeList = async (plural) => {
      let ms = 0; let n = 0; let total = Infinity;
      for (let offset = 0; offset < total; offset += 500) {
        const res = await get(`/${plural}?limit=500&offset=${offset}`);
        if (res.status !== 200) return { ms: Infinity, n };
        const body = JSON.parse(res.body);
        ms += res.ms; total = body.total; n += body.data.length;
      }
      return { ms, n };
    };
    for (const [plural, budget] of Object.entries(budgets.lists)) {
      if (plural === '_') continue;
      const passes = [await wholeList(plural), await wholeList(plural), await wholeList(plural)];
      check('whole list', plural, median(passes.map((x) => x.ms)), budget, `${passes[0].n} entries`);
    }
    // one change: an artist renamed (and back next run) — until the worker has every derived row current again
    await until('queues empty', async () => (await pending()) === 0, 60000);
    const t0 = Date.now();
    await db.query(`UPDATE artists SET name = CASE WHEN name LIKE '% ·' THEN left(name, -2) ELSE name || ' ·' END
                    WHERE id = (SELECT id FROM artists ORDER BY id LIMIT 1)`);
    await until('the change worked off', async () => (await pending()) === 0, 120000);
    check('worker', 'one change, until every derived row is current', Date.now() - t0, budgets.worker['one change, until every derived row is current']);
    const g0 = Date.now();
    await db.query('SELECT refresh_quality_global()');
    check('worker', 'global part (refresh_quality_global)', Date.now() - g0, budgets.worker['global part (refresh_quality_global)']);
  } finally {
    await db.end().catch(() => {});
    server.kill();
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.group.padEnd(10)} ${r.name.padEnd(width)} ${String(r.ms).padStart(7)} ms  (budget ${r.budget})  ${r.note}`);
  }
  const over = results.filter((r) => !r.ok);
  console.log(over.length ? `✗ ${over.length} over budget` : `✓ all ${results.length} within budget`);
  process.exitCode = over.length ? 1 : 0;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
