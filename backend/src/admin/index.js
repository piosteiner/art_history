// Admin panel (admin.arthistory.piogino.ch/…): server-rendered pages, forms generated from src/content.js.
// Writes go through arthistory_admin in a transaction tagged with the user, so the audit_log trigger records who.
//
//   /                          dashboard: counts + recent changes
//   /<plural>                  list + search            /<plural>/new        create
//   /<plural>/<slug>           view + relationships     /<plural>/<slug>/edit · /delete · /history
//   /relationships/<id>/edit   edit one relationship    /history             all changes
//   /images/<id>/edit          edit one image           (images are added and reordered on the entry's page)
//   /search-words              groups of equivalent search words (102)
//   (the pages themselves: src/admin/routes/*.js, mounted below in this order; shared helpers: src/admin/core.js)
const express = require('express');
const path = require('path');
const config = require('../config');
const { html, layout } = require('./html');
const { login, logout, loadUser, checkOrigin } = require('./auth');
const { send, notFoundPage } = require('./core');
const { asset } = require('./assets');

const router = express.Router();

// Development serves its own bundles first (npm run build:admin:dev → static-dev/): this checkout is also production,
// and a dev build must never replace the bundles the live site serves from static/.
if (config.env !== 'production') router.use('/static', express.static(path.join(__dirname, 'static-dev'), { index: false }));
// a file asked for under its current fingerprint (assets.js) can't change at that address: kept for a year, not even
// revalidated; any other request (no or an old ?v=) for an hour as before
router.use('/static', (req, res, next) => {
  const current = typeof req.query.v === 'string' && asset(req.path.slice(1)) === `/static${req.path}?v=${req.query.v}`;
  res.set('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  next();
});
router.use('/static', express.static(path.join(__dirname, 'static'), { index: false, cacheControl: false }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(express.urlencoded({ extended: false, limit: '1mb' }));
const siteAccount = require('./routes/site-account');
router.use('/site', siteAccount);   // the public site's login: its own origin check (routes/site-account.js)
router.use(checkOrigin);
router.use(loadUser);

// ---------------------------------------------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------------------------------------------
// ?next=<an address of the public site>: back there after logging in ("Log in" on the site, routes/site-account.js)
const loginPage = (error, next) => html`<div class="login"><h1>Art history admin</h1>
  ${error ? html`<p class="flash error">${error}</p>` : ''}
  <form method="post" action="/login" class="form">
    ${next ? html`<input type="hidden" name="next" value="${next}"><p class="muted small">You'll return to the site afterwards.</p>` : ''}
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <div class="actions"><button>Log in</button></div>
  </form></div>`;

router.get('/login', (req, res) => {
  const next = siteAccount.siteUrl(req.query.next);
  if (req.user) return res.redirect(next || '/');
  send(req, res, { title: 'Log in', body: loginPage(null, next) });
});

router.post('/login', async (req, res) => {
  const next = siteAccount.siteUrl(req.body.next);
  const result = await login(req, res, req.body.username, req.body.password);
  if (result.error) return send(req, res, { title: 'Log in', body: loginPage(result.error, next), status: 401 });
  res.redirect(303, next || '/');
});

router.post('/logout', async (req, res) => {
  await logout(req, res);
  res.redirect(303, '/login');
});

// Everything below needs a logged-in user.
router.use((req, res, next) => {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/login');
  res.status(401).type('text').send('Not logged in.');
});


// The pages, in this order (the more specific addresses first: /artworks/:slug/numbers before /:plural/:slug/…)
router.use(require('./routes/revert'));
router.use(require('./routes/dashboard'));
router.use(require('./routes/queue'));
router.use(require('./routes/featured'));
router.use(require('./routes/pages'));
router.use(require('./routes/changelog'));
router.use(require('./routes/feedback'));
router.use(require('./routes/search-words'));
router.use(require('./routes/relationships'));
router.use(require('./routes/citations'));
router.use(require('./routes/compare'));
router.use(require('./routes/provenance'));
router.use(require('./routes/phases'));         // a work's building history (169)
router.use(require('./routes/open-cases'));     // cases to follow up, out of the Quality page (198)
router.use(require('./routes/private-images')); // the owner's reference images from their books (184)
router.use(require('./routes/wikidata'));
router.use(require('./routes/entries'));
router.use(require('./routes/tools'));

router.use((req, res) => notFoundPage(req, res));

// Errors inside the admin panel → an HTML page, not the API's JSON.
router.use((err, req, res, next) => {
  console.error(err);
  res.status(500).type('html').send(String(layout({ title: 'Error', user: req.user,
    body: html`<h1>Something went wrong</h1><p>The error was logged. <a href="/">Back to the dashboard</a></p>` })));
});

module.exports = router;
