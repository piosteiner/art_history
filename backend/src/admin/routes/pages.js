// Admin panel — text pages of the site (migration 114): the project documentation and any further page. Written in the
// Markdown editor (src/admin/editor/editor.js) like every text; the page's own Preview renders with src/pages.js (the
// Obsidian forms: ![[image]], ==highlight==, task lists). Images: uploaded here — several files at once, dropped on the
// editor or pasted into it (editor/uploads.js) — and embedded by name, ![[name.webp]], so a note from Obsidian keeps its
// embeds when its attachments are uploaded under their own names. Mounted by src/admin/index.js before the entry pages.
const express = require('express');
const crypto = require('crypto');
const sharp = require('sharp');
const { adminPool } = require('../../db');
const { html } = require('../html');
const { send, withTx, notFoundPage, friendly, history, historyTable } = require('../core');
const { renderPage, IMAGE_NAME } = require('../../pages');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
// the site's address of a page (frontend: src/views/page.ts)
const ADDRESS = { 'projekt-dokumentation': '/dokumentation' };
const siteUrl = (p) => `${SITE}${ADDRESS[p.slug] || `/pages/${p.slug}`}`;
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif' };
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const slugOk = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

// Every upload becomes WebP (migration 115; settings as the adenai map's media library): the camera's rotation applied
// (rotate()), other metadata dropped, the longest side at most 1600 px, quality 82; an animated GIF stays animated.
// An upload that is already a small enough WebP is kept as it was when converting would not make it smaller.
const MAX_SIDE = 1600;
const WEBP_QUALITY = 82;
async function toWebp(input) {
  const meta = await sharp(input, { animated: true }).metadata();
  const animated = (meta.pages || 1) > 1;
  const { data, info } = await sharp(input, { animated })
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  const height = animated ? info.pageHeight || info.height : info.height;
  if (meta.format === 'webp' && !animated && input.length <= data.length && Math.max(meta.width, meta.height) <= MAX_SIDE) {
    return { bytes: input, width: meta.width, height: meta.height };
  }
  return { bytes: data, width: info.width, height };
}

const bySlug = async (slug) => (await adminPool.query('SELECT * FROM pages WHERE slug = $1', [slug])).rows[0] || null;
const imagesOf = async (pageId) => (await adminPool.query(
  'SELECT id, name, content_type, octet_length(bytes) AS size, original_bytes, width, height, created_at FROM page_images WHERE page_id = $1 ORDER BY name', [pageId])).rows;

router.get('/pages', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT p.*, length(p.body_md) AS chars, (SELECT count(*)::int FROM page_images i WHERE i.page_id = p.id) AS images
    FROM pages p ORDER BY p.title COLLATE sort_natural`);
  send(req, res, { title: 'Pages', body: html`<h1>Pages</h1>
    <p class="muted">Text pages of the site, written here in Markdown — Obsidian's forms included (![[image]], ==highlight==, task lists).</p>
    <div class="table-wrap"><table><thead><tr><th>Title</th><th>Slug</th><th>Status</th><th>Length</th><th>Images</th><th></th></tr></thead><tbody>
      ${rows.map((p) => html`<tr><td><a href="/pages/${p.slug}/edit">${p.title}</a></td><td class="muted">${p.slug}</td>
        <td>${p.published ? 'published' : html`<span class="muted">draft</span>`}</td><td class="muted">${Number(p.chars).toLocaleString('en')} characters</td>
        <td class="muted">${String(p.images)}</td><td>${p.published ? html`<a href="${siteUrl(p)}" target="_blank" rel="noopener">view ↗</a>` : ''}</td></tr>`)}
    </tbody></table></div>
    <form method="post" action="/pages" class="form inline-form"><div class="field-pair">
      <div class="field"><label for="pg-title">New page: title</label><input id="pg-title" name="title" required></div>
      <div class="field"><label for="pg-slug">Slug</label><input id="pg-slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" data-slug-field data-slug-from="pg-title"></div></div>
      <div class="actions"><button>+ New page</button></div></form>` });
});

router.post('/pages', async (req, res) => {
  const title = String(req.body.title || '').trim();
  const slug = String(req.body.slug || '').trim();
  if (!title || !slugOk(slug)) return res.redirect(303, '/pages');
  try {
    await withTx(req.user, (db) => db.query('INSERT INTO pages (slug, title) VALUES ($1, $2)', [slug, title]));
  } catch (err) {
    if (err.constraint === 'pages_slug_key') return res.redirect(303, `/pages/${slug}/edit`);
    throw err;
  }
  res.redirect(303, `/pages/${slug}/edit?done=created`);
});

function editPage(p, images, { flash = null, values = null } = {}) {
  const v = values || p;
  const { images: embedded } = renderPage(v.body_md, { imageBase: '' });
  const names = new Set(images.map((i) => i.name));
  const missing = embedded.filter((n) => !names.has(n));
  const unused = images.filter((i) => !embedded.includes(i.name));
  return { title: `Edit ${p.title}`, flash, body: html`<p class="muted"><a href="/pages">← Pages</a></p>
    <h1>${p.title}</h1>
    <p class="small">${p.published ? html`<a href="${siteUrl(p)}" target="_blank" rel="noopener">View on the site ↗</a>` : html`<span class="muted">Not published yet — the site shows it once “Published” is ticked.</span>`}
      <span class="muted">· <a href="/pages/${p.slug}/history">history</a></span></p>
    <form method="post" action="/pages/${p.slug}" class="form page-form">
      <div class="field-pair"><div class="field"><label for="pg-title">Title</label><input id="pg-title" name="title" value="${v.title}" required></div>
        <div class="field"><label for="pg-lang">Language</label><input id="pg-lang" name="lang" value="${v.lang}" required pattern="[a-z]{2}(-[A-Z]{2})?">
          <div class="hint">de-CH: Swiss German spelling (ss, no ß) — the site tells browsers and screen readers.</div></div></div>
      <div class="field"><label for="pg-body">Text</label>
        <textarea id="pg-body" name="body_md" class="md" rows="30" data-upload="/pages/${p.slug}/images" data-preview="/pages/${p.slug}/preview">${v.body_md}</textarea>
        <div class="hint">Markdown, as in Obsidian: <code>![[name.webp]]</code> embeds an image of this page (<code>![[name.webp|400]]</code> 400 px wide,
          <code>![[name.webp|caption]]</code> with a caption), <code>==highlight==</code>, <code>- [x]</code> tasks, tables, <code>&lt;span style="color:…"&gt;</code>.
          Drop or paste an image into the text to upload and embed it.</div></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${v.published ? ' checked' : ''}> Published</label></div>
      <div class="actions"><button>Save</button></div>
    </form>
    <section class="page-images">
      <h2>Images <span class="muted small">${String(images.length)}</span></h2>
      <p class="muted small">Upload the attachments of the note under their own names (Obsidian: the files in its attachments folder) and every
        <code>![[…]]</code> finds its image. WebP, PNG, JPEG, GIF or AVIF, up to 10 MB each — stored as WebP, at most 1600 px on the longest side (the name stays, so the embeds
        keep working). Uploading a file of the same name replaces the image.</p>
      <div class="field"><label for="pg-files">Upload images</label>
        <input id="pg-files" type="file" multiple accept="image/webp,image/png,image/jpeg,image/gif,image/avif" data-image-upload="/pages/${p.slug}/images">
        <p class="muted small" data-image-upload-status aria-live="polite"></p></div>
      ${missing.length ? html`<div class="flash warning page-images-missing"><b>Embedded, not uploaded yet (${String(missing.length)}):</b>
        ${missing.map((n, i) => html`${i ? ', ' : ''}<code>${n}</code>`)}</div>` : ''}
      <ul class="page-image-list" data-image-list>${images.map((i) => html`<li data-image-id="${String(i.id)}">
        <img src="/pages/${p.slug}/images/${encodeURIComponent(i.name)}" alt="" loading="lazy">
        <code>${i.name}</code> <span class="muted small">${kb(Number(i.size))}${i.original_bytes ? ` WebP (was ${kb(i.original_bytes)})` : ''}${i.width ? ` · ${i.width} × ${i.height}` : ''}${unused.includes(i) ? ' · not embedded' : ''}</span>
        <button type="button" class="link-button" data-copy="![[${i.name}]]">copy embed</button>
        <button type="button" class="link-button danger" data-image-delete="/pages/${p.slug}/images/${String(i.id)}/delete">delete</button></li>`)}</ul>
    </section>` };
}

router.get('/pages/:slug/edit', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  send(req, res, editPage(p, await imagesOf(p.id)));
});

// every revision (audit_log, like any entry's): who changed what, word by word
router.get('/pages/:slug/history', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const h = await history(adminPool, "a.table_name = 'pages' AND a.row_id = $1", [p.id], { limit: 200 });
  send(req, res, { title: `History of ${p.title}`, body: html`<p class="muted"><a href="/pages/${p.slug}/edit">← ${p.title}</a></p>
    <h1>History of ${p.title}</h1>${historyTable(h.rows, { showWhat: false })}` });
});

router.post('/pages/:slug', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const values = { title: String(req.body.title || '').trim(), lang: String(req.body.lang || 'de-CH').trim(),
    body_md: String(req.body.body_md || '').replace(/\r\n/g, '\n'), published: req.body.published === '1' };
  try {
    await withTx(req.user, (db) => db.query('UPDATE pages SET title = $2, lang = $3, body_md = $4, published = $5 WHERE id = $1',
      [p.id, values.title, values.lang, values.body_md, values.published]));
  } catch (err) {
    return send(req, res, { ...editPage(p, await imagesOf(p.id), { values, flash: { kind: 'error', text: friendly(err) } }), status: 422 });
  }
  res.redirect(303, `/pages/${p.slug}/edit?done=saved`);
});

// Preview (editor's button): the page as the site will show it, images from here (also those of an unpublished page)
router.post('/pages/:slug/preview', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).end();
  const imgs = await imagesOf(p.id);
  res.type('html').send(renderPage(String(req.body.text || '').slice(0, 2000000), { imageBase: `/pages/${p.slug}/images/`,
    known: new Set(imgs.map((i) => i.name)), dims: new Map(imgs.filter((i) => i.width).map((i) => [i.name, i])) }).html);
});

// Upload one image: the file as the body, its name in ?name= (editor/uploads.js). Same name → replaced.
router.post('/pages/:slug/images', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).json({ error: 'no such page' });
  const name = String(req.query.name || '').trim().replace(/[/\\]/g, '');
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  const type = ext && TYPES[ext.toLowerCase()];
  if (!IMAGE_NAME.test(name) || !type) return res.status(422).json({ error: `“${name}”: a WebP, PNG, JPEG, GIF or AVIF file with a plain name (letters, digits, spaces, . _ -)` });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(422).json({ error: 'empty file' });
  let image;
  try {
    image = await toWebp(req.body);
  } catch {
    return res.status(422).json({ error: `“${name}” could not be read as an image` });
  }
  const sha256 = crypto.createHash('sha256').update(image.bytes).digest('hex');
  try {
    await withTx(req.user, (db) => db.query(`INSERT INTO page_images (page_id, name, content_type, bytes, sha256, width, height, original_bytes)
      VALUES ($1, $2, 'image/webp', $3, $4, $5, $6, $7)
      ON CONFLICT (page_id, name) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256,
        width = EXCLUDED.width, height = EXCLUDED.height, original_bytes = EXCLUDED.original_bytes, created_at = now()`,
    [p.id, name, image.bytes, sha256, image.width, image.height, req.body.length]));
  } catch (err) {
    return res.status(422).json({ error: friendly(err) });
  }
  const { rows: [img] } = await adminPool.query('SELECT id FROM page_images WHERE page_id = $1 AND name = $2', [p.id, name]);
  res.status(201).json({ id: Number(img.id), name, size: image.bytes.length, original_size: req.body.length, width: image.width, height: image.height,
    size_label: `${kb(image.bytes.length)} WebP (was ${kb(req.body.length)}) · ${image.width} × ${image.height}`,
    url: `/pages/${p.slug}/images/${encodeURIComponent(name)}`, embed: `![[${name}]]`, delete: `/pages/${p.slug}/images/${img.id}/delete` });
});

router.get('/pages/:slug/images/:name', async (req, res) => {
  const { rows: [img] } = await adminPool.query(`SELECT i.content_type, i.bytes FROM page_images i JOIN pages p ON p.id = i.page_id
    WHERE p.slug = $1 AND i.name = $2`, [req.params.slug, req.params.name]);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.content_type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60' }).send(img.bytes);
});

router.post('/pages/:slug/images/:id/delete', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p || !/^\d+$/.test(req.params.id)) return res.status(404).end();
  await withTx(req.user, (db) => db.query('DELETE FROM page_images WHERE id = $1 AND page_id = $2', [req.params.id, p.id]));
  res.status(204).end();
});

module.exports = router;
