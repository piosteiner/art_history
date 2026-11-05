// The public site's login (owner 2026-11-01): the site (config.corsOrigin) has no accounts of its own — "Log in" there
// opens the CMS login (/login?next=<site address>), and the CMS session then shows the owner's private reference images
// (184) on the site's artwork pages too. These routes answer the site only (CORS with credentials for its origin); the
// session cookie stays on the admin host (SameSite=Strict, sent because site and admin host are the same site).
//   GET  /site/me                               {username, role, cms, public_name} or 401
//   GET  /site/signup                           {open, url} — whether "Create an account" is offered (220)
//   GET  /site/account                          {username, role, cms, public_name, created_at, created_via, sessions, sets, edits}
//   POST /site/account/public-name              public_name → {public_name}
//   POST /site/account/password                 current, password, password2 → 204 (other sessions end)
//   POST /site/account/sessions                 → {ended} — log out everywhere else
//   POST /site/account/delete                   password → 204: a site-only account deletes itself with everything
//                                               it holds (CMS accounts are deleted by an admin)
//   GET  /site/artworks/:slug/private-images    {images: [{url, source, locator, width, height}]} — this account's only
//   GET  /site/quiz/<image|artist|movement|glossary>?…   the quiz (src/routes/quiz.js) with this account's private
//                                               images counted as pictures too ({image_url, own: true}); ?mine=only
//   GET  /site/thumbs                           {images: {slug: address}} — works with only this account's images
//   /site/sets/…                                study sets and their index cards (routes/site-sets.js, 218)
//   /site/shared/…                              shared study sets — no login needed to look and learn (219)
//   POST /site/logout                           ends the session (the CMS's too: it is the same one)
// The images themselves: GET /private-images/:id (routes/private-images.js), owner-only as before.
const express = require('express');
const config = require('../../config');
const { adminPool } = require('../../db');
const { loadUser, logout, adminOrigin, verifyPassword, hashPassword, passwordProblem, endSessions, tooManyAttempts, recordFailure } = require('../auth');
const accounts = require('../accounts');
const { forAccount } = require('../../routes/quiz');

const router = express.Router();

/** A site address the login may send the browser back to — never anywhere else (no open redirect). */
const siteUrl = (next) => {
  const s = String(next || '');
  return s === config.corsOrigin || s.startsWith(`${config.corsOrigin}/`) ? s : null;
};

router.use((req, res, next) => {
  res.set('Vary', 'Origin');
  if (req.get('origin') === config.corsOrigin) {
    res.set({ 'Access-Control-Allow-Origin': config.corsOrigin, 'Access-Control-Allow-Credentials': 'true' });
  }
  // writes only from the site's own pages (the CMS's checkOrigin isn't in front of these routes)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('origin') !== config.corsOrigin) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}, loadUser);

// study sets (218): the account's own lists of entries and their index cards (routes/site-sets.js)
router.use('/sets', require('./site-sets'));
// shared sets (219): anyone with the link, logged in or not
router.use('/shared', require('./site-sets').shared);
router.use('/friends', require('./site-friends'));   // friends and chat (224)
router.use('/views', require('./site-views'));       // the account's own start-map views (227)

router.get('/me', (req, res) => (req.user
  ? res.json({ username: req.user.username, role: req.user.role, cms: req.user.cms, public_name: req.user.public_name })
  : res.status(401).json({ error: 'not_logged_in' })));

// ---- the account itself (220) -------------------------------------------------------------------------------------
router.get('/signup', async (req, res) => {
  const s = await accounts.signupSettings();
  res.json({ open: s.open && s.today < s.daily_limit, url: `${adminOrigin(req)}/signup` });
});

const needLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'not_logged_in' }));
router.use('/account', needLogin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/account', async (req, res) => {
  const { rows: [a] } = await adminPool.query(`SELECT u.username, u.role::text AS role, u.role >= 'editor' AS cms, u.public_name, u.created_at, u.created_via,
      u.password_set_at, (SELECT count(*)::int FROM admin_sessions x WHERE x.user_id = u.id AND x.expires_at > now()) AS sessions,
      (SELECT count(*)::int FROM study_sets s WHERE s.owner_id = u.id) AS sets,
      (SELECT count(*)::int FROM study_set_editors e WHERE e.account_id = u.id) AS edits
    FROM admin_users u WHERE u.id = $1`, [req.user.id]);
  res.json(a);
});

router.post('/account/public-name', async (req, res) => {
  const name = String(req.body.public_name ?? '').trim().slice(0, 60) || null;
  if (name && name.toLowerCase() === req.user.username.toLowerCase()) return res.status(422).json({ error: 'choose a public name other than your login name' });
  // a shared set or one edited together shows the name: it can be changed, not removed then
  if (!name) {
    const { rows: [{ shown }] } = await adminPool.query(`SELECT EXISTS (SELECT 1 FROM study_sets WHERE owner_id = $1 AND visibility <> 'private')
      OR EXISTS (SELECT 1 FROM study_set_editors WHERE account_id = $1) AS shown`, [req.user.id]);
    if (shown) return res.status(422).json({ error: 'your shared sets and sets edited together show your public name — change it, or stop sharing first' });
  }
  await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, name]);
  await accounts.log(adminPool, { account: req.user.id, username: req.user.username, actor: req.user.id, action: 'public_name' });
  res.json({ public_name: name });
});

/** The account's password is right (the login's brake against guessing applies here too). */
async function rightPassword(req, password) {
  if (tooManyAttempts(req.ip)) return false;
  const { rows: [u] } = await adminPool.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.user.id]);
  const ok = Boolean(u) && await verifyPassword(String(password || ''), u.password_hash);
  if (!ok) recordFailure(req.ip);
  return ok;
}

router.post('/account/password', async (req, res) => {
  if (!await rightPassword(req, req.body.current)) return res.status(403).json({ error: 'your current password is not right' });
  const weak = passwordProblem(req.body.password, req.user.username);
  if (weak) return res.status(422).json({ error: weak });
  if (req.body.password !== req.body.password2) return res.status(422).json({ error: 'the two new passwords differ' });
  await adminPool.query('UPDATE admin_users SET password_hash = $2, password_set_at = now() WHERE id = $1', [req.user.id, await hashPassword(req.body.password)]);
  await endSessions(req.user.id, req);   // logged out everywhere else
  await accounts.log(adminPool, { account: req.user.id, username: req.user.username, actor: req.user.id, action: 'password_changed' });
  res.status(204).end();
});

router.post('/account/sessions', async (req, res) => {
  const { rowCount } = await adminPool.query('SELECT 1 FROM admin_sessions WHERE user_id = $1', [req.user.id]);
  await endSessions(req.user.id, req);
  await accounts.log(adminPool, { account: req.user.id, username: req.user.username, actor: req.user.id, action: 'sessions_ended' });
  res.json({ ended: Math.max(0, rowCount - 1) });
});

router.post('/account/delete', async (req, res) => {
  if (req.user.cms) return res.status(403).json({ error: 'a CMS account is deleted by an admin (CMS → Accounts)' });
  if (!await rightPassword(req, req.body.password)) return res.status(403).json({ error: 'the password is not right' });
  // kept 30 days, switched off and its sets hidden — the owner can restore it on request; afterwards
  // purge_deleted_accounts() removes it with its sets, results and log lines (221)
  await accounts.log(adminPool, { account: req.user.id, username: req.user.username, actor: req.user.id, action: 'deleted', detail: { by: 'self' } });
  await adminPool.query('UPDATE admin_users SET disabled_at = coalesce(disabled_at, now()), deleted_at = now(), deleted_by = $1 WHERE id = $1', [req.user.id]);
  await logout(req, res);
  await adminPool.query('DELETE FROM admin_sessions WHERE user_id = $1', [req.user.id]);
  res.status(204).end();
});

router.get('/artworks/:slug/private-images', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  const { rows } = await adminPool.query(`SELECT i.id, i.locator, i.width, i.height, i.source_url, coalesce(b.siglum, b.name) AS source
      FROM private_images i JOIN artworks a ON a.id = i.artwork_id LEFT JOIN bibliography b ON b.id = i.source_id
     WHERE a.slug = $1 AND i.owner_id = image_owner($2) ORDER BY i.position, i.id`, [req.params.slug, req.user.id]);
  res.json({ images: rows.map((i) => ({ url: `${adminOrigin(req)}/private-images/${i.id}`, source: i.source, locator: i.locator, link: i.source_url, width: i.width, height: i.height })) });
});

router.get('/quiz/:kind', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  res.set('Cache-Control', 'no-store');
  const game = await forAccount(req.params.kind, req.query, { db: adminPool, owner: req.user.id, origin: adminOrigin(req) });
  return game ? res.json(game) : res.status(404).json({ error: 'not_found' });
});

// the owner's pictures as previews of works without a public one (owner 2026-11-02): slug → a small rendition
router.get('/thumbs', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  res.set('Cache-Control', 'no-store');
  const { rows } = await adminPool.query(`SELECT DISTINCT ON (a.id) a.slug, i.id FROM private_images i JOIN artworks a ON a.id = i.artwork_id
     WHERE i.owner_id = image_owner($1) AND NOT EXISTS (SELECT 1 FROM images p WHERE p.artwork_id = a.id) ORDER BY a.id, i.position, i.id`, [req.user.id]);
  res.json({ images: Object.fromEntries(rows.map((r) => [r.slug, `${adminOrigin(req)}/private-images/${r.id}`])) });
});

router.post('/logout', async (req, res) => {
  await logout(req, res);
  res.status(204).end();
});

module.exports = router;
module.exports.siteUrl = siteUrl;
