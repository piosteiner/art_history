// Admin panel — a work's building history (migration 169, src/phases.js): its phases listed on the artwork's page,
// added, edited, deleted and dragged into order here. Mounted before entries.js (src/admin/index.js).
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const phases = require('../../phases');
const { send, withTx, friendly, notFoundPage, findEntity } = require('../core');

const router = express.Router();
const KIND_LABEL = {
  construction: 'Construction', extension: 'Extension', alteration: 'Alteration / rebuilding', completion: 'Completion',
  restoration: 'Restoration', damage: 'Damage', destruction: 'Destruction', demolition: 'Demolition', reconstruction: 'Reconstruction', other: 'Other',
};
const who = (p) => html`<a href="/${BY_TYPE[p.type].folder}/${p.slug}">${p.name}</a>${p.role ? html` <span class="muted">${p.role}</span>` : ''}${p.patron ? html` <span class="tag">patron</span>` : ''}`;

// the section on the artwork's page (entries.js)
function section({ e, list }) {
  return html`<h2 id="building-history">Building history</h2>
    <p class="muted small">For buildings and works with a history in stages — built, extended, rebuilt, damaged, demolished,
      reconstructed — each phase with its time, the parts concerned and who took part. Architects become the work's
      co-creators, patrons its commissioners (on their pages and in the network), from the phase.</p>
    ${list.length ? html`<div class="table-wrap"><table class="phases" data-sortable="/artworks/${e.slug}/phases/order"><tbody>
      ${list.map((ph) => html`<tbody class="sort-item" data-sort-id="${String(ph.id)}"><tr>
        <td class="drag-cell"><button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move ${ph.title}">⠿</button></td>
        <td>${ph.period_label || html`<span class="muted">no date</span>`}</td>
        <td><b>${ph.title}</b> <span class="tag">${KIND_LABEL[ph.kind]}</span>${ph.part ? html`<div class="muted small">${ph.part}</div>` : ''}</td>
        <td>${ph.people.map((p, i) => html`${i ? html`<br>` : ''}${who(p)}`)}</td>
        <td><a href="/artworks/${e.slug}/phases/${String(ph.id)}/edit">edit</a></td></tr></tbody>`)}
    </tbody></table></div>` : html`<p class="muted">No phases yet.</p>`}
    <p><a class="button secondary" href="/artworks/${e.slug}/phases/new">+ Add a phase</a></p>`;
}

function form({ e, values = {}, action, submit, id = null }) {
  const v = (k) => values[k] ?? '';
  return html`<form method="post" action="${action}" class="form phase-form">
    <div class="row">
      <div class="field"><label for="ph-period">When</label><input id="ph-period" name="period" value="${v('period')}" placeholder="1698/1706 · c. 1443/1451 · 1950-09-07/1951-03">
        <div class="hint">A date or a span, as everywhere (“1698/1706”, “1845/1853”, “1950-09-07/1951-03”). Empty if unknown.</div></div>
      <div class="field"><label for="ph-label">Shown as</label><input id="ph-label" name="period_label" value="${v('period_label')}" placeholder="(from the date)"></div>
      <div class="field"><label for="ph-kind">Kind</label><select id="ph-kind" name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}"${v('kind') === k ? ' selected' : ''}>${l}</option>`)}</select></div>
    </div>
    <div class="field"><label for="ph-title">Title</label><input id="ph-title" name="title" value="${v('title')}" required placeholder="Baroque rebuilding"></div>
    <div class="field"><label for="ph-part">Parts concerned</label><input id="ph-part" name="part" value="${v('part')}" placeholder="Lustgarten and Schlossplatz wings, Schlüterhof">
      <div class="hint">Which parts of the building; empty = the whole.</div></div>
    <div class="field"><label for="ph-people">Who took part</label>
      <textarea id="ph-people" name="people" rows="5" placeholder="artist/andreas-schluter | architect&#10;person/frederick-i-of-prussia | commissioned it | patron">${v('people')}</textarea>
      <div class="hint">One per line: <code>artist/slug</code>, <code>person/slug</code> or <code>institution/slug</code>, then <code>| role</code>
        (as written: architect, site manager, sculptor …), then <code>| patron</code> for who commissioned it. An artist becomes a
        co-creator of the work, a patron its commissioner.</div></div>
    <div class="field"><label for="ph-notes">Text</label><textarea id="ph-notes" name="notes_md" rows="8" class="md">${v('notes_md')}</textarea>
      <div class="hint">What happened, with footnotes (<code>[[source/…]]</code>) as in descriptions.</div></div>
    <p class="actions"><button>${submit}</button> <a href="/artworks/${e.slug}#building-history">Cancel</a></p></form>
    ${id ? html`<form method="post" action="/artworks/${e.slug}/phases/${String(id)}/delete" class="inline" data-confirm="Delete this phase?"><button class="link danger">Delete this phase…</button></form>` : ''}`;
}

const valuesOf = (ph) => ({ ...ph, period: ph.period ? ph.period_label || '' : '', period_label: ph.period_label || '', people: phases.peopleText(ph.people) });

async function work(req, res) {
  const e = await findEntity(BY_TYPE.artwork, req.params.slug);
  if (!e) notFoundPage(req, res);
  return e;
}

router.get('/artworks/:slug/phases/new', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  send(req, res, { title: `Add a phase — ${e.name}`, body: html`<h1>Add a phase</h1><p><a href="/artworks/${e.slug}#building-history">← ${e.name}</a></p>
    ${form({ e, action: `/artworks/${e.slug}/phases`, submit: 'Add', values: { kind: 'construction' } })}` });
});

async function store(req, res, e, id) {
  const checked = phases.check(req.body);
  const again = (text) => send(req, res, { title: 'Phase', status: 422, flash: { kind: 'error', text },
    body: html`<h1>${id ? 'Edit' : 'Add'} a phase</h1><p><a href="/artworks/${e.slug}#building-history">← ${e.name}</a></p>
      ${form({ e, action: id ? `/artworks/${e.slug}/phases/${id}` : `/artworks/${e.slug}/phases`, submit: id ? 'Save' : 'Add', values: req.body, id })}` });
  if (checked.error) return again(checked.error);
  try {
    await withTx(req.user, (db) => phases.save(db, e.id, checked.phase, id));
  } catch (err) {
    return again(err.userError ? err.message : friendly(err));
  }
  res.redirect(303, `/artworks/${e.slug}?done=saved#building-history`);
}
router.post('/artworks/:slug/phases', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  await store(req, res, e, null);
});

// drag order (editor/sortable.js): ids → position 10, 20, 30 …
router.post('/artworks/:slug/phases/order', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  const ids = String(req.body.ids || '').split(',').filter((x) => /^[1-9][0-9]*$/.test(x));
  await withTx(req.user, (db) => db.query(`UPDATE artwork_phases p SET position = o.n * 10
    FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE p.id = o.id AND p.artwork_id = $2 AND p.position IS DISTINCT FROM o.n * 10`, [ids, e.id]));
  res.status(204).end();
});

async function phaseOf(req, res, e) {
  if (!/^[1-9][0-9]*$/.test(req.params.id)) { notFoundPage(req, res); return null; }
  const ph = (await phases.read(adminPool, e.id)).find((x) => String(x.id) === req.params.id);
  if (!ph) notFoundPage(req, res);
  return ph;
}
router.get('/artworks/:slug/phases/:id/edit', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  const ph = await phaseOf(req, res, e); if (!ph) return;
  send(req, res, { title: `Edit a phase — ${e.name}`, body: html`<h1>Edit a phase</h1><p><a href="/artworks/${e.slug}#building-history">← ${e.name}</a></p>
    ${form({ e, action: `/artworks/${e.slug}/phases/${ph.id}`, submit: 'Save', values: valuesOf(ph), id: ph.id })}` });
});
router.post('/artworks/:slug/phases/:id', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  const ph = await phaseOf(req, res, e); if (!ph) return;
  await store(req, res, e, ph.id);
});
router.post('/artworks/:slug/phases/:id/delete', async (req, res) => {
  const e = await work(req, res); if (!e) return;
  const ph = await phaseOf(req, res, e); if (!ph) return;
  await withTx(req.user, (db) => db.query('DELETE FROM artwork_phases WHERE id = $1', [ph.id]));
  res.redirect(303, `/artworks/${e.slug}?done=saved#building-history`);
});

module.exports = router;
module.exports.section = section;
