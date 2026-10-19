// Admin panel — Further numbers of an artwork; provenance steps: edit, remove, reorder.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const provenance = require('../provenance');
const numbers = require('../numbers');
const records = require('../provenance-records');
const citations = require('../citations');
const { send, withTx, friendly, stepFromBody, notFoundPage, findEntity } = require('../core');

const router = express.Router();

// Further numbers of an artwork (src/admin/numbers.js): added and removed on its edit page (?back=edit), one by one.
router.post('/artworks/:slug/numbers', async (req, res) => {
  const e = await findEntity(BY_TYPE.artwork, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, (db) => numbers.add(db, e.id, req.body));
  } catch (err) {
    const text = numbers.errorText(err) || friendly(err);
    return send(req, res, { title: 'Add a number', status: 422, flash: { kind: 'error', text },
      body: html`<p><a href="/artworks/${e.slug}/edit#numbers">← Edit ${e.name}</a></p>${numbers.section({ e, numbers: await numbers.list(adminPool, e.id), values: req.body, standalone: true })}` });
  }
  res.redirect(303, `/artworks/${e.slug}${req.query.back === 'edit' ? '/edit' : ''}?done=num-added#numbers`);
});

router.post('/numbers/:id/delete', async (req, res) => {
  const n = await numbers.byId(adminPool, req.params.id);
  if (!n) return notFoundPage(req, res);
  await withTx(req.user, (db) => numbers.remove(db, n.id));
  res.redirect(303, `/artworks/${n.artwork_slug}${req.query.back === 'edit' ? '/edit' : ''}?done=num-deleted#numbers`);
});

// Provenance steps: added on the artwork's page, edited / removed / reordered under /provenance/<id> (src/admin/provenance.js).
async function provenanceEditPage(req, res, step, { status = 200, flash, values = provenance.formValues(step), recordValues = {} } = {}) {
  const choices = provenance.stepChoices(await provenance.read(adminPool, step.artwork_id));   // "another reading of" (084)
  const list = (await records.forSteps(adminPool, [step.id]))[step.id] || [];
  send(req, res, {
    title: 'Edit provenance step', status, flash,
    body: html`<h1>Edit provenance step</h1><p><a href="${step.artworkUrl}#provenance">← ${step.artwork_title}</a></p>
      ${provenance.form({ action: `/provenance/${step.id}`, step: { ...values, id: step.id }, submit: 'Save', choices })}
      ${records.editSection(step, list, recordValues)}
      <form method="post" action="/provenance/${step.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Remove this step</button></form>`,
  });
}

// Records of a step (src/admin/provenance-records.js, migration 104): added, edited, removed one by one.
router.post('/provenance/:id/records', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => records.add(db, step.id, await records.fromForm(db, req.body)));
  } catch (err) {
    return provenanceEditPage(req, res, step, { status: 422, recordValues: { ...req.body, date_text: req.body.date, place_slug: req.body.place },
      flash: { kind: 'error', text: records.errorText(err) || friendly(err) } });
  }
  res.redirect(303, `/provenance/${step.id}/edit?done=record-added#records`);
});

router.get('/records/:id/edit', async (req, res) => {
  const r = await records.byId(adminPool, req.params.id);
  if (!r) return notFoundPage(req, res);
  send(req, res, { title: 'Edit record', body: html`<h1>Edit record</h1><p><a href="/provenance/${r.provenance_id}/edit#records">← the step</a></p>${records.editPage(r)}` });
});

router.post('/records/:id', async (req, res) => {
  const r = await records.byId(adminPool, req.params.id);
  if (!r) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => records.update(db, r.id, await records.fromForm(db, req.body)));
  } catch (err) {
    return send(req, res, { title: 'Edit record', status: 422, flash: { kind: 'error', text: records.errorText(err) || friendly(err) },
      body: html`<h1>Edit record</h1><p><a href="/provenance/${r.provenance_id}/edit#records">← the step</a></p>${records.editPage(r, { ...req.body, date_text: req.body.date, place_slug: req.body.place })}` });
  }
  res.redirect(303, `/provenance/${r.provenance_id}/edit?done=record-saved#records`);
});

router.post('/records/:id/delete', async (req, res) => {
  const r = await records.byId(adminPool, req.params.id);
  if (!r) return notFoundPage(req, res);
  await withTx(req.user, (db) => records.remove(db, r.id));
  res.redirect(303, `/provenance/${r.provenance_id}/edit?done=record-deleted#records`);
});

// Provenance numbers (077): a lot, a dealer's stock number, "Entartete Kunst", ERR, Munich, Linz, Alt-Aussee — where
// does this number occur? Exact match first, then numbers that contain it.
router.get('/provenance/numbers', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const { rows } = q ? await adminPool.query(`
    SELECT k.label AS kind, n.number, w.slug, w.title, pp.owner_name, pp.period_label, n.date_label, n.document, n.certainty::text AS certainty
    FROM provenance_numbers_all n JOIN provenance_number_kinds k ON k.code = n.kind
    JOIN provenance_periods pp ON pp.id = n.provenance_id JOIN artworks w ON w.id = pp.artwork_id
    WHERE lower(n.number) = lower($1) OR lower(n.number) LIKE '%' || lower($1) || '%'
    ORDER BY lower(n.number) = lower($1) DESC, k.position, n.number, w.title LIMIT 200`, [q]) : { rows: [] };
  send(req, res, { title: 'Provenance numbers', body: html`<h1>Provenance numbers</h1>
    <p class="muted">Lot and stock numbers, “Entartete Kunst” (EK), ERR, Munich Central Collecting Point, Linz, Alt-Aussee, Lugt —
      inventory numbers — as recorded on provenance steps and their records.</p>
    <form method="get" action="/provenance/numbers" class="bar" data-live><input type="search" name="q" value="${q}" class="grow" placeholder="a number, e.g. 4317" autocomplete="off"><button>Search</button></form>
    <div data-live-results="numbers">${q ? (rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Number</th><th>Kind</th><th>Artwork</th><th>Step</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><b>${r.number}</b>${r.certainty !== 'attested' ? html` <span class="muted">(${r.certainty})</span>` : ''}</td><td>${r.kind}${r.document || r.date_label ? html`<div class="muted small">${[r.document, r.date_label].filter(Boolean).join(', ')}</div>` : ''}</td><td><a href="/artworks/${r.slug}#provenance">${r.title}</a></td>
        <td>${r.owner_name || ''} <span class="muted">${r.period_label || ''}</span></td></tr>`)}</tbody></table></div>`
      : html`<p class="muted">No provenance step has this number.</p>`) : ''}</div>` });
});

router.get('/provenance/:id/edit', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  return provenanceEditPage(req, res, step);
});

router.post('/provenance/:id', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const values = await provenance.fromForm(db, req.body, step.metadata);
      await provenance.update(db, step.id, values);
      await citations.syncText(db, { provenance: step.id }, values.sources);
    });
  } catch (err) {
    return provenanceEditPage(req, res, step, { status: 422, values: stepFromBody(req.body),
      flash: { kind: 'error', text: err instanceof provenance.ProvenanceError ? err.message : friendly(err) } });
  }
  res.redirect(303, `${step.artworkUrl}?done=prov-saved#provenance`);
});

// A planned step (096) that happened as planned: no more reminder. ?back=dashboard → back to the dashboard.
router.post('/provenance/:id/confirm', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('UPDATE provenance SET check_after = NULL WHERE id = $1', [step.id]));
  res.redirect(303, req.query.back === 'dashboard' ? '/?done=prov-confirmed' : `${step.artworkUrl}?done=prov-confirmed#provenance`);
});

router.post('/provenance/:id/delete', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  await withTx(req.user, (db) => provenance.remove(db, step));
  res.redirect(303, `${step.artworkUrl}?done=prov-deleted#provenance`);
});

// A new order of an artwork's provenance (drag and drop, editor/sortable.js): ids=3,1,2 → 204, or 409 with a message.
router.post('/artworks/:slug/provenance/order', async (req, res) => {
  const e = await findEntity(BY_TYPE.artwork, req.params.slug);
  if (!e) return res.status(404).type('text').send('not found');
  const ids = String(req.body.ids || '').split(',').filter((x) => /^\d+$/.test(x));
  try {
    await withTx(req.user, (db) => provenance.reorder(db, e.id, ids));
  } catch (err) {
    if (err instanceof provenance.ProvenanceError) return res.status(409).type('text').send(err.message);
    throw err;
  }
  res.status(204).end();
});

router.post('/provenance/:id/move', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  if (['up', 'down'].includes(req.body.dir)) await withTx(req.user, (db) => provenance.move(db, step, req.body.dir));
  res.redirect(303, `${step.artworkUrl}?done=prov-moved#provenance`);
});

module.exports = router;
