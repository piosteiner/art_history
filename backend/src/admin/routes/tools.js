// Admin panel — Tools on an entry: discard changes, merge a duplicate, change type, delete, its history.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const drafts = require('../drafts');
const duplicates = require('../duplicates');
const collab = require('../collab');
const { humanize } = require('../forms');
const { PAGE, send, withTx, friendly, history, historyTable, pager, pageParam, anOf, CONVERTIBLE, notFoundPage, findEntity, pluralParam } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// Discarding resets everyone's working copy, so it is confirmed on a page that lists what would be lost.
router.get('/:plural/:slug/discard-changes', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const { form: working } = await collab.currentForm(t, e.id);
  const changed = drafts.changedFields(working, t, e);
  const pending = await collab.unpublished(t, e.id);
  send(req, res, {
    title: `Discard unpublished changes · ${e.name}`,
    page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<h1>Discard unpublished changes?</h1>
      ${changed.length ? html`<p>The working copy of <b>${e.name}</b> differs from the published version in:
        <b>${changed.join(', ')}</b>${pending && pending.contributors.length ? html` (changes by ${pending.contributors.join(', ')})` : ''}.
        Discarding resets it to the published version <b>for everyone</b> editing it. This cannot be undone.</p>
        <form method="post" action="/${t.folder}/${e.slug}/discard-changes" class="actions">
          <button class="danger">Discard for everyone</button><a class="button secondary" href="/${t.folder}/${e.slug}/edit">Cancel</a></form>`
      : html`<p>There are no unpublished changes. <a href="/${t.folder}/${e.slug}/edit">Back to the editor</a></p>`}`,
  });
});

router.post('/:plural/:slug/discard-changes', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  await collab.discard(t, e.id);
  res.redirect(303, `/${t.folder}/${e.slug}/edit?done=discarded`);
});

// Merge a duplicate into another entry (merge_entries, migration 044): pick → preview (rolled back) → merge.
// ?pair=dup:<id>:<id> (from the quality page) picks the other one of the pair.
router.get('/:plural/:slug/merge', async (req, res) => {
  const { t } = req;
  const dup = await findEntity(t, req.params.slug);
  if (!dup) return notFoundPage(req, res);
  let intoSlug = String(req.query.into || '').trim();
  const pair = /^dup:(\d+):(\d+)$/.exec(String(req.query.pair || ''));
  if (!intoSlug && pair) {
    const other = pair[1] === String(dup.id) ? pair[2] : pair[1];
    intoSlug = (await adminPool.query(`SELECT slug FROM ${t.table} WHERE id = $1`, [other])).rows[0]?.slug || '';
  }
  const keep = intoSlug ? await findEntity(t, intoSlug) : null;
  const found = await duplicates.candidates(adminPool, t.type, dup.id);
  let preview = null;
  let error = intoSlug && !keep ? `No ${t.type} "${intoSlug}".` : null;
  if (keep) ({ result: preview, error } = await duplicates.runMerge(adminPool, req.user, t, keep.id, dup.id, { preview: true }));
  send(req, res, { title: `Merge ${dup.name}`, page: { type: t.type, slug: dup.slug, mode: 'merge' },
    body: duplicates.mergePage({ t, dup, keep: preview ? keep : null, found, preview, error }) });
});

router.post('/:plural/:slug/merge', async (req, res) => {
  const { t } = req;
  const dup = await findEntity(t, req.params.slug);
  const keep = await findEntity(t, String(req.body.into || ''));
  if (!dup || !keep) return notFoundPage(req, res);
  const { error } = await duplicates.runMerge(adminPool, req.user, t, keep.id, dup.id, { preview: false });
  if (error) {
    return send(req, res, { title: `Merge ${dup.name}`, status: 409,
      body: duplicates.mergePage({ t, dup, keep: null, found: [], preview: null, error }) });
  }
  await collab.gone(t, dup.id);  // close the duplicate's working copy for everyone editing it
  res.redirect(303, `/${t.folder}/${keep.slug}?done=merged`);
});

// Change an entry's type (convert_entry, migration 055): pick the type → preview (rolled back) → change. The entry
// moves to the other table; old addresses and [[links]] follow.
async function runConvert(user, t, e, to, { preview }) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', 'admin', true)", [String(user.id)]);
    const { rows } = await client.query('SELECT convert_entry($1, $2, $3) AS r', [t.type, e.id, to]);
    await client.query(preview ? 'ROLLBACK' : 'COMMIT');
    return { result: rows[0].r };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (['P0001', '23503', '23505', '23514', '23502'].includes(err.code)) return { error: err.message };
    throw err;
  } finally {
    client.release();
  }
}
function convertPage({ t, e, to, preview, error, doubt }) {
  const targets = CONVERTIBLE.filter((x) => x !== t.type);
  return html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
    <h1>Change the type of ${e.name}</h1>
    <p>For an entry created as the wrong kind — a person entered as an institution. It moves to the other kind with
      everything both have; what can't come along is listed below before anything changes. Old addresses and [[links]]
      lead to it. Revertable from the history.</p>
    ${doubt ? html`<p class="flash warn">${doubt}</p>` : ''}
    ${error ? html`<p class="flash error">${error}</p>` : ''}
    <form method="get" action="/${t.folder}/${e.slug}/convert" class="bar">
      <label for="to">From ${anOf(t.type)} to</label>
      <select id="to" name="to">${targets.map((x) => html`<option value="${x}"${x === to ? ' selected' : ''}>${anOf(x)}</option>`)}</select>
      <button class="secondary">Preview</button></form>
    ${preview ? html`<section><h2>What happens</h2><ul class="merge-summary">
      <li>Comes along: ${preview.kept.filter((k) => !['metadata', 'slug'].includes(k)).join(', ')}${preview.slug !== e.slug ? html` — new address /${BY_TYPE[to].folder}/${preview.slug}` : ''}.</li>
      ${preview.lost.length ? html`<li><b>Not kept</b> (${anOf(to)} has no such field): ${preview.lost.join(', ')} — still in the history.</li>` : ''}
      ${preview.dropped_relationships.length ? html`<li><b>Relationships ${anOf(to)} can't have</b> (removed): ${preview.dropped_relationships.join(' · ')}</li>` : html`<li>All relationships come along.</li>`}
      ${Object.entries(preview.dropped).map(([k, n]) => html`<li><b>Removed:</b> ${n} ${k}</li>`)}
      ${preview.texts ? html`<li>${preview.texts} text${preview.texts > 1 ? 's' : ''} with [[links]] to it rewritten.</li>` : ''}</ul>
      <form method="post" action="/${t.folder}/${e.slug}/convert" class="actions"><input type="hidden" name="to" value="${to}">
        <button class="danger">Make ${e.name} ${anOf(to)}</button></form></section>` : ''}`;
}
router.get('/:plural/:slug/convert', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const doubt = (await adminPool.query('SELECT type_doubt($1, $2) AS d', [t.type, e.name])).rows[0].d;
  const to = CONVERTIBLE.includes(req.query.to) && req.query.to !== t.type ? req.query.to : null;
  if (!CONVERTIBLE.includes(t.type)) {
    return send(req, res, { title: 'Change type', body: html`<p class="flash warn">${humanize(t.folder)} can't change their type.</p><p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>` });
  }
  const { result: preview, error } = to ? await runConvert(req.user, t, e, to, { preview: true }) : {};
  send(req, res, { title: `Change type: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: convertPage({ t, e, to, preview, error, doubt }) });
});
router.post('/:plural/:slug/convert', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e || !CONVERTIBLE.includes(req.body.to)) return notFoundPage(req, res);
  const { result, error } = await runConvert(req.user, t, e, req.body.to, { preview: false });
  if (error) return send(req, res, { title: 'Change type', status: 409, body: convertPage({ t, e, to: req.body.to, preview: null, error }) });
  await collab.gone(t, e.id);
  res.redirect(303, `/${BY_TYPE[result.to].folder}/${result.slug}?done=converted`);
});

router.get('/:plural/:slug/delete', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const { rows } = await adminPool.query(`
    SELECT s.name AS subject, rt.label, o.name AS object, r.period_label
    FROM relationships r JOIN relationship_types rt ON rt.code = r.relationship_type
    JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
    JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
    WHERE (r.subject_type, r.subject_id) = ($1, $2) OR (r.object_type, r.object_id) = ($1, $2)
    ORDER BY rt.sort_order, s.name COLLATE sort_natural`, [t.type, e.id]);
  send(req, res, {
    title: `Delete ${e.name}`,
    body: html`<h1>Delete ${e.name}?</h1>
      ${rows.length ? html`<p>This also deletes <b>${rows.length}</b> relationship${rows.length === 1 ? '' : 's'}, including ones
        entered on other entities' pages:</p>
        <div class="table-wrap"><table><tbody>${rows.map((r) => html`<tr><td>${r.subject}</td><td>${r.label}</td><td>${r.object}</td>
          <td class="muted">${r.period_label || ''}</td></tr>`)}</tbody></table></div>` : html`<p>It has no relationships.</p>`}
      <p class="muted">Everything stays in the history, but there is no one-click undo yet.</p>
      <form method="post" action="/${t.folder}/${e.slug}/delete" class="actions">
        <button class="danger">Delete${rows.length ? ` with ${rows.length} relationship${rows.length === 1 ? '' : 's'}` : ''}</button>
        <a class="button secondary" href="/${t.folder}/${e.slug}">Cancel</a></form>`,
  });
});

router.post('/:plural/:slug/delete', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, (db) => db.query(`DELETE FROM ${t.table} WHERE id = $1`, [e.id]));
    await collab.gone(t, e.id);  // close the working copy for everyone editing it
  } catch (err) {
    return send(req, res, {
      title: `Delete ${e.name}`, status: 409, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Can't delete ${e.name}</h1><p>Other records still point to it (see above). Change or delete those first.</p>
        <p><a href="/${t.folder}/${e.slug}">← back</a></p>`,
    });
  }
  res.redirect(303, `/${t.folder}?done=deleted`);
});

router.get('/:plural/:slug/history', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const page = pageParam(req);
  const h = await history(adminPool, `(a.table_name = $1 AND a.row_id = $2) OR (a.table_name = 'relationships' AND (
      ((r->>'subject_type') = $3 AND (r->>'subject_id')::bigint = $2) OR ((r->>'object_type') = $3 AND (r->>'object_id')::bigint = $2)))
      OR (a.table_name = 'images' AND (r->>$4)::bigint = $2)
      OR (a.table_name = 'provenance' AND (($3 = 'artwork' AND (r->>'artwork_id')::bigint = $2) OR (r->>('owner_' || $3 || '_id'))::bigint = $2
                                            OR ($3 = 'place' AND (r->>'location_id')::bigint = $2)))
      OR (a.table_name = 'artwork_numbers' AND (($3 = 'artwork' AND (r->>'artwork_id')::bigint = $2) OR ($3 = 'institution' AND (r->>'institution_id')::bigint = $2)
                                                 OR ($3 = 'source' AND (r->>'source_id')::bigint = $2)))`,
  [t.table, e.id, t.type, t.imageFk || '-'], { offset: (page - 1) * PAGE });
  send(req, res, {
    title: `History of ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p><h1>History</h1>
      ${historyTable(h.rows, { restoreFor: { table: t.table, rowId: e.id } })}${pager(`/${t.folder}/${e.slug}/history`, page, h.more)}`,
  });
});

module.exports = router;
