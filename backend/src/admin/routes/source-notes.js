// Source files and reading notes (migration 253, owner 2026-11-16). Private like the reference images: only admins see
// them — the notes are written with AI and stay private until the owner has proofread them and pressed "Publish";
// then the API (view public_source_notes) and the site show them. The files never leave the CMS.
//   GET  /source-files/:id                       the file (admins; inline, not cached)
//   GET  /bibliography/:slug/notes/edit          edit the contents and summaries
//   POST /bibliography/:slug/notes               save
//   POST /bibliography/:slug/notes/publish       proofread → public    · POST …/notes/unpublish   back to private
// The section on a source's page: section(e, user).
const path = require('path');
const fs = require('fs');
const express = require('express');
const { adminPool } = require('../../db');
const config = require('../../config');
const { html, raw } = require('../html');
const { send, withTx, notFoundPage } = require('../core');
const { renderMarkdown } = require('../../markdown');

const router = express.Router();
const DIR = config.sourceFilesDir;
const LANG = { 'en-GB': 'British English', de: 'German', en: 'English' };
const mb = (b) => (b == null ? '' : b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);

async function load(sourceId) {
  const [files, note] = await Promise.all([
    adminPool.query('SELECT * FROM source_files WHERE source_id = $1 ORDER BY position, id', [sourceId]),
    adminPool.query(`SELECT n.*, u.username AS released_by_name FROM source_notes n LEFT JOIN admin_users u ON u.id = n.released_by WHERE n.source_id = $1`, [sourceId]),
  ]);
  return { files: files.rows, note: note.rows[0] || null };
}

// the contents as a nested list: [{title, page, level}] — level 1, 2, 3 …
function tocList(toc) {
  if (!toc || !toc.length) return '';
  return html`<ol class="source-toc">${toc.map((t) => html`<li class="toc-l${String(Math.min(t.level || 1, 4))}"><span>${t.title}</span>${t.page != null && t.page !== '' ? html` <span class="muted">${String(t.page)}</span>` : ''}</li>`)}</ol>`;
}

function notesBody(note) {
  return html`${note.summary_md ? html`<div class="md">${raw(renderMarkdown(note.summary_md) || '')}</div>` : ''}
    ${note.toc && note.toc.length ? html`<details open><summary><b>Contents</b>${note.toc_basis ? html` <span class="muted small">(${note.toc_basis})</span>` : ''}</summary>${tocList(note.toc)}</details>` : ''}
    ${note.chapters && note.chapters.length ? html`<details><summary><b>Chapter by chapter</b> <span class="muted small">(${String(note.chapters.length)})</span></summary>
      ${note.chapters.map((c) => html`<div class="source-chapter"><h4>${c.title}${c.pages ? html` <span class="muted small">${c.pages}</span>` : ''}</h4>
        <div class="md">${raw(renderMarkdown(c.summary_md || '') || '')}</div></div>`)}</details>` : ''}`;
}

async function section(e, user) {
  if (!user || !user.is_admin) return '';
  const { files, note } = await load(e.id);
  if (!files.length && !note) return '';
  const base = `/bibliography/${e.slug}/notes`;
  return html`<section class="source-notes" id="reading-notes"><h2>Reading notes ${note && note.released_at
      ? html`<span class="tag">published ${note.released_at.toISOString().slice(0, 10)}${note.released_by_name ? ` by ${note.released_by_name}` : ''}</span>`
      : html`<span class="tag warn" title="Only admins see this until it is published">private · not proofread</span>`}</h2>
    ${files.length ? html`<p class="small"><b>Files</b> (private): ${files.map((f, i) => html`${i ? ' · ' : ''}<a href="/source-files/${String(f.id)}" target="_blank" rel="noopener">${f.label || path.basename(f.path)}</a>
      <span class="muted">${f.pages ? `${f.pages} p., ` : ''}${mb(f.bytes)}</span>`)}</p>` : ''}
    ${note ? html`<p class="muted small">${LANG[note.lang] || note.lang}${note.generated_by ? ` · written by ${note.generated_by}` : ''}${note.released_at ? '' : ' — check it against the text before publishing'}</p>
      ${notesBody(note)}
      <div class="bar"><a class="button secondary" href="${base}/edit">Edit notes</a>
        ${note.released_at
          ? html`<form method="post" action="${base}/unpublish" class="inline"><button class="secondary">Unpublish</button></form>`
          : html`<form method="post" action="${base}/publish" class="inline"><button title="You have proofread it: show it on the site">Proofread — publish</button></form>`}</div>`
      : html`<p class="muted">No notes yet.</p>`}
  </section>`;
}

const adminOnly = (req, res, next) => (req.user && req.user.is_admin ? next() : notFoundPage(req, res));

router.get('/source-files/:id', adminOnly, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return notFoundPage(req, res);
  const f = (await adminPool.query('SELECT path FROM source_files WHERE id = $1', [req.params.id])).rows[0];
  const file = f && path.resolve(DIR, f.path);
  if (!file || !file.startsWith(path.resolve(DIR) + path.sep) || !fs.existsSync(file)) return notFoundPage(req, res);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file, { dotfiles: 'allow', headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` } });
});

async function sourceBySlug(slug) {
  return (await adminPool.query('SELECT id, slug, name FROM bibliography WHERE slug = $1', [slug])).rows[0] || null;
}

// the edit form: contents as lines "level | page | title", each chapter as title, pages and summary
const tocToLines = (toc) => (toc || []).map((t) => `${t.level || 1} | ${t.page ?? ''} | ${t.title}`).join('\n');
const linesToToc = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [level, page, ...title] = l.split('|').map((s) => s.trim());
  return { level: Number(level) || 1, page: page || null, title: title.join(' | ') };
}).filter((t) => t.title);

router.get('/bibliography/:slug/notes/edit', adminOnly, async (req, res) => {
  const s = await sourceBySlug(req.params.slug);
  if (!s) return notFoundPage(req, res);
  const { note } = await load(s.id);
  const n = note || { lang: 'en-GB', toc: [], chapters: [], summary_md: '' };
  const chapters = [...(n.chapters || []), { title: '', pages: '', summary_md: '' }];
  send(req, res, { title: `Reading notes: ${s.name}`, body: html`<p class="muted"><a href="/bibliography/${s.slug}#reading-notes">← ${s.name}</a></p>
    <h1>Reading notes</h1>
    <form method="post" action="/bibliography/${s.slug}/notes" class="entry-form">
      <div class="field"><label for="lang">Language</label><select id="lang" name="lang">${Object.entries(LANG).map(([k, v]) => html`<option value="${k}"${k === n.lang ? ' selected' : ''}>${v}</option>`)}</select></div>
      <div class="field"><label for="summary_md">Summary</label><textarea id="summary_md" name="summary_md" rows="12">${n.summary_md || ''}</textarea></div>
      <div class="field"><label for="toc">Contents <span class="muted small">one line each: level | page | title</span></label><textarea id="toc" name="toc" rows="12">${tocToLines(n.toc)}</textarea></div>
      <h2>Chapters</h2><p class="muted small">An empty title removes a chapter; the last block adds one.</p>
      ${chapters.map((c, i) => html`<fieldset class="source-chapter-edit"><legend>Chapter ${String(i + 1)}</legend>
        <div class="bar"><input name="ch_title" value="${c.title || ''}" placeholder="Title" class="grow" aria-label="Title of chapter ${String(i + 1)}">
          <input name="ch_pages" value="${c.pages || ''}" placeholder="pp. 1–20" size="12" aria-label="Pages of chapter ${String(i + 1)}"></div>
        <textarea name="ch_summary" rows="5" aria-label="Summary of chapter ${String(i + 1)}">${c.summary_md || ''}</textarea></fieldset>`)}
      <p class="actions"><button>Save</button></p></form>` });
});

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
router.post('/bibliography/:slug/notes', adminOnly, async (req, res) => {
  const s = await sourceBySlug(req.params.slug);
  if (!s) return notFoundPage(req, res);
  const b = req.body;
  const titles = asList(b.ch_title), pages = asList(b.ch_pages), sums = asList(b.ch_summary);
  const chapters = titles.map((t, i) => ({ title: String(t).trim(), pages: String(pages[i] || '').trim() || null, summary_md: String(sums[i] || '').trim() })).filter((c) => c.title);
  const lang = LANG[b.lang] ? b.lang : 'en-GB';
  await withTx(req.user, (db) => db.query(`INSERT INTO source_notes (source_id, lang, toc, summary_md, chapters, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, now())
      ON CONFLICT (source_id) DO UPDATE SET lang = EXCLUDED.lang, toc = EXCLUDED.toc, summary_md = EXCLUDED.summary_md, chapters = EXCLUDED.chapters, updated_at = now()`,
  [s.id, lang, JSON.stringify(linesToToc(b.toc)), String(b.summary_md || '').trim() || null, JSON.stringify(chapters)]));
  res.redirect(303, `/bibliography/${s.slug}?done=saved#reading-notes`);
});

for (const [act, sql] of [['publish', 'released_at = now(), released_by = $2'], ['unpublish', 'released_at = NULL, released_by = NULL']]) {
  router.post(`/bibliography/:slug/notes/${act}`, adminOnly, async (req, res) => {
    const s = await sourceBySlug(req.params.slug);
    if (!s) return notFoundPage(req, res);
    await withTx(req.user, (db) => db.query(`UPDATE source_notes SET ${sql} WHERE source_id = $1`, act === 'publish' ? [s.id, req.user.id] : [s.id]));
    res.redirect(303, `/bibliography/${s.slug}?done=saved#reading-notes`);
  });
}

module.exports = router;
module.exports.section = section;
module.exports.tocToLines = tocToLines;
module.exports.linesToToc = linesToToc;
