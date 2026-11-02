// Private reference images (migration 184, owner 2026-11-01): pictures of a work from the owner's own books, for their
// private use only. Each image belongs to the account that uploaded it; every route here answers only that account —
// to anyone else an image doesn't exist (404). Nothing of it reaches the API, the site, the export or the test copy.
//   POST /artworks/:slug/private-images?source=<bibliography slug>&locator=<p. 33, fig. 29>   the file as the body
//   GET  /private-images/:id          the image (WebP), not cached beyond the session
//   POST /artworks/:slug/private-images/from-link  {url, page?, source?, locator?} — a picture from another website:
//        an image address → stored like an upload (its page as source_url); a page → {page, pictures: [image addresses]}
//        to choose from (fetch-image.js: public http(s) addresses only)
//   GET  /private-images/preview?url=…&page=…   a small preview of such a picture for the chooser (fetched with the
//        page as Referer — some sites show their pictures only on their own pages)
//   POST /private-images/:id/move   dir=up|down|first — the first is the main one (189: what stands in for a missing picture)
//   POST /private-images/:id/delete
// The section on a work's page: section(e, user) — only that user's images, an upload field (drop / paste / choose).
const express = require('express');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { toWebp } = require('./pages');
const sharp = require('sharp');
const { fetchPublic, picturesOn, galleryPictures, FetchError } = require('../fetch-image');

const router = express.Router();

const move = (i, dir, label, title) => html`<form method="post" action="/private-images/${i.id}/move" class="inline">
  <input type="hidden" name="dir" value="${dir}"><button class="link small" title="${title}">${label}</button></form>`;

async function section(e, user) {
  const { rows } = await adminPool.query(`SELECT i.id, i.locator, i.width, i.height, i.source_url, b.slug AS source, coalesce(b.siglum, b.name) AS source_name
      FROM private_images i LEFT JOIN bibliography b ON b.id = i.source_id
     WHERE i.artwork_id = $1 AND i.owner_id = $2 ORDER BY i.position, i.id`, [e.id, user.id]);
  const sources = (await adminPool.query(`SELECT slug, coalesce(siglum, name) AS label FROM bibliography
     WHERE kind IN ('book', 'catalogue', 'chapter') ORDER BY 2`)).rows;
  // the book this work is cited from, preselected (e.g. Mason for the works entered from it)
  const cited = (await adminPool.query(`SELECT b.slug, max(c.locator) AS locator FROM citations c JOIN bibliography b ON b.id = c.source_id
     WHERE c.entity_type = 'artwork' AND c.entity_id = $1 AND b.kind IN ('book', 'catalogue', 'chapter') GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`, [e.id])).rows[0];
  return html`<section class="private-images" data-private-upload="/artworks/${e.slug}/private-images">
    <h2>Reference images <span class="tag">private</span></h2>
    <p class="muted small">Only you see these — from your own books, for your private use. Not on the site, not in the API,
      not in the test environment.</p>
    ${rows.length ? html`<div class="image-list">${rows.map((i, n) => html`<figure class="image-item${n === 0 ? ' main' : ''}">
        <a href="/private-images/${i.id}" target="_blank" rel="noopener"><img src="/private-images/${i.id}" alt="" loading="lazy"></a>
        <figcaption class="muted small">${n === 0 && rows.length > 1 ? html`<span class="tag">main image</span> ` : ''}${[i.source_name, i.locator].filter(Boolean).join(', ') || (i.source_url ? '' : '—')}
          ${i.source_url ? html`<a href="${i.source_url}" target="_blank" rel="noopener noreferrer">${hostOf(i.source_url)} ↗</a>` : ''}
          <div class="image-actions">${n > 0 ? move(i, 'up', '↑', 'Move earlier') : ''}${n < rows.length - 1 ? move(i, 'down', '↓', 'Move later') : ''}
            ${n > 0 ? move(i, 'first', 'make main', 'Make this the main reference image — the one shown where the work has no public picture') : ''}
            <form method="post" action="/private-images/${i.id}/delete" class="inline"><button class="link small">delete</button></form></div></figcaption>
      </figure>`)}</div>` : ''}
    <div class="bar">
      <label>Book <select name="pi-source"><option value="">—</option>${sources.map((s) => html`<option value="${s.slug}"${cited && cited.slug === s.slug ? ' selected' : ''}>${s.label}</option>`)}</select></label>
      <label>Page, figure <input name="pi-locator" value="${cited ? cited.locator : ''}" placeholder="p. 33, fig. 29" size="16"></label>
      <input type="file" name="pi-file" accept="image/*">
    </div>
    <div class="bar pi-link-bar">
      <label>Image or page link <input name="pi-link" type="url" placeholder="https://… — an image, or the object's page" size="48"></label>
      <button type="button" class="pi-link-add">Add from link</button>
    </div>
    <div class="pi-choose" hidden></div>
    <p class="hint">Choose a file, or paste a screenshot (Ctrl/⌘ V) or drop an image anywhere in this box — or give the link of a
      picture or of the page that shows it (a museum's object page: its pictures are offered to choose from).</p>
  </section>`;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const PAGE_TYPES = new Set(['text/html', 'application/xhtml+xml']);

router.post('/artworks/:slug/private-images/from-link', express.json({ limit: '20kb' }), async (req, res) => {
  const { rows: [a] } = await adminPool.query('SELECT id FROM artworks WHERE slug = $1', [req.params.slug]);
  if (!a) return res.status(404).json({ error: 'no such work' });
  const url = String(req.body.url || '').trim();
  const page = req.body.page ? String(req.body.page).trim() : null;
  if (!url || url.length > 2000) return res.status(422).json({ error: 'a link, please' });
  let got;
  try { got = await fetchPublic(url, { referer: page }); } catch (err) {
    return res.status(422).json({ error: err instanceof FetchError ? err.message : 'could not fetch it' });
  }
  if (PAGE_TYPES.has(got.type)) {
    const html = got.body.toString('utf8');
    const pictures = picturesOn(html, got.url, await galleryPictures(html, got.url));
    return pictures.length ? res.json({ page: got.url, pictures }) : res.status(422).json({ error: 'no pictures found on that page — try the image’s own address' });
  }
  let image;
  try { image = await toWebp(got.body); } catch { return res.status(422).json({ error: 'not an image this panel can read' }); }
  const source = String(req.body.source || '').trim();
  const sourceId = source ? (await adminPool.query('SELECT id FROM bibliography WHERE slug = $1', [source])).rows[0]?.id : null;
  if (source && !sourceId) return res.status(422).json({ error: `no source “${source}”` });
  const locator = String(req.body.locator || '').trim() || null;
  const { rows: [img] } = await adminPool.query(`INSERT INTO private_images (artwork_id, owner_id, source_id, locator, bytes, width, height, original_bytes, source_url, position)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT coalesce(max(position) + 1, 0) FROM private_images WHERE artwork_id = $1 AND owner_id = $2)) RETURNING id`,
  [a.id, req.user.id, sourceId, locator, image.bytes, image.width, image.height, got.body.length, page || got.url]);
  res.status(201).json({ id: Number(img.id), url: `/private-images/${img.id}` });
});

router.get('/private-images/preview', async (req, res) => {
  const url = String(req.query.url || '');
  try {
    const got = await fetchPublic(url, { referer: req.query.page ? String(req.query.page) : null });
    if (!/^image\//.test(got.type)) return res.status(415).end();
    const small = await sharp(got.body, { failOn: 'none' }).rotate().resize({ width: 240, height: 240, fit: 'inside' }).webp({ quality: 70 }).toBuffer();
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' }).send(small);
  } catch { res.status(404).end(); }
});

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
  const { rows: [img] } = await adminPool.query(`INSERT INTO private_images (artwork_id, owner_id, source_id, locator, bytes, width, height, original_bytes, position)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT coalesce(max(position) + 1, 0) FROM private_images WHERE artwork_id = $1 AND owner_id = $2)) RETURNING id`, [a.id, req.user.id, sourceId, locator, image.bytes, image.width, image.height, req.body.length]);
  res.status(201).json({ id: Number(img.id), url: `/private-images/${img.id}` });
});

router.get('/private-images/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).end();
  const { rows: [img] } = await adminPool.query('SELECT content_type, bytes FROM private_images WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  if (!img) return res.status(404).end();
  // ?w=250 / 500: a smaller rendition for the site's previews (lists, an artist's works)
  const w = Number(req.query.w);
  let body = img.bytes;
  let type = img.content_type;
  if ([250, 500].includes(w)) {
    try {
      body = await sharp(img.bytes).resize({ width: w, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
      type = 'image/webp';
    } catch { /* unreadable for sharp: the stored image as it is */ }
  }
  res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(body);
});

// up | down | first: the account's images of that work renumbered 0, 1, 2 … in the new order
router.post('/private-images/:id/move', express.urlencoded({ extended: false }), async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !['up', 'down', 'first'].includes(req.body.dir)) return res.status(404).end();
  const db = await adminPool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [me] } = await db.query(`SELECT i.artwork_id, a.slug FROM private_images i JOIN artworks a ON a.id = i.artwork_id
      WHERE i.id = $1 AND i.owner_id = $2`, [req.params.id, req.user.id]);
    if (!me) { await db.query('ROLLBACK'); return res.status(404).end(); }
    const { rows } = await db.query(`SELECT id FROM private_images WHERE artwork_id = $1 AND owner_id = $2 ORDER BY position, id FOR UPDATE`, [me.artwork_id, req.user.id]);
    const ids = rows.map((r) => String(r.id));
    const at = ids.indexOf(req.params.id);
    const to = req.body.dir === 'first' ? 0 : req.body.dir === 'up' ? at - 1 : at + 1;
    if (to >= 0 && to < ids.length && to !== at) {
      ids.splice(to, 0, ...ids.splice(at, 1));
      for (const [pos, id] of ids.entries()) await db.query('UPDATE private_images SET position = $2 WHERE id = $1', [id, pos]);
    }
    await db.query('COMMIT');
    res.redirect(303, `/artworks/${me.slug}#private-images`);
  } catch (err) { await db.query('ROLLBACK'); throw err; } finally { db.release(); }
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
