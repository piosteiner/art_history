// The public site's login (owner 2026-11-01): the site (config.corsOrigin) has no accounts of its own — "Log in" there
// opens the CMS login (/login?next=<site address>), and the CMS session then shows the owner's private reference images
// (184) on the site's artwork pages too. These routes answer the site only (CORS with credentials for its origin); the
// session cookie stays on the admin host (SameSite=Strict, sent because site and admin host are the same site).
//   GET  /site/me                               {username} or 401
//   GET  /site/artworks/:slug/private-images    {images: [{url, source, locator, width, height}]} — this account's only
//   GET  /site/quiz/<image|artist|movement|glossary>?…   the quiz (src/routes/quiz.js) with this account's private
//                                               images counted as pictures too ({image_url, own: true}); ?mine=only
//   GET  /site/thumbs                           {images: {slug: address}} — works with only this account's images
//   POST /site/logout                           ends the session (the CMS's too: it is the same one)
// The images themselves: GET /private-images/:id (routes/private-images.js), owner-only as before.
const express = require('express');
const config = require('../../config');
const { adminPool } = require('../../db');
const { loadUser, logout, adminOrigin } = require('../auth');
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

router.get('/me', (req, res) => (req.user ? res.json({ username: req.user.username }) : res.status(401).json({ error: 'not_logged_in' })));

router.get('/artworks/:slug/private-images', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  const { rows } = await adminPool.query(`SELECT i.id, i.locator, i.width, i.height, i.source_url, coalesce(b.siglum, b.name) AS source
      FROM private_images i JOIN artworks a ON a.id = i.artwork_id LEFT JOIN bibliography b ON b.id = i.source_id
     WHERE a.slug = $1 AND i.owner_id = $2 ORDER BY i.position, i.id`, [req.params.slug, req.user.id]);
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
     WHERE i.owner_id = $1 AND NOT EXISTS (SELECT 1 FROM images p WHERE p.artwork_id = a.id) ORDER BY a.id, i.position, i.id`, [req.user.id]);
  res.json({ images: Object.fromEntries(rows.map((r) => [r.slug, `${adminOrigin(req)}/private-images/${r.id}`])) });
});

router.post('/logout', async (req, res) => {
  await logout(req, res);
  res.status(204).end();
});

module.exports = router;
module.exports.siteUrl = siteUrl;
