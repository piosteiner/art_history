// Accounts for the test environment (migration 222): made on production's Accounts page, they log in only on the test
// hosts. sync(id) copies the account as it now is in production — username, password hash, role, public name, note,
// switched off — to the test database (cluster 18/test, :5433, its own credentials from ~/.config/arthistory/test.env),
// or deletes it there when it is gone or deleted here. The nightly reset (scripts/test-env.sh) keeps these accounts,
// so the copy is only needed for "now". No test environment set up (no file, no connection): a message, nothing else.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { adminPool } = require('../db');

const FILE = process.env.TEST_ENV_FILE || path.join(os.homedir(), '.config/arthistory/test.env');
let pool = null;

function testPool() {
  if (pool) return pool;
  let password = null;
  try {
    const line = fs.readFileSync(FILE, 'utf8').split('\n').find((l) => l.startsWith('DB_ADMIN_PASSWORD='));
    password = line ? line.slice('DB_ADMIN_PASSWORD='.length).trim() : null;
  } catch { return null; }
  if (!password) return null;
  pool = new Pool({ host: '127.0.0.1', port: Number(process.env.TEST_DB_PORT || 5433), database: 'arthistory', user: 'arthistory_admin', password, max: 2, connectionTimeoutMillis: 4000 });
  pool.on('error', () => {});
  return pool;
}

/** Copies production's account `id` (a test_env one) to the test database → null when done, else a sentence. */
async function sync(id, username) {
  const db = testPool();
  if (!db) return 'The test environment is not set up on this server — the account is copied at its next reset.';
  const { rows: [u] } = await adminPool.query(`SELECT username, password_hash, role::text AS role, public_name, note, password_set_at, created_via,
      disabled_at, deleted_at, test_env FROM admin_users WHERE id = $1`, [id]);
  try {
    if (!u || u.deleted_at || !u.test_env) {
      await db.query('DELETE FROM admin_users WHERE username = $1 AND test_env', [u ? u.username : username]);
      return null;
    }
    await db.query(`INSERT INTO admin_users (username, password_hash, role, public_name, note, password_set_at, created_via, test_env)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      ON CONFLICT (username) DO UPDATE SET (password_hash, role, public_name, note, password_set_at, test_env)
        = (EXCLUDED.password_hash, EXCLUDED.role, EXCLUDED.public_name, EXCLUDED.note, EXCLUDED.password_set_at, true)
      WHERE admin_users.test_env`, [u.username, u.password_hash, u.role, u.public_name, u.note, u.password_set_at, u.created_via]);
    await db.query('UPDATE admin_users SET disabled_at = $2 WHERE username = $1 AND test_env', [u.username, u.disabled_at]);
    // switched off or a new password: its sessions there end too
    if (u.disabled_at) await db.query('DELETE FROM admin_sessions WHERE user_id = (SELECT id FROM admin_users WHERE username = $1)', [u.username]);
    return null;
  } catch (err) {
    return `Not copied to the test environment yet (${err.code === '42703' ? 'its database is not migrated yet' : err.message}) — the next reset does it.`;
  }
}

module.exports = { sync };
