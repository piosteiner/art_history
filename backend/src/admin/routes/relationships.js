// Admin panel — One relationship and one image: edit, delete, move (they are added on the entry's page).
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE, readRelationships } = require('../../content');
const { html } = require('../html');
const images = require('../images');
const citations = require('../citations');
const { thumbUrl } = require('../images');
const { send, withTx, friendly, relationshipTypes, allEntities, relFromForm, relForm, notFoundPage } = require('../core');

const router = express.Router();

// ---------------------------------------------------------------------------------------------------------------
// Relationships (declared on the subject's page)
// ---------------------------------------------------------------------------------------------------------------
router.get('/relationships/:id/edit', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  const [types, entities] = await Promise.all([relationshipTypes(adminPool, found.subject.type), allEntities(adminPool)]);
  send(req, res, {
    title: 'Edit relationship',
    body: html`<h1>Edit relationship</h1><p><a href="${found.subjectUrl}">← ${found.subject.name}</a></p>
      ${relForm({ action: `/relationships/${found.id}`, types, entities, rel: found.rel, submit: 'Save' })}
      <form method="post" action="/relationships/${found.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Delete this relationship</button></form>`,
  });
});

async function relationshipById(db, id) {
  if (!/^\d+$/.test(id)) return null;
  const { rows } = await db.query(`
    SELECT r.id, r.metadata, s.type::text AS type, s.id AS subject_id, s.slug, s.name
    FROM relationships r JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id WHERE r.id = $1`, [id]);
  if (!rows.length) return null;
  const x = rows[0];
  const rel = (await readRelationships(db, x.type, x.subject_id)).find((r) => r.id === x.id).rel;
  return { id: x.id, metadata: x.metadata, rel, subject: { type: x.type, id: x.subject_id, name: x.name },
    subjectUrl: `/${BY_TYPE[x.type].folder}/${x.slug}` };
}

router.post('/relationships/:id', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const p = await relFromForm(db, req.body, found.subject, found.metadata, { userId: req.user.id });
      await db.query(`UPDATE relationships SET relationship_type = $3, object_type = $4, object_id = $5, period = $6::daterange,
        period_label = $7, label = $8, certainty = $9, notes_md = $10, metadata = $11::jsonb
        WHERE id = $12 AND subject_type = $1 AND subject_id = $2`, [...p, found.id]);
      await citations.syncText(db, { relationship: found.id }, p.sources);
    });
  } catch (err) {
    const [types, entities] = await Promise.all([relationshipTypes(adminPool, found.subject.type), allEntities(adminPool)]);
    return send(req, res, {
      title: 'Edit relationship', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Edit relationship</h1><p><a href="${found.subjectUrl}">← ${found.subject.name}</a></p>
        ${relForm({ action: `/relationships/${found.id}`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Save' })}`,
    });
  }
  res.redirect(303, `${found.subjectUrl}?done=rel-saved#relationships`);
});

router.post('/relationships/:id/delete', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM relationships WHERE id = $1', [found.id]));
  res.redirect(303, `${found.subjectUrl}?done=rel-deleted#relationships`);
});

function imageEditPage(req, res, img, { status = 200, flash, values = img } = {}) {
  return images.licenses(adminPool).then((licenseList) => send(req, res, {
    title: 'Edit image', status, flash,
    body: html`<h1>Edit image</h1><p><a href="${img.entityUrl}#images">← ${img.name}</a></p>
      <p><img class="image-edit-preview" src="${thumbUrl(img.url, 250)}" alt=""></p>
      ${images.form({ action: `/images/${img.id}`, img: values, submit: 'Save', licenseList })}
      <form method="post" action="/images/${img.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Remove this image</button></form>`,
  }));
}

router.get('/images/:id/edit', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  return imageEditPage(req, res, img);
});

router.post('/images/:id', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  try {
    const values = images.fromForm(req.body);
    await withTx(req.user, (db) => images.update(db, img.id, values));
  } catch (err) {
    return imageEditPage(req, res, img, { status: 422, values: req.body,
      flash: { kind: 'error', text: err instanceof images.ImageError ? err.message : friendly(err) } });
  }
  res.redirect(303, `${img.entityUrl}?done=img-saved#images`);
});

router.post('/images/:id/delete', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM images WHERE id = $1', [img.id]));
  res.redirect(303, `${img.entityUrl}?done=img-deleted#images`);
});

router.post('/images/:id/move', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  if (['up', 'down', 'first'].includes(req.body.dir)) await withTx(req.user, (db) => images.move(db, img, req.body.dir));
  res.redirect(303, `${img.entityUrl}?done=img-moved#images`);
});

module.exports = router;
