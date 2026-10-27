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

const router = express.Router();

// Development serves its own bundles first (npm run build:admin:dev → static-dev/): this checkout is also production,
// and a dev build must never replace the bundles the live site serves from static/.
if (config.env !== 'production') router.use('/static', express.static(path.join(__dirname, 'static-dev'), { index: false }));
router.use('/static', express.static(path.join(__dirname, 'static'), { index: false, maxAge: '1h' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(express.urlencoded({ extended: false, limit: '1mb' }));
router.use(checkOrigin);
router.use(loadUser);

// ---------------------------------------------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------------------------------------------
const loginPage = (error) => html`<div class="login"><h1>Art history admin</h1>
  ${error ? html`<p class="flash error">${error}</p>` : ''}
  <form method="post" action="/login" class="form">
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <div class="actions"><button>Log in</button></div>
  </form></div>`;

router.get('/login', (req, res) => (req.user ? res.redirect('/') : send(req, res, { title: 'Log in', body: loginPage() })));

router.post('/login', async (req, res) => {
  const result = await login(req, res, req.body.username, req.body.password);
  if (result.error) return send(req, res, { title: 'Log in', body: loginPage(result.error), status: 401 });
  res.redirect(303, '/');
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
