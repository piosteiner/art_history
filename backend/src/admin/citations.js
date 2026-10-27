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

async function forNumbers(db, ids) {  // further numbers of an artwork (081)
  if (!ids.length) return {};
  const { rows } = await db.query(`SELECT c.id, c.number_id, c.reliability, c.source_text, c.source_slug, c.locator, c.note,
      c.accessed, c.wikidata_item, c.url, false AS outdated, false AS pending FROM citation_status c
    WHERE c.number_id = ANY ($1::bigint[]) ORDER BY c.reliability DESC NULLS LAST, c.id`, [ids]);
  const byNumber = {};
  for (const r of await shortForms(db, rows)) (byNumber[r.number_id] ||= []).push(r);
  return byNumber;
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
  let sourceSlug = [].concat(body.source ?? []).map((x) => String(x).trim()).filter(Boolean).pop() || null;
  const free = text('text');
  let url = text('url');
  // a quick-select chip: a recent citation — the same source and the same page (a page typed now wins)
  if (/^\d+$/.test(String(body.pick || ''))) {
    const { rows } = await db.query(`SELECT b.slug, c.url FROM citations c JOIN bibliography b ON b.id = c.source_id WHERE c.id = $1`, [body.pick]);
    if (!rows.length) throw new CitationError('That source is not in the list any more — pick it again in the field.');
    sourceSlug = rows[0].slug;
    if (!url) url = rows[0].url;
  }
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
  // a source cites a piece of information once (143, index citations_one_per_source): two passages go into one note
  const already = async (where, params) => sourceId !== null
    && (await db.query(`SELECT 1 FROM citations WHERE source_id = $1 AND ${where}`, [sourceId, ...params])).rows.length > 0;
  const twice = async () => {
    const { rows: [b] } = await db.query('SELECT coalesce(siglum, name) AS name FROM bibliography WHERE id = $1', [sourceId]);
    return new CitationError(`${b ? b.name : 'This source'} is already a source here — a source is cited once. To add a page or a quote, remove that citation and add it again with both.`);
  };
  for (const [key, col] of [['relationship', 'relationship_id'], ['provenance', 'provenance_id'], ['number', 'number_id']]) {
    if (!text(key)) continue;
    if (await already(`${col} = $2`, [text(key)])) throw await twice();
    await db.query(`INSERT INTO citations (${col}, source_id, text, locator, note, accessed, url, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [text(key), ...common]);
    return;
  }
  // the field — and the others ticked under "also for" (one museum page backs the date, the size, the medium …)
  let fields = [...new Set([text('field'), ...[].concat(body.also ?? []).map(String)].filter(Boolean))];
  const citedHere = async (field) => already('entity_type = $2::entity_type AND entity_id = $3 AND field = $4', [text('type'), text('id'), field]);
  if (text('field') && await citedHere(text('field'))) throw await twice();
  // "also for" fields that cite it already: left as they are
  const open = [];
  for (const f of fields) if (f === text('field') || !(await citedHere(f))) open.push(f);
  fields = open;
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
// "Yes, it still does": the source was checked against the changed value — the value now is the cited one (the same
// field_value() as settle(); citation_status compares with it), and a dated source (a web page, Wikidata) was
// accessed today.
async function confirm(db, id) {
  await db.query(`UPDATE citations c SET cited_value = field_value(er.r, f.cols),
      accessed = CASE WHEN c.accessed IS NOT NULL THEN current_date ELSE c.accessed END, updated_at = now()
    FROM citable_fields f, entity_rows er WHERE c.id = $1 AND c.pending IS NULL
      AND (f.entity_type, f.field) = (c.entity_type, c.field) AND (er.type, er.id) = (c.entity_type, c.entity_id)`, [id]);
}

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

// The same for a bibliography source with the record's page (the GND comparison, 053): pending until published.
async function pendingFromSource(db, type, id, sourceSlug, url, cites, userId) {
  const fields = (await citableFields(db))[type] || {};
  const src = (await db.query("SELECT entity_id('source', $1) AS id", [sourceSlug])).rows[0].id;
  if (!src) return;
  for (const c of cites.filter((x) => x.field in fields)) {
    await db.query('DELETE FROM citations WHERE entity_type = $1 AND entity_id = $2 AND field = $3 AND pending IS NOT NULL AND source_id = $4', [type, id, c.field, src]);
    // cited by that source already (a published citation): it stays the one (143) — if the value changes, it shows as outdated
    await db.query(`INSERT INTO citations (entity_type, entity_id, field, source_id, url, accessed, pending, created_by)
      SELECT $1, $2, $3, $4, $5, current_date, $6, $7
      WHERE NOT EXISTS (SELECT 1 FROM citations WHERE entity_type = $1 AND entity_id = $2 AND field = $3 AND source_id = $4)`,
    [type, id, c.field, src, url, JSON.stringify(c.form), userId]);
  }
}
// Fields where that source agrees with our value: cited as they are (unless it is cited there already).
async function citeAgreeingSource(db, type, id, sourceSlug, url, fieldNames, userId) {
  await db.query(`INSERT INTO citations (entity_type, entity_id, field, source_id, url, accessed, cited_value, created_by)
    SELECT f.entity_type, er.id, f.field, b.id, $4, current_date, field_value(er.r, f.cols), $5
    FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2 JOIN bibliography b ON b.slug = $3
    WHERE f.entity_type = $1::entity_type AND f.field = ANY ($6::text[]) AND field_value(er.r, f.cols) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM citations c WHERE (c.entity_type, c.entity_id, c.field) = (f.entity_type, er.id, f.field) AND c.source_id = b.id)`,
  [type, id, sourceSlug, url, userId, fieldNames]);
}
async function citeRelationshipFromSource(db, relId, sourceSlug, url) {
  // (not twice: the Enrich page may offer the same relationship from two sources)
  await db.query(`INSERT INTO citations (relationship_id, source_id, url, accessed) SELECT $1, b.id, $3, current_date FROM bibliography b
    WHERE b.slug = $2 AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.relationship_id = $1 AND c.source_id = b.id)`, [relId, sourceSlug, url]);
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

// A new entry's own source (the "Source" section of the new-entry form, cite.*): one source for every field the
// entry was created with — a museum page backs the title, the date, the medium, the size. Wikidata's citations of the
// same fields stay beside it. A source that can't be used throws CitationError, and the entry is not created.
async function citeNew(db, type, id, body, userId) {
  const v = (k) => [].concat(body[`cite.${k}`] ?? []).map((x) => String(x).trim()).filter(Boolean).pop() || '';
  if (!['url', 'source', 'text'].some((k) => v(k))) return [];
  const { rows } = await db.query(`
    SELECT f.field FROM citable_fields f JOIN entity_rows er ON er.type = f.entity_type AND er.id = $2
    WHERE f.entity_type = $1::entity_type AND field_value(er.r, f.cols) IS NOT NULL ORDER BY f.position`, [type, id]);
  if (!rows.length) return [];
  return add(db, { type, id, field: rows[0].field, also: rows.slice(1).map((r) => r.field),
    url: v('url'), source: v('source'), locator: v('locator'), note: v('note'), text: v('text') }, userId);
}

// The "Source" section of the new-entry form: a page's link, a source of the bibliography (typed, or one used
// recently — the source only, the page differs per entry), page or number, a note. values: the posted cite.* (after an error).
function newEntrySection(recent = [], values = {}) {
  const val = (k) => values[`cite.${k}`] ?? '';
  const sources = [...new Map(recent.map((r) => [r.slug, r])).values()];
  return html`<section class="form-section" id="sec-source"><h2 class="form-section-title">Source</h2>
    <p class="hint">Optional: where the details above come from. It is added as the source of every field you fill in —
      later you can change it per field with the markers on the entry's page.</p>
    <div class="field"><label for="cite-url">Link of the page</label>
      <input id="cite-url" name="cite.url" type="url" value="${val('url')}" placeholder="https://collection.kunsthaus.ch/de/collection/item/…">
      <div class="hint">The website becomes a source of the bibliography (or the one we have for that site is used) — with this page and today's date.</div></div>
    <div class="field"><label for="cite-source">… or a source of the bibliography</label>
      <input id="cite-source" name="cite.source" data-lookup="source" autocomplete="off" value="${val('source')}" placeholder="start typing: Busch 1993, Kunsthaus …">
      ${sources.length ? html`<div class="cite-recent"><span class="small muted">Used recently:</span>
        ${sources.map((r) => html`<label class="choice cite-chip cite-chip-${r.reliability}"><input type="radio" name="cite.source" value="${r.slug}"${val('source') === r.slug ? ' checked' : ''}> ${r.label}</label>`)}</div>` : ''}</div>
    <div class="field-pair"><div class="field"><label for="cite-locator">Page, catalogue no.</label><input id="cite-locator" name="cite.locator" value="${val('locator')}" placeholder="45 · Kat.-Nr. 12"></div>
      <div class="field"><label for="cite-note">Note</label><input id="cite-note" name="cite.note" value="${val('note')}" placeholder="optional"></div></div>
    <div class="field"><label for="cite-text">Or in words (stays a note: T)</label><input id="cite-text" name="cite.text" value="${val('text')}" placeholder="e.g. letter to Theo, 1888"></div>
  </section>`;
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
  // (not twice: "cite Wikidata for it" on a relationship it already cites)
  await db.query(`INSERT INTO citations (relationship_id, wikidata_item, wikidata_property, accessed) SELECT $1, $2, $3, current_date
    WHERE NOT EXISTS (SELECT 1 FROM citations WHERE relationship_id = $1 AND wikidata_item = $2)`,
  [relId, qid, /^P\d+$/.test(property || '') ? property : null]);
}

// ── display ─────────────────────────────────────────────────────────────────────────────────────────────────────
// The sources used recently — by this user anywhere, and on this entry by anyone — for the quick select in every
// dialog: one click adds one. → [{slug, label, reliability}]
async function recentSources(db, userId, type = null, id = null) {
  // One chip per source *and page*: a website source (a museum's online collection) is cited with the object's page
  // (url) — the chip brings that page back, not just the website. DISTINCT ON keeps the latest citation of each
  // (source, page); `pick` is its id — the chip sends it, the server copies source and page from it.
  const { rows } = await db.query(`
    SELECT x.pick, x.url, b.slug, coalesce(b.siglum, b.name) AS label, source_reliability(b)::text AS reliability
    FROM (SELECT DISTINCT ON (c.source_id, coalesce(c.url, '')) c.id AS pick, c.source_id, c.url, c.created_at,
                 (c.entity_type = $2::entity_type AND c.entity_id = $3) AS here
            FROM citations c WHERE c.source_id IS NOT NULL AND (c.created_by = $1 OR (c.entity_type = $2::entity_type AND c.entity_id = $3))
           ORDER BY c.source_id, coalesce(c.url, ''), c.created_at DESC) x
    JOIN bibliography b ON b.id = x.source_id
    ORDER BY x.here DESC NULLS LAST, x.created_at DESC LIMIT 12`, [userId, type, id]);
  if (!rows.length) return rows;
  const sigla = await catalogueOf(db);  // the generated short references ("Busch 1993") where no own one is set
  return rows.map((r) => ({ ...r, label: (sigla.get(r.slug) || {}).siglum || r.label }));
}
// "collection.kunsthaus.ch/…/item/752012" — the end of a page's address, enough to tell the pages of one site apart
const pageOf = (url) => {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length ? `…/${parts.slice(-2).join('/')}` : u.host;
  } catch { return url; }
};
async function catalogueOf(db) { return require('../bibliography').loadCatalogue(db); }  // lazy: bibliography.js is only needed here

// cited: the slugs of the sources this marker cites already — their chips are disabled (a source cites once, 143)
function recentChips(recent = [], cited = []) {
  return html`<div class="cite-recent">${recent.length ? html`<span class="small muted">Used recently — one click adds it (with the page no. above):</span>
    ${recent.map((r) => (cited.includes(r.slug)
      ? html`<button type="button" class="cite-chip cite-chip-${r.reliability} cite-chip-used" data-slug="${r.slug}" disabled title="already a source here">${r.label} ✓</button>`
      : html`<button class="cite-chip cite-chip-${r.reliability}" data-slug="${r.slug}" name="pick" value="${r.pick}" title="${r.url ? `${r.url} — ` : ''}${BADGE_TITLE[r.reliability] || ''}">${r.label}${r.url ? html` <span class="cite-chip-page">${pageOf(r.url)}</span>` : ''}</button>`))}` : ''}</div>`;
}

// Next to a value: one badge per kind of source (W M L P), "+" when there is none; a click opens the dialog with the
// list and a form to add one. target: { type, id, field } or { relationship } or { provenance } or { number }, with its label.
// key / label (data-cite-*): which marker it is, so the page can replace just this one after an add or a remove
// (editor/sortable.js — no reload). edit: on the edit page (rendered after the entry's form; a button with the same
// badges goes next to the field's label, and `expect` gets the field's form values on submit).
const keyOf = (target) => (target.relationship ? `rel:${target.relationship}` : target.provenance ? `prov:${target.provenance}`
  : target.number ? `num:${target.number}` : `field:${target.field}`);
function badges(cites = []) {
  // every logged source shows its kind — also one still in the working copy (dotted: becomes a citation on Publish),
  // so a value with sources never looks like one without ("+" only when there is none at all)
  const kinds = [...new Set(cites.map(kindOf))];
  const onlyPending = (k) => cites.filter((c) => kindOf(c) === k).every((c) => c.pending);
  const outdated = cites.some((c) => c.outdated);
  return html`${kinds.length ? kinds.map((k) => (onlyPending(k)
    ? html`<span class="cite-badge cite-${k} cite-pending" title="${BADGE_TITLE[k]} — not published yet: becomes a citation when the value is published">${BADGE[k]}</span>`
    : html`<span class="cite-badge cite-${k}" title="${BADGE_TITLE[k]} — click to see or add sources">${BADGE[k]}</span>`))
    : html`<span class="cite-badge cite-none" title="no source yet — click to add one">+</span>`}${outdated ? html`<span class="cite-badge cite-outdated" title="changed since cited">!</span>` : ''}`;
}
// A button with a marker's badges where the marker itself can't stand (inside the entry's form on the edit page — its
// dialog holds a form of its own and sits after the entry's form): a click opens that dialog (editor/cites.js).
const trigger = (cites = [], target) => html`<button type="button" class="cite-trigger" data-for-key="${keyOf(target)}" aria-label="sources of ${target.label || 'this'}">${badges(cites)}</button>`;

function marker(cites = [], target, back, { edit = false, recent = [] } = {}) {
  const what = target.label || 'this';
  const cited = [...new Set(cites.filter((c) => c.source_slug).map((c) => c.source_slug))];   // offered no more (143)
  return html`<details class="cite${edit ? ' cite-edit' : ''}" data-cite-key="${keyOf(target)}" data-cite-label="${what}"${edit ? html` data-cite-field="${target.field}" data-cite-edit="1"` : ''}><summary aria-label="sources of ${what}">${badges(cites)}</summary>
    <div class="cite-panel" role="dialog" aria-label="Sources of ${what}">
      <div class="cite-head"><b>Sources of ${what}</b><button type="button" class="link cite-close" aria-label="close">close ✕</button></div>
      <div class="cite-status small" aria-live="polite"></div>
      ${cites.length ? html`<ul>${cites.map((c) => html`<li><span class="cite-badge cite-${kindOf(c)}" title="${BADGE_TITLE[kindOf(c)]}">${BADGE[kindOf(c)]}</span>
        ${c.wikidata_item ? html`<a href="https://www.wikidata.org/wiki/${c.wikidata_item}" target="_blank" rel="noopener">${c.source_text}</a>`
          : c.source_slug ? html`<a href="/bibliography/${c.source_slug}">${c.source_text}</a>` : html`<span>${c.source_text}</span>`}
        ${c.url ? html` <a class="small" href="${c.url}" target="_blank" rel="noopener">page ↗</a>` : ''}
        ${c.accessed ? html`<span class="muted small">· accessed ${c.accessed.toISOString().slice(0, 10)}</span>` : ''}
        ${c.note ? html`<div class="small">${c.note}</div>` : ''}
        ${c.outdated ? html`<div class="small cite-warn">The value changed since — does the source still support it?
          <form method="post" action="/citations/${c.id}/confirm" class="inline cite-confirm"><input type="hidden" name="back" value="${back}"><button class="link small" title="I checked: the source supports the value as it is now${c.accessed ? ' (accessed today)' : ''}">Yes, it still does</button></form>
          <span class="muted">· if not: remove it</span></div>` : ''}
        ${c.pending ? html`<div class="small muted">In the working copy — becomes a citation when published.</div>` : ''}
        <form method="post" action="/citations/${c.id}/delete" class="inline cite-remove"><input type="hidden" name="back" value="${back}"><button class="link small">remove</button></form></li>`)}</ul>`
      : html`<p class="small muted">No source yet.</p>`}
      <form method="post" action="/citations" class="form cite-add">
        ${target.relationship ? html`<input type="hidden" name="relationship" value="${target.relationship}">`
          : target.provenance ? html`<input type="hidden" name="provenance" value="${target.provenance}">`
          : target.number ? html`<input type="hidden" name="number" value="${target.number}">`
          : html`<input type="hidden" name="type" value="${target.type}"><input type="hidden" name="id" value="${target.id}"><input type="hidden" name="field" value="${target.field}">`}
        <input type="hidden" name="back" value="${back}">
        ${edit ? html`<input type="hidden" name="expect" value="">` : ''}
        <div class="field"><label>Add a source — paste the link of the page</label>
          <input name="url" type="url" placeholder="https://www.vangoghmuseum.nl/en/collection/…" aria-label="link of the page">
          <div class="hint">The website becomes a source of the bibliography (or the one we have for that site is used) — with this page and today's date.</div></div>
        <div class="field"><label>… or a source of the bibliography</label>
          <input name="source" data-lookup="source" data-cited="${cited.join(',')}" autocomplete="off" placeholder="start typing: Busch 1993, Kunsthaus …" aria-label="source of the bibliography">
          <div class="hint">Books, catalogues raisonnés, articles: <a href="/bibliography/new" target="_blank" rel="noopener">create it in the bibliography</a> first.</div></div>
        <div class="field-pair"><div class="field"><label>Page, catalogue no.</label><input name="locator" placeholder="45 · Kat.-Nr. 12" aria-label="page or number"></div>
          <div class="field"><label>Note</label><input name="note" placeholder="optional" aria-label="note"></div></div>
        ${recentChips(recent, cited)}
        ${target.field ? html`<div class="cite-also" hidden></div>` : ''}
        <details class="cite-more"><summary class="small muted">more: website name, accessed date, a source in words</summary>
          <div class="field-pair"><div class="field"><label>Name of the website (new ones)</label><input name="site" placeholder="e.g. Van Gogh Museum, Collection" aria-label="name of the website"></div>
            <div class="field"><label>Accessed</label><input name="accessed" type="date" aria-label="accessed"></div></div>
          <div class="field"><label>Or in words (stays a note: T)</label><input name="text" placeholder="e.g. letter to Theo, 1888" aria-label="source in words"></div></details>
        <div class="cite-actions"><button class="cite-submit">Add source</button></div>
      </form></div></details>`;
}

module.exports = { CitationError, citeNew, newEntrySection, citableFields, forEntity, forRelationships, forProvenance, forNumbers, syncText, add, byId, remove, confirm, pendingFromWikidata, settle,
  pendingFromSource, citeAgreeingSource, citeRelationshipFromSource,
  citeAllFromWikidata, citeAgreeing, citeRelationshipFromWikidata, marker, trigger, recentSources, recentChips, keyOf };
