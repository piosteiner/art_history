// Admin panel — Sources for facts (markers next to values) and reference records (authority files).
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE, readDocs } = require('../../content');
const { html } = require('../html');
const drafts = require('../drafts');
const citations = require('../citations');
const identifiers = require('../identifiers');
const { send, withTx, friendly, notFoundPage, findEntity, pluralParam } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// Sources for facts (src/admin/citations.js): added and removed from the markers next to values; back to the page.
// back to the entry page (a local path, maybe with #anchor), with ?done= before the anchor
const citeBack = (b, done) => {
  const url = typeof b === 'string' && /^\/[a-z][a-z0-9/_.-]*(#[a-z-]+)?$/i.test(b) ? b : '/';
  const [path, hash] = url.split('#');
  return `${path}?done=${done}${hash ? `#${hash}` : ''}`;
};

// Called by the page script (editor/sortable.js) — "X-Requested-With: fetch": answered with JSON, the page updates in
// place: { markers: {key: html}, recent: html } or { error }. Without script: the form posts and the page reloads.
const wantsJson = (req) => req.get('X-Requested-With') === 'fetch';

// The markers the page asks to have back (refresh: [{key, label, edit, type, id}]) — rendered anew from the database.
async function freshMarkers(req, refresh) {
  const out = {};
  const list = Array.isArray(refresh) ? refresh.slice(0, 40) : [];
  const ent = list.find((r) => BY_TYPE[r.type] && /^\d+$/.test(String(r.id)));
  const recent = await citations.recentSources(adminPool, req.user.id, ent ? ent.type : null, ent ? ent.id : null);
  const back = typeof req.body.back === 'string' ? req.body.back : '/';
  const fields = ent ? await citations.forEntity(adminPool, ent.type, ent.id) : {};
  const relIds = list.map((r) => /^rel:(\d+)$/.exec(r.key)).filter(Boolean).map((m) => m[1]);
  const provIds = list.map((r) => /^prov:(\d+)$/.exec(r.key)).filter(Boolean).map((m) => m[1]);
  const rels = await citations.forRelationships(adminPool, relIds);
  const provs = await citations.forProvenance(adminPool, provIds);
  const nums = await citations.forNumbers(adminPool, list.map((r) => /^num:(\d+)$/.exec(r.key)).filter(Boolean).map((m) => m[1]));
  for (const r of list) {
    const label = String(r.label || '').slice(0, 200);
    let m;
    if ((m = /^field:([a-z_]+)$/.exec(r.key)) && ent) {
      out[r.key] = String(citations.marker(fields[m[1]], { type: ent.type, id: ent.id, field: m[1], label }, back, { edit: !!r.edit, recent }));
    } else if ((m = /^rel:(\d+)$/.exec(r.key))) {
      out[r.key] = String(citations.marker(rels[m[1]], { relationship: m[1], label }, back, { recent }));
    } else if ((m = /^prov:(\d+)$/.exec(r.key))) {
      out[r.key] = String(citations.marker(provs[m[1]], { provenance: m[1], label }, back, { recent }));
    } else if ((m = /^num:(\d+)$/.exec(r.key))) {
      out[r.key] = String(citations.marker(nums[m[1]], { number: m[1], label }, back, { recent }));
    }
  }
  return { markers: out, recent: String(citations.recentChips(recent)) };
}
const refreshOf = (req) => { try { return JSON.parse(String(req.body.refresh || '[]')); } catch { return []; } };

router.post('/citations', async (req, res) => {
  try {
    // from the edit page: each field's values in the working copy (expect: {field: {f.…: value}}). Different from the
    // published ones → the citation is for the new value and waits for it to be published (settled by saveEntity).
    let pendingByField = null;
    const t = BY_TYPE[req.body.type];
    if (req.body.expect && t && /^\d+$/.test(String(req.body.id || ''))) {
      let expect = {};
      try { expect = JSON.parse(String(req.body.expect)) || {}; } catch { expect = {}; }
      const e = (await readDocs(adminPool, t, 't.id = $1', [req.body.id]))[0];
      const published = e ? drafts.formKeys(e.doc, t, e.slug) : {};
      const norm = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
      pendingByField = {};
      for (const [field, values] of Object.entries(expect)) {
        if (!/^[a-z_]+$/.test(field) || !values || typeof values !== 'object') continue;
        const v = Object.fromEntries(Object.entries(values).filter(([k, x]) => /^f\.[a-z_]+$/.test(k) && typeof x === 'string'));
        if (Object.keys(v).length && Object.entries(v).some(([k, x]) => norm(x) !== norm(published[k]))) pendingByField[field] = v;
      }
    }
    await withTx(req.user, (db) => citations.add(db, req.body, req.user.id, { pendingByField }));
  } catch (err) {
    const text = err instanceof citations.CitationError ? err.message : friendly(err);
    if (wantsJson(req)) return res.status(422).json({ error: text });
    return send(req, res, { title: 'Add a source', status: 422, flash: { kind: 'error', text },
      body: html`<p><a href="${citeBack(req.body.back, 'cite-failed').replace(/\?done=cite-failed/, '')}">← back</a></p>` });
  }
  if (wantsJson(req)) return res.json(await freshMarkers(req, refreshOf(req)));
  res.redirect(303, citeBack(req.body.back, 'cite-added'));
});
router.post('/citations/:id/delete', async (req, res) => {
  const c = await citations.byId(adminPool, req.params.id);
  if (!c) return wantsJson(req) ? res.status(404).json({ error: 'That source is gone already — reload the page.' }) : notFoundPage(req, res);
  await withTx(req.user, (db) => citations.remove(db, c.id));
  if (wantsJson(req)) return res.json(await freshMarkers(req, refreshOf(req)));
  res.redirect(303, citeBack(req.body.back, 'cite-deleted'));
});

router.post('/citations/:id/confirm', async (req, res) => {
  const c = await citations.byId(adminPool, req.params.id);
  if (!c) return wantsJson(req) ? res.status(404).json({ error: 'That source is gone — reload the page.' }) : notFoundPage(req, res);
  await withTx(req.user, (db) => citations.confirm(db, c.id));
  if (wantsJson(req)) return res.json(await freshMarkers(req, refreshOf(req)));
  res.redirect(303, citeBack(req.body.back, 'cite-confirmed'));
});

// Reference records (authority files, src/admin/identifiers.js): added and removed on the edit page (?back=edit), one
// by one — or from the SIKART search (next=sikart).
router.post('/:plural/:slug/identifiers', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, (db) => identifiers.add(db, t.type, e.id, req.body));
  } catch (err) {
    const text = err instanceof identifiers.IdentifierError ? err.message : friendly(err);
    return send(req, res, { title: 'Add a reference record', status: 422, flash: { kind: 'error', text },
      body: html`<p><a href="/${t.folder}/${e.slug}${req.query.back === 'edit' ? '/edit' : ''}#reference-records">← ${e.name}</a></p>` });
  }
  if (req.body.next === 'sikart') return res.redirect(303, `/${t.folder}/${e.slug}/sikart`);  // picked in the SIKART search
  res.redirect(303, `/${t.folder}/${e.slug}${req.query.back === 'edit' ? '/edit' : ''}?done=id-added#reference-records`);
});
router.post('/identifiers/:id/delete', async (req, res) => {
  const row = await identifiers.byId(adminPool, req.params.id);
  if (!row) return notFoundPage(req, res);
  const { rows } = await adminPool.query('SELECT slug FROM entity_index WHERE type = $1 AND id = $2', [row.entity_type, row.entity_id]);
  await withTx(req.user, (db) => identifiers.remove(db, row.id));
  res.redirect(303, `/${BY_TYPE[row.entity_type].folder}/${rows[0].slug}${req.query.back === 'edit' ? '/edit' : ''}?done=id-deleted#reference-records`);
});

module.exports = router;
