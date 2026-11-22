// Accounts (migration 220): shared by the CMS's Accounts page (routes/accounts.js), the sign-up (routes/signup.js) and
// the site's account routes (routes/site-account.js).
//   ROLES                       member (the site only) · editor (also the CMS) · admin (also the accounts)
//   log(db, …)                  a line in account_log: what happened to which account, by whom
//   signupSettings(db)          {open, daily_limit, today} — the owner's switch and the brake per day
//   create(db, {...})           a new account → its row (the password hashed here)
//   problem(err)                a Postgres error of an account write → a sentence, or null
//   resetPassword(u, actor)     an admin's reset (256): a generated, temporary password → {generated, until}
//   setOwnPassword(req, …)      the account replaces its temporary password (256) → a sentence why not, or null
//   day(date)                   "22 December 2026" — the temporary password's last day in the texts
const { adminPool } = require('../db');
const { hashPassword, verifyPassword, generatePassword, passwordProblem, endSessions, TEMPORARY_DAYS } = require('./auth');

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

async function create(db, { username, password, role = 'member', publicName = null, via, actor = null, note = null, testEnv = false }) {
  const { rows: [u] } = await db.query(`INSERT INTO admin_users (username, password_hash, role, public_name, created_via, created_by, note, password_set_at, test_env)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8) RETURNING id, username, role::text AS role, role >= 'editor' AS cms, test_env`,
  [username, await hashPassword(password), role, publicName, via, actor, note, testEnv]);
  await log(db, { account: u.id, username: u.username, actor, action: via === 'signup' ? 'signed_up' : 'created', detail: testEnv ? { role, test_env: true } : { role } });
  return u;
}

function problem(err) {
  if (err.code === '23505' && /username/.test(err.constraint || err.detail || '')) return 'That username is taken — choose another.';
  if (err.code === '23514' && err.constraint === 'keep_an_admin') return 'At least one active admin must remain — make someone else an admin first.';
  if (err.code === '23514' && /username/.test(err.constraint || '')) return 'A username has 2–40 small letters, digits, _ . or -.';
  if (err.code === '23514' && /public_name/.test(err.constraint || '')) return 'A public name has at most 60 characters.';
  return null;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const day = (d) => DAY.format(new Date(d));

/** An admin resets account `u` (256): a generated password replaces the old one. Someone else's becomes temporary —
 *  to be replaced at the next login, valid TEMPORARY_DAYS — and all its sessions end. The admin's own account
 *  keeps the old behaviour (an ordinary new password, this session kept): there is no one to hand it to, and a
 *  forced change on oneself would only be a detour. → {generated (the new password), until (null: not temporary)} */
async function resetPassword(u, actor) {
  const own = u.id === actor.id;
  const generated = generatePassword();
  const { rows: [r] } = await adminPool.query(`UPDATE admin_users SET password_hash = $2, password_set_at = now(),
      password_temporary_until = CASE WHEN $3 THEN now() + make_interval(days => $4) END
    WHERE id = $1 RETURNING password_temporary_until AS until`, [u.id, await hashPassword(generated), !own, TEMPORARY_DAYS]);
  await log(adminPool, { account: u.id, username: u.username, actor: actor.id, action: 'password_reset', detail: own ? null : { temporary_until: r.until } });
  return { generated, until: r.until };
}

/** The logged-in account (`req.user`, logged in with a temporary password) sets its own (256): the usual rules, typed
 *  twice, not the temporary one again. The temporary state ends, so do its other sessions; this one stays. */
async function setOwnPassword(req, { password, password2 }) {
  const weak = passwordProblem(password, req.user.username);
  if (weak) return weak;
  if (password !== password2) return 'The two passwords differ.';
  const { rows: [u] } = await adminPool.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.user.id]);
  if (u && await verifyPassword(String(password), u.password_hash)) return 'Choose a password of your own — not the temporary one.';
  await adminPool.query('UPDATE admin_users SET password_hash = $2, password_set_at = now(), password_temporary_until = NULL WHERE id = $1',
    [req.user.id, await hashPassword(password)]);
  await endSessions(req.user.id, req);
  await log(adminPool, { account: req.user.id, username: req.user.username, actor: req.user.id, action: 'password_changed', detail: { replaced: 'temporary' } });
  return null;
}

module.exports = { ROLES, log, signupSettings, create, problem, resetPassword, setOwnPassword, day };
