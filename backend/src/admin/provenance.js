// ---------------------------------------------------------------------------------------------------------------
// Provenance of an artwork (table provenance, migration 031): the owners in order, as the sources record them —
// when each acquired it, how, where it was, whether the handover is documented as direct. The periods are computed
// by the view provenance_periods (each end recorded / implied by the next acquisition / ongoing / unknown) and drawn
// as owned_by / kept_in / transferred_to edges (view edges). Changes are saved immediately, like images.
// ---------------------------------------------------------------------------------------------------------------
const { html, raw } = require('./html');
const { BY_TYPE, dateToDoc } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');
const { renderMarkdown } = require('../markdown');

class ProvenanceError extends Error {}

const METHODS = ['creation', 'commission', 'inheritance', 'purchase', 'auction', 'gift', 'bequest', 'exchange',
  'confiscation', 'forced_sale', 'restitution', 'unknown'];
const CERTAINTY = ['attested', 'probable', 'possible', 'disputed'];
const OWNER_TYPES = ['artist', 'person', 'institution', 'place'];
const ARC = { artist: 'owner_artist_id', person: 'owner_person_id', institution: 'owner_institution_id', place: 'owner_place_id' };
const COLS = ['owner_artist_id', 'owner_person_id', 'owner_institution_id', 'owner_place_id', 'owner_label',
  'acquired', 'acquired_label', 'ended', 'ended_label', 'method', 'direct', 'location_id', 'label', 'certainty', 'notes_md', 'metadata'];
const CASTS = { acquired: '::daterange', ended: '::daterange', method: '::acquisition_method', certainty: '::certainty', metadata: '::jsonb' };
const methodLabel = (m) => (m === 'forced_sale' ? 'forced sale' : m);
const END_BASIS = {
  recorded: null,
  implied: 'end implied by the next acquisition',
  ongoing: 'ongoing — the current holder',
  unknown: 'end unknown',
};

// Form body → column values (COLS order). Owner "type/slug" and place slug are looked up; throws ProvenanceError.
async function fromForm(db, body, keepMetadata = {}) {
  const text = (k) => String(body[k] ?? '').replace(/\r\n/g, '\n').trim() || null;
  const v = Object.fromEntries(COLS.map((c) => [c, null]));
  const owner = text('owner');
  if (owner) {
    const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(owner);
    if (!m || !OWNER_TYPES.includes(m[1])) throw new ProvenanceError('Owner: pick an artist, person, institution or place from the suggestions — or leave it empty and describe the owner.');
    const id = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Owner: ${owner} does not exist.`);
    v[ARC[m[1]]] = id;
  }
  v.owner_label = text('owner_label');
  if (!owner && !v.owner_label) throw new ProvenanceError('Owner: pick an entry or describe the owner (e.g. "Private collection, Paris").');
  for (const key of ['acquired', 'ended']) {
    let d = null;
    try { d = parseFuzzyDate(text(key)); } catch (err) { throw new ProvenanceError(`${key === 'acquired' ? 'Acquired' : 'Ended'}: ${err.message}`); }
    v[key] = d && d.range;
    v[`${key}_label`] = d ? text(`${key}_label`) || d.label : null;
  }
  v.method = METHODS.includes(body.method) ? body.method : 'unknown';
  v.direct = body.direct === '1';
  const place = text('location');
  if (place) {
    const id = (await db.query('SELECT id FROM places WHERE slug = $1', [place])).rows[0];
    if (!id) throw new ProvenanceError(`Place: "${place}" does not exist — pick one from the suggestions.`);
    v.location_id = id.id;
  }
  v.label = text('label');
  v.certainty = CERTAINTY.includes(body.certainty) ? body.certainty : 'attested';
  v.notes_md = text('notes_md');
  // the "Sources" lines are free-text citations now (050): returned beside the column values
  const sources = String(body.sources || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const { sources: _old, ...rest } = keepMetadata;
  v.metadata = JSON.stringify(rest);
  return Object.assign(COLS.map((c) => v[c]), { sources });
}

// One step with its artwork, for the edit page and the redirect back.
async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`
    SELECT p.*, w.slug AS artwork_slug, w.title AS artwork_title,
           (SELECT o.type::text || '/' || o.slug FROM entity_index o
             WHERE (o.type, o.id) = (pp.owner_type, pp.owner_id)) AS owner_ref,
           (SELECT slug FROM places WHERE id = p.location_id) AS location_slug, text_sources(NULL, p.id) AS text_sources
    FROM provenance p JOIN artworks w ON w.id = p.artwork_id JOIN provenance_periods pp ON pp.id = p.id
    WHERE p.id = $1`, [id]);
  if (!rows.length) return null;
  return { ...rows[0], artworkUrl: `/artworks/${rows[0].artwork_slug}` };
}

// A step as form values (for editing).
function formValues(step) {
  const acquired = dateToDoc(step.acquired, step.acquired_label, false);
  const ended = dateToDoc(step.ended, step.ended_label, false);
  return {
    owner: step.owner_ref || '', owner_label: step.owner_label || '',
    acquired: acquired.value || '', acquired_label: acquired.label || '',
    ended: ended.value || '', ended_label: ended.label || '',
    method: step.method, direct: step.direct, location: step.location_slug || '', label: step.label || '',
    certainty: step.certainty, notes_md: step.notes_md || '', sources: step.text_sources || [],
  };
}

async function add(db, artworkId, values) {
  // appended at the end of the chain
  const { rows } = await db.query(`INSERT INTO provenance (artwork_id, position, ${COLS.join(', ')})
    VALUES ($1, (SELECT coalesce(max(position) + 1, 0) FROM provenance WHERE artwork_id = $1),
            ${COLS.map((c, i) => `$${i + 2}${CASTS[c] || ''}`).join(', ')}) RETURNING id`, [artworkId, ...values]);
  return rows[0].id;
}

async function update(db, id, values) {
  await db.query(`UPDATE provenance SET ${COLS.map((c, i) => `${c} = $${i + 2}${CASTS[c] || ''}`).join(', ')} WHERE id = $1`, [id, ...values]);
}

// Renumbers the artwork's steps 0, 1, 2 … in the given order; only changed rows are written. The unique constraint
// on (artwork_id, position) is DEFERRABLE INITIALLY DEFERRED, so the intermediate duplicates are fine until COMMIT.
async function renumber(db, artworkId, ids) {
  const { rows } = await db.query('SELECT id, position FROM provenance WHERE artwork_id = $1 FOR UPDATE', [artworkId]);
  for (const [pos, id] of ids.entries()) {
    if (rows.find((r) => r.id === id).position !== pos) await db.query('UPDATE provenance SET position = $2 WHERE id = $1', [id, pos]);
  }
}

async function orderedIds(db, artworkId) {
  return (await db.query('SELECT id FROM provenance WHERE artwork_id = $1 ORDER BY position, id', [artworkId])).rows.map((r) => r.id);
}

async function move(db, step, dir) {
  const ids = await orderedIds(db, step.artwork_id);
  const at = ids.indexOf(step.id);
  const to = dir === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(at, 1));
  await renumber(db, step.artwork_id, ids);
}

// A new order from the page (drag and drop): the same steps, in the order given — else nothing changes.
async function reorder(db, artworkId, ids) {
  const now = await orderedIds(db, artworkId);
  const want = ids.map(Number);
  if (want.length !== now.length || [...want].sort((a, b) => a - b).join() !== [...now].sort((a, b) => a - b).join()) {
    throw new ProvenanceError('The provenance changed meanwhile — reload the page and try again.');
  }
  await renumber(db, artworkId, want);
}

async function remove(db, step) {
  await db.query('DELETE FROM provenance WHERE id = $1', [step.id]);
  await renumber(db, step.artwork_id, await orderedIds(db, step.artwork_id));
}

// The chain for the artwork page: steps with the computed period (view provenance_periods).
async function read(db, artworkId) {
  return (await db.query(`
    SELECT p.*, o.slug AS owner_slug, l.slug AS location_slug, l.name AS location_name, pv.metadata
    FROM provenance_periods p JOIN provenance pv ON pv.id = p.id
    LEFT JOIN entity_index o ON (o.type, o.id) = (p.owner_type, p.owner_id)
    LEFT JOIN places l ON l.id = p.location_id
    WHERE p.artwork_id = $1 ORDER BY p.position`, [artworkId])).rows;
}

function form({ action, step = {}, submit }) {
  const v = (k) => step[k] ?? '';
  return html`<form method="post" action="${action}" class="form provenance-form">
    <select id="pv-owner-type" hidden><option data-object-types="${OWNER_TYPES.join(',')}" selected></option></select>
    <div class="row">
      <div class="field"><label for="pv-owner">Owner</label>
        <input id="pv-owner" name="owner" value="${v('owner')}" placeholder="start typing a name" autocomplete="off" data-lookup-from="pv-owner-type">
        <div class="hint">An artist, person, institution or place (a city or state).</div></div>
      <div class="field"><label for="pv-owner-label">Owner description</label>
        <input id="pv-owner-label" name="owner_label" value="${v('owner_label')}" placeholder="e.g. Private collection, Paris">
        <div class="hint">When the owner is unknown or not an entry — or a qualifier for the entry ("as agent").</div></div>
    </div>
    <div class="row">
      <div class="field"><label for="pv-acquired">Acquired</label><input id="pv-acquired" name="acquired" value="${v('acquired')}" placeholder="date, e.g. 1952, c. 1890">
        <input name="acquired_label" value="${v('acquired_label')}" placeholder="label (optional)" aria-label="Acquired label"></div>
      <div class="field"><label for="pv-method">How</label><select id="pv-method" name="method">
        ${METHODS.map((m) => html`<option value="${m}"${m === (step.method || 'unknown') ? ' selected' : ''}>${methodLabel(m)}</option>`)}</select></div>
      <div class="field"><label for="pv-location">Place</label>
        <input id="pv-location" name="location" value="${v('location')}" placeholder="where the work was" autocomplete="off" data-lookup="place"></div>
    </div>
    <label class="choice"><input type="checkbox" name="direct" value="1"${step.direct ? ' checked' : ''}> documented as passed on directly from the previous owner</label>
    <div class="hint">Leave it unticked when the source doesn't say so — a gap between owners stays visible (and is checked for 1933–1945).</div>
    <div class="row">
      <div class="field"><label for="pv-ended">Ended <span class="muted">(only if a source says so)</span></label><input id="pv-ended" name="ended" value="${v('ended')}" placeholder="date">
        <input name="ended_label" value="${v('ended_label')}" placeholder="label (optional)" aria-label="Ended label"></div>
      <div class="field"><label for="pv-label">Details</label><input id="pv-label" name="label" value="${v('label')}" placeholder="e.g. via Galerie Durand-Ruel, lot 23"></div>
      <div class="field"><label for="pv-cert">Certainty</label><select id="pv-cert" name="certainty">
        ${CERTAINTY.map((c) => html`<option${c === (step.certainty || 'attested') ? ' selected' : ''}>${c}</option>`)}</select></div>
    </div>
    <div class="hint">Without an end, the step lasts until the next owner's acquisition (shown as implied).</div>
    <div class="field"><label for="pv-notes">Notes</label><textarea class="md" id="pv-notes" name="notes_md" rows="2">${v('notes_md')}</textarea></div>
    <div class="field"><label for="pv-src">Sources</label><textarea id="pv-src" name="sources" rows="2">${(step.sources || []).join('\n')}</textarea><div class="hint">One per line.</div></div>
    <div class="actions"><button>${submit}</button></div></form>`;
}

// The "Provenance" section of an artwork's page: the chain in order, with the computed periods; between two steps
// "↓" (documented direct) or "⋮ gap" (not documented); reorder by dragging the handle (editor/sortable.js), edit, add.
// One <tbody> per step (its transfer line and its row), so a step moves as one.
function section({ e, steps, names, cites = {}, marker = null, back = '' }) {
  return html`<h2 id="provenance">Provenance</h2>
    ${steps.length ? html`<div class="table-wrap"><table class="provenance" data-sortable="/artworks/${e.slug}/provenance/order">${steps.map((s, i) => html`
      <tbody class="sort-item" data-sort-id="${s.id}">
      ${i > 0 ? html`<tr class="transfer muted small"><td></td><td></td><td colspan="6">${s.direct ? '↓ passed on directly' : '⋮ not documented as direct'}</td></tr>` : ''}
      <tr><td class="drag-cell">${steps.length > 1 ? html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move step ${i + 1}: drag, or arrow keys">⠿</button>` : ''}</td>
        <td>${i + 1}.</td>
        <td>${s.owner_slug ? html`<a href="/${BY_TYPE[s.owner_type].folder}/${s.owner_slug}">${s.owner_name}</a>` : s.owner_label}</td>
        <td>${[methodLabel(s.method) !== 'unknown' && methodLabel(s.method), s.acquired_label].filter(Boolean).join(', ') || html`<span class="muted">undated</span>`}
          ${s.label ? html`<div class="muted small">${s.label}</div>` : ''}</td>
        <td>${s.location_slug ? html`<a href="/places/${s.location_slug}">${s.location_name}</a>` : ''}</td>
        <td>${s.period_label || ''}${END_BASIS[s.end_basis] ? html` <span class="tag ${s.end_basis}">${END_BASIS[s.end_basis]}</span>` : ''}
          ${s.certainty !== 'attested' ? html` <span class="muted">· ${s.certainty}</span>` : ''}
          ${s.notes_md ? html`<div class="md small">${raw(renderMarkdown(s.notes_md, { names }))}</div>` : ''}</td>
        <td>${marker ? marker(cites[s.id], { provenance: s.id, label: `step ${i + 1} (${s.owner_slug ? s.owner_name : s.owner_label})` }, back) : ''}</td>
        <td class="nowrap"><a href="/provenance/${s.id}/edit">edit</a></td></tr></tbody>`)}</table></div>
      ${steps.length > 1 ? html`<p class="muted small">Drag ⠿ to change the order — the periods are recomputed.</p>` : ''}`
    : html`<p class="muted">None yet. The owners in order, as the sources record them: when each acquired the work and how.</p>`}
    <details><summary><b>+ Add provenance step</b></summary>${form({ action: `/artworks/${e.slug}/provenance`, submit: 'Add' })}</details>`;
}

module.exports = { ProvenanceError, METHODS, fromForm, byId, formValues, add, update, move, reorder, remove, read, form, section };
