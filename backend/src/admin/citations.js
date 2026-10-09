// ---------------------------------------------------------------------------------------------------------------
// Sources for facts (table citations, migration 049): which source supports which value of an entry — a field
// (created, dimensions, institution …, the list is the table citable_fields) or a whole relationship. A citation keeps
// the value it was made for (cited_value); when the field changes, the view citation_status shows it as outdated.
// Wikidata cites itself: values taken from Wikidata get a citation automatically — pending while they sit in a
// working copy or a new-entry form, settled when published (settle(), called by saveEntity).
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');

class CitationError extends Error {}

const BADGE = { database: 'W', institution: 'M', scholarly: 'L', primary: 'P', text: 'T' };
const BADGE_TITLE = { database: 'aggregated database (Wikidata)', institution: 'institution (museum, collection database)',
  scholarly: 'scholarly (catalogue raisonné, literature)', primary: 'primary source (archive, letter)', text: 'a note in words — not yet a source of the bibliography' };
const kindOf = (c) => c.reliability || 'text';

let fieldsCache = null;
async function citableFields(db) {
  if (!fieldsCache) {
    const { rows } = await db.query('SELECT entity_type::text AS type, field, wikidata_property FROM citable_fields ORDER BY entity_type, position');
    fieldsCache = {};
    for (const r of rows) (fieldsCache[r.type] ||= {})[r.field] = r.wikidata_property;
  }
  return fieldsCache;
}

// A bibliography source's short form, as cited on the site (KHIST): "Busch 1993, S. 45" — siglum and locator.
async function shortForms(db, rows) {
  if (!rows.some((r) => r.source_slug)) return rows;
  const bib = require('../bibliography');
  const cat = await bib.loadCatalogue(db);
  return rows.map((r) => {
    const s = r.source_slug && cat.get(r.source_slug);
    return s ? { ...r, source_text: [s.siglum, bib.locator(r.locator, s.kind)].filter(Boolean).join(', ') } : r;
  });
}

// An entry's citations, by field; and those of its relationships, by relationship id.
async function forEntity(db, type, id) {
  const { rows } = await db.query(`SELECT c.id, c.field, c.reliability, c.source_text, c.source_slug, c.locator, c.note, c.accessed,
      c.wikidata_item, c.url, c.outdated, c.pending IS NOT NULL AS pending FROM citation_status c
    WHERE c.entity_type = $1 AND c.entity_id = $2 ORDER BY c.reliability DESC NULLS LAST, c.id`, [type, id]);
  const byField = {};
  for (const r of await shortForms(db, rows)) (byField[r.field] ||= []).push(r);
  return byField;
}
async function forRelationships(db, ids) {
  if (!ids.length) return {};
  const { rows } = await db.query(`SELECT c.id, c.relationship_id, c.reliability, c.source_text, c.source_slug, c.locator, c.note,
      c.accessed, c.wikidata_item, c.url, false AS outdated, false AS pending FROM citation_status c
    WHERE c.relationship_id = ANY ($1::bigint[]) ORDER BY c.reliability DESC NULLS LAST, c.id`, [ids]);
  const byRel = {};
  for (const r of await shortForms(db, rows)) (byRel[r.relationship_id] ||= []).push(r);
  return byRel;
}
async function forProvenance(db, ids) {
  if (!ids.length) return {};
  const { rows } = await db.query(`SELECT c.id, c.provenance_id, c.reliability, c.source_text, c.source_slug, c.locator, c.note,
      c.accessed, c.wikidata_item, c.url, false AS outdated, false AS pending FROM citation_status c
    WHERE c.provenance_id = ANY ($1::bigint[]) ORDER BY c.reliability DESC NULLS LAST, c.id`, [ids]);
  const byStep = {};
  for (const r of await shortForms(db, rows)) (byStep[r.provenance_id] ||= []).push(r);
  return byStep;
}

// The "Sources" box of the relationship and provenance forms: one free-text citation per line (050). Lines that stay
// keep their citation, removed ones go, new ones are added.
async function syncText(db, target, lines) {
  const col = target.relationship ? 'relationship_id' : 'provenance_id';
  const id = target.relationship || target.provenance;
  const want = [...new Set((lines || []).map((l) => String(l).trim()).filter(Boolean))];
  await db.query(`DELETE FROM citations WHERE ${col} = $1 AND text IS NOT NULL AND text <> ALL ($2::text[])`, [id, want]);
  for (const line of want) {
    await db.query(`INSERT INTO citations (${col}, text) SELECT $1, $2
      WHERE NOT EXISTS (SELECT 1 FROM citations WHERE ${col} = $1 AND text = $2)`, [id, line]);
  }
}

// Add a citation from the form on an entry's page: target (type + id + field, or relationship id), a source of the
// bibliography (slug), page/locator, note. The value is recorded as it is now — unless `pending` (the edit page: the
// field's form values in the working copy differ from the published ones): then it waits for them to be published.
async function add(db, body, userId, { pending = null, pendingByField = null } = {}) {
  const text = (k) => String(body[k] ?? '').trim() || null;
  // the source: a quick-select chip (button name=source) or the field — both arrive as "source"; the chosen one wins
  const sourceSlug = [].concat(body.source ?? []).map((x) => String(x).trim()).filter(Boolean).pop() || null;
  const free = text('text');
  const url = text('url');
  if (url && !/^https?:\/\/[^\s/]+\.[^\s]+$/.test(url)) throw new CitationError('Link: a web address (https://…).');
  if (!sourceSlug && !free && !url) throw new CitationError('Paste the link of the page, pick a source of the bibliography — or describe the source in words.');
  let sourceId = null;
  if (sourceSlug) {
    sourceId = (await db.query('SELECT entity_id($1, $2) AS id', ['source', sourceSlug])).rows[0].id;
    if (sourceId === null) throw new CitationError(`Source “${sourceSlug}” does not exist — pick one from the suggestions.`);
  } else if (url && !free) {
    sourceId = await websiteSource(db, url, text('site'));
  }
  let accessed = text('accessed');
  if (accessed && !/^\d{4}-\d{2}-\d{2}$/.test(accessed)) throw new CitationError('Accessed: a date like 2026-10-08.');
  if (url && !accessed) accessed = new Date().toISOString().slice(0, 10);  // a web page: consulted today
  const common = [sourceId, sourceId ? null : free, text('locator'), text('note'), accessed, url, userId];
  for (const [key, col] of [['relationship', 'relationship_id'], ['provenance', 'provenance_id']]) {
    if (!text(key)) continue;
    await db.query(`INSERT INTO citations (${col}, source_id, text, locator, note, accessed, url, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [text(key), ...common]);
    return;
  }
  // the field — and the others ticked under "also for" (one museum page backs the date, the size, the medium …)
  const fields = [...new Set([text('field'), ...[].concat(body.also ?? []).map(String)].filter(Boolean))];
  for (const field of fields) {
    const waiting = pendingByField ? pendingByField[field] || null : field === text('field') ? pending : null;
    const { rowCount } = await db.query(`
      INSERT INTO citations (entity_type, entity_id, field, source_id, text, locator, note, accessed, url, created_by, cited_value, pending)
      SELECT f.entity_type, er.id, f.field, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $11::jsonb IS NULL THEN field_value(er.r, f.cols) END, $11::jsonb
      FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
      WHERE f.entity_type = $1::entity_type AND f.field = $3`,
    [text('type'), text('id'), field, ...common, waiting ? JSON.stringify(waiting) : null]);
    if (!rowCount) throw new CitationError(`“${field}” takes no source.`);
  }
  return fields;
}

async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  return (await db.query('SELECT * FROM citations WHERE id = $1', [id])).rows[0] || null;
}
async function remove(db, id) { await db.query('DELETE FROM citations WHERE id = $1', [id]); }

// A pasted link → the bibliography source of its website: ours for that host if we have one (kind web, its url on
// the same host), else a new one — named as given, else after the host — reliability "institution" (a museum's or
// collection's site; change it on the source if not).
async function websiteSource(db, url, site) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const { rows } = await db.query(`SELECT id FROM bibliography WHERE kind = 'web' AND url IS NOT NULL
    AND regexp_replace(substring(url FROM '^https?://([^/:]+)'), '^www\.', '') = $1 ORDER BY id LIMIT 1`, [host]);
  if (rows.length) return rows[0].id;
  const name = (site || host).slice(0, 200);
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'website';
  let slug = base;
  for (let i = 2; (await db.query('SELECT 1 FROM bibliography WHERE slug = $1', [slug])).rows.length; i += 1) slug = `${base}-${i}`;
  const ins = await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability) VALUES ($1, 'web', $2, $2, $3, 'institution') RETURNING id`,
    [slug, name, `${new URL(url).protocol}//${new URL(url).host}/`]);
  return ins.rows[0].id;
}

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
// The sources used recently — by this user anywhere, and on this entry by anyone — for the quick select in every
// dialog: one click adds one. → [{slug, label, reliability}]
async function recentSources(db, userId, type = null, id = null) {
  const { rows } = await db.query(`
    SELECT b.slug, coalesce(b.siglum, b.name) AS label, source_reliability(b)::text AS reliability
    FROM bibliography b
    JOIN (SELECT source_id, max(created_at) AS last, bool_or(entity_type = $2::entity_type AND entity_id = $3) AS here
            FROM citations WHERE source_id IS NOT NULL AND (created_by = $1 OR (entity_type = $2::entity_type AND entity_id = $3))
           GROUP BY source_id) c ON c.source_id = b.id
    ORDER BY c.here DESC NULLS LAST, c.last DESC LIMIT 10`, [userId, type, id]);
  if (!rows.length) return rows;
  const sigla = await catalogueOf(db);  // the generated short references ("Busch 1993") where no own one is set
  return rows.map((r) => ({ ...r, label: (sigla.get(r.slug) || {}).siglum || r.label }));
}
async function catalogueOf(db) { return require('../bibliography').loadCatalogue(db); }  // lazy: bibliography.js is only needed here

function recentChips(recent = []) {
  return html`<div class="cite-recent">${recent.length ? html`<span class="small muted">Used recently — one click adds it (with the page no. above):</span>
    ${recent.map((r) => html`<button class="cite-chip cite-chip-${r.reliability}" name="source" value="${r.slug}" title="${BADGE_TITLE[r.reliability] || ''}">${r.label}</button>`)}` : ''}</div>`;
}

// Next to a value: one badge per kind of source (W M L P), "+" when there is none; a click opens the dialog with the
// list and a form to add one. target: { type, id, field } or { relationship } or { provenance }, with its label.
// key / label (data-cite-*): which marker it is, so the page can replace just this one after an add or a remove
// (editor/sortable.js — no reload). edit: on the edit page (rendered after the entry's form; a button with the same
// badges goes next to the field's label, and `expect` gets the field's form values on submit).
const keyOf = (target) => (target.relationship ? `rel:${target.relationship}` : target.provenance ? `prov:${target.provenance}` : `field:${target.field}`);
function marker(cites = [], target, back, { edit = false, recent = [] } = {}) {
  const kinds = [...new Set(cites.filter((c) => !c.pending && !c.outdated).map(kindOf))];
  const outdated = cites.some((c) => c.outdated);
  const pending = cites.some((c) => c.pending);
  const label = kinds.length ? kinds.map((k) => html`<span class="cite-badge cite-${k}" title="${BADGE_TITLE[k]} — click to see or add sources">${BADGE[k]}</span>`)
    : html`<span class="cite-badge cite-none" title="no source yet — click to add one">+</span>`;
  const what = target.label || 'this';
  return html`<details class="cite${edit ? ' cite-edit' : ''}" data-cite-key="${keyOf(target)}" data-cite-label="${what}"${edit ? html` data-cite-field="${target.field}" data-cite-edit="1"` : ''}><summary aria-label="sources of ${what}">${label}${outdated ? html`<span class="cite-badge cite-outdated" title="changed since cited">!</span>` : ''}${pending ? html`<span class="cite-badge cite-pending" title="not published yet — becomes a citation when the value is published">…</span>` : ''}</summary>
    <div class="cite-panel" role="dialog" aria-label="Sources of ${what}">
      <div class="cite-head"><b>Sources of ${what}</b><button type="button" class="link cite-close" aria-label="close">close ✕</button></div>
      <div class="cite-status small" aria-live="polite"></div>
      ${cites.length ? html`<ul>${cites.map((c) => html`<li><span class="cite-badge cite-${kindOf(c)}" title="${BADGE_TITLE[kindOf(c)]}">${BADGE[kindOf(c)]}</span>
        ${c.wikidata_item ? html`<a href="https://www.wikidata.org/wiki/${c.wikidata_item}" target="_blank" rel="noopener">${c.source_text}</a>`
          : c.source_slug ? html`<a href="/bibliography/${c.source_slug}">${c.source_text}</a>` : html`<span>${c.source_text}</span>`}
        ${c.url ? html` <a class="small" href="${c.url}" target="_blank" rel="noopener">page ↗</a>` : ''}
        ${c.accessed ? html`<span class="muted small">· accessed ${c.accessed.toISOString().slice(0, 10)}</span>` : ''}
        ${c.note ? html`<div class="small">${c.note}</div>` : ''}
        ${c.outdated ? html`<div class="small cite-warn">The value changed since — does the source still support it?</div>` : ''}
        ${c.pending ? html`<div class="small muted">In the working copy — becomes a citation when published.</div>` : ''}
        <form method="post" action="/citations/${c.id}/delete" class="inline cite-remove"><input type="hidden" name="back" value="${back}"><button class="link small">remove</button></form></li>`)}</ul>`
      : html`<p class="small muted">No source yet.</p>`}
      <form method="post" action="/citations" class="form cite-add">
        ${target.relationship ? html`<input type="hidden" name="relationship" value="${target.relationship}">`
          : target.provenance ? html`<input type="hidden" name="provenance" value="${target.provenance}">`
          : html`<input type="hidden" name="type" value="${target.type}"><input type="hidden" name="id" value="${target.id}"><input type="hidden" name="field" value="${target.field}">`}
        <input type="hidden" name="back" value="${back}">
        ${edit ? html`<input type="hidden" name="expect" value="">` : ''}
        <div class="field"><label>Add a source — paste the link of the page</label>
          <input name="url" type="url" placeholder="https://www.vangoghmuseum.nl/en/collection/…" aria-label="link of the page">
          <div class="hint">The website becomes a source of the bibliography (or the one we have for that site is used) — with this page and today's date.</div></div>
        <div class="field"><label>… or a source of the bibliography</label>
          <input name="source" data-lookup="source" autocomplete="off" placeholder="start typing: Busch 1993, Kunsthaus …" aria-label="source of the bibliography">
          <div class="hint">Books, catalogues raisonnés, articles: <a href="/bibliography/new" target="_blank" rel="noopener">create it in the bibliography</a> first.</div></div>
        <div class="field-pair"><div class="field"><label>Page, catalogue no.</label><input name="locator" placeholder="45 · Kat.-Nr. 12" aria-label="page or number"></div>
          <div class="field"><label>Note</label><input name="note" placeholder="optional" aria-label="note"></div></div>
        ${recentChips(recent)}
        ${target.field ? html`<div class="cite-also" hidden></div>` : ''}
        <details class="cite-more"><summary class="small muted">more: website name, accessed date, a source in words</summary>
          <div class="field-pair"><div class="field"><label>Name of the website (new ones)</label><input name="site" placeholder="e.g. Van Gogh Museum, Collection" aria-label="name of the website"></div>
            <div class="field"><label>Accessed</label><input name="accessed" type="date" aria-label="accessed"></div></div>
          <div class="field"><label>Or in words (stays a note: T)</label><input name="text" placeholder="e.g. letter to Theo, 1888" aria-label="source in words"></div></details>
        <div class="cite-actions"><button class="cite-submit">Add source</button></div>
      </form></div></details>`;
}

module.exports = { CitationError, citableFields, forEntity, forRelationships, forProvenance, syncText, add, byId, remove, pendingFromWikidata, settle,
  citeAllFromWikidata, citeAgreeing, citeRelationshipFromWikidata, marker, recentSources, recentChips, keyOf };
