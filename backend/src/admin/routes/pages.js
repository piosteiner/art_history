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
const { wordDiff } = require('../textdiff');
const { send, withTx, notFoundPage, friendly, history, historyTable } = require('../core');
const { renderPage, pageHeadings, siteAddress, reorderChapters, splitChapters, replaceChapter, words, chars, IMAGE_NAME } = require('../../pages');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
// the site's address of a page (src/pages.js, frontend: src/views/page.ts)
const siteUrl = (p) => `${SITE}${siteAddress(p.slug)}`;
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
  const pending = new Map(await Promise.all(rows.map(async (p) => [p.id, (await changesOf(p, req.user.id)).length])));
  send(req, res, { title: 'Pages', body: html`<h1>Pages</h1>
    <p class="muted">Text pages of the site, written here in Markdown — Obsidian's forms included (![[image]], ==highlight==, task lists).</p>
    <div class="table-wrap"><table><thead><tr><th>Title</th><th>Slug</th><th>On the site</th><th>Length</th><th>Images</th><th></th></tr></thead><tbody>
      ${rows.map((p) => html`<tr><td><a href="/pages/${p.slug}/edit">${p.title}</a></td><td class="muted">${p.slug}</td>
        <td>${p.published ? 'visible' : html`<span class="muted">hidden</span>`}${pending.get(p.id) ? html` · <a class="page-pending" href="/pages/${p.slug}/changes">● ${String(pending.get(p.id))} unpublished</a>` : ''}</td><td class="muted">${Number(p.chars).toLocaleString('en')} characters</td>
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

const sha = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const lastSync = async (pageId) => (await adminPool.query('SELECT sha256, at, kind FROM page_downloads WHERE page_id = $1', [pageId])).rows[0] || null;
const when = (d) => d.toISOString().slice(0, 16).replace('T', ' ');
const fileName = (p) => `${p.title.normalize('NFC').replace(/[\\/:*?"<>|]+/g, '-')}.md`;

// which part of the text is edited: 'all' · 0 (the introduction) · 1 … (a chapter); none: the outline only
function partOf(text, asked) {
  const { intro, chapters } = splitChapters(text);
  if (asked === 'all' || (!chapters.length && asked === undefined)) return { key: 'all', label: 'the whole text', md: text };
  if (asked === undefined || asked === '') return null;
  const n = Number(asked);
  if (n === 0) return { key: '0', label: 'the introduction', md: intro.md, chapter: null };
  const c = chapters.find((x) => x.index === n);
  return c ? { key: String(n), label: `chapter ${n}: ${c.title}`, md: c.md, chapter: c.id } : null;
}

// A draft remembers the text of its part as it was on the site when the draft began (base_sha = sha of that part's
// text): a change elsewhere on the page — another chapter published — leaves it current; only a change of its own
// part on the site makes it stale.
// This account's unpublished changes (drafts, 117) of a page, part by part, compared with the text on the site: a
// draft identical to its part is none. → [{key, label, saved_at, base_changed, live, draft}]
async function changesOf(p, userId) {
  const { rows } = await adminPool.query('SELECT part, base_sha, body_md, saved_at FROM page_drafts WHERE page_id = $1 AND user_id = $2', [p.id, userId]);
  const out = [];
  for (const d of rows) {
    const part = partOf(p.body_md, d.part);
    if (!part || d.body_md === part.md) continue;
    out.push({ key: part.key, label: part.label, saved_at: d.saved_at, base_changed: d.base_sha !== sha(part.md), live: part.md, draft: d.body_md });
  }
  const order = (k) => (k === 'all' ? -1 : Number(k));
  return out.sort((a, b) => order(a.key) - order(b.key));
}
// The unpublished changes of one part as a word diff: removed words struck through red, added ones green
const changesBox = (live, draft) => html`<div class="page-changes-diff">${wordDiff(live, draft)}</div>`;

function editPage(p, images, { flash = null, values = null, part = null, sync = null, draft = null, changes = [] } = {}) {
  const v = values || p;
  const { images: embedded } = renderPage(p.body_md, { imageBase: '' });
  const names = new Set(images.map((i) => i.name));
  const missing = embedded.filter((n) => !names.has(n));
  const unused = images.filter((i) => !embedded.includes(i.name));
  const { intro, chapters } = splitChapters(p.body_md);
  // [[# suggestions (editor.js): the headings of the other chapters — those of the part edited come from the editor
  const titles = new Map(chapters.map((c) => [c.id, c.title]));
  // a name used twice ("pm2" under two chapters) is written with the heading above it: [[#Projektaufbau#pm2]]
  const all = pageHeadings(p.body_md).all;
  const otherHeadings = part && part.key !== 'all' ? all.filter((h) => h.chapter !== part.chapter).map((h) => ({ text: h.text, level: h.level,
    chapter: h.chapter ? titles.get(h.chapter) : 'Introduction',
    path: all.filter((x) => x.key === h.key).length > 1 && h.above ? `${h.above}#${h.text}` : h.text })) : [];
  const changedSince = sync && sync.sha256 !== sha(p.body_md);
  const on = (k) => (part && part.key === k ? ' aria-current="true" class="on"' : '');
  // a part with unpublished changes of this account: marked in the outline
  const pending = new Set(changes.map((c) => c.key));
  const mark = (k) => (pending.has(k) ? html` <span class="page-pending" title="Unpublished changes — not on the site until you publish them">● unpublished</span>` : '');
  return { title: `Edit ${p.title}`, flash, body: html`<p class="muted"><a href="/pages">← Pages</a></p>
    <h1>${p.title}</h1>
    <p class="small">${p.published ? html`<a href="${siteUrl(p)}" target="_blank" rel="noopener">View on the site ↗</a>` : html`<span class="muted">Hidden — the site shows it once “Visible on the site” is ticked in the page settings.</span>`}
      <span class="muted">· <a href="/pages/${p.slug}/history">history</a> · ${words(p.body_md).toLocaleString('en')} words · ${chars(p.body_md).toLocaleString('en')} characters with spaces</span></p>
    <div class="page-layout">
    <nav class="page-outline" aria-label="Chapters">
      <h2>Chapters</h2>
      <p class="muted small">The text's top-level headings. Edit one at a time — it is put back in its place when you publish. Drag ⠿ to move a chapter (or focus it and use ↑ ↓): it moves on the site at once, your drafts move with it.</p>
      ${intro.md.trim() ? html`<p class="page-outline-intro"><a href="/pages/${p.slug}/edit?chapter=0"${on('0')}>Introduction</a> <span class="muted small">${String(words(intro.md))}</span>${mark('0')}</p>` : ''}
      <ol class="page-chapters"${chapters.length > 1 ? html` data-sortable="/pages/${p.slug}/order" data-sort-current="${part ? part.key : ''}"` : ''}>
        ${chapters.map((c) => html`<li class="sort-item" data-sort-id="${String(c.index)}">${chapters.length > 1 ? html`<button type="button" class="drag-handle" title="Drag to move the chapter (or focus and use ↑ ↓)" aria-label="Move chapter ${c.title}: drag, or arrow keys">⠿</button>` : ''}<a href="/pages/${p.slug}/edit?chapter=${String(c.index)}"${on(String(c.index))}>${c.title}</a> <span class="muted small">${String(words(c.md))}</span>${mark(String(c.index))}</li>`)}
      </ol>
      <p class="small"><a href="/pages/${p.slug}/edit?chapter=all"${on('all')}>Whole text</a>${mark('all')}</p>
      ${changes.length ? html`<p class="small"><a class="button secondary" href="/pages/${p.slug}/changes">Review unpublished changes (${String(changes.length)})</a></p>` : ''}
      <h2>Obsidian</h2>
      <p class="small"><a class="button secondary" href="/pages/${p.slug}/download" download>Download .md</a></p>
      <div class="field"><label for="pg-md">Upload .md</label>
        <input id="pg-md" type="file" accept=".md,.markdown,text/markdown,text/plain" data-md-upload="/pages/${p.slug}/upload">
        <p class="muted small">Replaces the whole text (the images stay; the old text stays in the history).</p></div>
      <p class="muted small" data-md-sync>${sync ? html`Last ${sync.kind} ${when(sync.at)}${changedSince ? html` — <b>changed in the CMS since</b>` : ' — no changes in the CMS since'}.` : 'Not downloaded yet.'}</p>
    </nav>
    <div class="page-main">
    ${part ? html`<form method="post" action="/pages/${p.slug}" class="form page-form">
      ${draft ? html`<div class="flash warning page-draft">Your unpublished changes of ${part.label} from ${when(draft.saved_at)} — they are not on the site until you publish them.
        ${draft.base_sha !== sha(part.md) ? html` <b>This part has changed on the site since</b>: Publish will show you before anything is overwritten.` : ''}</div>` : ''}
      <input type="hidden" name="chapter" value="${part.key}"><input type="hidden" name="base" value="${draft ? draft.base_sha : sha(part.md)}">
      <div class="field"><label for="pg-body">Text — ${part.label}</label>
        <textarea id="pg-body" name="body_md" class="md" rows="30" data-upload="/pages/${p.slug}/images" data-preview="/pages/${p.slug}/preview"
          data-headings="${JSON.stringify(otherHeadings)}" data-autosave="/pages/${p.slug}/draft">${values && values.body_md !== undefined ? values.body_md : draft ? draft.body_md : part.md}</textarea>
        <p class="muted small page-autosave" data-autosave-status aria-live="polite">Your changes are saved as a draft as you type; “Publish changes” puts them on the site.</p>
        <details class="page-changes" data-page-changes open${draft ? '' : ' hidden'}>
          <summary>Unpublished changes in ${part.label} <span class="muted small">— compared with the text on the site; updated as the draft is saved</span></summary>
          <div data-page-changes-body>${draft ? changesBox(part.md, draft.body_md) : ''}</div></details>
        <div class="hint">Markdown, as in Obsidian: <code>![[name.webp]]</code> embeds an image of this page (<code>![[name.webp|400]]</code> 400 px wide,
          <code>![[name.webp|caption]]</code> with a caption), <code>[[#Heading]]</code> a link to a heading of this page, in any chapter (type <code>[[#</code> for the list), <code>==highlight==</code>, <code>- [x]</code> tasks, tables, <code>&lt;span style="color:…"&gt;</code>.
          Drop or paste an image into the text to upload and embed it. A new <code>#</code> heading starts a new chapter.</div></div>
      <div class="actions"><button data-publish${draft || values ? '' : ' disabled'}>Publish changes</button>
        <button type="submit" form="pg-discard" class="secondary" data-discard${draft ? '' : ' hidden'}>Discard changes</button></div>
    </form>
    <form id="pg-discard" method="post" action="/pages/${p.slug}/draft/discard" data-confirm="Discard your changes of ${part.label}? The text on the site stays as it is."><input type="hidden" name="chapter" value="${part.key}"></form>`
      : html`<p class="muted">Choose a chapter on the left to edit it${chapters.length ? '' : ', or the whole text'}.</p>`}
    <details class="page-settings"${flash && flash.settings ? ' open' : ''}><summary>Page settings</summary>
      <form method="post" action="/pages/${p.slug}/settings" class="form">
        <div class="field-pair"><div class="field"><label for="pg-title">Title</label><input id="pg-title" name="title" value="${v.title}" required></div>
          <div class="field"><label for="pg-lang">Language</label><input id="pg-lang" name="lang" value="${v.lang}" required pattern="[a-z]{2}(-[A-Z]{2})?">
            <div class="hint">de-CH: Swiss German spelling (ss, no ß) — the site tells browsers and screen readers.</div></div></div>
        <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${v.published ? ' checked' : ''}> Visible on the site</label>
          <div class="hint">The whole page: hidden, the site doesn't show it at all. Changes to the text go on the site with “Publish changes”.</div></div>
        <div class="actions"><button class="secondary">Save settings</button></div>
      </form></details>
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
    </section>
    </div></div>` };
}

router.get('/pages/:slug/edit', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const part = partOf(p.body_md, req.query.chapter);
  if (req.query.chapter !== undefined && req.query.chapter !== '' && !part) return res.redirect(303, `/pages/${p.slug}/edit`);
  const draft = part ? (await adminPool.query('SELECT base_sha, body_md, saved_at FROM page_drafts WHERE page_id = $1 AND user_id = $2 AND part = $3',
    [p.id, req.user.id, part.key])).rows[0] : null;
  // a draft that says nothing new (saved, then typed back) is no draft
  const useful = draft && !(draft.base_sha === sha(p.body_md) && draft.body_md === part.md) ? draft : null;
  send(req, res, editPage(p, await imagesOf(p.id), { part, sync: await lastSync(p.id), draft: useful, changes: await changesOf(p, req.user.id) }));
});

// Every unpublished change of this account in one page, part by part as word diffs — to audit before saving
router.get('/pages/:slug/changes', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const changes = await changesOf(p, req.user.id);
  // after publishing from here: how many went on the site, how many stayed (their part changed on the site meanwhile)
  const published = Number(req.query.published) || 0;
  const kept = Number(req.query.kept) || 0;
  const flash = req.query.published === undefined ? null : published
    ? { kind: kept ? 'warning' : 'ok', text: `Published ${published} ${published === 1 ? 'part' : 'parts'} — on the site now.${kept ? ` ${kept} kept as draft: their part changed on the site since — open them to see what would be overwritten.` : ''}` }
    : { kind: 'warning', text: 'Nothing published: the part changed on the site since the draft began — open it to see what would be overwritten.' };
  const ready = changes.filter((c) => !c.base_changed);
  send(req, res, { title: `Unpublished changes · ${p.title}`, flash, body: html`<p class="muted"><a href="/pages/${p.slug}/edit">← ${p.title}</a></p>
    <h1>Unpublished changes</h1>
    <p class="muted">Your changes of ${p.title}, compared with the text on the site: <del class="legend-del">removed</del> · <ins class="legend-ins">added</ins>. Nothing here is on the site until you publish it.</p>
    ${ready.length > 1 ? html`<form method="post" action="/pages/${p.slug}/publish" class="inline" data-confirm="Publish all ${String(ready.length)} parts? They go on the site now.">
      <input type="hidden" name="chapter" value="all-drafts"><button>Publish all (${String(ready.length)})</button></form>` : ''}
    ${changes.length ? changes.map((c) => html`<section class="page-change">
      <h2>${c.label.replace(/^./, (x) => x.toUpperCase())}</h2>
      <p class="muted small">Saved as draft ${when(c.saved_at)}${c.base_changed ? html` · <b>this part changed on the site since</b> — open it: publishing there shows you what would be overwritten` : ''}
        · <a href="/pages/${p.slug}/edit?chapter=${c.key}">open in the editor</a></p>
      ${changesBox(c.live, c.draft)}
      <div class="actions">${c.base_changed ? '' : html`<form method="post" action="/pages/${p.slug}/publish" class="inline">
        <input type="hidden" name="chapter" value="${c.key}"><button>Publish</button></form>`}
      <form method="post" action="/pages/${p.slug}/draft/discard" class="inline" data-confirm="Discard these changes? The text on the site stays as it is.">
        <input type="hidden" name="chapter" value="${c.key}"><input type="hidden" name="back" value="changes"><button class="secondary">Discard</button></form></div>
    </section>`) : html`<p>No unpublished changes — everything you wrote is on the site.</p>`}` });
});

// The text as a .md file, named after the page — for Obsidian; remembered, so an upload can tell what changed since
router.get('/pages/:slug/download', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  await adminPool.query(`INSERT INTO page_downloads (page_id, sha256, kind) VALUES ($1, $2, 'download')
    ON CONFLICT (page_id) DO UPDATE SET sha256 = EXCLUDED.sha256, at = now(), kind = 'download'`, [p.id, sha(p.body_md)]);
  const name = fileName(p);
  res.set({ 'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` });
  res.send(p.body_md);
});

// A .md file replaces the whole text (editor/uploads.js). Changed in the CMS since the last download or upload (or
// never synced and different): 409 with the reason; ?force=1 after the owner confirmed.
router.post('/pages/:slug/upload', express.text({ type: () => true, limit: '5mb' }), async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).json({ error: 'no such page' });
  const text = String(req.body || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) return res.status(422).json({ error: 'The file is empty.' });
  const sync = await lastSync(p.id);
  const current = sha(p.body_md);
  if (req.query.force !== '1' && p.body_md.trim() && sha(text) !== current && (!sync || sync.sha256 !== current)) {
    return res.status(409).json({ error: sync
      ? `The text was changed in the CMS after your last ${sync.kind} (${when(sync.at)}). The file would undo those changes (they stay in the history).`
      : 'The page already has a text that was never downloaded. The file replaces it (the old text stays in the history).' });
  }
  await withTx(req.user, (db) => db.query('UPDATE pages SET body_md = $2 WHERE id = $1', [p.id, text]));
  await adminPool.query(`INSERT INTO page_downloads (page_id, sha256, kind) VALUES ($1, $2, 'upload')
    ON CONFLICT (page_id) DO UPDATE SET sha256 = EXCLUDED.sha256, at = now(), kind = 'upload'`, [p.id, sha(text)]);
  const { chapters } = splitChapters(text);
  res.json({ chapters: chapters.length, words: words(text) });
});

// every revision (audit_log, like any entry's): who changed what, word by word
router.get('/pages/:slug/history', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const h = await history(adminPool, "a.table_name = 'pages' AND a.row_id = $1", [p.id], { limit: 200 });
  send(req, res, { title: `History of ${p.title}`, body: html`<p class="muted"><a href="/pages/${p.slug}/edit">← ${p.title}</a></p>
    <h1>History of ${p.title}</h1>${historyTable(h.rows, { showWhat: false })}` });
});

// Save: the settings, and the part being edited put back in its place (the rest of the text exactly as it was). The text
// changed since the part was opened (another tab, an upload): not saved — the edited version comes back in the editor,
// and saving again (now based on the current text) puts it in.
// Publish: the edited part goes on the site. Refused when that part changed on the site since the editing began
// (base = sha of the part's text then); a change in another chapter doesn't matter.
router.post('/pages/:slug', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const chapter = req.body.chapter;
  const edited = req.body.body_md === undefined ? undefined : String(req.body.body_md).replace(/\r\n/g, '\n');
  if (chapter === undefined || edited === undefined) return res.redirect(303, `/pages/${p.slug}/edit`);
  const part = partOf(p.body_md, chapter);
  const again = async (flash, status = 409) => send(req, res, { ...editPage(p, await imagesOf(p.id), { values: { ...p, body_md: edited },
    part: part || { key: String(chapter), label: 'your text', md: '' }, flash, sync: await lastSync(p.id), changes: await changesOf(p, req.user.id) }), status });
  if (!part) return again({ kind: 'error', text: 'This chapter is no longer there. Your version is in the editor — copy it, then open the chapter list again.' });
  if (req.body.base !== sha(part.md)) {
    return again({ kind: 'error', text: `${part.label.replace(/^./, (x) => x.toUpperCase())} was changed on the site since you began (another tab or an upload). Your version is in the editor — publish again to put it in, or open the part again to see the current one.` });
  }
  const body = chapter === 'all' ? edited : replaceChapter(p.body_md, Number(chapter), edited);
  try {
    await withTx(req.user, (db) => db.query('UPDATE pages SET body_md = $2 WHERE id = $1', [p.id, body]));
  } catch (err) {
    return again({ kind: 'error', text: friendly(err) }, 422);
  }
  await adminPool.query('DELETE FROM page_drafts WHERE page_id = $1 AND user_id = $2 AND part = $3', [p.id, req.user.id, String(chapter)]);
  res.redirect(303, `/pages/${p.slug}/edit?chapter=${encodeURIComponent(chapter)}&done=page-published`);
});

// Chapters moved (the outline's drag and drop, editor/sortable.js): ids = the chapters' indices as they were, in their new
// order. One change of the text (in its history); the drafts of every account move with their chapters — a draft that
// was current stays current (its base follows the chapter's text), the whole text's draft becomes stale. The chapter
// being edited is opened again at its new place (X-Location).
router.post('/pages/:slug/order', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).type('text').send('No such page.');
  const order = String(req.body.ids || '').split(',').map(Number);
  const body = reorderChapters(p.body_md, order);
  if (body === null) return res.status(422).type('text').send('The chapters changed meanwhile — the page reloads with the current order.');
  const before = splitChapters(p.body_md).chapters;
  const after = splitChapters(body).chapters;
  const newIndex = (k) => order.indexOf(k) + 1;
  await withTx(req.user, async (db) => {
    await db.query('UPDATE pages SET body_md = $2 WHERE id = $1', [p.id, body]);
    const { rows } = await db.query("DELETE FROM page_drafts WHERE page_id = $1 AND part ~ '^[1-9][0-9]*$' RETURNING *", [p.id]);
    for (const d of rows) {
      const k = Number(d.part);
      if (!before[k - 1]) continue;                     // a draft of a chapter no longer there: dropped
      const n = newIndex(k);
      const base = d.base_sha === sha(before[k - 1].md) ? sha(after[n - 1].md) : d.base_sha;
      await db.query('INSERT INTO page_drafts (page_id, user_id, part, base_sha, body_md, saved_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [p.id, d.user_id, String(n), base, d.body_md, d.saved_at]);
    }
  });
  const current = Number(req.body.current);
  if (current >= 1) res.set('X-Location', `/pages/${p.slug}/edit?chapter=${newIndex(current)}`);
  res.status(204).end();
});

// The page's settings: title, language, visible on the site — apart from the text, which is published by part
router.post('/pages/:slug/settings', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const values = { title: String(req.body.title || '').trim(), lang: String(req.body.lang || 'de-CH').trim(), published: req.body.published === '1' };
  try {
    await withTx(req.user, (db) => db.query('UPDATE pages SET title = $2, lang = $3, published = $4 WHERE id = $1', [p.id, values.title, values.lang, values.published]));
  } catch (err) {
    return send(req, res, { ...editPage(p, await imagesOf(p.id), { values: { ...p, ...values }, flash: { kind: 'error', text: friendly(err), settings: true },
      sync: await lastSync(p.id), changes: await changesOf(p, req.user.id) }), status: 422 });
  }
  res.redirect(303, `/pages/${p.slug}/edit?done=saved`);
});

// Publish from the review page: one part's draft (chapter=<key>) or all of them (chapter=all-drafts). Later chapters
// first, so a draft that adds a chapter doesn't move the ones still to come; a draft whose part changed on the site
// since it began stays a draft (the page says so) — opened, it shows what would be overwritten.
router.post('/pages/:slug/publish', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const wanted = String(req.body.chapter || '');
  const order = (k) => (k === 'all' ? Infinity : Number(k));
  const drafts = (await changesOf(p, req.user.id)).filter((c) => wanted === 'all-drafts' || c.key === wanted).sort((x, y) => order(y.key) - order(x.key));
  let body = p.body_md;
  const done = [];
  for (const c of drafts) {
    if (c.base_changed) continue;
    if (c.key === 'all' && drafts.length > 1) continue;   // the whole text beside chapter drafts: only on its own
    const next = c.key === 'all' ? c.draft : replaceChapter(body, Number(c.key), c.draft);
    if (next === null) continue;
    body = next;
    done.push(c.key);
  }
  if (done.length) {
    try {
      await withTx(req.user, (db) => db.query('UPDATE pages SET body_md = $2 WHERE id = $1', [p.id, body]));
    } catch (err) {
      return send(req, res, { title: 'Not published', flash: { kind: 'error', text: friendly(err) },
        body: html`<p><a href="/pages/${p.slug}/changes">← Unpublished changes</a></p>` });
    }
    await adminPool.query('DELETE FROM page_drafts WHERE page_id = $1 AND user_id = $2 AND part = ANY($3)', [p.id, req.user.id, done]);
  }
  const skipped = drafts.length - done.length;
  res.redirect(303, `/pages/${p.slug}/changes?published=${done.length}&kept=${skipped}`);
});

// Autosave (117, editor/uploads.js): the part being edited as a draft of this account — not on the site until Save
router.post('/pages/:slug/draft', express.json({ limit: '5mb' }), async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).json({ error: 'no such page' });
  const part = String(req.body.chapter || '');
  if (!/^(all|\d{1,4})$/.test(part) || typeof req.body.body !== 'string' || typeof req.body.base !== 'string') return res.status(422).json({ error: 'bad draft' });
  const { rows: [d] } = await adminPool.query(`INSERT INTO page_drafts (page_id, user_id, part, base_sha, body_md) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (page_id, user_id, part) DO UPDATE SET base_sha = EXCLUDED.base_sha, body_md = EXCLUDED.body_md, saved_at = now() RETURNING saved_at`,
  [p.id, req.user.id, part, req.body.base, req.body.body.replace(/\r\n/g, '\n')]);
  // the changes against the site, for the editor's panel (uploads.js)
  const live = partOf(p.body_md, part);
  const body = req.body.body.replace(/\r\n/g, '\n');
  const changed = !!live && body !== live.md;
  res.json({ saved_at: d.saved_at, changed, changes_html: changed ? String(changesBox(live.md, body)) : '' });
});

router.post('/pages/:slug/draft/discard', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return notFoundPage(req, res);
  const part = String(req.body.chapter || '');
  await adminPool.query('DELETE FROM page_drafts WHERE page_id = $1 AND user_id = $2 AND part = $3', [p.id, req.user.id, part]);
  res.redirect(303, req.body.back === 'changes' ? `/pages/${p.slug}/changes` : `/pages/${p.slug}/edit?chapter=${encodeURIComponent(part)}&done=page-discarded`);
});

// Preview (editor's button): the page as the site will show it, images from here (also those of an unpublished page)
router.post('/pages/:slug/preview', async (req, res) => {
  const p = await bySlug(req.params.slug);
  if (!p) return res.status(404).end();
  const imgs = await imagesOf(p.id);
  const text = String(req.body.text || '').slice(0, 2000000);
  // [[#Heading]]: the saved page's headings, and those only in the text previewed (just written)
  const headings = pageHeadings(p.body_md);
  const fresh = pageHeadings(text);
  for (const [k, h] of fresh) if (!headings.has(k)) headings.set(k, h);
  headings.all = [...headings.all, ...fresh.all.filter((h) => !headings.all.some((x) => x.key === h.key))];
  res.type('html').send(renderPage(text, { imageBase: `/pages/${p.slug}/images/`, headings, linkBase: siteUrl(p),
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
