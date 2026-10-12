// Admin panel — Wikidata: find the item, review field by field, apply; find a place and fill the new-place form.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const wikidata = require('../wikidata');
const citations = require('../citations');
const placefinder = require('../placefinder');
const { searchPage, reviewPage } = require('../wikidata-ui');
const collab = require('../collab');
const { docToForm } = require('../forms');
const { send, withTx, typeWarning, notFoundPage, findEntity, pluralParam } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// ---------------------------------------------------------------------------------------------------------------
// Wikidata: find the item, review field by field, apply only what was ticked (src/admin/wikidata.js)
// ---------------------------------------------------------------------------------------------------------------
const wdLinks = { folderOf: (type) => BY_TYPE[type].folder };

async function wikidataPage(req, res, t, e) {
  const action = e ? `/${t.folder}/${e.slug}/wikidata` : `/${t.folder}/new/wikidata`;
  const title = e ? `Compare ${e.name} with Wikidata` : `New ${t.type} from Wikidata`;
  const page = { type: t.type, slug: e ? e.slug : null, mode: 'view' };
  const qid = String(req.query.q || (e && !req.query.search && e.doc.wikidata_id) || '').trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/.test(qid)) {
    const q = String(req.query.search ?? (e ? e.name : '')).trim();
    let results = null;
    let error = null;
    if (/^Q[1-9][0-9]*$/i.test(q)) return res.redirect(`${action}?q=${q.toUpperCase()}`);
    if (q) { try { results = await wikidata.search(q); } catch (err) { error = `Wikidata search failed: ${err.message}`; } }
    return send(req, res, { title, page, body: searchPage({ title, action, q, results, error }) });
  }
  const ours = e ? (await collab.currentForm(t, e.id)).form : {};
  let plan;
  try {
    plan = await wikidata.compare(adminPool, t, qid, ours, e ? { type: t.type, id: e.id } : null);
  } catch (err) {
    return send(req, res, { title, page, status: 502, body: searchPage({ title, action, q: qid, results: null, error: `Could not load ${qid}: ${err.message}` }) });
  }
  // the item's class says it is something else (a human, created as an institution — 055)
  const types = await wikidata.typesOf(qid).catch(() => null);
  const wrong = types && !types.includes(t.type) ? typeWarning(t, types, qid, e) : '';
  send(req, res, { title, page, body: html`${wrong}${reviewPage({ title, plan, t: wdLinks, action, isNew: !e })}` });
}

async function wikidataApply(req, res, t, e) {
  const qid = String(req.body.qid || '');
  if (!/^Q[1-9][0-9]*$/.test(qid)) return notFoundPage(req, res);
  const ours = e ? (await collab.currentForm(t, e.id)).form : {};
  const plan = await wikidata.compare(adminPool, t, qid, ours, e ? { type: t.type, id: e.id } : null);
  let result;
  try {
    result = await withTx(req.user, (db) => wikidata.apply(db, t, e ? { type: t.type, id: e.id } : null, plan, req.body, req.user.id), { source: 'wikidata' });
  } catch (err) {
    return send(req, res, { title: 'Wikidata', status: 422, flash: { kind: 'error', text: `Nothing was applied: ${err.message}` },
      body: reviewPage({ title: 'Wikidata', plan, t: wdLinks, action: req.originalUrl, isNew: !e }) });
  }
  const form = wikidata.withProvenance(result.form, ours, qid);
  if (!e) {  // a new entry: prefill the new-entry form (the user's draft), created with "Create"
    const base = Object.fromEntries(Object.entries(docToForm({}, t.fields)).map(([k, v]) => [`f.${k}`, v]));
    const slug = wikidata.slugify(plan.label || qid);
    await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, $2, NULL, $3)
      ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`,
    [req.user.id, t.type, JSON.stringify({ slug, ...base, ...form,
      ...(result.pendingImages.length ? { 'wd.images': JSON.stringify(result.pendingImages) } : {}),
      ...(result.pendingIds.length ? { 'wd.ids': JSON.stringify(result.pendingIds) } : {}),
      ...(result.cites.length ? { 'wd.cite': JSON.stringify({ qid, cites: result.cites }) } : {}) })]);
    return res.redirect(303, `/${t.folder}/new?draft=1`);
  }
  if (Object.keys(form).length) await collab.applyForm(t, e.id, form, req.user.username);
  // the values in the working copy came from Wikidata: citations, settled when published (049)
  if (result.cites.length) await withTx(req.user, (db) => citations.pendingFromWikidata(db, t.type, e.id, qid, result.cites, req.user.id), { source: 'wikidata' });
  res.redirect(303, `/${t.folder}/${e.slug}/edit?done=wikidata&rels=${result.relationships}&created=${result.created.length}&imgs=${result.images}`);
}

router.get('/:plural/new/wikidata', (req, res) => wikidataPage(req, res, req.t, null));
router.post('/:plural/new/wikidata', (req, res) => wikidataApply(req, res, req.t, null));
router.get('/:plural/:slug/wikidata', async (req, res) => {
  const e = await findEntity(req.t, req.params.slug);
  return e ? wikidataPage(req, res, req.t, e) : notFoundPage(req, res);
});
router.post('/:plural/:slug/wikidata', async (req, res) => {
  const e = await findEntity(req.t, req.params.slug);
  return e ? wikidataApply(req, res, req.t, e) : notFoundPage(req, res);
});

// Find a place and fill the new-place form from it (src/admin/placefinder.js, migration 032).
router.get('/places/new/find', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  let hits = [];
  let error = null;
  if (q) { try { hits = await placefinder.candidates(q); } catch (err) { error = `Place search failed: ${err.message}`; } }
  send(req, res, {
    title: 'Find a place', page: { type: 'place', slug: null, mode: 'new' },
    body: html`<p class="muted"><a href="/places">Places</a></p><h1>New place from a search</h1>
      <p class="muted">Pick the place: its name (also in other languages), kind and country are filled in; countries and
        regions get their outline from Natural Earth, smaller places a point (Wikidata's when there is an item); the
        parent is found from what we already have. You check the form and press Create.</p>
      <form method="get" action="/places/new/find" class="bar"><input type="search" name="q" value="${q}" class="grow" aria-label="place"
        placeholder="e.g. Arles · Kyoto · Saitama Prefecture · Louvre"><button>Search</button></form>
      ${error ? html`<p class="flash error">${error}</p>` : ''}
      ${q && !error && !hits.length ? html`<p class="muted">Nothing found.</p>` : ''}
      <div class="table-wrap"><table class="place-hits"><tbody>${hits.map((h) => html`<tr>
        <td><b>${h.name}</b> <span class="tag">${h.kind}</span>${h.country_code ? html` <span class="tag">${h.country_code}</span>` : ''}
          <div class="muted small">${h.label}</div></td>
        <td><form method="post" action="/places/new/find"><input type="hidden" name="pick" value="${JSON.stringify(h)}">
          <button class="small">Use this</button></form></td></tr>`)}</tbody></table></div>
      <p class="muted small">Search: © OpenStreetMap contributors (Nominatim) — used for finding only.</p>`,
  });
});

router.post('/places/new/find', async (req, res) => {
  let pick;
  try { pick = JSON.parse(String(req.body.pick || '')); } catch { pick = null; }
  if (!pick || typeof pick !== 'object') return res.redirect(303, '/places/new/find');
  let draft;
  try {
    draft = await placefinder.draftFor(adminPool, pick, wikidata.coordsOf, wikidata.slugify);
  } catch (err) {
    return send(req, res, { title: 'Find a place', status: 422, flash: { kind: 'error', text: `That result can't be used: ${err.message}` },
      body: html`<p><a href="/places/new/find">← search again</a></p>` });
  }
  const t = BY_TYPE.place;
  const base = Object.fromEntries(Object.entries(docToForm({}, t.fields)).map(([k, v]) => [`f.${k}`, v]));
  await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, 'place', NULL, $2)
    ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`,
  [req.user.id, JSON.stringify({ ...base, ...draft.form })]);
  res.redirect(303, '/places/new?draft=1');
});

module.exports = router;
