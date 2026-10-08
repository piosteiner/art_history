// Duplicates (migration 044): the weighing is SQL — dup_facts, dup_score(), duplicate_candidates() — so the create
// form, the live box while typing and the quality page agree. This module: the boxes, "it's a different one",
// unique-index hits as candidates, and the merge page (merge_entries(), previewed in a rolled-back transaction).
const { html } = require('./html');
const { BY_TYPE } = require('../content');

const SHOW = 50;  // possible duplicate: shown while typing and on the quality page
const ASK = 70;   // probable duplicate: Create asks "it's a different one?" first

// Thrown inside the save's transaction, so it rolls back: Probe for the live box (always), Found when Create needs
// a confirmation.
class Probe extends Error { constructor(candidates) { super('probe'); this.candidates = candidates; } }
class Found extends Error { constructor(candidates) { super('possible duplicates'); this.candidates = candidates; } }

async function candidates(db, type, id, min = SHOW) {
  const { rows } = await db.query('SELECT id::text, slug, name, score, reasons FROM duplicate_candidates($1, $2, $3)', [type, id, min]);
  return rows;
}

// Inside the save: the new row is in, compare it. A confirmed pair is remembered as "not the same" — the quality
// page's acknowledgement of that pair, so neither asks again.
async function checkNew(db, t, id, body, userId, { probe = false } = {}) {
  const found = await candidates(db, t.type, id);
  if (probe) throw new Probe(found);
  const ok = new Set([].concat(body['dup.ok'] || []).map(String));
  const ask = found.filter((d) => d.score >= ASK);
  const open = ask.filter((d) => !ok.has(d.id));
  if (open.length) throw new Found(open);
  for (const d of ask) await markDifferent(db, id, d.id, userId, 'confirmed as different when it was created');
}

async function markDifferent(db, a, b, userId, note) {
  await db.query(`INSERT INTO quality_acks (check_id, issue_key, note, acked_by) VALUES ('possible_duplicate', $1, $2, $3)
    ON CONFLICT (check_id, issue_key) DO NOTHING`, [pairKey(a, b), note, userId]);
}
const pairKey = (a, b) => `dup:${Math.min(Number(a), Number(b))}:${Math.max(Number(a), Number(b))}`;

// A unique index hit while probing or creating is the surest duplicate of all: the same Wikidata item, inventory
// number in the same collection, or Natural Earth outline. → the existing entry as a candidate, or null.
async function fromUniqueViolation(db, t, err, doc) {
  if (err.code !== '23505') return null;
  let q = null;
  if (/_wikidata_id_key$/.test(err.constraint || '') && doc.wikidata_id) {
    q = [`SELECT id::text, slug, ${t.name} AS name FROM ${t.table} WHERE wikidata_id = $1`, [doc.wikidata_id], 'same Wikidata item'];
  } else if (err.constraint === 'artworks_inventory_unique') {
    q = [`SELECT w.id::text, w.slug, w.title AS name FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
          WHERE i.slug = $1 AND lower(btrim(w.inventory_number)) = lower(btrim($2))`, [doc.institution, doc.inventory_number],
    'same inventory number in the same collection'];
  } else if (err.constraint === 'institution_number_unique' && doc.institution && doc.inventory_number) {
    q = [`SELECT w.id::text, w.slug, w.title AS name FROM artworks w JOIN institutions i ON i.slug = $1
          WHERE (w.current_institution_id = i.id AND lower(btrim(w.inventory_number)) = lower(btrim($2)))
             OR EXISTS (SELECT 1 FROM artwork_numbers n WHERE n.artwork_id = w.id AND n.institution_id = i.id AND lower(btrim(n.number)) = lower(btrim($2)))`,
    [doc.institution, doc.inventory_number], 'same inventory number in the same collection'];
  } else if (err.constraint === 'places_boundary_unique') {
    q = ['SELECT id::text, slug, name FROM places WHERE boundary_code = $1', [doc.boundary_code], 'same outline (boundary code)'];
  }
  if (!q) return null;
  const { rows } = await db.query(q[0], q[1]);
  return rows.length ? { ...rows[0], score: 100, reasons: [q[2]], certain: true } : null;
}

const reasonText = (d) => d.reasons.join(', ');
const entryLink = (t, d) => html`<a href="/${t.folder}/${d.slug}" target="_blank" rel="noopener">${d.name}</a> <span class="muted small">(${d.slug})</span>`;

// The live box above the form (filled by editor/duplicates.js while typing).
function liveBox(t, found) {
  if (!found.length) return '';
  return html`<div class="flash warn dup-box"><b>Already here?</b> ${found.length === 1 ? 'An entry' : 'Entries'} that may be the same:
    <ul>${found.map((d) => html`<li>${entryLink(t, d)} — ${reasonText(d)}${d.score >= ASK ? html` <span class="tag">probably the same</span>` : ''}</li>`)}</ul>
    <div class="muted small">Names alone don't decide: creator, dates, dimensions, places and identifiers count too.</div></div>`;
}

// In the rejected form: tick each one that is a different thing, then Create again.
function confirmBox(t, found) {
  return html`<div class="flash warn dup-confirm"><b>This may already exist.</b> Open the entry to check, or tick
    <i>it's a different one</i> and press Create again — the pair is remembered and not asked about again.
    <ul>${found.map((d) => html`<li>${entryLink(t, d)} — ${reasonText(d)}
      ${d.certain ? html`<div class="muted small">That can't be stored twice — edit the existing entry instead.</div>`
        : html`<label class="choice"><input type="checkbox" name="dup.ok" value="${d.id}"> it's a different one</label>`}</li>`)}</ul></div>`;
}

// ── Merge ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// merge_entries() in a transaction; preview = roll it back. → { result } or { error }
async function runMerge(pool, user, t, keepId, dupId, { preview }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', 'admin', true)", [String(user.id)]);
    const { rows } = await client.query('SELECT merge_entries($1, $2, $3) AS r', [t.type, keepId, dupId]);
    await client.query(preview ? 'ROLLBACK' : 'COMMIT');
    return { result: rows[0].r };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (['P0001', '23503', '23505', '23514'].includes(err.code)) return { error: err.message };
    throw err;
  } finally {
    client.release();
  }
}

const MOVED_LABELS = {
  relationships: 'relationships', 'artworks.creator_id': 'artworks (as their creator)', 'artworks.current_institution_id': 'artworks (in its collection)',
  'artworks.parent_id': 'parts of the series', 'images.artwork_id': 'images', 'images.artist_id': 'images', 'images.person_id': 'images',
  'images.institution_id': 'images', 'images.glossary_id': 'images', 'institutions.place_id': 'institutions (in this place)',
  'places.parent_id': 'places inside it', 'movements.parent_id': 'sub-movements', 'polities.parent_id': 'polities inside it',
  'events.parent_id': 'parts of the event', 'events.place_id': 'events (that happened here)', 'images.event_id': 'images',
  'provenance.artwork_id': 'provenance steps', 'provenance.owner_artist_id': 'provenance steps (as owner)',
  'provenance.owner_person_id': 'provenance steps (as owner)', 'provenance.owner_institution_id': 'provenance steps (as owner)',
  'provenance.owner_place_id': 'provenance steps (as owner)', 'provenance.location_id': 'provenance steps (as place)',
};

function summary(r, keep, dup) {
  const moved = Object.entries(r.moved || {});
  return html`<ul class="merge-summary">
    <li>${moved.length ? html`Moved to <b>${keep.name}</b>: ${moved.map(([k, n], i) => html`${i ? ', ' : ''}${n} ${MOVED_LABELS[k] || k}`)}` : 'Nothing points at it — nothing to move.'}</li>
    <li>${r.filled.length ? html`Filled in (empty on ${keep.name}): ${r.filled.join(', ')}` : 'No empty fields to fill in.'}</li>
    ${r.names_added ? html`<li>${r.names_added} name${r.names_added > 1 ? 's' : ''} added as other names (incl. “${dup.name}”).</li>` : ''}
    ${r.differing.length ? html`<li><b>Not taken over</b> (${keep.name} has its own): ${r.differing.join(', ')} — still in the history of ${dup.name}.</li>` : ''}
    <li>${r.texts ? `${r.texts} text${r.texts > 1 ? 's' : ''} with [[links]] to it rewritten. ` : ''}Its address /${dup.slug} will lead to ${keep.name}.</li></ul>`;
}

function mergePage({ t, dup, keep, found, preview, error }) {
  return html`<p class="muted"><a href="/${t.folder}/${dup.slug}">← ${dup.name}</a></p>
    <h1>Merge ${dup.name} into …</h1>
    <p>For duplicates: everything that points at <b>${dup.name}</b> moves to the entry you pick, and ${dup.name} is deleted.
      Pick the better of the two as the one that stays — the other's missing fields are filled in from it. Revertable from the history.</p>
    ${error ? html`<p class="flash error">${error}</p>` : ''}
    <form method="get" action="/${t.folder}/${dup.slug}/merge" class="form inline-form">
      <div class="field"><label for="f-into">Keep this ${t.type}</label>
        <input id="f-into" name="into" value="${keep ? keep.slug : ''}" data-lookup="${t.type}" autocomplete="off" placeholder="name or slug" required>
        <div class="hint">${found.length ? html`Possible duplicates: ${found.map((d, i) => html`${i ? ' · ' : ''}<a href="?into=${d.slug}">${d.name}</a> <span class="muted small">(${reasonText(d)})</span>`)}`
          : 'No likely duplicate found — type the name of the entry to keep.'}</div></div>
      <div class="actions"><button class="secondary">Preview</button></div>
    </form>
    ${preview ? html`<section><h2>What happens</h2>${summary(preview, keep, dup)}
      <form method="post" action="/${t.folder}/${dup.slug}/merge" class="actions"><input type="hidden" name="into" value="${keep.slug}">
        <button class="danger">Merge ${dup.name} into ${keep.name}</button>
        <a class="button secondary" href="/${t.folder}/${keep.slug}" target="_blank" rel="noopener">Open ${keep.name}</a></form></section>` : ''}`;
}

module.exports = { SHOW, ASK, Probe, Found, candidates, checkNew, markDifferent, pairKey, fromUniqueViolation, liveBox, confirmBox, runMerge, summary, mergePage, BY_TYPE };
