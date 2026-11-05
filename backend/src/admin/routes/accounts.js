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
const testAccounts = require('../test-accounts');
const TEST_CMS = 'https://admin.test.arthistory.piogino.ch';
const TEST_SITE = 'https://test.arthistory.piogino.ch';
const envTag = (u) => (u.test_env ? html` <span class="tag account-test" title="Logs in only on the test CMS and test site">test environment</span>` : '');
/** a test-environment account changed here: copied to the test database now; a problem shown with the flash */
async function synced(u) { return u.test_env ? testAccounts.sync(u.id, u.username) : null; }

const router = express.Router();
const ID = /^[1-9][0-9]{0,15}$/;
const WHEN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const when = (d) => (d ? WHEN.format(d) : '—');
const VIA = { script: 'by script', cms: 'in the CMS', signup: 'signed up' };
const ACTION = {
  created: 'created', signed_up: 'signed up', role: 'role changed', disabled: 'switched off', enabled: 'switched on',
  'password_reset': 'new password set', 'password_changed': 'password changed by the account', sessions_ended: 'sessions ended',
  public_name: 'public name changed', note: 'note changed', deleted: 'deleted', restored: 'restored after deletion',
  purged: 'removed for good', set_rolled_back: 'a set rolled back', reference_images: 'reference images shown changed',
};
const KEEP_DAYS = 30;   // a deleted account waits this long for a restore (221)
const until = (d) => when(new Date(new Date(d).getTime() + KEEP_DAYS * 86400000));
const OK = {
  created: 'Account created.', saved: 'Saved.', disabled: 'Switched off — its sessions have ended.', enabled: 'Switched on again.',
  sessions: 'Its sessions have ended.', deleted: `Account deleted — it can be restored for ${'30'} days.`, settings: 'Sign-up settings saved.',
  deleted_test: 'Test-environment account deleted — here and in the test environment.',
  reference_images: 'Saved: which reference images it sees.',
  restored: 'Account restored — switched on again, its sets back where they were.', rolled_back: 'The set is back as it was then (the step is in its history).',
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
  <p class="muted small">${user.test_env ? html`A test-environment account: it logs in only at <a href="${TEST_CMS}/login" target="_blank" rel="noopener">${TEST_CMS.replace('https://', '')}</a> or on the test site — with the username <b>${user.username}</b>.`
    : html`They log in at the site's “Log in” with the username <b>${user.username}</b>, and can change the password under “Your account” on the site.`}</p>
  <p><a href="/accounts/${String(user.id)}">Back to the account</a> · <a href="/accounts">All accounts</a></p>` });

router.get('/accounts', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const role = accounts.ROLES[req.query.role] ? req.query.role : '';
  const env = ['live', 'test'].includes(req.query.env) ? req.query.env : '';
  const [{ rows }, settings, { rows: counts }] = await Promise.all([
    adminPool.query(`SELECT u.id, u.username, u.public_name, u.role::text AS role, u.disabled_at, u.deleted_at, u.test_env, u.created_at, u.created_via, u.last_login_at,
        (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id) AS sets,
        (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id AND s.visibility <> 'private') AS shared,
        (SELECT count(*)::int FROM admin_sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions
      FROM admin_users u
      WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' OR u.public_name ILIKE '%' || $1 || '%') AND ($2 = '' OR u.role::text = $2)
        AND ($3 = '' OR u.test_env = ($3 = 'test'))
      ORDER BY u.test_env, u.role DESC, u.disabled_at IS NOT NULL, lower(u.username) LIMIT 500`, [q, role, env]),
    accounts.signupSettings(),
    adminPool.query(`SELECT role::text AS role, count(*)::int AS n FROM admin_users GROUP BY role`),
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.role, c.n]));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const { rows: [{ open: reports }] } = await adminPool.query('SELECT count(*)::int AS open FROM chat_reports WHERE handled_at IS NULL');
  send(req, res, { title: 'Accounts', flash: req.query.error ? { kind: 'error', text: String(req.query.error).slice(0, 200) } : flashOf(req), body: html`<h1>Accounts <span class="muted">${String(total)}</span></h1>
    ${reports ? html`<p class="flash"><a href="/accounts/reports">${String(reports)} reported conversation${reports === 1 ? '' : 's'} to look at →</a></p>` : html`<p class="small"><a href="/accounts/reports">Reported conversations</a></p>`}
    <p class="muted">Who may log in, and to what: <b>Site only</b> accounts have study sets and their quiz results on the site —
      never the CMS. <b>CMS editors</b> also edit everything in the CMS; <b>admins</b> also manage the accounts here.</p>
    <section class="accounts-box"><h2>Sign-up on the site</h2>
      <form method="post" action="/accounts/settings" class="form inline-form">
        <label class="check"><input type="checkbox" name="signup_open" value="1"${settings.open ? ' checked' : ''}> <span>Anyone may create a <b>site-only</b> account</span></label>
        <label>at most <input type="number" name="signup_daily_limit" value="${String(settings.daily_limit)}" min="0" max="10000" class="narrow"> new per day</label>
        <button class="secondary">Save</button>
        <span class="muted small">${String(settings.today)} today · the form: <a href="/signup" target="_blank">/signup</a></span></form></section>
    <details class="accounts-box"${req.query.new ? ' open' : ''}><summary><b>+ New account</b></summary>
      <form method="post" action="/accounts/new" class="form">
        <div class="field"><label for="a-u">Username <span class="muted small">— 2–40 small letters, digits, _ . -</span></label>
          <input id="a-u" name="username" required pattern="[a-z0-9_.\\-]{2,40}" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label for="a-r">Role</label>${roleSelect('role', 'member')}</div>
        <fieldset class="field accounts-env"><legend>Where it logs in</legend>
          <label class="check"><input type="radio" name="env" value="live" checked> <span>Here — <b>arthistory.piogino.ch</b> and this CMS</span></label>
          <label class="check"><input type="radio" name="env" value="test"> <span>The <b>test environment</b> only — <a href="${TEST_CMS}" target="_blank" rel="noopener">test CMS</a> and <a href="${TEST_SITE}" target="_blank" rel="noopener">test site</a>; refused here, kept by the nightly reset, its changes there undone each night</span></label></fieldset>
        <div class="field"><label for="a-n">Public name <span class="muted small">— optional; shown on shared sets</span></label><input id="a-n" name="public_name" maxlength="60"></div>
        <div class="field"><label for="a-p">Password <span class="muted small">— leave empty for a generated one (shown once)</span></label>
          <input id="a-p" name="password" type="text" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="a-o">Note <span class="muted small">— for you: who it is, why</span></label><input id="a-o" name="note" maxlength="1000"></div>
        <div class="actions"><button>Create account</button></div></form></details>
    <h2 class="accounts-search-title">User search</h2>
    <form class="filter-bar accounts-search" method="get" action="/accounts" role="search">
      <input type="search" name="q" value="${q}" placeholder="Username or public name" aria-label="Username or public name">
      <select name="role" aria-label="Role"><option value="">every role</option>${Object.entries(accounts.ROLES).map(([k, r]) => html`<option value="${k}"${k === role ? ' selected' : ''}>${r.label} (${String(n[k] || 0)})</option>`)}</select>
      <select name="env" aria-label="Environment"><option value="">live and test</option><option value="live"${env === 'live' ? ' selected' : ''}>live only</option><option value="test"${env === 'test' ? ' selected' : ''}>test environment only</option></select>
      <button class="secondary">Search</button></form>
    <table class="list accounts-list"><thead><tr><th>Username</th><th>Public name</th><th>Role</th><th>Created</th><th>Last login</th><th>Sets</th><th>Sessions</th></tr></thead><tbody>
      ${rows.map((u) => html`<tr class="${u.disabled_at ? 'account-off' : ''}"><td><a href="/accounts/${String(u.id)}">${u.username}</a>${envTag(u)}${u.id === req.user.id ? html` <span class="muted small">(you)</span>` : ''}${u.deleted_at ? html` <span class="tag account-deleted">deleted — restorable until ${until(u.deleted_at)}</span>` : u.disabled_at ? html` <span class="tag">switched off</span>` : ''}</td>
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
    user = await accounts.create(adminPool, { username, password, role, publicName, via: 'cms', actor: req.user.id, note: String(req.body.note || '').trim().slice(0, 1000) || null, testEnv: req.body.env === 'test' });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return again(why);
    throw err;
  }
  const problem = await synced(user);
  if (given) return res.redirect(303, `/accounts/${user.id}?ok=created${problem ? `&error=${encodeURIComponent(problem)}` : ''}`);
  passwordShown(req, res, user, password, user.test_env ? 'Test account created' : 'Account created');
});

/** The account of the address, or null. */
async function accountOf(req) {
  if (!ID.test(req.params.id)) return null;
  const { rows: [u] } = await adminPool.query(`SELECT u.id, u.username, u.public_name, u.role::text AS role, u.disabled_at, u.deleted_at, u.test_env, u.reference_images_of, u.created_at, u.created_via,
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

// reported conversations (224): what a reporter sent — the last 100 messages at that moment; nothing else of the
// chat is ever shown here
router.get('/accounts/reports', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT r.id, r.reporter, r.reported, r.reporter_id, r.reported_id, r.note, r.messages, r.at, r.handled_at,
      h.username AS handled_by FROM chat_reports r LEFT JOIN admin_users h ON h.id = r.handled_by ORDER BY r.handled_at IS NOT NULL, r.at DESC LIMIT 200`);
  send(req, res, { title: 'Reports', flash: req.query.ok ? { kind: 'ok', text: 'Marked as handled.' } : null, body: html`
    <p class="crumbs"><a href="/accounts">Accounts</a> / Reports</p>
    <h1>Reported conversations</h1>
    <p class="muted">A report sends a copy of the conversation as it was then (its last 100 messages) — chats are otherwise seen by no one but the two people.</p>
    ${rows.length ? rows.map((r) => html`<section class="accounts-box${r.handled_at ? ' muted' : ''}">
      <h2>${r.reporter} reported ${r.reported} <span class="muted small">${when(r.at)}</span></h2>
      <p class="small">${r.reporter_id ? html`<a href="/accounts/${String(r.reporter_id)}">reporter's account</a>` : 'reporter gone'} ·
        ${r.reported_id ? html`<a href="/accounts/${String(r.reported_id)}">reported account</a>` : 'reported account gone'}
        ${r.handled_at ? html` · handled ${when(r.handled_at)} by ${r.handled_by || '—'}` : ''}</p>
      ${r.note ? html`<p><b>Note:</b> ${r.note}</p>` : ''}
      <details><summary>The conversation (${String(r.messages.length)} messages)</summary>
        <ol class="report-messages">${r.messages.map((m) => html`<li><span class="muted small">${when(new Date(m.at))}</span> <b>${m.from === 'reporter' ? r.reporter : r.reported}:</b> ${m.body}</li>`)}</ol></details>
      ${r.handled_at ? '' : html`<form method="post" action="/accounts/reports/${String(r.id)}/handled" class="inline"><button class="secondary">Mark as handled</button></form>`}
    </section>`) : html`<p class="muted">No reports.</p>`}` });
});
router.post('/accounts/reports/:rid/handled', async (req, res) => {
  if (!ID.test(req.params.rid)) return notFoundPage(req, res);
  await adminPool.query('UPDATE chat_reports SET handled_at = now(), handled_by = $2 WHERE id = $1 AND handled_at IS NULL', [req.params.rid, req.user.id]);
  res.redirect(303, '/accounts/reports?ok=1');
});

router.get('/accounts/:id', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const self = u.id === req.user.id;
  const { rows: log } = await adminPool.query(`SELECT l.at, l.action, l.detail, a.username AS actor FROM account_log l LEFT JOIN admin_users a ON a.id = l.actor_id
    WHERE l.account_id = $1 ORDER BY l.at DESC, l.id DESC LIMIT 100`, [u.id]);
  const { rows: sets } = await adminPool.query(`SELECT id, name, visibility, share_code, locked_at, (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS n,
      (SELECT count(*)::int FROM study_set_editors e WHERE e.set_id = s.id) AS editors
    FROM study_sets s WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 100`, [u.id]);
  send(req, res, { title: u.username, flash: req.query.error ? { kind: 'error', text: String(req.query.error).slice(0, 200) } : flashOf(req), body: html`
    <p class="crumbs"><a href="/accounts">Accounts</a> / ${u.username}</p>
    <h1>${u.username} ${roleTag(u.role)}${envTag(u)}${u.deleted_at ? html` <span class="tag account-deleted">deleted ${when(u.deleted_at)}</span>` : u.disabled_at ? html` <span class="tag">switched off ${when(u.disabled_at)}</span>` : ''}${self ? html` <span class="muted small">(you)</span>` : ''}</h1>
    <p class="muted small">Created ${when(u.created_at)} ${VIA[u.created_via]}${u.created_by ? ` by ${u.created_by}` : ''} · last login ${when(u.last_login_at)} ·
      password set ${when(u.password_set_at)} · ${String(u.sessions)} active session${u.sessions === 1 ? '' : 's'}</p>
    <p class="small">${String(u.sets)} study set${u.sets === 1 ? '' : 's'} · editor of ${String(u.edits)} other${u.edits === 1 ? '' : 's'} · ${String(u.rounds)} quiz rounds ·
      ${String(u.images)} private reference images · ${String(u.changes)} changes to the content</p>
    ${u.deleted_at ? html`<section class="accounts-box account-deleted-box"><h2>Deleted ${when(u.deleted_at)}</h2>
      <p>It can't log in and its sets are hidden. Kept until <b>${until(u.deleted_at)}</b>, then removed for good with its sets, results and images.</p>
      <form method="post" action="/accounts/${String(u.id)}/restore" class="inline" data-confirm="Restore ${u.username}? It can log in again with its old password; its sets come back as they were."><button>Restore the account</button></form></section>` : ''}
    ${sets.length ? html`<h2>Study sets</h2><table class="list"><tbody>${sets.map((s) => html`<tr><td><a href="/accounts/${String(u.id)}/sets/${String(s.id)}">${s.name}</a></td>
      <td class="small">${String(s.n)} entries${s.editors ? ` · ${String(s.editors)} editor${s.editors === 1 ? '' : 's'}` : ''}${s.locked_at ? ' · locked' : ''}</td>
      <td class="small">${s.visibility === 'private' ? html`<span class="muted">private</span>` : html`<a href="${process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch'}/sets/s/${s.share_code}" target="_blank" rel="noopener">${s.visibility}</a>`}</td></tr>`)}</tbody></table>
      <p class="muted small">A set's page shows its history and rolls it back to a moment — for a set an editor emptied or flooded.</p>` : ''}
    <form method="post" action="/accounts/${String(u.id)}" class="form accounts-box">
      <div class="field"><label>Role</label>${roleSelect('role', u.role, self)}${self ? html`<p class="muted small">Not your own — another admin can change it.</p>` : ''}</div>
      <div class="field"><label for="a-n">Public name</label><input id="a-n" name="public_name" value="${u.public_name || ''}" maxlength="60"></div>
      <div class="field"><label for="a-o">Note</label><input id="a-o" name="note" value="${u.note || ''}" maxlength="1000"></div>
      <div class="actions"><button>Save</button></div></form>
    ${await referenceImagesBox(u)}
    <div class="accounts-box accounts-actions">
      <form method="post" action="/accounts/${String(u.id)}/password" class="inline" data-confirm="Set a new password for ${u.username}? The old one stops working, the account is logged out everywhere; the new one is shown once.">
        <button class="secondary">New password…</button></form>
      <form method="post" action="/accounts/${String(u.id)}/sessions" class="inline"><button class="secondary"${u.sessions ? '' : ' disabled'}>Log out everywhere</button></form>
      ${self ? '' : u.disabled_at
    ? html`<form method="post" action="/accounts/${String(u.id)}/enable" class="inline"><button class="secondary">Switch on again</button></form>`
    : html`<form method="post" action="/accounts/${String(u.id)}/disable" class="inline" data-confirm="Switch off ${u.username}? It can't log in until switched on again; its sets stay (shared ones too)."><button class="secondary">Switch off</button></form>`}
    </div>
    ${self || u.deleted_at ? '' : html`<details class="accounts-box danger"><summary>Delete the account</summary>
      <p class="small">${u.test_env ? 'A test-environment account: deleted at once, here and in the test environment — not kept.'
        : `Switched off at once and its sets hidden; kept ${String(KEEP_DAYS)} days in case it should come back (Restore), then gone for good: its study sets (shared ones too), what it knows, its results and private images. Its changes to the content stay in the history, without its name.`}</p>
      <form method="post" action="/accounts/${String(u.id)}/delete" class="inline"><label>Type <b>${u.username}</b> to confirm <input name="confirm" autocomplete="off" required></label>
        <button class="danger">Delete</button></form></details>`}
    <h2>Log</h2>
    ${log.length ? html`<table class="list"><tbody>${log.map((l) => html`<tr><td class="small">${when(l.at)}</td><td>${ACTION[l.action] || l.action}${l.detail && l.detail.role ? html` → ${accounts.ROLES[l.detail.role] ? accounts.ROLES[l.detail.role].label : l.detail.role}` : ''}</td>
      <td class="muted small">${l.actor ? `by ${l.actor}` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}` });
});

/** Which reference images an account sees (223): its own, or another account's — read only. Offered: the accounts that
 *  have reference images. */
async function referenceImagesBox(u) {
  const { rows: owners } = await adminPool.query(`SELECT a.id, a.username, count(*)::int AS n FROM private_images i JOIN admin_users a ON a.id = i.owner_id
    WHERE a.id <> $1 GROUP BY a.id, a.username ORDER BY a.username`, [u.id]);
  if (!owners.length && !u.reference_images_of) return '';
  return html`<form method="post" action="/accounts/${String(u.id)}/reference-images" class="form inline-form accounts-box">
    <label>Reference images <select name="of"><option value="">its own only</option>${owners.map((o) => html`<option value="${String(o.id)}"${String(o.id) === String(u.reference_images_of) ? ' selected' : ''}>also see those of ${o.username} (${String(o.n)})</option>`)}</select></label>
    <button class="secondary">Save</button>
    <span class="muted small">Read only — adding, ordering and deleting stay with the images' owner.</span></form>`;
}

router.post('/accounts/:id/reference-images', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const of = ID.test(String(req.body.of || '')) && String(req.body.of) !== String(u.id) ? req.body.of : null;
  await withTx(req.user, async (db) => {
    await db.query('UPDATE admin_users SET reference_images_of = $2 WHERE id = $1', [u.id, of]);
    await accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action: 'reference_images', detail: { of } });
  });
  await back(res, u, 'reference_images');
});

const back = async (res, u, ok) => {
  // a test-environment account: the change copied to the test database now (222)
  const problem = u.test_env ? await testAccounts.sync(u.id, u.username) : null;
  res.redirect(303, `/accounts/${u.id}?ok=${ok}${problem ? `&error=${encodeURIComponent(problem)}` : ''}`);
};
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
  await back(res, u, 'saved');
});

router.post('/accounts/:id/password', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  const generated = generatePassword();
  await adminPool.query('UPDATE admin_users SET password_hash = $2, password_set_at = now() WHERE id = $1', [u.id, await hashPassword(generated)]);
  await endSessions(u.id, u.id === req.user.id ? req : null);
  await accounts.log(adminPool, { account: u.id, username: u.username, actor: req.user.id, action: 'password_reset' });
  await synced(u);
  passwordShown(req, res, u, generated, 'New password');
});

router.post('/accounts/:id/sessions', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  await endSessions(u.id, u.id === req.user.id ? req : null);   // your own: all but this one
  await accounts.log(adminPool, { account: u.id, username: u.username, actor: req.user.id, action: 'sessions_ended' });
  await back(res, u, 'sessions');
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
  await back(res, u, off ? 'disabled' : 'enabled');
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
      if (u.test_env) {
        // a test-environment account isn't kept (owner 2026-11-05): gone at once, here and in the test database
        await db.query('DELETE FROM admin_users WHERE id = $1', [u.id]);
      } else {
        // kept 30 days, switched off (221); purge_deleted_accounts() removes it afterwards
        await db.query('UPDATE admin_users SET disabled_at = coalesce(disabled_at, now()), deleted_at = now(), deleted_by = $2 WHERE id = $1', [u.id, req.user.id]);
        await db.query('DELETE FROM admin_sessions WHERE user_id = $1', [u.id]);
      }
    });
  } catch (err) {
    const why = accounts.problem(err);
    if (why) return refuse(res, u, why);
    throw err;
  }
  if (u.test_env) {
    const problem = await testAccounts.sync(u.id, u.username);
    return res.redirect(303, `/accounts?ok=deleted_test${problem ? `&error=${encodeURIComponent(problem)}` : ''}`);
  }
  await back(res, u, 'deleted');
});

// a deleted account back within the 30 days (221): switched on, its sets visible again
router.post('/accounts/:id/restore', async (req, res) => {
  const u = await accountOf(req);
  if (!u) return notFoundPage(req, res);
  if (!u.deleted_at) return back(res, u, 'saved');
  await withTx(req.user, async (db) => {
    await db.query('UPDATE admin_users SET deleted_at = NULL, deleted_by = NULL, disabled_at = NULL WHERE id = $1', [u.id]);
    await accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action: 'restored' });
  });
  await back(res, u, 'restored');
});

// ---- an account's study set: its history, rolled back to a moment by an admin (221) ------------------------------
async function setOf(req, u) {
  if (!ID.test(req.params.sid)) return null;
  const { rows: [s] } = await adminPool.query(`SELECT s.id, s.name, s.topic, s.visibility, s.share_code, s.locked_at, s.created_at, s.updated_at,
      (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS n,
      (SELECT string_agg(coalesce(a.public_name, a.username), ', ') FROM study_set_editors e JOIN admin_users a ON a.id = e.account_id WHERE e.set_id = s.id) AS editors
    FROM study_sets s WHERE s.id = $1 AND s.owner_id = $2`, [req.params.sid, u.id]);
  return s || null;
}
const EVENT = { created: 'created the set', changed: 'changed', added: 'added', removed: 'removed', restored: 'restored the set to', locked: 'locked the set', unlocked: 'unlocked the set' };
const ZURICH = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const localInput = (d) => ZURICH.format(d).replace(' ', 'T');   // for <input type=datetime-local>, Zurich time

router.get('/accounts/:id/sets/:sid', async (req, res) => {
  const u = await accountOf(req);
  const set = u && await setOf(req, u);
  if (!set) return notFoundPage(req, res);
  const { rows: events } = await adminPool.query(`SELECT ev.at, ev.action, ev.field, left(ev.old_value, 120) AS old, left(ev.new_value, 120) AS new, ev.detail,
      coalesce(a.username, '—') AS by, e.name AS entry, e.type::text AS type
    FROM study_set_events ev LEFT JOIN admin_users a ON a.id = ev.actor_id LEFT JOIN entity_index e ON (e.type, e.id) = (ev.entity_type, ev.entity_id)
    WHERE ev.set_id = $1 ORDER BY ev.at DESC, ev.id DESC LIMIT 1000`, [set.id]);
  const what = (ev) => (ev.action === 'changed' ? html`${ev.field}: <s class="muted">${ev.old || '—'}</s> → ${ev.new || '—'}`
    : ev.action === 'added' || ev.action === 'removed' ? html`${ev.entry || '(an entry since deleted)'} <span class="muted small">${ev.type || ''}</span>`
      : ev.action === 'restored' ? html`${when(new Date(ev.detail.to))} <span class="muted small">(−${String(ev.detail.removed)} +${String(ev.detail.added)}${ev.detail.reason ? ` · ${ev.detail.reason}` : ''})</span>` : '');
  send(req, res, { title: set.name, flash: req.query.error ? { kind: 'error', text: String(req.query.error).slice(0, 200) } : flashOf(req), body: html`
    <p class="crumbs"><a href="/accounts">Accounts</a> / <a href="/accounts/${String(u.id)}">${u.username}</a> / study set</p>
    <h1>${set.name}</h1>
    <p class="muted small">${String(set.n)} entries · ${set.visibility}${set.locked_at ? ' · locked' : ''} · created ${when(set.created_at)} · last changed ${when(set.updated_at)}${set.editors ? ` · editors: ${set.editors}` : ''}</p>
    <section class="accounts-box"><h2>Roll back</h2>
      <p class="small">The set as it was at a moment: its name, topic and description, and its entries — those added since are removed, those removed since come back (if they still exist). The rollback is a step in the history itself, so it can be undone the same way.</p>
      <form method="post" action="/accounts/${String(u.id)}/sets/${String(set.id)}/rollback" class="form inline-form" data-confirm="Roll the set back to this moment?">
        <label>To <input type="datetime-local" name="at" step="1" required value="${/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(req.query.at || '')) ? req.query.at : events[1] ? localInput(events[1].at) : ''}"${req.query.at ? ' autofocus' : ''}></label> <span class="muted small">Zurich time</span>
        <label>Why <input name="reason" maxlength="300" placeholder="e.g. flooded by an editor"></label>
        <button>Roll back</button></form></section>
    <h2>History</h2>
    <table class="list set-history"><tbody>${events.map((ev) => html`<tr><td class="small nowrap">${when(ev.at)}</td><td class="small">${ev.by}</td>
      <td>${EVENT[ev.action]} ${what(ev)}</td>
      <td><a class="small" href="?at=${encodeURIComponent(localInput(ev.at))}" data-fill-at="${localInput(ev.at)}" title="Put this moment into the form above">this moment</a></td></tr>`)}</tbody></table>` });
});

router.post('/accounts/:id/sets/:sid/rollback', async (req, res) => {
  const u = await accountOf(req);
  const set = u && await setOf(req, u);
  if (!set) return notFoundPage(req, res);
  const typed = zurichTime(String(req.body.at || ''));
  const backTo = (q) => res.redirect(303, `/accounts/${u.id}/sets/${set.id}?${q}`);
  // the typed second / minute counts to its end — but never later than now
  if (!typed || typed.getTime() - 60000 > Date.now()) return backTo(`error=${encodeURIComponent('Which moment? A date and time in the past.')}`);
  const at = typed > new Date() ? new Date() : typed;
  try {
    await withTx(req.user, async (db) => {
      const reason = String(req.body.reason || '').trim().slice(0, 300) || null;
      await db.query('SELECT study_set_restore($1, $2, $3)', [set.id, at.toISOString(), reason ? `by an admin: ${reason}` : 'by an admin']);
      await accounts.log(db, { account: u.id, username: u.username, actor: req.user.id, action: 'set_rolled_back', detail: { set: set.name, to: at.toISOString(), reason } });
    }, { source: 'admin' });
  } catch (err) {
    if (err.code === '23514') return backTo(`error=${encodeURIComponent('The set did not exist yet then.')}`);
    throw err;
  }
  backTo('ok=rolled_back');
});

/** "2026-11-05T14:30[:15]" read as Zurich time → a Date (or null) */
function zurichTime(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  // the offset of Zurich at that moment (one hour in winter, two in summer)
  const shown = new Date(ZURICH.format(new Date(asUtc)).replace(' ', 'T') + 'Z').getTime();
  // "as it was at 14:30:15": everything up to the end of that second (of that minute when no seconds are given)
  return new Date(asUtc - (shown - asUtc) + (m[6] ? 999 : 59999));
}

module.exports = router;
