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
const booklookup = require('../booklookup');
const drafts = require('../drafts');
const entries = require('./entries');   // the form's Create (saveEntity) for "Create now"
const { docToForm, fieldLabel } = require('../forms');
const { send, withTx, typeWarning, notFoundPage, findEntity, pluralParam, formContext } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// ---------------------------------------------------------------------------------------------------------------
// Wikidata: find the item, review field by field, apply only what was ticked (src/admin/wikidata.js)
// ---------------------------------------------------------------------------------------------------------------
const wdLinks = { folderOf: (type) => BY_TYPE[type].folder };

// A new entry's menus that must have a value and that Wikidata doesn't fill (a term's category, a movement's kind):
// chosen on the review page, so "Create now" never takes the menu's first value unasked
async function requiredChoices(t) {
  const ctx = await formContext(t);
  return Object.keys(ctx.enums).filter((k) => t.fields[k] && !ctx.enumsNullable.has(k))
    .map((key) => ({ key, label: fieldLabel(t.type, key), values: ctx.enums[key] }));
}

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
  const required = e ? [] : await requiredChoices(t);
  send(req, res, { title, page, body: html`${wrong}${reviewPage({ title, plan, t: wdLinks, action, isNew: !e, required })}` });
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
    const draft = { slug, ...base, ...form,
      ...(result.pendingImages.length ? { 'wd.images': JSON.stringify(result.pendingImages) } : {}),
      ...(result.pendingIds.length ? { 'wd.ids': JSON.stringify(result.pendingIds) } : {}),
      ...(result.cites.length ? { 'wd.cite': JSON.stringify({ qid, cites: result.cites }) } : {}) };
    // "Create now" (owner 2026-11-02): the form's own Create with these values — refused (a possible duplicate, a
    // missing field), the form opens with the reason, kept as the draft
    const missing = [];
    for (const r of await requiredChoices(t)) {
      const chosen = String(req.body[`f.${r.key}`] || '');
      if (r.values.includes(chosen)) draft[`f.${r.key}`] = chosen;
      else if (!draft[`f.${r.key}`]) missing.push(`${r.key}: ${r.label} — choose one (Wikidata doesn’t say).`);
    }
    const saved = req.body.create === '1'
      ? (missing.length ? { errors: missing } : await entries.saveEntity(req.user, t, draft, null)) : null;
    if (saved) {
      if (!saved.errors) {
        await drafts.deleteDraft(adminPool, req.user.id, t.type, null);
        return res.redirect(303, entries.createdUrl(t, saved));
      }
    }
    await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, $2, NULL, $3)
      ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`,
    [req.user.id, t.type, JSON.stringify(draft)]);
    if (saved) return entries.refusedNew(req, res, t, draft, saved);
    return res.redirect(303, `/${t.folder}/new?draft=1`);
  }
  // someone else's unpublished changes in the working copy: not published over them — the edit page, as before
  const others = await collab.unpublished(t, e.id);
  const othersWorking = others && (others.contributors || []).some((u) => u !== req.user.username);
  if (Object.keys(form).length) await collab.applyForm(t, e.id, form, req.user.username);
  // the values in the working copy came from Wikidata: citations, settled when published (049)
  if (result.cites.length) await withTx(req.user, (db) => citations.pendingFromWikidata(db, t.type, e.id, qid, result.cites, req.user.id), { source: 'wikidata' });
  const counts = `rels=${result.relationships}&created=${result.created.length}&imgs=${result.images}`;
  if (othersWorking) return res.redirect(303, `/${t.folder}/${e.slug}/edit?done=wikidata-others&${counts}`);
  // Applied = published (owner 2026-11-04): whoever applies a Wikidata selection wants it public; editing more is the
  // rarer case and starts from the entry's page. The same path as Publish on the edit page (saveEntity: validation,
  // duplicates, citations settled); refused, the edit page opens with the reason and the values kept in the copy.
  const { form: working } = await collab.currentForm(t, e.id);
  const saved = await entries.saveEntity(req.user, t, working, e);
  if (saved.errors) return entries.refusedEdit(req, res, t, e, saved);
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e.id);
  await collab.publishedNow(t, e.id, req.user.username);
  res.redirect(303, `/${t.folder}/${saved.slug}?done=wikidata-published&${counts}`);
}

// A new bibliography entry from its ISBN or DOI (src/admin/booklookup.js): fills the new-entry form (the user's draft)
router.get('/bibliography/new/lookup', async (req, res) => {
  const t = BY_TYPE.source;
  const text = String(req.query.id || '').trim();
  const back = (msg, status = 422) => send(req, res, { title: 'New source', status, flash: { kind: 'error', text: msg },
    body: html`<p><a href="/bibliography/new#lookup">← New source</a></p>` });
  let found;
  try { found = await booklookup.lookup(text); } catch (err) { return back(err.message); }
  if (!found) return back(`Nothing found for ${text}.`, 404);
  // already in the bibliography? then that one
  const [col, value] = Object.entries(found.key)[0];
  const have = (await adminPool.query(`SELECT slug FROM bibliography WHERE regexp_replace(lower(${col}), '[^0-9a-z./x]', '', 'g') = $1`,
    [String(value).toLowerCase().replace(/[^0-9a-z./x]/g, '')])).rows[0];
  if (have) return res.redirect(303, `/bibliography/${have.slug}?done=source-exists`);
  const doc = { ...found.doc, metadata: { sources: [`${found.source.name}: ${found.source.url} (retrieved ${new Date().toISOString().slice(0, 10)})`] } };
  const form = Object.fromEntries(Object.entries(docToForm(doc, t.fields)).map(([k, v]) => [`f.${k}`, v]));
  const who = (doc.authors || doc.editors || [doc.name])[0] || 'source';
  const slug = wikidata.slugify(`${String(who).split(',')[0]} ${doc.year || ''}`);
  await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, $2, NULL, $3)
    ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`, [req.user.id, t.type, JSON.stringify({ slug, ...form })]);
  res.redirect(303, '/bibliography/new?draft=1&done=looked-up');
});

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
