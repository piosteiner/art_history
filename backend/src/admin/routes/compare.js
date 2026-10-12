// Admin panel — Comparison with an authority file: the GND and SIKART.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const autocreate = require('../autocreate');
const { html } = require('../html');
const wikidata = require('../wikidata');
const citations = require('../citations');
const identifiers = require('../identifiers');
const gnd = require('../gnd');
const sikart = require('../sikart');
const placefinder = require('../placefinder');
const collab = require('../collab');
const { formToDoc, fieldLabel } = require('../forms');
const { send, withTx, UserError, notFoundPage, findEntity, pluralParam } = require('../core');

const router = express.Router();
router.param('plural', pluralParam);

// Comparison with an authority file — the GND (src/admin/gnd.js, 053) and SIKART (src/admin/sikart.js, 057): for an
// entry with that number. Like the Wikidata comparison: field values into the working copy (cited when published),
// relationships created at once (cited), values that agree cited as they are; numbers the record knows (SIKART: GND,
// VIAF) offered as reference records.
const COMPARE = {
  gnd: { name: 'the GND', short: 'GND', source: 'gnd', types: ['artist', 'person', 'institution'],
    plan: (t, e, id) => gnd.compare(adminPool, t, e, e.doc, id), opts: { source: 'gnd', byNameGets: 'gnd', ensure: gnd.ensureSource } },
  sikart: { name: 'SIKART', short: 'SIKART', source: 'sikart', types: ['artist', 'person'],
    plan: (t, e, id) => sikart.compare(adminPool, t, e, e.doc, id, gnd.placeTarget), opts: { source: 'sikart', byNameGets: null, ensure: sikart.ensureSource } },
};
// A place found in OpenStreetMap (placefinder.settlementByName) → created like the city found on save: the place
// finder's draft (names, Wikidata point, parent region — from Natural Earth if we don't have it) → its slug
async function createPlaceFrom(db, c, user) {
  const placeT = BY_TYPE.place;
  const draft = await placefinder.draftFor(db, c, wikidata.coordsOf, wikidata.slugify);
  const { doc, errors } = formToDoc(draft.form, placeT.fields);
  if (errors.length) throw new UserError(`The place ${c.name}: ${errors.join('; ')}`);
  const parent = await autocreate.resolveRefs(db, placeT, doc, {});
  if (parent.errors.length) delete doc.parent;
  else {
    const slugs = await autocreate.create(db, parent.creates);
    if (slugs.has('parent')) doc.parent = slugs.get('parent');
  }
  return wikidata.createEntry(db, 'place', doc, null, user.id, doc.wikidata_id || null, false);
}
async function comparePlan(t, e, code) {
  const id = (await identifiers.list(adminPool, t.type, e.id)).find((x) => x.code === code);
  if (!id) return { missing: true };
  try { return { plan: await COMPARE[code].plan(t, e, id.value) }; } catch (err) { return { error: `The ${COMPARE[code].short} record could not be read: ${err.message}` }; }
}
function comparePage(t, e, plan, code) {
  const c = COMPARE[code];
  const choice = (name, value, label, checked) => html`<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${label}</label>`;
  return html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
    <h1>Compare with ${c.name}</h1>
    <p><a href="${plan.url}" target="_blank" rel="noopener">${c.short} ${plan.gnd} ↗</a> — <b>${plan.info.name}</b>${plan.info.occupations.length ? html` · <span class="muted">${plan.info.occupations.join(', ')}</span>` : ''}</p>
    <p class="muted small">Everything is ticked — untick what you don't want. Taken values are cited with the source “${c.short}” and this record;
      values that agree are cited as they are. Field values go into the working copy — check them and Publish. Places we don't have are
      looked up in OpenStreetMap and created with their names, position and region.</p>
    <form method="post" action="/${t.folder}/${e.slug}/${code}" class="wd-form">
      <h2>Fields</h2>
      ${plan.rows.length ? html`<div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Field</th><th>Yours</th><th>${c.short}</th><th>Take?</th></tr></thead><tbody>
        ${plan.rows.map((r) => html`<tr><td>${fieldLabel(t.type, r.key)}</td><td>${r.ours || html`<span class="muted">(empty)</span>`}</td>
          <td>${r.label || r.theirs}${r.key !== 'place' ? html` <span class="muted small">(${r.theirs})</span>` : r.create ? html` <span class="muted small">— new place: ${r.create.label}</span>` : ''}</td>
          <td>${r.status === 'same' ? html`<label class="choice"><input type="checkbox" name="cite.${r.key}" value="cite" checked> the same — cite it</label>`
            : r.status === 'missing' ? html`<span class="muted">not among our places</span>`
            : html`${choice(`take.${r.key}`, 'take', `take ${c.short}’s`, r.status === 'new')} ${choice(`take.${r.key}`, 'keep', r.status === 'new' ? 'leave empty' : 'keep mine', r.status !== 'new')}`}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nothing to compare.</p>`}
      <h2>Relationships suggested by ${c.short}</h2>
      ${plan.rels.length ? html`<div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Relationship</th><th>${c.short}</th><th>Ours</th><th>Add?</th></tr></thead><tbody>
        ${plan.rels.map((x) => html`<tr><td>${x.label}</td><td>${x.ref.label}</td>
          <td>${x.target ? html`<a href="/${BY_TYPE[x.target.type].folder}/${x.target.slug}">${x.target.name}</a>${x.target.by_id ? '' : html` <span class="muted small">(${x.target.name === x.ref.label ? 'same name' : 'found by OpenStreetMap'})</span>`}`
            : x.create ? html`<span class="muted">not in our database —</span> new place <b>${x.create.name}</b> <span class="muted small">(${x.create.label}, OpenStreetMap)</span>`
            : html`<span class="muted">not in our database, not found in OpenStreetMap</span>`}</td>
          <td>${x.already ? html`<span class="muted">have it</span>` : x.target || x.create ? html`<label class="choice"><input type="checkbox" name="rel.${x.i}" value="add" checked> ${x.create ? 'create the place and add' : 'add'}</label>` : ''}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">None.</p>`}
      ${plan.ids && plan.ids.length ? html`<h2>Reference records ${c.short} knows</h2><div class="table-wrap"><table class="diff wd-table wd-ids"><tbody>
        ${plan.ids.map((x) => html`<tr><td>${x.name}</td><td>${x.ours || html`<span class="muted">(none)</span>`}</td><td>${x.value}</td>
          <td>${x.status === 'same' ? html`<span class="muted">the same</span>` : html`<label class="choice"><input type="checkbox" name="idf.${x.code}" value="take"${x.status === 'new' ? ' checked' : ''}> ${x.status === 'new' ? 'add' : 'replace yours'}</label>`}</td></tr>`)}
      </tbody></table></div>` : ''}
      ${plan.info.variants.length ? html`<p class="muted small">${code === 'gnd' ? 'Other names in the GND: ' : ''}${plan.info.variants.join(' · ')}</p>` : ''}
      <div class="actions sticky-actions"><button>Apply selected</button><a class="button secondary" href="/${t.folder}/${e.slug}">Cancel</a></div>
    </form>`;
}
// SIKART without a number yet: the people of that name in SIKART — "this one" adds the number and compares
function sikartSearchPage(t, e, q, hits, error) {
  return html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p><h1>Find ${e.name} in SIKART</h1>
    <form method="get" action="/${t.folder}/${e.slug}/sikart" class="bar"><input name="q" value="${q}" class="grow" aria-label="name">
      <button class="secondary">Search</button></form>
    ${error ? html`<p class="flash error">${error}</p>` : !hits.length ? html`<p class="muted">Nobody of that name in SIKART.</p>`
      : html`<div class="table-wrap"><table class="sikart-hits"><tbody>${hits.map((h) => html`<tr>
        <td><b>${h.name}</b><div class="small muted">${h.note.replace(/\n/g, ' ')}</div>${h.short ? html`<div class="small">${h.short}</div>` : ''}</td>
        <td><a href="${h.url}" target="_blank" rel="noopener">${h.id} ↗</a></td>
        <td><form method="post" action="/${t.folder}/${e.slug}/identifiers"><input type="hidden" name="authority" value="sikart">
          <input type="hidden" name="value" value="${h.id}"><input type="hidden" name="next" value="sikart"><button>This one</button></form></td></tr>`)}
      </tbody></table></div>`}`;
}
for (const code of Object.keys(COMPARE)) {
  router.get(`/:plural/:slug/${code}`, async (req, res) => {
    const { t } = req;
    const e = await findEntity(t, req.params.slug);
    if (!e || !COMPARE[code].types.includes(t.type)) return notFoundPage(req, res);
    const { plan, error, missing } = await comparePlan(t, e, code);
    if (missing && code === 'sikart') {
      const q = String(req.query.q || e.name);
      let hits = []; let err = null;
      try { hits = await sikart.search(q); } catch (x) { err = `SIKART could not be searched: ${x.message}`; }
      return send(req, res, { title: `SIKART: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: sikartSearchPage(t, e, q, hits, err) });
    }
    if (missing || error) {
      return send(req, res, { title: COMPARE[code].short, status: 422, flash: { kind: 'error', text: error || `This entry has no ${COMPARE[code].short} number yet — add it under “Reference records”.` },
        body: html`<p><a href="/${t.folder}/${e.slug}#reference-records">← ${e.name}</a></p>` });
    }
    send(req, res, { title: `${COMPARE[code].short}: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: comparePage(t, e, plan, code) });
  });
  router.post(`/:plural/:slug/${code}`, async (req, res) => {
    const { t } = req;
    const e = await findEntity(t, req.params.slug);
    if (!e || !COMPARE[code].types.includes(t.type)) return notFoundPage(req, res);
    const { plan, error, missing } = await comparePlan(t, e, code);
    if (missing || error) return send(req, res, { title: COMPARE[code].short, status: 422, flash: { kind: 'error', text: error || 'No number.' }, body: html`<p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>` });
    const { source } = COMPARE[code];
    const result = await withTx(req.user, async (db) => {
      const r = await gnd.apply(db, t, e, plan, req.body, citations, { ...COMPARE[code].opts, createPlace: (d, c) => createPlaceFrom(d, c, req.user) });
      if (r.agreed.length) await citations.citeAgreeingSource(db, t.type, e.id, source, plan.url, r.agreed, req.user.id);
      return r;
    }, { source });
    if (Object.keys(result.form).length) {
      await collab.applyForm(t, e.id, result.form, req.user.username);
      await withTx(req.user, (db) => citations.pendingFromSource(db, t.type, e.id, source, plan.url, result.cites, req.user.id), { source });
      return res.redirect(303, `/${t.folder}/${e.slug}/edit?done=gnd&rels=${result.relationships}&created=${result.created.length}`);
    }
    res.redirect(303, `/${t.folder}/${e.slug}?done=gnd-applied&rels=${result.relationships}&created=${result.created.length}`);
  });
}

module.exports = router;
