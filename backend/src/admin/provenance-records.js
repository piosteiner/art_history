// ---------------------------------------------------------------------------------------------------------------
// Provenance records (table provenance_records, migration 104): the evidence under a step — an inventory entry, a
// catalogue, an exhibition, a sighting — with its date, place (a palace, a city), room, number, the document it is in,
// and how sure the source is ("¿nº 411?": the number possible; "¿Real Alcázar, 1666?": the record possible).
// Saved one by one on the step's edit page (like further numbers); listed under the step on the artwork's page.
// A record's place is a stop on the map where it changes (provenance_stops), its number is found by the number search
// (view provenance_numbers_all), its words by the full-text search (search_documents).
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');
const { dateToDoc } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');

class RecordError extends Error {}

const KINDS = [['inventory', 'inventory'], ['catalogue', 'catalogue'], ['exhibition', 'exhibition'], ['sighting', 'seen there (a visitor, a report)'],
  ['document', 'a document (letter, receipt, register)'], ['other', 'other']];
const CERTAINTY = ['attested', 'probable', 'possible', 'disputed'];

// a step's records — or several steps' at once ({step id: [records]})
async function forSteps(db, stepIds) {
  if (!stepIds.length) return {};
  const { rows } = await db.query(`
    SELECT r.id, r.provenance_id, r.position, r.kind::text AS kind, r.date::text AS date, r.date_label, r.room, r.number,
           r.number_certainty::text AS number_certainty, r.document, r.certainty::text AS certainty, r.note,
           l.slug AS place_slug, l.name AS place_name
    FROM provenance_records r LEFT JOIN places l ON l.id = r.place_id
    WHERE r.provenance_id = ANY ($1::bigint[]) ORDER BY lower(r.date) NULLS LAST, r.position`, [stepIds]);
  const by = {};
  for (const r of rows) (by[r.provenance_id] ||= []).push(r);
  return by;
}

async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`SELECT r.*, r.kind::text AS kind, r.date::text AS date, r.certainty::text AS certainty,
      r.number_certainty::text AS number_certainty, l.slug AS place_slug FROM provenance_records r
    LEFT JOIN places l ON l.id = r.place_id WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

// Form → column values. Throws RecordError.
async function fromForm(db, body) {
  const text = (k) => String(body[k] ?? '').replace(/\r\n/g, '\n').trim() || null;
  const v = { kind: KINDS.some(([k]) => k === body.kind) ? body.kind : 'inventory', date: null, date_label: null, place_id: null,
    room: text('room'), number: text('number'), document: text('document'), note: text('note'),
    certainty: CERTAINTY.includes(body.certainty) ? body.certainty : 'attested',
    number_certainty: CERTAINTY.includes(body.number_certainty) ? body.number_certainty : 'attested' };
  let d = null;
  try { d = parseFuzzyDate(text('date')); } catch (err) { throw new RecordError(`Date: ${err.message}`); }
  if (d) { v.date = d.range; v.date_label = text('date_label') || d.label; }
  const place = text('place');
  if (place) {
    const row = (await db.query('SELECT id FROM places WHERE slug = $1', [place])).rows[0];
    if (!row) throw new RecordError(`Place: "${place}" does not exist — pick one from the suggestions.`);
    v.place_id = row.id;
  }
  if (!v.number) v.number_certainty = 'attested';
  if (![v.date, v.place_id, v.room, v.number, v.document, v.note].some((x) => x !== null)) {
    throw new RecordError('A record needs something: a date, a place, a room, a number, the document — or a note.');
  }
  return v;
}

const COLS = ['kind', 'date', 'date_label', 'place_id', 'room', 'number', 'number_certainty', 'document', 'certainty', 'note'];
const CASTS = { kind: '::provenance_record_kind', date: '::daterange', certainty: '::certainty', number_certainty: '::certainty' };
async function add(db, stepId, v) {
  const { rows } = await db.query(`INSERT INTO provenance_records (provenance_id, position, ${COLS.join(', ')})
    VALUES ($1, (SELECT coalesce(max(position) + 1, 0) FROM provenance_records WHERE provenance_id = $1), ${COLS.map((c, i) => `$${i + 2}${CASTS[c] || ''}`).join(', ')})
    RETURNING id`, [stepId, ...COLS.map((c) => v[c])]);
  return rows[0].id;
}
async function update(db, id, v) {
  await db.query(`UPDATE provenance_records SET ${COLS.map((c, i) => `${c} = $${i + 2}${CASTS[c] || ''}`).join(', ')} WHERE id = $1`, [id, ...COLS.map((c) => v[c])]);
}
async function remove(db, id) { await db.query('DELETE FROM provenance_records WHERE id = $1', [id]); }

// "?" after what the source doubts
const doubt = (c) => (c && c !== 'attested' ? html` <span class="muted" title="${c}">(${c})</span>` : '');
const KIND_LABEL = Object.fromEntries(KINDS.map(([k, l]) => [k, l.replace(/ \(.*$/, '')]));

// one record as a line: "1700 · inventory of the Real Alcázar · Real Alcázar, summer office · no. 286"
function line(r, { link = true } = {}) {
  const place = r.place_slug ? (link ? html`<a href="/places/${r.place_slug}">${r.place_name}</a>` : r.place_name) : '';
  return html`<span class="record-date">${r.date_label || 'undated'}</span> · ${r.document || KIND_LABEL[r.kind]}${doubt(r.certainty)}
    ${place || r.room ? html` · ${place}${place && r.room ? ', ' : ''}${r.room || ''}` : ''}
    ${r.number ? html` · no. ${link ? html`<a href="/provenance/numbers?q=${encodeURIComponent(r.number)}">${r.number}</a>` : r.number}${doubt(r.number_certainty)}` : ''}
    ${r.note ? html` <span class="muted">— ${r.note}</span>` : ''}`;
}

// under a step on the artwork's page: folded when there are many
function stepList(list = []) {
  if (!list.length) return '';
  const items = html`<ul class="records">${list.map((r) => html`<li>${line(r)}</li>`)}</ul>`;
  return list.length > 3 ? html`<details class="records small"><summary>${list.length} records</summary>${items}</details>`
    : html`<div class="records small">${items}</div>`;
}

function fields(v = {}, { own = '' } = {}) {
  const val = (k) => v[k] ?? '';
  const sel = (name, options, cur) => html`<select name="${name}"${own}>${options.map(([k, l]) => html`<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`)}</select>`;
  return html`<div class="field-pair"><div class="field"><label>Kind</label>${sel('kind', KINDS, val('kind') || 'inventory')}</div>
      <div class="field"><label>Date</label><input name="date" value="${val('date_text')}" placeholder="1700 · 1814-1818 · c. 1666"${own}>
        <div class="hint">When the document was made — an inventory's year, an exhibition's dates.</div></div></div>
    <div class="field-pair"><div class="field"><label>Place</label><input name="place" value="${val('place_slug')}" data-lookup="place" autocomplete="off" placeholder="the palace, the city"${own}></div>
      <div class="field"><label>Room</label><input name="room" value="${val('room')}" placeholder="e.g. summer office, Sala Reservada"${own}></div></div>
    <div class="field"><label>Document</label><input name="document" value="${val('document')}" placeholder="e.g. inventory of the Real Alcázar · Prado catalogue · Gautier, Voyage en Espagne"${own}></div>
    <div class="field-pair"><div class="field"><label>Number</label><input name="number" value="${val('number')}" placeholder="its number in that document"${own}>
        <div class="hint">Empty when it is listed without a number (s.n.) — say so in the note.</div></div>
      <div class="field"><label>The number is</label>${sel('number_certainty', CERTAINTY.map((c) => [c, c]), val('number_certainty') || 'attested')}
        <div class="hint">“¿nº 411?” = possible.</div></div></div>
    <div class="field-pair"><div class="field"><label>The record is</label>${sel('certainty', CERTAINTY.map((c) => [c, c]), val('certainty') || 'attested')}
        <div class="hint">The source doubts the whole entry: “¿Real Alcázar, 1666?” = possible.</div></div>
      <div class="field"><label>Note</label><input name="note" value="${val('note')}" placeholder="optional"${own}></div></div>`;
}
// form values of a stored record
const values = (r) => ({ ...r, date_text: r.date ? dateToDoc(r.date, r.date_label, false).value ?? '' : '' });

// the step's edit page (after the step's form): the records with edit / remove, and a form for one more
function editSection(step, list = [], v = {}) {
  return html`<section id="records"><h2>Records</h2>
    <p class="muted small">The evidence under this step: inventory entries, catalogues, exhibitions, sightings — each with its date,
      place, room and number. Saved at once. A dated place is a stop on the map; the numbers are found by the number search.</p>
    ${list.length ? html`<ol class="records-edit">${list.map((r) => html`<li>${line(r, { link: false })}
        <a href="/records/${r.id}/edit" class="small">edit</a>
        <form method="post" action="/records/${r.id}/delete" class="inline"><button class="link small">remove</button></form></li>`)}</ol>`
    : html`<p class="muted">None yet.</p>`}
    <details${v.kind ? ' open' : ''}><summary class="button secondary">+ Add a record</summary>
      <form method="post" action="/provenance/${step.id}/records" class="form">${fields(v)}<div class="actions"><button>Add</button></div></form>
    </details></section>`;
}

function editPage(r, v = values(r)) {
  return html`<form method="post" action="/records/${r.id}" class="form">${fields(v)}<div class="actions"><button>Save</button></div></form>`;
}

const errorText = (err) => (err instanceof RecordError ? err.message : null);

module.exports = { RecordError, KINDS, forSteps, byId, fromForm, add, update, remove, line, stepList, editSection, editPage, values, errorText };
