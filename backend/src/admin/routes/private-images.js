// Private reference images (migration 184, owner 2026-11-01): pictures of a work from the owner's own books, for their
// private use only. Each image belongs to the account that uploaded it; every route here answers only that account —
// to anyone else an image doesn't exist (404). Nothing of it reaches the API, the site, the export or the test copy.
//   POST /artworks/:slug/private-images?source=<bibliography slug>&locator=<p. 33, fig. 29>   the file as the body
//   GET  /private-images/:id          the image (WebP), not cached beyond the session
//   POST /private-images/:id/delete
// The section on a work's page: section(e, user) — only that user's images, an upload field (drop / paste / choose).
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { toWebp } = require('./pages');

const router = express.Router();

async function section(e, user) {
  const { rows } = await adminPool.query(`SELECT i.id, i.locator, i.width, i.height, b.slug AS source, coalesce(b.siglum, b.name) AS source_name
      FROM private_images i LEFT JOIN bibliography b ON b.id = i.source_id
     WHERE i.artwork_id = $1 AND i.owner_id = $2 ORDER BY i.created_at`, [e.id, user.id]);
  const sources = (await adminPool.query(`SELECT slug, coalesce(siglum, name) AS label FROM bibliography
     WHERE kind IN ('book', 'catalogue', 'chapter') ORDER BY 2`)).rows;
  // the book this work is cited from, preselected (e.g. Mason for the works entered from it)
  const cited = (await adminPool.query(`SELECT b.slug, max(c.locator) AS locator FROM citations c JOIN bibliography b ON b.id = c.source_id
     WHERE c.entity_type = 'artwork' AND c.entity_id = $1 AND b.kind IN ('book', 'catalogue', 'chapter') GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [e.id])).rows[0];
  return html`<section class="private-images" data-private-upload="/artworks/${e.slug}/private-images">
    <h2>Reference images <span class="tag">private</span></h2>
    <p class="muted small">Only you see these — from your own books, for your private use. Not on the site, not in the API,
      not in the test environment.</p>
    ${rows.length ? html`<div class="image-list">${rows.map((i) => html`<figure class="image-item">
        <a href="/private-images/${i.id}" target="_blank" rel="noopener"><img src="/private-images/${i.id}" alt="" loading="lazy"></a>
        <figcaption class="muted small">${[i.source_name, i.locator].filter(Boolean).join(', ') || '—'}
          <form method="post" action="/private-images/${i.id}/delete" class="inline"><button class="link small">delete</button></form></figcaption>
      </figure>`)}</div>` : ''}
    <div class="bar">
      <label>Book <select name="pi-source"><option value="">—</option>${sources.map((s) => html`<option value="${s.slug}"${cited && cited.slug === s.slug ? ' selected' : ''}>${s.label}</option>`)}</select></label>
      <label>Page, figure <input name="pi-locator" value="${cited ? cited.locator : ''}" placeholder="p. 33, fig. 29" size="16"></label>
      <input type="file" name="pi-file" accept="image/*">
    </div>
    <p class="hint">Choose a file, or paste a screenshot (Ctrl/⌘ V) or drop an image anywhere in this box.</p>
  </section>`;
}

router.post('/artworks/:slug/private-images', express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  const { rows: [a] } = await adminPool.query('SELECT id FROM artworks WHERE slug = $1', [req.params.slug]);
  if (!a) return res.status(404).json({ error: 'no such work' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(422).json({ error: 'empty file' });
  let image;
  try { image = await toWebp(req.body); } catch { return res.status(422).json({ error: 'not an image this panel can read' }); }
  const source = String(req.query.source || '').trim();
  const sourceId = source ? (await adminPool.query('SELECT id FROM bibliography WHERE slug = $1', [source])).rows[0]?.id : null;
  if (source && !sourceId) return res.status(422).json({ error: `no source “${source}”` });
  const locator = String(req.query.locator || '').trim() || null;
  const { rows: [img] } = await adminPool.query(`INSERT INTO private_images (artwork_id, owner_id, source_id, locator, bytes, width, height, original_bytes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [a.id, req.user.id, sourceId, locator, image.bytes, image.width, image.height, req.body.length]);
  res.status(201).json({ id: Number(img.id), url: `/private-images/${img.id}` });
});

router.get('/private-images/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).end();
  const { rows: [img] } = await adminPool.query('SELECT content_type, bytes FROM private_images WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.content_type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(img.bytes);
});

router.post('/private-images/:id/delete', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).end();
  const { rows: [img] } = await adminPool.query(`DELETE FROM private_images i USING artworks a WHERE i.id = $1 AND i.owner_id = $2 AND a.id = i.artwork_id
    RETURNING a.slug`, [req.params.id, req.user.id]);
  if (!img) return res.status(404).end();
  res.redirect(303, `/artworks/${img.slug}#private-images`);
});

module.exports = router;
module.exports.section = section;
