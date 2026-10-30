// Admin panel — the public changelog and roadmap (migration 118, German: de-CH). Mounted by src/admin/index.js before
// the entry pages (/changelog and /roadmap are no /:plural).
//   /changelog                entries, newest first; /changelog/new, /changelog/<id>/edit — the bullets one per line,
//                             "Neu: …", "Verbessert: …", "Behoben: …", "Inhalt: …", "Technik: …" (src/changelog.js)
//   /roadmap                  the four columns (drag within a column to order; buttons move an item to another);
//                             "✓ Erledigt" also writes it into today's changelog entry (a draft one is started if there
//                             is none), linked to the item
// Every form autosaves as a draft of this account while typing (119 form_drafts, editor/formdrafts.js); Save applies it.
// History: each edit page lists its changes (audit_log); /changelog/restore/<audit id> and /roadmap/restore/<audit id>
// bring back a version — an entry with its bullets, a deleted one as it was before the deletion, under its old id.
const express = require('express');
const { adminPool } = require('../../db');
const { html, raw } = require('../html');
const { send, withTx, notFoundPage, friendly, history, historyTable, when } = require('../core');
const { KINDS, STATUS, parseItems, itemsToText, renderItems, sortItems } = require('../../changelog');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
const DATE = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (d) => DATE.format(new Date(`${d}T12:00:00Z`));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());   // YYYY-MM-DD in Zurich
const idOk = (s) => /^\d{1,15}$/.test(String(s));

// ---------------------------------------------------------------------------------------------------------------
// Drafts (119): the form as typed, per account and form — restored when the form is opened again
// ---------------------------------------------------------------------------------------------------------------
const stamp = (d) => (d ? new Date(d).toISOString() : '');
async function draftOf(user, key, base) {
  const { rows: [d] } = await adminPool.query('SELECT base, fields, saved_at FROM form_drafts WHERE user_id = $1 AND form_key = $2', [user.id, key]);
  return d ? { ...d, stale: d.base !== base } : null;
}
const dropDraft = (db, user, key) => db.query('DELETE FROM form_drafts WHERE user_id = $1 AND form_key = $2', [user.id, key]);
const draftBanner = (d, key) => (d ? html`<div class="flash warn form-draft">Restored your unsaved draft from ${when(d.saved_at)} — not saved yet.
  ${d.stale ? html` <b>It was changed since the draft was started</b> (see the history below): check before you save.` : ''}
  <button type="submit" form="draft-discard" class="link-button">Discard draft</button></div>
  <form id="draft-discard" method="post" action="/drafts/${key}/discard"></form>` : '');
const draftStatus = html`<span class="muted small" data-form-draft-status aria-live="polite"></span>`;

router.post('/drafts/:kind/:id', express.json({ limit: '1mb' }), async (req, res) => {
  if (!['changelog', 'roadmap'].includes(req.params.kind)) return notFoundPage(req, res);
  const key = `${req.params.kind}/${req.params.id}`;
  const { fields, base } = req.body || {};
  if (!(req.params.id === 'new' || idOk(req.params.id)) || !fields || typeof fields !== 'object' || Array.isArray(fields) || typeof base !== 'string'
      || Object.values(fields).some((v) => typeof v !== 'string')) return res.status(422).json({ error: 'bad draft' });
  await adminPool.query(`INSERT INTO form_drafts (user_id, form_key, base, fields) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, form_key) DO UPDATE SET fields = EXCLUDED.fields, saved_at = now()`, [req.user.id, key, base, fields]);
  res.status(204).end();
});
router.post('/drafts/:kind/:id/discard', async (req, res) => {
  if (!['changelog', 'roadmap'].includes(req.params.kind) || !(req.params.id === 'new' || idOk(req.params.id))) return notFoundPage(req, res);
  const key = `${req.params.kind}/${req.params.id}`;
  await dropDraft(adminPool, req.user, key);
  const back = req.params.kind === 'roadmap' && req.params.id === 'new' ? '/roadmap' : `/${key}${req.params.id === 'new' ? '' : '/edit'}`;
  res.redirect(303, `${back}?done=draft-discarded`);
});

// "Recently deleted": rows whose last logged action deleted them and that are still gone
async function deleted(table) {
  const { rows } = await adminPool.query(`SELECT * FROM (
      SELECT DISTINCT ON (a.row_id) a.id, a.row_id, a.action, a.changed_at, a.old_row, u.username
      FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id
      WHERE a.table_name = $1 ORDER BY a.row_id, a.id DESC) last
    WHERE action = 'delete' AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id = last.row_id)
    ORDER BY changed_at DESC LIMIT 10`, [table]);
  return rows;
}

// this account's autosaved drafts not saved yet, with what they belong to
async function myDrafts(user, kind) {
  const { rows } = await adminPool.query(`SELECT split_part(d.form_key, '/', 2) AS id, d.saved_at,
      CASE WHEN $2 = 'changelog' THEN (SELECT e.day::text FROM changelog_entries e WHERE e.id::text = split_part(d.form_key, '/', 2))
           ELSE (SELECT r.title FROM roadmap_items r WHERE r.id::text = split_part(d.form_key, '/', 2)) END AS label
    FROM form_drafts d WHERE d.user_id = $1 AND d.form_key LIKE $2 || '/%' ORDER BY d.saved_at DESC`, [user.id, kind]);
  return rows.filter((d) => d.id === 'new' || d.label).map((d) => ({ ...d, label: kind === 'changelog' && d.label ? dayLabel(d.label) : d.label }));
}
const draftsNotice = (drafts, link) => (drafts.length ? html`<div class="flash warn unsaved-drafts"><b>Unsaved changes</b> (autosaved drafts, not saved yet):
  ${drafts.map((d, i) => html`${i ? ', ' : ''}${link(d)} <span class="muted small">${when(d.saved_at)}</span>`)} — open to save or discard.</div>` : '');

// ---------------------------------------------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------------------------------------------
router.get('/changelog', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT e.id, e.day::text AS day, e.title, e.published,
      (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) AS n FROM changelog_items i WHERE i.entry_id = e.id GROUP BY kind) k) AS kinds
    FROM changelog_entries e ORDER BY e.day DESC, e.id DESC`);
  const gone = await deleted('changelog_entries');
  const unpublished = rows.filter((r) => !r.published);
  const mine = await myDrafts(req.user, 'changelog');
  send(req, res, { title: 'Changelog', body: html`<h1>Changelog</h1>
    <p class="muted">What changed on the site, one entry per day or patch — in German, as the site shows it at
      <a href="${SITE}/changelog" target="_blank" rel="noopener">/changelog ↗</a>. <a href="/roadmap">Roadmap →</a> · <a href="/roadmap#topics">Topics and their colours →</a></p>
    ${draftsNotice(mine, (d) => (d.id === 'new' ? html`<a href="/changelog/new">a new entry</a>` : html`<a href="/changelog/${d.id}/edit">${d.label}</a>`))}
    ${unpublished.length ? html`<div class="flash warn unpublished-list"><b>${String(unpublished.length)} saved entr${unpublished.length === 1 ? 'y is' : 'ies are'} not published</b>
      — not on the site: ${unpublished.slice(0, 12).map((r, i) => html`${i ? ', ' : ''}<a href="/changelog/${String(r.id)}/edit">${dayLabel(r.day)}</a>`)}${unpublished.length > 12 ? ` and ${unpublished.length - 12} more` : ''}.</div>` : ''}
    <p class="actions"><a class="button" href="/changelog/new">+ New entry</a></p>
    ${rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Day</th><th>Title</th><th>Bullets</th><th>Status</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><a href="/changelog/${String(r.id)}/edit">${dayLabel(r.day)}</a></td><td>${r.title || ''}</td>
        <td class="muted small">${Object.entries(r.kinds || {}).map(([k, n], i) => html`${i ? ' · ' : ''}${String(n)} ${KINDS[k]}`)}</td>
        <td>${r.published ? 'published' : html`<span class="tag flagged">draft</span>`}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No entries yet.</p>`}
    ${gone.length ? html`<h2>Recently deleted</h2><ul class="recently-deleted">${gone.map((g) => html`<li>${dayLabel(g.old_row.day)}${g.old_row.title ? ` · ${g.old_row.title}` : ''}
      <span class="muted small">deleted ${when(g.changed_at)}${g.username ? ` by ${g.username}` : ''}</span> <a href="/changelog/restore/${String(g.id)}">restore…</a></li>`)}</ul>` : ''}` });
});

function entryForm(e, { action, items = '', flash = null, preview = null, isNew = false, draft = null, key, base = '', past = '' }) {
  return { title: isNew ? 'New changelog entry' : `Changelog ${dayLabel(e.day)}`, flash, body: html`<p class="muted"><a href="/changelog">← Changelog</a></p>
    <h1>${isNew ? 'New changelog entry' : dayLabel(e.day)}</h1>
    ${!isNew && !e.savedPublished ? html`<div class="flash warn unpublished-entry"><b>Saved, but not published</b> — this entry is not on the site.
      <button type="submit" form="cl-publish" class="link-button">Publish now</button></div>
      <form id="cl-publish" method="post" action="/changelog/${String(e.id)}/publish"></form>` : ''}
    ${draftBanner(draft, key)}
    <form method="post" action="${action}" class="form changelog-form" data-form-draft="/drafts/${key}" data-form-draft-base="${base}">
      <div class="field-pair"><div class="field"><label for="cl-day">Day</label><input id="cl-day" name="day" type="date" value="${e.day}" required></div>
        <div class="field"><label for="cl-title">Title <span class="muted small">(optional)</span></label><input id="cl-title" name="title" value="${e.title || ''}" placeholder="e.g. Patch: Suche"></div></div>
      <div class="field"><label for="cl-items">Bullet points</label>
        <textarea id="cl-items" name="items" rows="14" class="md" data-preview="/changelog/preview" data-topics-url="/roadmap/topics.json">${items}</textarea>
        <div class="hint">One per line, starting with its kind: <code>Neu:</code> · <code>Verbessert:</code> · <code>Behoben:</code> · <code>Inhalt:</code> · <code>Technik:</code>
          (none = Neu). A topic in brackets after the kind: <code>Neu [Karte]: …</code> — the roadmap's <a href="/roadmap#topics">topics</a>
          and colours; a new one is added there. A line indented by two spaces continues the bullet above. Markdown and <code>[[type/slug]]</code> links work;
          the spell check follows the text's language (EN/DE in the toolbar).</div></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${e.published ? ' checked' : ''}> Published</label></div>
      <div class="actions"><button>${isNew ? 'Create' : 'Save'}</button> ${draftStatus}</div>
    </form>
    ${preview ? html`<h2>As on the site</h2><ul class="changelog-preview">${preview}</ul>` : ''}
    ${isNew ? '' : html`<p class="actions" style="margin-top:1.5rem"><a class="button danger" href="/changelog/${String(e.id)}/delete">Delete this entry…</a></p>`}
    ${past}` };
}
const previewOf = async (unsorted) => {
  const areas = await areaList(adminPool);
  const items = sortItems(unsorted, new Map(areas.map((a) => [a.name, a.rank])));  // as the site will show them (167, 168)
  const htmls = await renderItems(adminPool, items.map((i) => i.text_md ?? i.text));
  const colors = new Map(areas.map((a) => [a.name, a.color]));
  return html`${items.map((i, n) => html`<li><span class="cl-kind cl-${i.kind}">${KINDS[i.kind]}</span>${i.area ? html` ${areaTag(i.area, colors)}` : ''} ${raw(htmls[n])}</li>`)}`;
};

const fromBody = (body) => ({ day: String(body.day || '').trim(), title: String(body.title || '').trim() || null,
  published: body.published === '1', items: parseItems(body.items) });

// The entry's bullets made these — in place, position by position, so the history shows what changed in each bullet
// (not every bullet deleted and written anew). A bullet keeps its roadmap link when its text is unchanged; an item
// may also name its link (a restored version).
async function writeItems(db, entryId, items) {
  const { rows: old } = await db.query('SELECT id, position, kind, area, text_md, roadmap_item_id FROM changelog_items WHERE entry_id = $1 ORDER BY position', [entryId]);
  for (const a of new Set(items.map((i) => i.area).filter(Boolean))) await ensureArea(db, a);   // a new topic: added with its colour
  const link = new Map(old.filter((o) => o.roadmap_item_id).map((o) => [o.text_md, o.roadmap_item_id]));
  const linkOf = async (i) => {
    if (!('roadmap_item_id' in i)) return link.get(i.text) || null;
    if (!i.roadmap_item_id) return null;
    const { rows } = await db.query('SELECT 1 FROM roadmap_items WHERE id = $1', [i.roadmap_item_id]);   // the item may be gone
    return rows.length ? i.roadmap_item_id : null;
  };
  for (const [n, i] of items.entries()) {
    const o = old[n];
    const roadmap = await linkOf(i);
    if (!o) {
      await db.query('INSERT INTO changelog_items (entry_id, position, kind, text_md, roadmap_item_id, area) VALUES ($1, $2, $3, $4, $5, $6)', [entryId, n, i.kind, i.text, roadmap, i.area || null]);
    } else if (o.position !== n || o.kind !== i.kind || o.text_md !== i.text || String(o.roadmap_item_id) !== String(roadmap) || (o.area || null) !== (i.area || null)) {
      await db.query('UPDATE changelog_items SET position = $2, kind = $3, text_md = $4, roadmap_item_id = $5, area = $6 WHERE id = $1', [o.id, n, i.kind, i.text, roadmap, i.area || null]);
    }
  }
  const extra = old.slice(items.length).map((o) => o.id);
  if (extra.length) await db.query('DELETE FROM changelog_items WHERE id = ANY($1::bigint[])', [extra]);
}

const newForm = (e, opts) => entryForm(e, { action: '/changelog', isNew: true, key: 'changelog/new', ...opts });
// the editor's preview (editor.js, data-preview): the bullets as the site shows them
router.post('/changelog/preview', async (req, res) => {
  const items = parseItems(req.body.text);
  res.type('html').send(String(items.length ? html`<ul class="changelog-preview">${await previewOf(items)}</ul>` : html`<p class="muted">No bullet points yet.</p>`));
});

router.get('/changelog/new', async (req, res) => {
  const draft = await draftOf(req.user, 'changelog/new', '');
  const f = draft ? draft.fields : {};
  send(req, res, newForm({ day: f.day || today(), title: f.title, published: f.published === '1' }, { items: f.items || '', draft: draft && { ...draft, stale: false } }));
});

router.post('/changelog', async (req, res) => {
  const v = fromBody(req.body);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return send(req, res, { ...newForm({ ...v }, { items: req.body.items, flash: { kind: 'error', text: 'Day: a date.' } }), status: 422 });
  let id;
  try {
    id = await withTx(req.user, async (db) => {
      const { rows: [e] } = await db.query('INSERT INTO changelog_entries (day, title, published) VALUES ($1, $2, $3) RETURNING id', [v.day, v.title, v.published]);
      await writeItems(db, e.id, v.items);
      await dropDraft(db, req.user, 'changelog/new');
      return e.id;
    });
  } catch (err) {
    return send(req, res, { ...newForm({ ...v }, { items: req.body.items, flash: { kind: 'error', text: friendly(err) } }), status: 422 });
  }
  res.redirect(303, `/changelog/${id}/edit?done=created`);
});

async function entry(id) {
  if (!idOk(id)) return null;
  const { rows: [e] } = await adminPool.query('SELECT id, day::text AS day, title, published, updated_at FROM changelog_entries WHERE id = $1', [id]);
  if (!e) return null;
  const { rows: items } = await adminPool.query('SELECT kind, area, text_md, updated_at FROM changelog_items WHERE entry_id = $1 ORDER BY position', [id]);
  // changed = the entry or any of its bullets (a draft started before is stale)
  const changed = [e.updated_at, ...items.map((i) => i.updated_at)].reduce((a, b) => (b > a ? b : a));
  return { ...e, items, base: stamp(changed) };
}

// the entry's changes and its bullets', newest first
const entryHistory = async (id) => (await history(adminPool, `(a.table_name = 'changelog_entries' AND a.row_id = $1)
  OR (a.table_name = 'changelog_items' AND (coalesce(a.new_row, a.old_row)->>'entry_id')::bigint = $1)`, [id], { limit: 50 })).rows;
const pastSection = (rows) => html`<h2>History</h2>${historyTable(rows, { showWhat: true })}`;

router.get('/changelog/:id/edit', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  const key = `changelog/${e.id}`;
  const draft = await draftOf(req.user, key, e.base);
  const f = draft && draft.fields;
  const shown = { ...(f ? { ...e, day: f.day || e.day, title: f.title, published: f.published === '1' } : e), savedPublished: e.published };
  send(req, res, entryForm(shown, { action: `/changelog/${e.id}`, items: f ? f.items || '' : itemsToText(e.items), key, base: e.base, draft,
    preview: e.items.length ? await previewOf(e.items) : null, past: pastSection(await entryHistory(e.id)) }));
});

router.post('/changelog/:id', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  const v = fromBody(req.body);
  const key = `changelog/${e.id}`;
  try {
    await withTx(req.user, async (db) => {
      await db.query('UPDATE changelog_entries SET day = $2, title = $3, published = $4 WHERE id = $1 AND (day, title, published) IS DISTINCT FROM ($2::date, $3, $4)',
        [e.id, v.day, v.title, v.published]);
      await writeItems(db, e.id, v.items);
      await dropDraft(db, req.user, key);
    });
  } catch (err) {
    return send(req, res, { ...entryForm({ ...e, ...v, savedPublished: e.published }, { action: `/changelog/${e.id}`, items: req.body.items, key, base: e.base, flash: { kind: 'error', text: friendly(err) } }), status: 422 });
  }
  res.redirect(303, `/changelog/${e.id}/edit?done=saved`);
});

// Deleting takes a second step on a page of its own (owner, 2026-10-20: an entry was deleted by accident): what goes
// is shown, and only "Yes, delete" (confirm=yes) deletes — a stray POST or a double click doesn't.
const confirmPage = ({ title, what, action, back }) => ({ title, body: html`<p class="muted"><a href="${back}">← Back</a></p>
  <h1>${title}</h1>${what}
  <p>It can be restored from the history (“Recently deleted”), but it is gone from the site at once.</p>
  <form method="post" action="${action}" class="actions"><input type="hidden" name="confirm" value="yes">
    <button class="danger">Yes, delete</button> <a class="button" href="${back}">Cancel</a></form>` });

router.post('/changelog/:id/publish', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('UPDATE changelog_entries SET published = true WHERE id = $1 AND NOT published', [e.id]));
  res.redirect(303, `/changelog/${e.id}/edit?done=cl-published`);
});

router.get('/changelog/:id/delete', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  send(req, res, confirmPage({ title: `Delete ${dayLabel(e.day)}?`, action: `/changelog/${e.id}/delete`, back: `/changelog/${e.id}/edit`,
    what: html`<p><b>${dayLabel(e.day)}</b>${e.title ? ` · ${e.title}` : ''} — ${e.published ? 'published' : 'draft'}, ${String(e.items.length)} bullet point${e.items.length === 1 ? '' : 's'}:</p>
      <ul class="changelog-preview">${e.items.length ? await previewOf(e.items) : ''}</ul>` }));
});

router.post('/changelog/:id/delete', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  if (req.body.confirm !== 'yes') return res.redirect(303, `/changelog/${e.id}/delete`);
  await withTx(req.user, (db) => db.query('DELETE FROM changelog_entries WHERE id = $1', [e.id]));
  res.redirect(303, '/changelog?done=deleted');
});

// ---------------------------------------------------------------------------------------------------------------
// Restoring a version from the history (audit_log)
// ---------------------------------------------------------------------------------------------------------------
// From one logged row: the change set it belongs to (its transaction) and the moment to go back to — right after
// that change set, or right before it when it deleted the entry (or item) itself. A row's state at that moment is the
// newest logged version up to it: DISTINCT ON (row_id) … ORDER BY row_id, id DESC picks it per row.
async function restorePoint(auditId, table) {
  if (!idOk(auditId)) return null;
  const { rows: [a] } = await adminPool.query(`SELECT a.id, a.txid, a.table_name, a.row_id, a.old_row, a.new_row, a.changed_at,
      (SELECT min(b.id) FROM audit_log b WHERE b.txid = a.txid) AS first, (SELECT max(b.id) FROM audit_log b WHERE b.txid = a.txid) AS last
    FROM audit_log a WHERE a.id = $1`, [auditId]);
  if (!a) return null;
  const rootTable = table === 'changelog' ? 'changelog_entries' : 'roadmap_items';
  if (table === 'changelog' ? !['changelog_entries', 'changelog_items'].includes(a.table_name) : a.table_name !== 'roadmap_items') return null;
  const rootId = a.table_name === 'changelog_items' ? (a.new_row || a.old_row).entry_id : a.row_id;
  const { rows: [del] } = await adminPool.query(`SELECT 1 FROM audit_log WHERE txid = $1 AND table_name = $2 AND row_id = $3 AND action = 'delete'`, [a.txid, rootTable, rootId]);
  return { audit: a, rootId: Number(rootId), before: Boolean(del), upto: del ? Number(a.first) - 1 : Number(a.last), at: a.changed_at };
}
async function stateAt(table, upto, where, params = []) {
  const { rows } = await adminPool.query(`SELECT * FROM (
      SELECT DISTINCT ON (a.row_id) a.action, a.new_row AS r FROM audit_log a
      WHERE a.table_name = $1 AND a.id <= $2 AND ${where} ORDER BY a.row_id, a.id DESC) s
    WHERE action <> 'delete'`, [table, upto, ...params]);
  return rows.map((x) => x.r);
}
async function entryAt(p) {
  const [e] = await stateAt('changelog_entries', p.upto, 'a.row_id = $3', [p.rootId]);
  if (!e) return null;
  // its bullets: every bullet ever logged for this entry, as it was then — still in this entry then
  const items = (await stateAt('changelog_items', p.upto, `a.row_id IN (SELECT x.row_id FROM audit_log x WHERE x.table_name = 'changelog_items'
      AND (coalesce(x.new_row, x.old_row)->>'entry_id')::bigint = $3)`, [p.rootId]))
    .filter((i) => Number(i.entry_id) === p.rootId).sort((x, y) => x.position - y.position);
  return { ...e, items };
}
const restoreNote = (p) => (p.before ? `as it was before it was deleted on ${when(p.at)}` : `as it was right after the change of ${when(p.at)}`);

router.get('/changelog/restore/:auditId', async (req, res) => {
  const p = await restorePoint(req.params.auditId, 'changelog');
  const v = p && await entryAt(p);
  if (!v) return notFoundPage(req, res);
  const exists = (await adminPool.query('SELECT 1 FROM changelog_entries WHERE id = $1', [p.rootId])).rows.length > 0;
  send(req, res, { title: 'Restore a changelog entry', body: html`<p class="muted"><a href="/changelog">← Changelog</a></p>
    <h1>Restore ${dayLabel(v.day)}</h1>
    <p>The entry ${restoreNote(p)}${exists ? ' — it replaces the current version (which stays in the history)' : ' — it comes back under its old address'}:</p>
    <div class="restore-preview"><p><b>${dayLabel(v.day)}</b>${v.title ? ` · ${v.title}` : ''} — ${v.published ? 'published' : 'draft'}</p>
      <ul class="changelog-preview">${await previewOf(v.items)}</ul></div>
    <form method="post" class="actions"><button>Restore</button> <a href="${exists ? `/changelog/${p.rootId}/edit` : '/changelog'}">Cancel</a></form>` });
});

router.post('/changelog/restore/:auditId', async (req, res) => {
  const p = await restorePoint(req.params.auditId, 'changelog');
  const v = p && await entryAt(p);
  if (!v) return notFoundPage(req, res);
  await withTx(req.user, async (db) => {
    await db.query("SELECT set_config('arthistory.restores', $1, true)", [String(p.audit.id)]);
    // jsonb_populate_record turns the logged JSON back into a row of the table's own types; a deleted entry is
    // re-inserted with its old id (OVERRIDING SYSTEM VALUE), so its links (#eintrag-<id>) work again
    const { rowCount } = await db.query(`UPDATE changelog_entries t SET (day, title, published) = (SELECT r.day, r.title, r.published
      FROM jsonb_populate_record(NULL::changelog_entries, $2) r) WHERE t.id = $1`, [p.rootId, v]);
    if (!rowCount) {
      await db.query(`INSERT INTO changelog_entries (id, day, title, published, created_at) OVERRIDING SYSTEM VALUE
        SELECT r.id, r.day, r.title, r.published, r.created_at FROM jsonb_populate_record(NULL::changelog_entries, $1) r`, [v]);
    }
    await writeItems(db, p.rootId, v.items.map((i) => ({ kind: i.kind, area: i.area || null, text: i.text_md, roadmap_item_id: i.roadmap_item_id })));
  });
  res.redirect(303, `/changelog/${p.rootId}/edit?done=restored`);
});

// ---------------------------------------------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------------------------------------------
// Topics (136, table roadmap_areas): a name and a colour of this palette (CSS .area-<key> in admin.css and the site's
// style.css). An item's area references the name (ON UPDATE CASCADE): a rename reaches every item.
const PALETTE = { blue: 'Blau', teal: 'Petrol', purple: 'Violett', pink: 'Rosa', red: 'Rot', brown: 'Braun', olive: 'Oliv', indigo: 'Indigo', cyan: 'Cyan', slate: 'Schiefer' };
// n: roadmap items, bullets: changelog bullets (137) with the topic
// in their order (168, view roadmap_areas_ordered): by hand, else by section and name; manual = some were dragged
const areaList = async (db) => (await db.query(`SELECT a.id, a.name, a.color, a.section, a.position, o.rank,
    (SELECT count(*) FROM roadmap_items r WHERE r.area = a.name)::int AS n,
    (SELECT count(*) FROM changelog_items i WHERE i.area = a.name)::int AS bullets
  FROM roadmap_areas a JOIN roadmap_areas_ordered o ON o.name = a.name ORDER BY o.rank`)).rows;
// a topic typed in an item's form that doesn't exist yet: created with the palette's next colour
async function ensureArea(db, name) {
  if (!name) return;
  await db.query(`INSERT INTO roadmap_areas (name, color)
    SELECT $1, ($2::text[])[(SELECT count(*) FROM roadmap_areas)::int % cardinality($2::text[]) + 1]
    ON CONFLICT (name) DO NOTHING`, [name, Object.keys(PALETTE)]);
}
const areaTag = (name, colors) => html`<span class="tag area area-${colors.get(name) || 'slate'}">${name}</span>`;
const doneDays = async (db) => (await db.query(`SELECT (value #>> '{}')::int AS days FROM site_settings WHERE key = 'roadmap_done_days'`)).rows[0]?.days ?? 30;
const SHORT = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDay = (d) => SHORT.format(new Date(`${d}T12:00:00Z`));
// a date column as YYYY-MM-DD: pg hands it over as a Date at local midnight (no type parser for date) — local getters
const isoDay = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d));

function itemForm(r, { action, submit, key, base = '', areas = [] }) {
  return html`<form method="post" action="${action}" class="form roadmap-form" data-form-draft="/drafts/${key}" data-form-draft-base="${base}">
    <div class="field-pair"><div class="field"><label for="rm-title">Title</label><input id="rm-title" name="title" value="${r.title || ''}" required></div>
      <div class="field"><label for="rm-area">Topic</label><input id="rm-area" name="area" value="${r.area || ''}" list="rm-areas" placeholder="e.g. Provenienz">
        <datalist id="rm-areas">${areas.map((a) => html`<option>${a.name}</option>`)}</datalist>
        <div class="hint">One of the topics below, or a new one (it gets the next colour).</div></div>
      <div class="field"><label for="rm-added">Added on</label><input id="rm-added" name="added_on" type="date" value="${r.added_on ? isoDay(r.added_on) : today()}" style="width:auto"></div></div>
    <div class="field"><label for="rm-notes">Notes <span class="muted small">(optional, shown on the site)</span></label><textarea id="rm-notes" name="notes_md" rows="4" class="md">${r.notes_md || ''}</textarea></div>
    <div class="field-pair"><div class="field"><label for="rm-status">Column</label><select id="rm-status" name="status">
        ${Object.entries(STATUS).map(([k, l]) => html`<option value="${k}"${(r.status || 'spaeter') === k ? ' selected' : ''}>${l}</option>`)}</select></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${r.published !== false ? ' checked' : ''}> On the site</label>
        <label class="choice"><input type="checkbox" name="log" value="1" checked> When it becomes “Erledigt”: into today's changelog</label></div></div>
    <div class="actions"><button>${submit}</button> ${draftStatus}</div></form>`;
}
// a draft's fields over the item's (an unticked box is absent from a draft)
const withDraft = (r, d) => (d ? { ...r, title: d.fields.title, area: d.fields.area, notes_md: d.fields.notes_md, status: d.fields.status || r.status, added_on: d.fields.added_on || r.added_on,
  published: d.fields.published === '1' } : r);

router.get('/roadmap', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT r.id, r.title, r.area, r.status, r.position, r.published, r.done_on::text AS done_on, r.added_on::text AS added_on,
      r.done_on < (now() AT TIME ZONE 'Europe/Zurich')::date - (SELECT (value #>> '{}')::int FROM site_settings WHERE key = 'roadmap_done_days') AS off_site,
      (SELECT e.id FROM changelog_items i JOIN changelog_entries e ON e.id = i.entry_id WHERE i.roadmap_item_id = r.id ORDER BY e.day DESC LIMIT 1) AS logged_in
    FROM roadmap_items r ORDER BY r.position, r.id`);
  const gone = await deleted('roadmap_items');
  const areas = await areaList(adminPool);
  const manualOrder = areas.some((a) => a.position !== null);
  const colors = new Map(areas.map((a) => [a.name, a.color]));
  const days = await doneDays(adminPool);
  const draft = await draftOf(req.user, 'roadmap/new', '');
  const mine = (await myDrafts(req.user, 'roadmap')).filter((d) => d.id !== 'new');   // the new item's draft shows in its form
  const col = (status) => rows.filter((r) => r.status === status)
    .sort((a, b) => (status === 'erledigt' ? String(b.done_on).localeCompare(String(a.done_on)) : 0));
  const move = (r) => html`${Object.entries(STATUS).filter(([k]) => k !== r.status).map(([k, l]) => html`
    <button type="submit" form="rm-move-${String(r.id)}" name="status" value="${k}" class="link-button small" title="Move to “${l}”">${k === 'erledigt' ? '✓ Erledigt' : `→ ${l}`}</button>`)}`;
  send(req, res, { title: 'Roadmap', body: html`<h1>Roadmap</h1>
    <p class="muted">What is being worked on, what comes next, what later, and what is done — in German, as the site shows it at
      <a href="${SITE}/roadmap" target="_blank" rel="noopener">/roadmap ↗</a>. Drag within a column to order it. “✓ Erledigt” also
      writes the item into today's changelog entry. <a href="/changelog">Changelog →</a></p>
    ${draftsNotice(mine, (d) => html`<a href="/roadmap/${d.id}/edit">${d.label}</a>`)}
    <div class="roadmap-board">
      ${Object.entries(STATUS).map(([status, label]) => html`<section class="roadmap-col roadmap-${status}">
        <h2>${label} <span class="muted small">${String(col(status).length)}</span></h2>
        <table${status === 'erledigt' ? '' : html` data-sortable="/roadmap/order"`} class="roadmap-list">
          ${col(status).map((r) => html`<tbody class="sort-item" data-sort-id="${String(r.id)}"><tr>
            <td class="drag-cell">${status === 'erledigt' ? '' : html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move ${r.title}">⠿</button>`}</td>
            <td class="roadmap-card"><a href="/roadmap/${String(r.id)}/edit"><b>${r.title}</b></a>${r.area ? html` ${areaTag(r.area, colors)}` : ''}${r.published ? '' : html` <span class="tag flagged">hidden</span>`}${r.off_site ? html` <span class="tag" title="Done more than ${String(days)} days ago: no longer on the site's roadmap">off the site</span>` : ''}
            <div class="muted small">added ${shortDay(r.added_on)}${r.done_on ? html` · done ${dayLabel(r.done_on)}${r.logged_in ? html` · <a href="/changelog/${String(r.logged_in)}/edit">in the changelog</a>` : ''}` : ''}</div>
            <form id="rm-move-${String(r.id)}" method="post" action="/roadmap/${String(r.id)}/move"><input type="hidden" name="log" value="1"></form>
            <div class="roadmap-moves">${move(r)}</div></td></tr></tbody>`)}
        </table></section>`)}
    </div>
    <h2>New item</h2>
    ${draftBanner(draft && { ...draft, stale: false }, 'roadmap/new')}
    ${itemForm(withDraft({}, draft), { action: '/roadmap', submit: '+ Add', key: 'roadmap/new', areas })}
    <h2 id="topics">Topics</h2>
    <p class="muted small">The bubbles on the roadmap's items and the changelog's bullets (<code>Neu [Topic]: …</code>), each
      with its colour. Renaming a topic renames it everywhere; a topic nothing uses can be deleted. A new topic typed into an
      item's form or a bullet is added here with the next colour.</p>
    <p class="muted small">Order: by section, then by name — or as you drag them (⠿). The changelog's bullets follow it
      within each kind. The section is for you only; it isn't shown on the site.${manualOrder ? html` <span class="topic-order-manual">Ordered by hand.</span>` : ''}</p>
    ${manualOrder ? html`<form method="post" action="/roadmap/areas/reset-order" class="inline"><button class="secondary small">Sort by section and name again</button></form>` : ''}
    <div class="table-wrap"><table class="roadmap-areas" data-sortable="/roadmap/areas/order"><thead><tr><th></th><th>Topic</th><th>Section</th><th>Items</th><th>Bullets</th><th>Name</th><th>Colour</th><th></th></tr></thead>
      ${areas.map((a) => html`<tbody class="sort-item" data-sort-id="${String(a.id)}"><tr>
        <td class="drag-cell"><button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move ${a.name}">⠿</button></td>
        <td>${areaTag(a.name, colors)}</td>
        <td><input form="rm-area-${String(a.id)}" name="section" value="${a.section || ''}" aria-label="Section of ${a.name}" placeholder="—" list="rm-sections" style="width:9rem"></td>
        <td>${String(a.n)}</td><td>${String(a.bullets)}</td>
        <td><input form="rm-area-${String(a.id)}" name="name" value="${a.name}" required aria-label="Name of ${a.name}" style="width:12rem"></td>
        <td><select form="rm-area-${String(a.id)}" name="color" aria-label="Colour of ${a.name}">${Object.entries(PALETTE).map(([k, l]) => html`<option value="${k}"${k === a.color ? ' selected' : ''}>${l}</option>`)}</select></td>
        <td><form id="rm-area-${String(a.id)}" method="post" action="/roadmap/areas/${String(a.id)}" class="inline"><button class="secondary small">Save</button></form>
          ${a.n || a.bullets ? '' : html`<form method="post" action="/roadmap/areas/${String(a.id)}/delete" class="inline" data-confirm="Delete the topic “${a.name}”?"><button class="link">delete</button></form>`}</td></tr></tbody>`)}
    </table></div>
    <datalist id="rm-sections">${[...new Set(areas.map((a) => a.section).filter(Boolean))].map((x) => html`<option value="${x}">`)}</datalist>
    <h2 id="done-days">Done items on the site</h2>
    <form method="post" action="/roadmap/settings" class="form inline-form">
      <label>A done item stays on the site's roadmap for <input name="done_days" type="number" min="0" max="365" step="1" value="${String(days)}" style="width:5rem" aria-label="Days"> days after its done date</label>
      <button class="secondary">Save</button>
      <div class="hint">After that it is only in the changelog and here (marked “off the site”). 0 = done items are not shown on the site.</div></form>
    ${gone.length ? html`<h2>Recently deleted</h2><ul class="recently-deleted">${gone.map((g) => html`<li>${g.old_row.title}
      <span class="muted small">deleted ${when(g.changed_at)}${g.username ? ` by ${g.username}` : ''}</span> <a href="/roadmap/restore/${String(g.id)}">restore…</a></li>`)}</ul>` : ''}
    <p class="muted small"><a href="/roadmap/history">History of the roadmap →</a></p>` });
});

// the topics for the bullets' "[" suggestions (editor.js topicCompletions)
router.get('/roadmap/topics.json', async (req, res) => {
  res.json((await areaList(adminPool)).map((a) => ({ name: a.name, color: a.color })));
});
// drag order of the topics (editor/sortable.js, 168): ids in the new order → position 10, 20, 30 … for all of them
router.post('/roadmap/areas/order', async (req, res) => {
  const ids = String(req.body.ids || '').split(',').filter(idOk);
  await withTx(req.user, (db) => db.query(`UPDATE roadmap_areas a SET position = o.n * 10
    FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE a.id = o.id AND a.position IS DISTINCT FROM o.n * 10`, [ids]));
  res.status(204).end();
});
// back to the automatic order: by section, then by name
router.post('/roadmap/areas/reset-order', async (req, res) => {
  await withTx(req.user, (db) => db.query('UPDATE roadmap_areas SET position = NULL WHERE position IS NOT NULL'));
  res.redirect(303, '/roadmap?done=saved#topics');
});
router.post('/roadmap/areas/:id', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const name = String(req.body.name || '').trim();
  const color = PALETTE[req.body.color] ? req.body.color : null;
  const section = String(req.body.section ?? '').trim().replace(/\s+/g, ' ') || null;  // 168: for internal reference
  if (!name || !color) return res.redirect(303, '/roadmap#topics');
  try {
    await withTx(req.user, (db) => db.query(`UPDATE roadmap_areas SET name = $2, color = $3, section = $4 WHERE id = $1
      AND (name, color, section) IS DISTINCT FROM ($2, $3, $4)`, [req.params.id, name, color, section]));
  } catch (err) {
    if (err.code !== '23505') throw err;   // the name of another topic: nothing changed
    return res.redirect(303, '/roadmap?done=area-exists#topics');
  }
  res.redirect(303, '/roadmap?done=saved#topics');
});
router.post('/roadmap/areas/:id/delete', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query(`DELETE FROM roadmap_areas a WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM roadmap_items r WHERE r.area = a.name)
    AND NOT EXISTS (SELECT 1 FROM changelog_items i WHERE i.area = a.name)`, [req.params.id]));
  res.redirect(303, '/roadmap?done=saved#topics');
});
router.post('/roadmap/settings', async (req, res) => {
  const days = Number(req.body.done_days);
  if (Number.isInteger(days) && days >= 0 && days <= 365) {
    await withTx(req.user, (db) => db.query(`UPDATE site_settings SET value = to_jsonb($1::int) WHERE key = 'roadmap_done_days' AND value <> to_jsonb($1::int)`, [days]));
  }
  res.redirect(303, '/roadmap?done=saved#done-days');
});

router.get('/roadmap/history', async (req, res) => {
  const { rows } = await history(adminPool, "a.table_name = 'roadmap_items'", [], { limit: 100 });
  send(req, res, { title: 'Roadmap history', body: html`<p class="muted"><a href="/roadmap">← Roadmap</a></p><h1>History of the roadmap</h1>${historyTable(rows)}` });
});

// drag order within a column (editor/sortable.js): ids in the new order → position 10, 20, 30 …
router.post('/roadmap/order', async (req, res) => {
  const ids = String(req.body.ids || '').split(',').filter(idOk);
  await withTx(req.user, (db) => db.query(`UPDATE roadmap_items r SET position = o.n * 10
    FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE r.id = o.id AND r.position IS DISTINCT FROM o.n * 10`, [ids]));
  res.status(204).end();
});

// "Erledigt": the day it was finished and — unless asked not to — a bullet in today's entry (the newest entry of today,
// else a new draft one); back to another column: no longer done
async function setStatus(db, id, status, log) {
  const { rows: [r] } = await db.query('SELECT * FROM roadmap_items WHERE id = $1', [id]);
  if (!r || r.status === status) return null;
  const done = status === 'erledigt';
  await db.query('UPDATE roadmap_items SET status = $2, done_on = $3, position = (SELECT coalesce(max(position), 0) + 10 FROM roadmap_items WHERE status = $2) WHERE id = $1',
    [id, status, done ? today() : null]);
  if (!done || !log) return null;
  let { rows: [e] } = await db.query('SELECT id FROM changelog_entries WHERE day = $1 ORDER BY id DESC LIMIT 1', [today()]);
  if (!e) ({ rows: [e] } = await db.query('INSERT INTO changelog_entries (day, published) VALUES ($1, false) RETURNING id', [today()]));
  const { rows: [{ n }] } = await db.query('SELECT coalesce(max(position), -1) + 1 AS n FROM changelog_items WHERE entry_id = $1', [e.id]);
  await db.query(`INSERT INTO changelog_items (entry_id, position, kind, text_md, roadmap_item_id, area) VALUES ($1, $2, 'neu', $3, $4, $5)`, [e.id, n, r.title, id, r.area]);
  return e.id;
}

router.post('/roadmap/:id/move', async (req, res) => {
  if (!idOk(req.params.id) || !STATUS[req.body.status]) return notFoundPage(req, res);
  const entryId = await withTx(req.user, (db) => setStatus(db, req.params.id, req.body.status, req.body.log === '1'));
  res.redirect(303, entryId ? `/roadmap?done=logged&entry=${entryId}` : '/roadmap?done=saved');
});

const itemFromBody = (b) => ({ title: String(b.title || '').trim(), area: String(b.area || '').trim() || null, notes_md: String(b.notes_md || '').trim() || null,
  added_on: /^\d{4}-\d{2}-\d{2}$/.test(String(b.added_on || '')) ? b.added_on : null,
  status: STATUS[b.status] ? b.status : 'spaeter', published: b.published === '1', log: b.log === '1' });

router.post('/roadmap', async (req, res) => {
  const v = itemFromBody(req.body);
  if (!v.title) return res.redirect(303, '/roadmap');
  await withTx(req.user, async (db) => {
    await ensureArea(db, v.area);
    const { rows: [r] } = await db.query(`INSERT INTO roadmap_items (title, area, notes_md, status, published, position, added_on)
      VALUES ($1, $2, $3, 'spaeter', $4, (SELECT coalesce(max(position), 0) + 10 FROM roadmap_items WHERE status = 'spaeter'),
        coalesce($5::date, (now() AT TIME ZONE 'Europe/Zurich')::date)) RETURNING id`,
    [v.title, v.area, v.notes_md, v.published, v.added_on]);
    if (v.status !== 'spaeter') await setStatus(db, r.id, v.status, v.log);
    await dropDraft(db, req.user, 'roadmap/new');
  });
  res.redirect(303, '/roadmap?done=created');
});

router.get('/roadmap/:id/edit', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const { rows: [r] } = await adminPool.query('SELECT * FROM roadmap_items WHERE id = $1', [req.params.id]);
  if (!r) return notFoundPage(req, res);
  const key = `roadmap/${r.id}`;
  const draft = await draftOf(req.user, key, stamp(r.updated_at));
  const { rows: past } = await history(adminPool, "a.table_name = 'roadmap_items' AND a.row_id = $1", [r.id], { limit: 50 });
  const areas = await areaList(adminPool);
  send(req, res, { title: r.title, body: html`<p class="muted"><a href="/roadmap">← Roadmap</a></p><h1>${r.title}</h1>
    ${draftBanner(draft, key)}
    ${itemForm(withDraft(r, draft), { action: `/roadmap/${r.id}`, submit: 'Save', key, base: stamp(r.updated_at), areas })}
    <p class="actions" style="margin-top:1.5rem"><a class="button danger" href="/roadmap/${String(r.id)}/delete">Delete this item…</a></p>
    <h2>History</h2>${historyTable(past, { showWhat: false })}` });
});

router.post('/roadmap/:id', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const v = itemFromBody(req.body);
  if (!v.title) return res.redirect(303, `/roadmap/${req.params.id}/edit`);
  await withTx(req.user, async (db) => {
    await ensureArea(db, v.area);
    await db.query(`UPDATE roadmap_items SET title = $2, area = $3, notes_md = $4, published = $5, added_on = coalesce($6::date, added_on)
      WHERE id = $1 AND (title, area, notes_md, published, added_on) IS DISTINCT FROM ($2, $3, $4, $5, coalesce($6::date, added_on))`,
    [req.params.id, v.title, v.area, v.notes_md, v.published, v.added_on]);
    await setStatus(db, req.params.id, v.status, v.log);
    await dropDraft(db, req.user, `roadmap/${req.params.id}`);
  });
  res.redirect(303, '/roadmap?done=saved');
});

router.get('/roadmap/:id/delete', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const { rows: [r] } = await adminPool.query('SELECT id, title, area, status, published FROM roadmap_items WHERE id = $1', [req.params.id]);
  if (!r) return notFoundPage(req, res);
  send(req, res, confirmPage({ title: `Delete “${r.title}”?`, action: `/roadmap/${r.id}/delete`, back: `/roadmap/${r.id}/edit`,
    what: html`<p><b>${r.title}</b>${r.area ? html` <span class="tag">${r.area}</span>` : ''} — ${STATUS[r.status]}, ${r.published ? 'on the site' : 'hidden'}.</p>` }));
});

router.post('/roadmap/:id/delete', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  if (req.body.confirm !== 'yes') return res.redirect(303, `/roadmap/${req.params.id}/delete`);
  await withTx(req.user, (db) => db.query('DELETE FROM roadmap_items WHERE id = $1', [req.params.id]));
  res.redirect(303, '/roadmap?done=deleted');
});

router.get('/roadmap/restore/:auditId', async (req, res) => {
  const p = await restorePoint(req.params.auditId, 'roadmap');
  const [v] = p ? await stateAt('roadmap_items', p.upto, 'a.row_id = $3', [p.rootId]) : [];
  if (!v) return notFoundPage(req, res);
  const exists = (await adminPool.query('SELECT 1 FROM roadmap_items WHERE id = $1', [p.rootId])).rows.length > 0;
  send(req, res, { title: 'Restore a roadmap item', body: html`<p class="muted"><a href="/roadmap">← Roadmap</a></p>
    <h1>Restore “${v.title}”</h1>
    <p>The item ${restoreNote(p)}${exists ? ' — it replaces the current version (which stays in the history)' : ''}:</p>
    <div class="restore-preview"><p><b>${v.title}</b>${v.area ? html` <span class="tag">${v.area}</span>` : ''} — ${STATUS[v.status]}${v.done_on ? ` (done ${dayLabel(v.done_on)})` : ''}, ${v.published ? 'on the site' : 'hidden'}</p>
      ${v.notes_md ? html`<p class="muted">${v.notes_md}</p>` : ''}</div>
    <form method="post" class="actions"><button>Restore</button> <a href="${exists ? `/roadmap/${p.rootId}/edit` : '/roadmap'}">Cancel</a></form>` });
});

router.post('/roadmap/restore/:auditId', async (req, res) => {
  const p = await restorePoint(req.params.auditId, 'roadmap');
  const [v] = p ? await stateAt('roadmap_items', p.upto, 'a.row_id = $3', [p.rootId]) : [];
  if (!v) return notFoundPage(req, res);
  await withTx(req.user, async (db) => {
    await db.query("SELECT set_config('arthistory.restores', $1, true)", [String(p.audit.id)]);
    await ensureArea(db, v.area);   // its topic may have been deleted or renamed since (136)
    const { rowCount } = await db.query(`UPDATE roadmap_items t SET (title, notes_md, area, status, position, done_on, published) =
      (SELECT r.title, r.notes_md, r.area, r.status, r.position, r.done_on, r.published FROM jsonb_populate_record(NULL::roadmap_items, $2) r) WHERE t.id = $1`, [p.rootId, v]);
    if (!rowCount) {
      await db.query(`INSERT INTO roadmap_items (id, title, notes_md, area, status, position, done_on, published, created_at, added_on) OVERRIDING SYSTEM VALUE
        SELECT r.id, r.title, r.notes_md, r.area, r.status, r.position, r.done_on, r.published, r.created_at,
               coalesce(r.added_on, (r.created_at AT TIME ZONE 'Europe/Zurich')::date) FROM jsonb_populate_record(NULL::roadmap_items, $1) r`, [v]);
    }
  });
  res.redirect(303, `/roadmap/${p.rootId}/edit?done=restored`);
});

module.exports = router;
