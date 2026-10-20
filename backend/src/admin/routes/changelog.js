// Admin panel — the public changelog and roadmap (migration 118, German: de-CH). Mounted by src/admin/index.js before
// the entry pages (/changelog and /roadmap are no /:plural).
//   /changelog                entries, newest first; /changelog/new, /changelog/<id>/edit — the bullets one per line,
//                             "Neu: …", "Verbessert: …", "Behoben: …", "Inhalt: …", "Technik: …" (src/changelog.js)
//   /roadmap                  the four columns (drag within a column to order; buttons move an item to another);
//                             "✓ Erledigt" also writes it into today's changelog entry (a draft one is started if there
//                             is none), linked to the item
const express = require('express');
const { adminPool } = require('../../db');
const { html, raw } = require('../html');
const { send, withTx, notFoundPage, friendly } = require('../core');
const { KINDS, STATUS, parseItems, itemsToText, renderItems } = require('../../changelog');

const router = express.Router();
const SITE = process.env.PUBLIC_SITE_URL || 'https://arthistory.piogino.ch';
const DATE = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (d) => DATE.format(new Date(`${d}T12:00:00Z`));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());   // YYYY-MM-DD in Zurich
const idOk = (s) => /^\d{1,15}$/.test(String(s));

// ---------------------------------------------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------------------------------------------
router.get('/changelog', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT e.id, e.day::text AS day, e.title, e.published,
      (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) AS n FROM changelog_items i WHERE i.entry_id = e.id GROUP BY kind) k) AS kinds
    FROM changelog_entries e ORDER BY e.day DESC, e.id DESC`);
  const drafts = rows.filter((r) => !r.published).length;
  send(req, res, { title: 'Changelog', body: html`<h1>Changelog</h1>
    <p class="muted">What changed on the site, one entry per day or patch — in German, as the site shows it at
      <a href="${SITE}/changelog" target="_blank" rel="noopener">/changelog ↗</a>. ${drafts ? html`<b>${String(drafts)} draft${drafts === 1 ? '' : 's'}</b> not on the site yet.` : ''}
      <a href="/roadmap">Roadmap →</a></p>
    <p class="actions"><a class="button" href="/changelog/new">+ New entry</a></p>
    ${rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Day</th><th>Title</th><th>Bullets</th><th>Status</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><a href="/changelog/${String(r.id)}/edit">${dayLabel(r.day)}</a></td><td>${r.title || ''}</td>
        <td class="muted small">${Object.entries(r.kinds || {}).map(([k, n], i) => html`${i ? ' · ' : ''}${String(n)} ${KINDS[k]}`)}</td>
        <td>${r.published ? 'published' : html`<span class="tag flagged">draft</span>`}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">No entries yet.</p>`}` });
});

function entryForm(e, { action, items = '', flash = null, preview = null, isNew = false }) {
  return { title: isNew ? 'New changelog entry' : `Changelog ${dayLabel(e.day)}`, flash, body: html`<p class="muted"><a href="/changelog">← Changelog</a></p>
    <h1>${isNew ? 'New changelog entry' : dayLabel(e.day)}</h1>
    <form method="post" action="${action}" class="form changelog-form">
      <div class="field-pair"><div class="field"><label for="cl-day">Day</label><input id="cl-day" name="day" type="date" value="${e.day}" required></div>
        <div class="field"><label for="cl-title">Title <span class="muted small">(optional)</span></label><input id="cl-title" name="title" value="${e.title || ''}" placeholder="e.g. Patch: Suche"></div></div>
      <div class="field"><label for="cl-items">Bullet points</label>
        <textarea id="cl-items" name="items" rows="14" class="mono" spellcheck="true" lang="de">${items}</textarea>
        <div class="hint">One per line, starting with its kind: <code>Neu:</code> · <code>Verbessert:</code> · <code>Behoben:</code> · <code>Inhalt:</code> · <code>Technik:</code>
          (none = Neu). A line indented by two spaces continues the bullet above. Markdown and <code>[[type/slug]]</code> links work.</div></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${e.published ? ' checked' : ''}> Published</label></div>
      <div class="actions"><button>${isNew ? 'Create' : 'Save'}</button></div>
    </form>
    ${preview ? html`<h2>As on the site</h2><ul class="changelog-preview">${preview}</ul>` : ''}
    ${isNew ? '' : html`<form method="post" action="/changelog/${String(e.id)}/delete" class="actions" style="margin-top:1.5rem"><button class="danger">Delete this entry</button></form>`}` };
}
const previewOf = async (items) => {
  const htmls = await renderItems(adminPool, items.map((i) => i.text_md ?? i.text));
  return html`${items.map((i, n) => html`<li><span class="cl-kind cl-${i.kind}">${KINDS[i.kind]}</span> ${raw(htmls[n])}</li>`)}`;
};

const fromBody = (body) => ({ day: String(body.day || '').trim(), title: String(body.title || '').trim() || null,
  published: body.published === '1', items: parseItems(body.items) });

// the entry's bullets replaced by these, keeping the roadmap link of a bullet whose text is unchanged
async function writeItems(db, entryId, items) {
  const { rows: old } = await db.query('SELECT text_md, roadmap_item_id FROM changelog_items WHERE entry_id = $1', [entryId]);
  const link = new Map(old.filter((o) => o.roadmap_item_id).map((o) => [o.text_md, o.roadmap_item_id]));
  await db.query('DELETE FROM changelog_items WHERE entry_id = $1', [entryId]);
  for (const [n, i] of items.entries()) {
    await db.query('INSERT INTO changelog_items (entry_id, position, kind, text_md, roadmap_item_id) VALUES ($1, $2, $3, $4, $5)',
      [entryId, n, i.kind, i.text, link.get(i.text) || null]);
  }
}

router.get('/changelog/new', (req, res) => send(req, res, entryForm({ day: today(), published: false }, { action: '/changelog', isNew: true })));

router.post('/changelog', async (req, res) => {
  const v = fromBody(req.body);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return send(req, res, { ...entryForm({ ...v }, { action: '/changelog', items: req.body.items, isNew: true, flash: { kind: 'error', text: 'Day: a date.' } }), status: 422 });
  let id;
  try {
    id = await withTx(req.user, async (db) => {
      const { rows: [e] } = await db.query('INSERT INTO changelog_entries (day, title, published) VALUES ($1, $2, $3) RETURNING id', [v.day, v.title, v.published]);
      await writeItems(db, e.id, v.items);
      return e.id;
    });
  } catch (err) {
    return send(req, res, { ...entryForm({ ...v }, { action: '/changelog', items: req.body.items, isNew: true, flash: { kind: 'error', text: friendly(err) } }), status: 422 });
  }
  res.redirect(303, `/changelog/${id}/edit?done=created`);
});

async function entry(id) {
  if (!idOk(id)) return null;
  const { rows: [e] } = await adminPool.query('SELECT id, day::text AS day, title, published FROM changelog_entries WHERE id = $1', [id]);
  if (!e) return null;
  const { rows: items } = await adminPool.query('SELECT kind, text_md FROM changelog_items WHERE entry_id = $1 ORDER BY position', [id]);
  return { ...e, items };
}

router.get('/changelog/:id/edit', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  send(req, res, entryForm(e, { action: `/changelog/${e.id}`, items: itemsToText(e.items), preview: e.items.length ? await previewOf(e.items) : null }));
});

router.post('/changelog/:id', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  const v = fromBody(req.body);
  try {
    await withTx(req.user, async (db) => {
      await db.query('UPDATE changelog_entries SET day = $2, title = $3, published = $4 WHERE id = $1', [e.id, v.day, v.title, v.published]);
      await writeItems(db, e.id, v.items);
    });
  } catch (err) {
    return send(req, res, { ...entryForm({ ...e, ...v }, { action: `/changelog/${e.id}`, items: req.body.items, flash: { kind: 'error', text: friendly(err) } }), status: 422 });
  }
  res.redirect(303, `/changelog/${e.id}/edit?done=saved`);
});

router.post('/changelog/:id/delete', async (req, res) => {
  const e = await entry(req.params.id);
  if (!e) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM changelog_entries WHERE id = $1', [e.id]));
  res.redirect(303, '/changelog?done=deleted');
});

// ---------------------------------------------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------------------------------------------
const AREAS = ['Daten', 'Provenienz', 'Suche', 'Karte', 'Zeitleiste', 'Netzwerk', 'CMS', 'Website', 'Dokumentation', 'Technik'];

function itemForm(r, { action, submit }) {
  return html`<form method="post" action="${action}" class="form roadmap-form">
    <div class="field-pair"><div class="field"><label for="rm-title">Title</label><input id="rm-title" name="title" value="${r.title || ''}" required></div>
      <div class="field"><label for="rm-area">Area</label><input id="rm-area" name="area" value="${r.area || ''}" list="rm-areas" placeholder="e.g. Provenienz">
        <datalist id="rm-areas">${AREAS.map((a) => html`<option>${a}</option>`)}</datalist></div></div>
    <div class="field"><label for="rm-notes">Notes <span class="muted small">(optional, shown on the site)</span></label><textarea id="rm-notes" name="notes_md" rows="4" class="md">${r.notes_md || ''}</textarea></div>
    <div class="field-pair"><div class="field"><label for="rm-status">Column</label><select id="rm-status" name="status">
        ${Object.entries(STATUS).map(([k, l]) => html`<option value="${k}"${(r.status || 'spaeter') === k ? ' selected' : ''}>${l}</option>`)}</select></div>
      <div class="field"><label class="choice"><input type="checkbox" name="published" value="1"${r.published !== false ? ' checked' : ''}> On the site</label>
        <label class="choice"><input type="checkbox" name="log" value="1" checked> When it becomes “Erledigt”: into today's changelog</label></div></div>
    <div class="actions"><button>${submit}</button></div></form>`;
}

router.get('/roadmap', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT r.id, r.title, r.area, r.status, r.position, r.published, r.done_on::text AS done_on,
      (SELECT e.id FROM changelog_items i JOIN changelog_entries e ON e.id = i.entry_id WHERE i.roadmap_item_id = r.id ORDER BY e.day DESC LIMIT 1) AS logged_in
    FROM roadmap_items r ORDER BY r.position, r.id`);
  const col = (status) => rows.filter((r) => r.status === status)
    .sort((a, b) => (status === 'erledigt' ? String(b.done_on).localeCompare(String(a.done_on)) : 0));
  const move = (r) => html`${Object.entries(STATUS).filter(([k]) => k !== r.status).map(([k, l]) => html`
    <button type="submit" form="rm-move-${String(r.id)}" name="status" value="${k}" class="link-button small" title="Move to “${l}”">${k === 'erledigt' ? '✓ Erledigt' : `→ ${l}`}</button>`)}`;
  send(req, res, { title: 'Roadmap', body: html`<h1>Roadmap</h1>
    <p class="muted">What is being worked on, what comes next, what later, and what is done — in German, as the site shows it at
      <a href="${SITE}/roadmap" target="_blank" rel="noopener">/roadmap ↗</a>. Drag within a column to order it. “✓ Erledigt” also
      writes the item into today's changelog entry. <a href="/changelog">Changelog →</a></p>
    <div class="roadmap-board">
      ${Object.entries(STATUS).map(([status, label]) => html`<section class="roadmap-col roadmap-${status}">
        <h2>${label} <span class="muted small">${String(col(status).length)}</span></h2>
        <table${status === 'erledigt' ? '' : html` data-sortable="/roadmap/order"`} class="roadmap-list">
          ${col(status).map((r) => html`<tbody class="sort-item" data-sort-id="${String(r.id)}"><tr>
            <td class="drag-cell">${status === 'erledigt' ? '' : html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move ${r.title}">⠿</button>`}</td>
            <td class="roadmap-card"><a href="/roadmap/${String(r.id)}/edit"><b>${r.title}</b></a>${r.area ? html` <span class="tag">${r.area}</span>` : ''}${r.published ? '' : html` <span class="tag flagged">hidden</span>`}
            ${r.done_on ? html`<div class="muted small">done ${dayLabel(r.done_on)}${r.logged_in ? html` · <a href="/changelog/${String(r.logged_in)}/edit">in the changelog</a>` : ''}</div>` : ''}
            <form id="rm-move-${String(r.id)}" method="post" action="/roadmap/${String(r.id)}/move"><input type="hidden" name="log" value="1"></form>
            <div class="roadmap-moves">${move(r)}</div></td></tr></tbody>`)}
        </table></section>`)}
    </div>
    <h2>New item</h2>
    ${itemForm({}, { action: '/roadmap', submit: '+ Add' })}` });
});

// drag order within a column (editor/sortable.js): ids in the new order → position 10, 20, 30 …
router.post('/roadmap/order', async (req, res) => {
  const ids = String(req.body.ids || '').split(',').filter(idOk);
  await withTx(req.user, (db) => db.query(`UPDATE roadmap_items r SET position = o.n * 10
    FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE r.id = o.id`, [ids]));
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
  await db.query(`INSERT INTO changelog_items (entry_id, position, kind, text_md, roadmap_item_id) VALUES ($1, $2, 'neu', $3, $4)`, [e.id, n, r.title, id]);
  return e.id;
}

router.post('/roadmap/:id/move', async (req, res) => {
  if (!idOk(req.params.id) || !STATUS[req.body.status]) return notFoundPage(req, res);
  const entryId = await withTx(req.user, (db) => setStatus(db, req.params.id, req.body.status, req.body.log === '1'));
  res.redirect(303, entryId ? `/roadmap?done=logged&entry=${entryId}` : '/roadmap?done=saved');
});

const itemFromBody = (b) => ({ title: String(b.title || '').trim(), area: String(b.area || '').trim() || null, notes_md: String(b.notes_md || '').trim() || null,
  status: STATUS[b.status] ? b.status : 'spaeter', published: b.published === '1', log: b.log === '1' });

router.post('/roadmap', async (req, res) => {
  const v = itemFromBody(req.body);
  if (!v.title) return res.redirect(303, '/roadmap');
  await withTx(req.user, async (db) => {
    const { rows: [r] } = await db.query(`INSERT INTO roadmap_items (title, area, notes_md, status, published, position)
      VALUES ($1, $2, $3, 'spaeter', $4, (SELECT coalesce(max(position), 0) + 10 FROM roadmap_items WHERE status = 'spaeter')) RETURNING id`,
    [v.title, v.area, v.notes_md, v.published]);
    if (v.status !== 'spaeter') await setStatus(db, r.id, v.status, v.log);
  });
  res.redirect(303, '/roadmap?done=created');
});

router.get('/roadmap/:id/edit', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const { rows: [r] } = await adminPool.query('SELECT * FROM roadmap_items WHERE id = $1', [req.params.id]);
  if (!r) return notFoundPage(req, res);
  send(req, res, { title: r.title, body: html`<p class="muted"><a href="/roadmap">← Roadmap</a></p><h1>${r.title}</h1>
    ${itemForm(r, { action: `/roadmap/${r.id}`, submit: 'Save' })}
    <form method="post" action="/roadmap/${String(r.id)}/delete" class="actions" style="margin-top:1.5rem"><button class="danger">Delete this item</button></form>` });
});

router.post('/roadmap/:id', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  const v = itemFromBody(req.body);
  if (!v.title) return res.redirect(303, `/roadmap/${req.params.id}/edit`);
  await withTx(req.user, async (db) => {
    await db.query('UPDATE roadmap_items SET title = $2, area = $3, notes_md = $4, published = $5 WHERE id = $1', [req.params.id, v.title, v.area, v.notes_md, v.published]);
    await setStatus(db, req.params.id, v.status, v.log);
  });
  res.redirect(303, '/roadmap?done=saved');
});

router.post('/roadmap/:id/delete', async (req, res) => {
  if (!idOk(req.params.id)) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM roadmap_items WHERE id = $1', [req.params.id]));
  res.redirect(303, '/roadmap?done=deleted');
});

module.exports = router;
