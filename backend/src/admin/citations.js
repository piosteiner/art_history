// ---------------------------------------------------------------------------------------------------------------
// Sources for facts (table citations, migration 049): which source supports which value of an entry — a field
// (created, dimensions, institution …, the list is the table citable_fields) or a whole relationship. A citation keeps
// the value it was made for (cited_value); when the field changes, the view citation_status shows it as outdated.
// Wikidata cites itself: values taken from Wikidata get a citation automatically — pending while they sit in a
// working copy or a new-entry form, settled when published (settle(), called by saveEntity).
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');

class CitationError extends Error {}

const BADGE = { database: 'W', institution: 'M', scholarly: 'L', primary: 'P' };
const BADGE_TITLE = { database: 'aggregated database (Wikidata)', institution: 'institution (museum, collection database)',
  scholarly: 'scholarly (catalogue raisonné, literature)', primary: 'primary source (archive, letter)' };

let fieldsCache = null;
async function citableFields(db) {
  if (!fieldsCache) {
    const { rows } = await db.query('SELECT entity_type::text AS type, field, wikidata_property FROM citable_fields ORDER BY entity_type, position');
    fieldsCache = {};
    for (const r of rows) (fieldsCache[r.type] ||= {})[r.field] = r.wikidata_property;
  }
  return fieldsCache;
}

// An entry's citations, by field; and those of its relationships, by relationship id.
async function forEntity(db, type, id) {
  const { rows } = await db.query(`SELECT c.id, c.field, c.reliability, c.source_text, c.source_slug, c.locator, c.note, c.accessed,
      c.wikidata_item, c.outdated, c.pending IS NOT NULL AS pending FROM citation_status c
    WHERE c.entity_type = $1 AND c.entity_id = $2 ORDER BY c.reliability DESC, c.id`, [type, id]);
  const byField = {};
  for (const r of rows) (byField[r.field] ||= []).push(r);
  return byField;
}
async function forRelationships(db, ids) {
  if (!ids.length) return {};
  const { rows } = await db.query(`SELECT c.id, c.relationship_id, c.reliability, c.source_text, c.source_slug, c.locator, c.note,
      c.accessed, c.wikidata_item, false AS outdated, false AS pending FROM citation_status c
    WHERE c.relationship_id = ANY ($1::bigint[]) ORDER BY c.reliability DESC, c.id`, [ids]);
  const byRel = {};
  for (const r of rows) (byRel[r.relationship_id] ||= []).push(r);
  return byRel;
}

// Add a citation from the form on an entry's page: target (type + id + field, or relationship id), a source of the
// bibliography (slug), page/locator, note. The value is recorded as it is now.
async function add(db, body, userId) {
  const text = (k) => String(body[k] ?? '').trim() || null;
  const sourceSlug = text('source');
  if (!sourceSlug) throw new CitationError('Source: pick one from the bibliography (create it there first, e.g. the museum’s page as a website).');
  const { rows: src } = await db.query('SELECT entity_id($1, $2) AS id', ['source', sourceSlug]);
  if (src[0].id === null) throw new CitationError(`Source “${sourceSlug}” does not exist — pick one from the suggestions.`);
  const accessed = text('accessed');
  if (accessed && !/^\d{4}-\d{2}-\d{2}$/.test(accessed)) throw new CitationError('Accessed: a date like 2026-10-08.');
  if (text('relationship')) {
    await db.query(`INSERT INTO citations (relationship_id, source_id, locator, note, accessed, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [text('relationship'), src[0].id, text('locator'), text('note'), accessed, userId]);
    return;
  }
  const { rowCount } = await db.query(`
    INSERT INTO citations (entity_type, entity_id, field, source_id, locator, note, accessed, cited_value, created_by)
    SELECT f.entity_type, er.id, f.field, $4, $5, $6, $7, field_value(er.r, f.cols), $8
    FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
    WHERE f.entity_type = $1::entity_type AND f.field = $3`,
  [text('type'), text('id'), text('field'), src[0].id, text('locator'), text('note'), accessed, userId]);
  if (!rowCount) throw new CitationError('That field takes no source.');
}

async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  return (await db.query('SELECT * FROM citations WHERE id = $1', [id])).rows[0] || null;
}
async function remove(db, id) { await db.query('DELETE FROM citations WHERE id = $1', [id]); }

// ── Wikidata ──────────────────────────────────────────────────────────────────────────────────────────────────
// The fields a Wikidata application took (wikidata.apply → cites: [{field, form}]), as citations to be settled:
// for an existing entry rows with `pending` (the form values expected on publish); for a new one the same list
// travels in the form (wd.cite) and is settled after Create.
async function pendingFromWikidata(db, type, id, qid, cites, userId) {
  const fields = (await citableFields(db))[type] || {};
  for (const c of cites.filter((x) => x.field in fields)) {
    await db.query(`DELETE FROM citations WHERE entity_type = $1 AND entity_id = $2 AND field = $3 AND pending IS NOT NULL`, [type, id, c.field]);
    await db.query(`INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, pending, created_by)
      VALUES ($1, $2, $3, $4, $5, current_date, $6, $7)`, [type, id, c.field, qid, fields[c.field], JSON.stringify(c.form), userId]);
  }
}

const sameForm = (expected, body) => Object.entries(expected).every(([k, v]) => String(body[k] ?? '').trim() === String(v ?? '').trim());

// After a save (saveEntity): pending citations of this entry whose expected values were published are settled (the
// value recorded now), the others dropped (the value was changed before publishing — not Wikidata's any more).
// A new entry: the citations of wd.cite whose values were kept.
async function settle(db, type, id, body, userId) {
  const { rows } = await db.query('SELECT id, pending FROM citations WHERE entity_type = $1 AND entity_id = $2 AND pending IS NOT NULL', [type, id]);
  for (const c of rows) {
    if (sameForm(c.pending, body)) {
      await db.query(`UPDATE citations c SET pending = NULL, cited_value = field_value(er.r, f.cols)
        FROM citable_fields f, entity_rows er WHERE c.id = $1 AND (f.entity_type, f.field) = (c.entity_type, c.field)
          AND (er.type, er.id) = (c.entity_type, c.entity_id)`, [c.id]);
    } else await db.query('DELETE FROM citations WHERE id = $1', [c.id]);
  }
  let wd = null;
  try { wd = body['wd.cite'] ? JSON.parse(String(body['wd.cite'])) : null; } catch { wd = null; }
  if (!wd || !/^Q\d+$/.test(wd.qid || '') || !Array.isArray(wd.cites)) return;
  const fields = (await citableFields(db))[type] || {};
  for (const c of wd.cites.filter((x) => x && x.field in fields && x.form && sameForm(x.form, body))) {
    await db.query(`INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, cited_value, created_by)
      SELECT f.entity_type, er.id, f.field, $3, f.wikidata_property, current_date, field_value(er.r, f.cols), $4
      FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
      WHERE f.entity_type = $1::entity_type AND f.field = $5 AND field_value(er.r, f.cols) IS NOT NULL`, [type, id, wd.qid, userId, c.field]);
  }
}

// An entry created from Wikidata in one go (a missing target, a city): every field it has comes from that item.
async function citeAllFromWikidata(db, type, id, qid, userId = null) {
  if (!/^Q\d+$/.test(qid || '')) return;
  await db.query(`INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, cited_value, created_by)
    SELECT f.entity_type, er.id, f.field, $3, f.wikidata_property, current_date, field_value(er.r, f.cols), $4
    FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
    WHERE f.entity_type = $1::entity_type AND field_value(er.r, f.cols) IS NOT NULL`, [type, id, qid, userId]);
}

// Fields where Wikidata has the same value as we do: cited as they are (unless Wikidata is cited there already).
async function citeAgreeing(db, type, id, qid, fields, userId = null) {
  if (!/^Q\d+$/.test(qid || '')) return;
  await db.query(`INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, cited_value, created_by)
    SELECT f.entity_type, er.id, f.field, $3, f.wikidata_property, current_date, field_value(er.r, f.cols), $4
    FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
    WHERE f.entity_type = $1::entity_type AND f.field = ANY ($5::text[]) AND field_value(er.r, f.cols) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM citations c WHERE (c.entity_type, c.entity_id, c.field) = (f.entity_type, er.id, f.field)
                                                 AND c.wikidata_item = $3)`, [type, id, qid, userId, fields]);
}

async function citeRelationshipFromWikidata(db, relId, qid, property) {
  await db.query(`INSERT INTO citations (relationship_id, wikidata_item, wikidata_property, accessed) VALUES ($1, $2, $3, current_date)`,
    [relId, qid, /^P\d+$/.test(property || '') ? property : null]);
}

// ── display ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Next to a value: one badge per kind of source (W M L P), "?" when there is none; a click opens the list and a form
// to add one. target: { type, id, field } or { relationship }.
function marker(cites = [], target, back) {
  const kinds = [...new Set(cites.filter((c) => !c.pending && !c.outdated).map((c) => c.reliability))];
  const outdated = cites.some((c) => c.outdated);
  const pending = cites.some((c) => c.pending);
  const label = kinds.length ? kinds.map((k) => html`<span class="cite-badge cite-${k}" title="${BADGE_TITLE[k]}">${BADGE[k]}</span>`)
    : html`<span class="cite-badge cite-none" title="no source yet">?</span>`;
  return html`<details class="cite"><summary aria-label="sources">${label}${outdated ? html`<span class="cite-badge cite-outdated" title="changed since cited">!</span>` : ''}${pending ? html`<span class="cite-badge cite-pending" title="from Wikidata, not published yet">…</span>` : ''}</summary>
    <div class="cite-panel">
      ${cites.length ? html`<ul>${cites.map((c) => html`<li><span class="cite-badge cite-${c.reliability}">${BADGE[c.reliability]}</span>
        ${c.wikidata_item ? html`<a href="https://www.wikidata.org/wiki/${c.wikidata_item}" target="_blank" rel="noopener">${c.source_text}</a>`
          : html`<a href="/bibliography/${c.source_slug}">${c.source_text}</a>`}
        ${c.accessed ? html`<span class="muted small">· accessed ${c.accessed.toISOString().slice(0, 10)}</span>` : ''}
        ${c.note ? html`<div class="small">${c.note}</div>` : ''}
        ${c.outdated ? html`<div class="small cite-warn">The value changed since — does the source still support it?</div>` : ''}
        ${c.pending ? html`<div class="small muted">In the working copy — becomes a citation when published.</div>` : ''}
        <form method="post" action="/citations/${c.id}/delete" class="inline"><input type="hidden" name="back" value="${back}"><button class="link small">remove</button></form></li>`)}</ul>`
      : html`<p class="small muted">No source yet.</p>`}
      <form method="post" action="/citations" class="form cite-add">
        ${target.relationship ? html`<input type="hidden" name="relationship" value="${target.relationship}">`
          : html`<input type="hidden" name="type" value="${target.type}"><input type="hidden" name="id" value="${target.id}"><input type="hidden" name="field" value="${target.field}">`}
        <input type="hidden" name="back" value="${back}">
        <input name="source" data-lookup="source" autocomplete="off" placeholder="source (bibliography)" aria-label="source" required>
        <input name="locator" placeholder="page, no. …" aria-label="page or number" class="short">
        <input name="accessed" type="date" aria-label="accessed (websites)" class="short" title="accessed (websites)">
        <input name="note" placeholder="note (optional)" aria-label="note">
        <button class="secondary">Add source</button>
        <div class="hint">A museum page, a catalogue raisonné, a book — create it in the <a href="/bibliography/new">bibliography</a> first.</div>
      </form></div></details>`;
}

module.exports = { CitationError, citableFields, forEntity, forRelationships, add, byId, remove, pendingFromWikidata, settle,
  citeAllFromWikidata, citeAgreeing, citeRelationshipFromWikidata, marker };
