// Applies db/migrations/NNN_name.sql in order, each once, each in its own transaction.
// Runs as arthistory_owner (the only role allowed to change the schema).
//   npm run migrate                 # production DB (DB_NAME from env, default arthistory)
//   DB_NAME=arthistory_dev npm run migrate
//   npm run migrate -- --status     # list applied / pending
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

const DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  const client = new Client({ connectionString: config.db.ownerUrl, application_name: 'arthistory-migrate' });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Bookkeeping only — the app roles have no business here.
    await client.query('REVOKE ALL ON schema_migrations FROM arthistory_admin, arthistory_api');

    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const pending = files.filter((f) => !applied.has(f));

    console.log(`database: ${config.db.name} — ${applied.size} applied, ${pending.length} pending`);
    if (process.argv.includes('--status')) {
      files.forEach((f) => console.log(`  ${applied.has(f) ? '✓' : '·'} ${f}`));
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file}: ${err.message}${err.position ? ` (at char ${err.position})` : ''}`);
        process.exitCode = 1;
        return;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
