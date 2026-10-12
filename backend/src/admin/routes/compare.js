// Admin panel — Enrich (Wikidata, the GND and SIKART on one page: src/admin/enrich.js) and the comparison with one
// authority file: the GND, SIKART (and finding a person in SIKART).
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { html } = require('../html');
const citations = require('../citations');
const sikart = require('../sikart');
const collab = require('../collab');
const authority = require('../authority');
const enrich = require('../enrich');
const { send, withTx, notFoundPage, findEntity, pluralParam } = require('../core');

const { SOURCES } = authority;
const router = express.Router();
router.param('plural', pluralParam);

// Comparison with one authority file — the GND or SIKART (logic and tables: src/admin/authority.js)
function comparePage(t, e, p, code) {
  const c = SOURCES[code];
  return html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
    <h1>Compare with ${c.name}</h1>
    <p>${authority.recordLine(p, code)}</p>
    <p class="muted small">Everything is ticked — untick what you don't want. Taken values are cited with the source “${c.short}” and this record;
      values that agree are cited as they are. Field values go into the working copy — check them and Publish. Places we don't have are
      looked up in OpenStreetMap and created with their names, position and region.</p>
    <form method="post" action="/${t.folder}/${e.slug}/${code}" class="wd-form">
      <h2>Fields</h2>
      ${authority.fieldsTable(t, p, code)}
      <h2>Relationships suggested by ${c.short}</h2>
      ${authority.relsTable(p, code)}
      ${p.ids && p.ids.length ? html`<h2>Reference records ${c.short} knows</h2>${authority.idsTable(p)}` : ''}
      ${authority.variantsLine(p, code)}
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
// Enrich: every source of an entry, one review, one Apply
router.get('/:plural/:slug/enrich', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const data = await enrich.load(t, e);
  send(req, res, { title: `Enrich: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: enrich.page(t, e, data) });
});
router.post('/:plural/:slug/enrich', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const data = await enrich.load(t, e);
  let r;
  try {
    r = await enrich.apply(t, e, data, req.body, req.user);
  } catch (err) {
    return send(req, res, { title: `Enrich: ${e.name}`, status: 422, flash: { kind: 'error', text: `Nothing was applied: ${err.message}` },
      page: { type: t.type, slug: e.slug, mode: 'view' }, body: enrich.page(t, e, data) });
  }
  const counts = `rels=${r.relationships}&created=${r.created}&imgs=${r.images}`;
  if (Object.keys(r.form).length) return res.redirect(303, `/${t.folder}/${e.slug}/edit?done=enrich&${counts}`);
  res.redirect(303, `/${t.folder}/${e.slug}?done=enrich-applied&${counts}`);
});

for (const code of Object.keys(SOURCES)) {
  router.get(`/:plural/:slug/${code}`, async (req, res) => {
    const { t } = req;
    const e = await findEntity(t, req.params.slug);
    if (!e || !SOURCES[code].types.includes(t.type)) return notFoundPage(req, res);
    const { plan, error, missing } = await authority.plan(t, e, code);
    if (missing && code === 'sikart') {
      const q = String(req.query.q || e.name);
      let hits = []; let err = null;
      try { hits = await sikart.search(q); } catch (x) { err = `SIKART could not be searched: ${x.message}`; }
      return send(req, res, { title: `SIKART: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: sikartSearchPage(t, e, q, hits, err) });
    }
    if (missing || error) {
      return send(req, res, { title: SOURCES[code].short, status: 422, flash: { kind: 'error', text: error || `This entry has no ${SOURCES[code].short} number yet — add it under “Reference records”.` },
        body: html`<p><a href="/${t.folder}/${e.slug}#reference-records">← ${e.name}</a></p>` });
    }
    send(req, res, { title: `${SOURCES[code].short}: ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' }, body: comparePage(t, e, plan, code) });
  });
  router.post(`/:plural/:slug/${code}`, async (req, res) => {
    const { t } = req;
    const e = await findEntity(t, req.params.slug);
    if (!e || !SOURCES[code].types.includes(t.type)) return notFoundPage(req, res);
    const { plan, error, missing } = await authority.plan(t, e, code);
    if (missing || error) return send(req, res, { title: SOURCES[code].short, status: 422, flash: { kind: 'error', text: error || 'No number.' }, body: html`<p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>` });
    const { source } = SOURCES[code];
    const result = await withTx(req.user, (db) => authority.apply(db, t, e, code, plan, req.body, req.user), { source });
    if (Object.keys(result.form).length) {
      await collab.applyForm(t, e.id, result.form, req.user.username);
      await withTx(req.user, (db) => citations.pendingFromSource(db, t.type, e.id, source, plan.url, result.cites, req.user.id), { source });
      return res.redirect(303, `/${t.folder}/${e.slug}/edit?done=gnd&rels=${result.relationships}&created=${result.created.length}`);
    }
    res.redirect(303, `/${t.folder}/${e.slug}?done=gnd-applied&rels=${result.relationships}&created=${result.created.length}`);
  });
}

module.exports = router;
