// Accounts (migration 220): shared by the CMS's Accounts page (routes/accounts.js), the sign-up (routes/signup.js) and
// the site's account routes (routes/site-account.js).
//   ROLES                       member (the site only) · editor (also the CMS) · admin (also the accounts)
//   log(db, …)                  a line in account_log: what happened to which account, by whom
//   signupSettings(db)          {open, daily_limit, today} — the owner's switch and the brake per day
//   create(db, {...})           a new account → its row (the password hashed here)
//   problem(err)                a Postgres error of an account write → a sentence, or null
const { adminPool } = require('../db');
const { hashPassword } = require('./auth');

const ROLES = {
  member: { label: 'Site only', help: 'study sets, the quiz with its own results — no CMS' },
  editor: { label: 'CMS editor', help: 'the site, and the CMS: every entry, page and setting except accounts' },
  admin: { label: 'Admin', help: 'everything, and the accounts (this page)' },
};

async function log(db, { account, username, actor = null, action, detail = null }) {
  await db.query('INSERT INTO account_log (account_id, username, actor_id, action, detail) VALUES ($1, $2, $3, $4, $5)',
    [account, username, actor, action, detail]);
}

async function signupSettings(db = adminPool) {
  const { rows: [s] } = await db.query(`SELECT
      coalesce((SELECT (value #>> '{}')::boolean FROM site_settings WHERE key = 'signup_open'), false) AS open,
      coalesce((SELECT (value #>> '{}')::int FROM site_settings WHERE key = 'signup_daily_limit'), 50) AS daily_limit,
      (SELECT count(*)::int FROM admin_users WHERE created_via = 'signup'
         AND created_at >= (now() AT TIME ZONE 'Europe/Zurich')::date AT TIME ZONE 'Europe/Zurich') AS today`);
  return s;
}

async function create(db, { username, password, role = 'member', publicName = null, via, actor = null, note = null }) {
  const { rows: [u] } = await db.query(`INSERT INTO admin_users (username, password_hash, role, public_name, created_via, created_by, note, password_set_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id, username, role::text AS role, role >= 'editor' AS cms`,
  [username, await hashPassword(password), role, publicName, via, actor, note]);
  await log(db, { account: u.id, username: u.username, actor, action: via === 'signup' ? 'signed_up' : 'created', detail: { role } });
  return u;
}

function problem(err) {
  if (err.code === '23505' && /username/.test(err.constraint || err.detail || '')) return 'That username is taken — choose another.';
  if (err.code === '23514' && err.constraint === 'keep_an_admin') return 'At least one active admin must remain — make someone else an admin first.';
  if (err.code === '23514' && /username/.test(err.constraint || '')) return 'A username has 2–40 small letters, digits, _ . or -.';
  if (err.code === '23514' && /public_name/.test(err.constraint || '')) return 'A public name has at most 60 characters.';
  return null;
}

module.exports = { ROLES, log, signupSettings, create, problem };
