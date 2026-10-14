// Admin panel — Further numbers of an artwork; provenance steps: edit, remove, reorder.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const provenance = require('../provenance');
const numbers = require('../numbers');
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
function provenanceEditPage(req, res, step, { status = 200, flash, values = provenance.formValues(step) } = {}) {
  send(req, res, {
    title: 'Edit provenance step', status, flash,
    body: html`<h1>Edit provenance step</h1><p><a href="${step.artworkUrl}#provenance">← ${step.artwork_title}</a></p>
      ${provenance.form({ action: `/provenance/${step.id}`, step: values, submit: 'Save' })}
      <form method="post" action="/provenance/${step.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Remove this step</button></form>`,
  });
}

router.get('/provenance/:id/edit', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  provenanceEditPage(req, res, step);
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
