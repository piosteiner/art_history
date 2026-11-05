// Accounts (migration 220, owner 2026-11-05: "manage accounts in the cms … create accounts that do not have cms
// access") — admins only.
//   /accounts[?q=&role=]          sign-up open / closed and its limit per day; a new account (role, public name, a
//                                 password given or generated — shown once); every account with its role, state, sets,
//                                 last login
//   /accounts/<id>                one account: role, public name, note; switch off / on, a new password (generated,
//                                 shown once — its sessions end), end its sessions, delete; its log
// Your own account can't be switched off, demoted or deleted here (and the database keeps one active admin anyway:
// keep_an_admin()). Accounts aren't content: not in audit_log, but in account_log (who did what, when).
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx, notFoundPage } = require('../core');
const { endSessions, generatePassword, hashPassword, passwordProblem, USERNAME } = require('../auth');
const accounts = require('../accounts');

const router = express.Router();
const ID = /^[1-9][0-9]{0,15}$/;
const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const when = (d) => (d ? WHEN.format(d) : '—');
const VIA = { script: 'by script', cms: 'in the CMS', signup: 'signed up' };
const ACTION = {
  created: 'created', signed_up: 'signed up', role: 'role changed', disabled: 'switched off', enabled: 'switched on',
  'password_reset': 'new password set', 'password_changed': 'password changed by the account', sessions_ended: 'sessions ended',
  public_name: 'public name changed', note: 'note changed', deleted: 'deleted',
};
const OK = {
  created: 'Account created.', saved: 'Saved.', disabled: 'Switched off — its sessions have ended.', enabled: 'Switched on again.',
  sessions: 'Its sessions have ended.', deleted: 'Account deleted.', settings: 'Sign-up settings saved.',
};

router.use('/accounts', (req, res, next) => (req.user.is_admin ? next()
  : send(req, res, { title: 'Accounts', status: 403, body: html`<h1>Accounts</h1><p>Only admins manage accounts.</p>` })));

const roleSelect = (name, current, disabled = false) => html`<select name="${name}"${disabled ? ' disabled' : ''}>
  ${Object.entries(accounts.ROLES).map(([k, r]) => html`<option value="${k}"${k === current ? ' selected' : ''}>${r.label} — ${r.help}</option>`)}</select>`;
const roleTag = (role) => html`<span class="tag role-${role}">${accounts.ROLES[role].label}</span>`;
const flashOf = (req) => (OK[req.query.ok] ? { kind: 'ok', text: OK[req.query.ok] } : null);

/** The page showing a password once (new account, new password). */
const passwordShown = (req, res, user, password, what) => send(req, res, { title: 'Password', body: html`<h1>${what}: ${user.username}</h1>
  <p>The password — shown <b>only now</b>; hand it over safely (in person, a message to the person only):</p>
  <p class="password-once"><code>${password}</code></p>
  <p class="muted small">They log in at the site's “Log in” with the username <b>${user.username}</b>, and can change the password under “Your account” on the site.</p>
  <p><a href="/accounts/${String(user.id)}">Back to the account</a> · <a href="/accounts">All accounts</a></p>` });

router.get('/accounts', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const role = accounts.ROLES[req.query.role] ? req.query.role : '';
  const [{ rows }, settings, { rows: counts }] = await Promise.all([
    adminPool.query(`SELECT u.id, u.username, u.public_name, u.role::text AS role, u.disabled_at, u.created_at, u.created_via, u.last_login_at,
        (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id) AS sets,
        (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id AND s.visibility <> 'private') AS shared,
        (SELECT count(*)::int FROM admin_sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions
      FROM admin_users u
      WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' OR u.public_name ILIKE '%' || $1 || '%') AND ($2 = '' OR u.role::text = $2)
      ORDER BY u.role DESC, u.disabled_at IS NOT NULL, lower(u.username) LIMIT 500`, [q, role]),
    accounts.signupSettings(),
    adminPool.query(`SELECT role::text AS role, count(*)::int AS n FROM admin_users GROUP BY role`),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.role, c.n]));
  const total = counts.reduce((a, c) => a + c.n, 0);
  send(req, res, { title: 'Accounts', flash: flashOf(req), body: html`<h1>Accounts <span class="muted">${String(total)}</span></h1>
    <p class="muted">Who may log in, and to what: <b>Site only</b> accounts have study sets and their quiz results on the site —
      never the CMS. <b>CMS editors</b> also edit everything in the CMS; <b>admins</b> also manage the accounts here.</p>
    <section class="accounts-box"><h2>Sign-up on the site</h2>
      <form method="post" action="/accounts/settings" class="form inline-form">
        <label class="check"><input type="checkbox" name="signup_open" value="1"${settings.open ? ' checked' : ''}> Anyone may create a <b>site-only</b> account</label>
        <label>at most <input type="number" name="signup_daily_limit" value="${String(settings.daily_limit)}" min="0" max="10000" class="narrow"> new per day</label>
        <button class="secondary">Save</button>
        <span class="muted small">${String(settings.today)} today · the form: <a href="/signup" target="_blank">/signup</a></span></form></section>
    <details class="accounts-box"${req.query.new ? ' open' : ''}><summary><b>+ New account</b></summary>
      <form method="post" action="/accounts/new" class="form">
        <div class="field"><label for="a-u">Username <span class="muted small">— 2–40 small letters, digits, _ . -</span></label>
          <input id="a-u" name="username" required pattern="[a-z0-9_.\\-]{2,40}" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label for="a-r">Role</label>${roleSelect('role', 'member')}</div>
        <div class="field"><label for="a-n">Public name <span class="muted small">— optional; shown on shared sets</span></label><input id="a-n" name="public_name" maxlength="60"></div>
        <div class="field"><label for="a-p">Password <span class="muted small">— leave empty for a generated one (shown once)</span></label>
          <input id="a-p" name="password" type="text" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="a-o">Note <span class="muted small">— for you: who it is, why</span></label><input id="a-o" name="note" maxlength="1000"></div>
        <div class="actions"><button>Create account</button></div></form></details>
    <form class="filter-bar" method="get" action="/accounts">
      <input type="search" name="q" value="${q}" placeholder="Username or public name" aria-label="Search accounts">
      <select name="role"><option value="">every role</option>${Object.entries(accounts.ROLES).map(([k, r]) => html`<option value="${k}"${k === role ? ' selected' : ''}>${r.label} (${String(n[k] || 0)})</option>`)}</select>
      <button class="secondary">Show</button></form>
    <table class="list accounts-list"><thead><tr><th>Username</th><th>Public name</th><th>Role</th><th>Created</th><th>Last login</th><th>Sets</th><th>Sessions</th></tr></thead><tbody>
      ${rows.map((u) => html`<tr class="${u.disabled_at ? 'account-off' : ''}"><td><a href="/accounts/${String(u.id)}">${u.username}</a>${u.id === req.user.id ? html` <span class="muted small">(you)</span>` : ''}${u.disabled_at ? html` <span class="tag">switched off</span>` : ''}</td>
        <td>${u.public_name || html`<span class="muted">—</span>`}</td><td>${roleTag(u.role)}</td>
        <td class="small">${when(u.created_at)} <span class="muted">${VIA[u.created_via]}</span></td><td class="small">${when(u.last_login_at)}</td>
        <td>${String(u.sets)}${u.shared ? html` <span class="muted small">(${String(u.shared)} shared)</span>` : ''}</td><td>${String(u.sessions)}</td></tr>`)}
    </tbody></table>${rows.length ? '' : html`<p class="muted">No account matches.</p>`}` });
});

router.post('/accounts/settings', async (req, res) => {
  const open = req.body.signup_open === '1';
  const limit = Math.max(0, Math.min(10000, Number.parseInt(req.body.signup_daily_limit, 10) || 0));
  await withTx(req.user, async (db) => {
    await db.query(`UPDATE site_settings SET value = to_jsonb($1::boolean) WHERE key = 'signup_open' AND value <> to_jsonb($1::boolean)`, [open]);
    await db.query(`UPDATE site_settings SET value = to_jsonb($1::int) WHERE key = 'signup_daily_limit' AND value <> to_jsonb($1::int)`, [limit]);
  });
  res.redirect(303, '/accounts?ok=settings');
});

router.post('/accounts/new', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const role = accounts.ROLES[req.body.role] ? req.body.role : 'member';
  const publicName = String(req.body.public_name || '').trim().slice(0, 60) || null;
  const given = String(req.body.password || '');
  const again = (text) => send(req, res, { title: 'Accounts', status: 422, flash: { kind: 'error', text },
    body: html`<h1>New account</h1><p><a href="/accounts?new=1">Back</a></p>` });
  if (!USERNAME.test(username)) return again('A username has 2–40 small letters, digits, _ . or -.');
  const weak = given && passwordProblem(given, username);
  if (weak) return again(weak);
  const password = given || generatePassword();
  let user;
  try {
    user = await accounts.create(adminPool, { username, password, role, publicName, via: 'cms', actor: req.user.id, note: String(req.body.note || '').trim().slice(0, 1000) || null });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return again(why);
    throw err;
  }
  if (given) return res.redirect(303, `/accounts/${user.id}?ok=created`);
  passwordShown(req, res, user, password, 'Account created');
});

/** The account of the address, or null. */
async function accountOf(req) {
  if (!ID.test(req.params.id)) return null;
  const { rows: [u] } = await adminPool.query(`SELECT u.id, u.username, u.public_name, u.role::text AS role, u.disabled_at, u.created_at, u.created_via,
      u.last_login_at, u.note, u.password_set_at, c.username AS created_by,
      (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id) AS sets,
      (SELECT count(*)::int FROM study_set_editors e WHERE e.account_id = u.id) AS edits,
      (SELECT count(*)::int FROM study_sessions s WHERE s.owner_id = u.id) AS rounds,
      (SELECT count(*)::int FROM private_images i WHERE i.owner_id = u.id) AS images,
      (SELECT count(*)::int FROM admin_sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions,
      (SELECT count(*)::int FROM audit_log a WHERE a.user_id = u.id) AS changes
    FROM admin_users u LEFT JOIN admin_users c ON c.id = u.created_by WHERE u.id = $1`, [req.params.id]);
  return u || null;
}

router.get('/accounts/:id', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const self = u.id === req.user.id;
  const { rows: log } = await adminPool.query(`SELECT l.at, l.action, l.detail, a.username AS actor FROM account_log l LEFT JOIN admin_users a ON a.id = l.actor_id
    WHERE l.account_id = $1 ORDER BY l.at DESC, l.id DESC LIMIT 100`, [u.id]);
  const { rows: sets } = await adminPool.query(`SELECT name, visibility, share_code, (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS n
    FROM study_sets s WHERE owner_id = $1 AND visibility <> 'private' ORDER BY updated_at DESC LIMIT 50`, [u.id]);
  send(req, res, { title: u.username, flash: req.query.error ? { kind: 'error', text: String(req.query.error).slice(0, 200) } : flashOf(req), body: html`
    <p class="crumbs"><a href="/accounts">Accounts</a> / ${u.username}</p>
    <h1>${u.username} ${roleTag(u.role)}${u.disabled_at ? html` <span class="tag">switched off ${when(u.disabled_at)}</span>` : ''}${self ? html` <span class="muted small">(you)</span>` : ''}</h1>
    <p class="muted small">Created ${when(u.created_at)} ${VIA[u.created_via]}${u.created_by ? ` by ${u.created_by}` : ''} · last login ${when(u.last_login_at)} ·
      password set ${when(u.password_set_at)} · ${String(u.sessions)} active session${u.sessions === 1 ? '' : 's'}</p>
    <p class="small">${String(u.sets)} study set${u.sets === 1 ? '' : 's'} · editor of ${String(u.edits)} other${u.edits === 1 ? '' : 's'} · ${String(u.rounds)} quiz rounds ·
      ${String(u.images)} private reference images · ${String(u.changes)} changes to the content</p>
    ${sets.length ? html`<p class="small">Shared: ${sets.map((s, i) => html`${i ? ', ' : ''}<a href="${process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch'}/sets/s/${s.share_code}" target="_blank" rel="noopener">${s.name}</a> <span class="muted">(${s.visibility}, ${String(s.n)})</span>`)}</p>` : ''}
    <form method="post" action="/accounts/${String(u.id)}" class="form accounts-box">
      <div class="field"><label>Role</label>${roleSelect('role', u.role, self)}${self ? html`<p class="muted small">Not your own — another admin can change it.</p>` : ''}</div>
      <div class="field"><label for="a-n">Public name</label><input id="a-n" name="public_name" value="${u.public_name || ''}" maxlength="60"></div>
      <div class="field"><label for="a-o">Note</label><input id="a-o" name="note" value="${u.note || ''}" maxlength="1000"></div>
      <div class="actions"><button>Save</button></div></form>
    <div class="accounts-box accounts-actions">
      <form method="post" action="/accounts/${String(u.id)}/password" class="inline" data-confirm="Set a new password for ${u.username}? The old one stops working, the account is logged out everywhere; the new one is shown once.">
        <button class="secondary">New password…</button></form>
      <form method="post" action="/accounts/${String(u.id)}/sessions" class="inline"><button class="secondary"${u.sessions ? '' : ' disabled'}>Log out everywhere</button></form>
      ${self ? '' : u.disabled_at
    ? html`<form method="post" action="/accounts/${String(u.id)}/enable" class="inline"><button class="secondary">Switch on again</button></form>`
    : html`<form method="post" action="/accounts/${String(u.id)}/disable" class="inline" data-confirm="Switch off ${u.username}? It can't log in until switched on again; its sets stay (shared ones too)."><button class="secondary">Switch off</button></form>`}
    </div>
    ${self ? '' : html`<details class="accounts-box danger"><summary>Delete the account</summary>
      <p class="small">Gone for good: its study sets (shared ones too), what it knows, its results and private images. Its changes to the content stay in the history, without its name.</p>
      <form method="post" action="/accounts/${String(u.id)}/delete" class="inline"><label>Type <b>${u.username}</b> to confirm <input name="confirm" autocomplete="off" required></label>
        <button class="danger">Delete</button></form></details>`}
    <h2>Log</h2>
    ${log.length ? html`<table class="list"><tbody>${log.map((l) => html`<tr><td class="small">${when(l.at)}</td><td>${ACTION[l.action] || l.action}${l.detail && l.detail.role ? html` → ${accounts.ROLES[l.detail.role] ? accounts.ROLES[l.detail.role].label : l.detail.role}` : ''}</td>
      <td class="muted small">${l.actor ? `by ${l.actor}` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}` });
});

const back = (res, u, ok) => res.redirect(303, `/accounts/${u.id}?ok=${ok}`);
const refuse = (res, u, text) => res.redirect(303, `/accounts/${u.id}?error=${encodeURIComponent(text)}`);

router.post('/accounts/:id', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const self = u.id === req.user.id;
  const role = self || !accounts.ROLES[req.body.role] ? u.role : req.body.role;
  const publicName = String(req.body.public_name ?? '').trim().slice(0, 60) || null;
  const note = String(req.body.note ?? '').trim().slice(0, 1000) || null;
  if (publicName && publicName.toLowerCase() === u.username) return refuse(res, u, 'A public name other than the username — the username is half of the login.');
  try {
    await withTx(req.user, async (db) => {
      await db.query('UPDATE admin_users SET role = $2, public_name = $3, note = $4 WHERE id = $1', [u.id, role, publicName, note]);
      const entry = (action, detail = null) => accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action, detail });
      if (role !== u.role) {
        await entry('role', { role, from: u.role });
        // fewer rights take effect at once: a CMS page open in another tab must not keep working
        if (role === 'member') await db.query('DELETE FROM admin_sessions WHERE user_id = $1', [u.id]);
      }
      if (publicName !== u.public_name) await entry('public_name');
      if (note !== u.note) await entry('note');
    });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return refuse(res, u, why);
    throw err;
  }
  back(res, u, 'saved');
});

router.post('/accounts/:id/password', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const generated = generatePassword();
  await adminPool.query('UPDATE admin_users SET password_hash = $2, password_set_at = now() WHERE id = $1', [u.id, await hashPassword(generated)]);
  await endSessions(u.id, u.id === req.user.id ? req : null);
  await accounts.log(adminPool, { account: u.id, username: u.username, actor: req.user.id, action: 'password_reset' });
  passwordShown(req, res, u, generated, 'New password');
});

router.post('/accounts/:id/sessions', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  await endSessions(u.id, u.id === req.user.id ? req : null);   // your own: all but this one
  await accounts.log(adminPool, { account: u.id, username: u.username, actor: req.user.id, action: 'sessions_ended' });
  back(res, u, 'sessions');
});

const switchAccount = (off) => async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  if (u.id === req.user.id) return refuse(res, u, 'Not your own account.');
  try {
    await withTx(req.user, async (db) => {
      await db.query('UPDATE admin_users SET disabled_at = CASE WHEN $2 THEN now() END WHERE id = $1', [u.id, off]);
      if (off) await db.query('DELETE FROM admin_sessions WHERE user_id = $1', [u.id]);
      await accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action: off ? 'disabled' : 'enabled' });
    });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return refuse(res, u, why);
    throw err;
  }
  back(res, u, off ? 'disabled' : 'enabled');
};
router.post('/accounts/:id/disable', switchAccount(true));
router.post('/accounts/:id/enable', switchAccount(false));

router.post('/accounts/:id/delete', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  if (u.id === req.user.id) return refuse(res, u, 'Not your own account.');
  if (String(req.body.confirm || '').trim().toLowerCase() !== u.username) return refuse(res, u, `Type the username “${u.username}” to delete it.`);
  try {
    await withTx(req.user, async (db) => {
      await accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action: 'deleted', detail: { role: u.role } });
      await db.query('DELETE FROM admin_users WHERE id = $1', [u.id]);
    });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return refuse(res, u, why);
    throw err;
  }
  res.redirect(303, '/accounts?ok=deleted');
});

module.exports = router;
