// Admin panel — what the route files (src/admin/routes/) share: the page frame with ?done= messages, the
// transaction tagged with the user, Postgres errors as sentences, the history tables, relationship forms, finding
// an entry, "not found" (following old slugs and changed types), the form's context.
const { adminPool } = require('../db');
const { BY_FOLDER, BY_TYPE, SLUG, readDocs } = require('../content');
const names = require('../names');
const { parseFuzzyDate } = require('../fuzzy-date');
const { html, layout } = require('./html');
const { wordDiff, isLongText } = require('./textdiff');
const drafts = require('./drafts');
const collab = require('./collab');
const { fieldLabel, HINTS } = require('./forms');

const PAGE = 50;
const an = (word) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

// Fixed messages for ?done=… after a redirect (never reflect arbitrary text).
const DONE = {
  created: 'Created.', saved: 'Saved.', deleted: 'Deleted.', unchanged: 'No changes.',
  wikidata: 'Wikidata values applied — the field values are in the working copy: check them below and Publish.',
  published: 'Published — the working copy is now the public version.',
  discarded: 'Unpublished changes discarded — the working copy is back to the published version.',
  reverted: 'Change reverted — the revert itself is in the history and can be reverted too.',
  restored: 'Version restored.',
  'rel-added': 'Relationship added.', 'rel-saved': 'Relationship saved.', 'rel-deleted': 'Relationship deleted.',
  'auto-done': 'Marked as complete.', merged: 'Merged — the other entry is gone; its address leads here.',
  'img-added': 'Image added.', 'img-saved': 'Image saved.', 'img-deleted': 'Image removed.', 'img-moved': 'Order changed.',
  converted: 'Type changed — everything that could come along is here; the old address leads here.',
  'gnd-applied': 'Comparison applied — agreeing values are cited.', 'id-added': 'Reference record added.', 'id-deleted': 'Reference record removed.', gnd: 'Values applied — the field values are in the working copy: check them below and Publish.',
  'cite-added': 'Source added.', 'cite-deleted': 'Source removed.',
  'num-added': 'Number added.', 'num-deleted': 'Number removed.',
  'prov-added': 'Provenance step added.', 'prov-saved': 'Provenance step saved.', 'prov-deleted': 'Provenance step removed.', 'prov-moved': 'Order changed.',
};

function send(req, res, { title, body, status = 200, flash, page = null }) {
  if (!flash && DONE[req.query.done]) {
    // Numbers only from the URL — never reflect free text.
    const n = (k) => Math.max(0, Number.parseInt(req.query[k], 10) || 0);
    const extra = ['wikidata', 'gnd', 'gnd-applied'].includes(req.query.done) ? [n('rels') && `${n('rels')} relationship${n('rels') === 1 ? '' : 's'} added`,
      n('created') && `${n('created')} new entr${n('created') === 1 ? 'y' : 'ies'} created`,
      n('imgs') && `${n('imgs')} image${n('imgs') === 1 ? '' : 's'} added`].filter(Boolean).join(', ') : '';
    const auto = n('auto') ? ` ${n('auto') === 1 ? 'A new entry was' : `${n('auto')} new entries were`} created for what you typed — marked “to complete” (see the links below and the Quality page).` : '';
    // the city of an exact location, set by itself (saveEntity → cityFor): found among ours, or created
    const city = req.query.city === '1' ? ` Its city was set from the location${n('places') ? ` — ${n('places')} new place${n('places') === 1 ? '' : 's'} created (OpenStreetMap / Wikidata, Natural Earth)` : ''}.` : '';
    flash = { kind: 'ok', text: DONE[req.query.done] + (extra ? ` (${extra})` : '') + auto + city };
  }
  res.status(status).type('html').send(String(layout({ title, body, user: req.user, flash, page })));
}

const when = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

// Banner on edit/new pages when this user has an unsaved draft (admin_drafts, written by the live connection).
function draftBanner({ draft, changed, restoreUrl, t, slug }) {
  if (!draft || !changed.length) return '';
  return html`<div class="flash draft">You have <b>unsaved changes</b> from ${when(draft.updated_at)} (${changed.join(', ')}).
    <span class="actions"><a class="button" href="${restoreUrl}">Restore them</a>
    <form method="post" action="/drafts/discard" class="inline"><input type="hidden" name="type" value="${t.type}">
      <input type="hidden" name="slug" value="${slug || ''}"><button class="secondary">Discard</button></form></span></div>`;
}

// Entry with a working copy that differs from what is published (live step 2).
// pending.fields: labels of the fields the working copy changes (unpublishedFields())
function unpublishedBanner(t, e, pending, onEditPage) {
  const who = pending.contributors.length ? pending.contributors.join(', ') : 'someone';
  const what = pending.fields && pending.fields.length ? html` in <b>${pending.fields.join(', ')}</b>` : '';
  return html`<div class="flash draft unpublished-banner"><b>Unpublished changes</b>${what} by ${who} (last ${when(pending.updated_at)}).
    ${onEditPage ? html`They are marked below — <b>Publish</b> makes them public.`
    : html`This page shows the published version. <a href="/${t.folder}/${e.slug}/edit">Open the working copy</a>`}</div>`;
}

// Which fields the shared working copy changes compared with the published entry (labels, in form order).
async function unpublishedFields(t, e) {
  const { form } = await collab.currentForm(t, e.id);
  const published = drafts.formKeys(e.doc, t, e.slug);
  const norm = (v) => String(v ?? '').replace(/\r\n/g, '\n').trim();
  const keys = Object.keys(published).filter((k) => k in form && norm(form[k]) !== norm(published[k]));
  return [...new Set(keys.map((k) => (k === 'slug' ? 'Slug' : fieldLabel(t.type, k.slice(2).replace(/_(lon|lat|label|lang|h|w|d)$/, '')))))];
}

function restoredBanner({ draft, rb, t, slug }) {
  return html`<div class="flash draft">Showing your <b>unsaved changes</b> from ${when(draft.updated_at)} — save to keep them.
    ${rb.stale ? html`<br>The entry was saved by someone else in the meantime — their changes are included${rb.merged.length
      ? html` (merged word by word in: ${rb.merged.join(', ')})` : ''}.` : ''}
    ${rb.conflicts.length ? html`<br><b>Check these fields</b> — both you and someone else changed them; your version is shown: ${rb.conflicts.join(', ')}.` : ''}
    <form method="post" action="/drafts/discard" class="inline"><input type="hidden" name="type" value="${t.type}">
      <input type="hidden" name="slug" value="${slug || ''}"><button class="link">Discard my changes</button></form></div>`;
}

// One transaction per save; set_config(…, true) is transaction-local, so the pooled connection forgets it at COMMIT.
async function withTx(user, fn, { source = 'admin' } = {}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', $2, true)",
      [String(user.id), source]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Postgres error → a sentence for the form. Constraint names come from the schema (e.g. places_slug_key).
class UserError extends Error {}
const RULES = {
  places_check: 'A place needs coordinates, an outline, or a boundary code (a country JP, a region JP-13).',
  places_check1: 'A place cannot be its own parent.',
  parent_cycle: 'That would make it part of itself (through its parents) — check "Part of" / "Parent".',
  artworks_parent_check: 'An artwork cannot be part of itself.',
  artworks_parts_count_check: 'Number of parts: a whole number above 0.',
  artworks_web_url_check: 'Web page: a link starting with https:// (or http://), without spaces.',
  movements_check: 'A movement cannot be its own parent.',
  artists_check: 'Death cannot be before birth.',
  relationships_check: 'An entity cannot be related to itself.',
  artworks_inventory_needs_institution: 'An inventory number belongs to a collection: set the institution (current holder) too, or leave the number empty.',
  artworks_loan_needs_institution: 'On loan: set the institution it is lent to (where it is now) — the owner goes into the provenance.',
  artworks_loan_since_needs_loan: '“On loan since” only for a work on loan — tick “on loan” or leave the date empty.',
  artwork_numbers_check: 'A number belongs either to an institution or to a catalogue — not both.',
  artwork_numbers_check1: 'Say whose number it is: an institution, a catalogue (source), or a note such as “Lugt”.',
  polities_country_codes_check: 'Country codes: two capital letters each (ISO 3166, e.g. CN, UA), one per line.',
  polities_check: 'A polity cannot be part of itself.',
  events_check: 'An event cannot be part of itself.',
  provenance_check: 'Provenance: one owner — an entry or a description, not both kinds of entry at once.',
  provenance_check1: 'Provenance: pick an owner or describe them.',
  provenance_check2: 'Provenance: the end lies before the acquisition.',
  artworks_dimensions_check: 'Dimensions: height alone, height × width, or height × width × depth.',
};
function friendly(err) {
  if (err instanceof UserError) return err.message;
  if (err.code === '23505') {
    if (/^images_\w+_url$/.test(err.constraint || '')) return 'This image is already one of the entry\'s images.';
    if (err.constraint === 'artworks_inventory_unique') return 'inventory_number: another artwork in this collection has this inventory number — the same object? (Merge… on its page)';
    if (err.constraint === 'places_boundary_unique') return 'boundary_code: another place has this outline already — the same place?';
    if (/_wikidata_id_key$/.test(err.constraint || '')) return 'wikidata_id: another entry is linked to this Wikidata item — the same thing?';
    if (err.constraint === 'entry_identifiers_unique') return `Reference record: ${err.detail || err.message} — another entry has this number (the same thing twice?).`;
    if (err.constraint === 'institution_number_unique') return `inventory_number: ${err.message} — the same object? (Merge… on its page)`;
    return /slug/.test(err.constraint || '') ? 'That slug is already taken.' : `Duplicate: ${err.detail || err.message}`;
  }
  if (err.constraint === 'places_boundary_code_fkey') return 'Unknown boundary code — use an ISO code like JP (a country) or JP-13 (a region).';
  if (err.code === '23503' || err.code === '23001') {
    const m = /referenced from table "(\w+)"/.exec(err.detail || '');
    if (m && m[1] === 'provenance') return 'Still named in the provenance of an artwork (as owner or place) — change those steps first.';
    return m ? `Still used by ${m[1]} (e.g. an artwork's creator or an institution's place) — change those first.` : `Still in use: ${err.detail || err.message}`;
  }
  if (err.code === '23514') return RULES[err.constraint] || `Not allowed by the rule "${err.constraint}".`;
  if (['22P02', '22007', '22008', 'XX000', '22023', 'P0001'].includes(err.code)) return err.message;
  throw err;  // unexpected → 500 handler
}

// ---------------------------------------------------------------------------------------------------------------
// History (audit_log) — shared by the dashboard, the global page and each entity
// ---------------------------------------------------------------------------------------------------------------
const HIDDEN_KEYS = ['id', 'created_at', 'updated_at', 'lifespan', 'web_url_accessed'];  // the last follows web_url (trigger, 039)

// `where` is SQL on alias a (audit_log) and r (the row as jsonb). Geography values are shown as WKT.
// A deleted entity's name comes from its last recorded version (its table: entity_table(), migration 019).
const GONE_NAME = `(SELECT coalesce(x.old_row->>'name', x.old_row->>'title') FROM audit_log x
  WHERE x.table_name = entity_table(($T)::entity_type) AND x.row_id = ($I)::bigint AND x.old_row IS NOT NULL ORDER BY x.id DESC LIMIT 1)`;
async function history(db, where, params, { limit = PAGE, offset = 0 } = {}) {
  const gone = (typeExpr, idExpr) => `coalesce(${GONE_NAME.replace('$T', () => typeExpr).replace('$I', () => idExpr)}, (${typeExpr}) || ' #' || (${idExpr}))`;
  const { rows } = await db.query(`
    SELECT a.id, a.changed_at, a.action, a.source, a.table_name, a.row_id, u.username,
           a.txid::text AS txid, a.reverts::text AS reverts, a.restores,
           (SELECT min(b.changed_at) FROM audit_log b WHERE b.reverts = a.txid) AS reverted_at,
           (SELECT count(*)::int FROM audit_log c WHERE c.txid = a.txid) AS tx_rows,
           CASE WHEN a.table_name = 'relationships'
             THEN concat_ws(' ', coalesce(s.name, ${gone("r->>'subject_type'", "r->>'subject_id'")}), '—',
                            rt.label, '→', coalesce(o.name, ${gone("r->>'object_type'", "r->>'object_id'")}))
             WHEN a.table_name = 'images'
             THEN concat_ws(' ', 'image of', coalesce(ie.name, ${gone('ix.type', 'ix.id')}), '“' || coalesce(r->>'caption', regexp_replace(r->>'url', '^.*/', '')) || '”')
             WHEN a.table_name = 'citations'
             THEN concat_ws(' ', 'source for', coalesce(r->>'field', 'a relationship'), coalesce('— Wikidata ' || (r->>'wikidata_item'), ''))
             WHEN a.table_name = 'artwork_numbers'
             THEN concat_ws(' ', 'number', r->>'number', 'of', coalesce(pa.name, ${gone("'artwork'", "r->>'artwork_id'")}))
             WHEN a.table_name = 'provenance'
             THEN concat_ws(' ', 'provenance of', coalesce(pa.name, ${gone("'artwork'", "r->>'artwork_id'")}), '—',
                            coalesce(po.name, r->>'owner_label', 'owner #' || px.id), nullif(r->>'acquired_label', ''))
             ELSE coalesce(r->>'name', r->>'title', r->>'slug') END AS what,
           CASE WHEN a.table_name = 'relationships' THEN s.type::text || 's/' || s.slug
                WHEN a.table_name = 'images' THEN ie.type::text || 's/' || ie.slug
                WHEN a.table_name IN ('provenance', 'artwork_numbers') THEN 'artworks/' || pa.slug
                WHEN a.action <> 'delete' THEN a.table_name || '/' || (r->>'slug') END AS link,
           (SELECT jsonb_object_agg(k, jsonb_build_array(
                     CASE WHEN k IN ('location', 'area') THEN to_jsonb(ST_AsText((a.old_row->>k)::geography)) ELSE a.old_row->k END,
                     CASE WHEN k IN ('location', 'area') THEN to_jsonb(ST_AsText((a.new_row->>k)::geography)) ELSE a.new_row->k END))
            FROM jsonb_object_keys(r) k
            WHERE (a.old_row->k) IS DISTINCT FROM (a.new_row->k) AND k <> ALL ($${params.length + 1}::text[])) AS diff
    FROM audit_log a
    CROSS JOIN LATERAL (SELECT coalesce(a.new_row, a.old_row) AS r) x
    LEFT JOIN admin_users u ON u.id = a.user_id
    LEFT JOIN relationship_types rt ON a.table_name = 'relationships' AND rt.code = r->>'relationship_type'
    -- an image row belongs to whichever of its foreign keys is set (migration 017); rows logged since 043 say it
    -- themselves (entity_type/entity_id), older ones are read from the keys (people had no images before 043)
    LEFT JOIN LATERAL (SELECT coalesce(r->>'entity_type', CASE WHEN r->>'artwork_id' IS NOT NULL THEN 'artwork' WHEN r->>'artist_id' IS NOT NULL THEN 'artist'
                                   WHEN r->>'glossary_id' IS NOT NULL THEN 'term' ELSE 'institution' END) AS type,
                              coalesce(r->>'entity_id', r->>'artwork_id', r->>'artist_id', r->>'institution_id', r->>'glossary_id') AS id) ix ON a.table_name = 'images'
    LEFT JOIN entity_index ie ON a.table_name = 'images' AND ie.type = ix.type::entity_type AND ie.id = ix.id::bigint
    -- a provenance step (031): its artwork, and its owner from whichever arm of the owner arc is set
    LEFT JOIN entity_index pa ON a.table_name IN ('provenance', 'artwork_numbers') AND pa.type = 'artwork' AND pa.id = (r->>'artwork_id')::bigint
    LEFT JOIN LATERAL (SELECT CASE WHEN r->>'owner_artist_id' IS NOT NULL THEN 'artist' WHEN r->>'owner_person_id' IS NOT NULL THEN 'person'
                                   WHEN r->>'owner_institution_id' IS NOT NULL THEN 'institution' ELSE 'place' END AS type,
                              coalesce(r->>'owner_artist_id', r->>'owner_person_id', r->>'owner_institution_id', r->>'owner_place_id') AS id) px
      ON a.table_name = 'provenance'
    LEFT JOIN entity_index po ON a.table_name = 'provenance' AND po.type = px.type::entity_type AND po.id = px.id::bigint
    LEFT JOIN entity_index s ON a.table_name = 'relationships' AND s.type = (r->>'subject_type')::entity_type AND s.id = (r->>'subject_id')::bigint
    LEFT JOIN entity_index o ON a.table_name = 'relationships' AND o.type = (r->>'object_type')::entity_type AND o.id = (r->>'object_id')::bigint
    WHERE ${where}
    ORDER BY a.id DESC
    LIMIT ${limit + 1} OFFSET ${offset}`, [...params, HIDDEN_KEYS]);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

const short = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

// restoreFor: { table, rowId } on an entity's history page — its insert/update rows get "restore this version".
function historyTable(rows, { showWhat = true, restoreFor = null } = {}) {
  if (!rows.length) return html`<p class="muted">No changes recorded yet.</p>`;
  const seenTx = new Set();  // "revert…" once per change set (a delete and its relationships share one txid)
  return html`<div class="table-wrap"><table class="diff"><thead><tr><th>When</th><th>Who</th>${showWhat ? html`<th>What</th>` : ''}<th>Changes</th><th></th></tr></thead><tbody>
  ${rows.map((h) => {
    const entries = Object.entries(h.diff || {}).filter(([, [o, n]]) => !(h.action !== 'update' && (o ?? n) === null));
    const firstOfTx = !seenTx.has(h.txid);
    seenTx.add(h.txid);
    const canRestore = restoreFor && h.table_name === restoreFor.table && h.row_id === restoreFor.rowId && h.action !== 'delete';
    return html`<tr>
      <td><span title="${h.changed_at.toISOString()}">${h.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</span>
        ${h.reverts ? html`<div><span class="tag">↩ revert</span></div>` : ''}${h.restores ? html`<div><span class="tag">↩ restore</span></div>` : ''}
        ${h.reverted_at ? html`<div class="muted small">reverted ${h.reverted_at.toISOString().slice(0, 10)}</div>` : ''}</td>
      <td>${h.username || html`<span class="muted">—</span>`} <span class="tag">${h.source}</span></td>
      ${showWhat ? html`<td><span class="tag">${h.action}</span> ${h.link ? html`<a href="/${h.link}">${h.what}</a>` : h.what}</td>` : ''}
      <td>${h.action === 'update' ? html`<table>${entries.map(([k, [o, n]]) => (isLongText(k, o, n)
          ? html`<tr><th>${k}</th><td colspan="2">${wordDiff(o, n)}</td></tr>`
          : html`<tr><th>${k}</th><td class="old">${short(o)}</td><td class="new">${short(n)}</td></tr>`))}</table>`
        : html`<span class="tag">${h.action}</span> <span class="muted">${entries.map(([k, [o, n]]) => `${k}: ${short(o ?? n)}`).join(' · ')}</span>`}</td>
      <td class="history-actions">${firstOfTx ? html`<a href="/revert/${h.txid}" title="Undo this save${h.tx_rows > 1 ? ` (${h.tx_rows} rows)` : ''}">revert…</a>` : ''}
        ${canRestore ? html`<a href="/restore/${h.id}" title="Make it look like right after this change">restore this version…</a>` : ''}</td>
    </tr>`;
  })}</tbody></table></div>`;
}

const pager = (base, page, more) => html`<div class="actions">
  ${page > 1 ? html`<a href="${base}${base.includes('?') ? '&' : '?'}page=${page - 1}">← newer</a>` : ''}
  ${more ? html`<a href="${base}${base.includes('?') ? '&' : '?'}page=${page + 1}">older →</a>` : ''}</div>`;

const pageParam = (req) => Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));

// ---------------------------------------------------------------------------------------------------------------
// Relationship forms — on the relationship's own page and on the entity pages
// ---------------------------------------------------------------------------------------------------------------
// Types that start from this entity type (it is the subject). With { reverse: true } also the ones that end at it,
// as "~code" with the inverse label ("commissioned by"), whose targets are the subject types — so a commission can
// be entered on the artwork's page. Saving a "~" type swaps subject and object: storage stays canonical.
// Symmetric types have no reverse entry (they already read both ways). Derived types (the creator, 029) are columns.
async function relationshipTypes(db, entityType, { reverse = false } = {}) {
  const { rows } = await db.query(`
    SELECT code, label, object_types::text[] AS object_types, false AS reverse, sort_order FROM relationship_types
    WHERE $1::entity_type = ANY (subject_types) AND NOT derived
    UNION ALL
    SELECT '~' || code, inverse_label, subject_types::text[], true, sort_order FROM relationship_types
    WHERE $2 AND $1::entity_type = ANY (object_types) AND NOT is_symmetric AND NOT derived
    ORDER BY reverse, sort_order`, [entityType, reverse]);
  return rows;
}

async function allEntities(db) {
  const { rows } = await db.query("SELECT type::text || '/' || slug AS ref, name, type::text AS type FROM entity_index ORDER BY name");
  return rows;
}

// Form body → validated params for INSERT/UPDATE relationships. Throws UserError.
// `entity` is the page the form is on; with a reverse ("~") type it becomes the object and the target the subject.
async function relFromForm(db, body, entity, keepMetadata = {}, { reverse = false } = {}) {
  const type = String(body.type || '');
  const types = await relationshipTypes(db, entity.type, { reverse });
  const rt = types.find((x) => x.code === type);
  if (!rt) throw new UserError(`"${type}" is not a relationship type for ${an(entity.type)}.`);
  const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(String(body.to || '').trim());
  if (!m) throw new UserError('Target must look like place/paris — pick one from the suggestions.');
  if (!rt.object_types.includes(m[1])) throw new UserError(`"${rt.label}" needs ${rt.object_types.map(an).join(' or ')} as target, not ${an(m[1])}.`);
  const targetId = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
  if (targetId === null) throw new UserError(`${m[0]} does not exist.`);
  const [subject, code, objectType, objectId] = rt.reverse
    ? [{ type: m[1], id: targetId }, type.slice(1), entity.type, entity.id]
    : [entity, type, m[1], targetId];
  let period = null;
  try { period = parseFuzzyDate(String(body.period || '').trim() || null, { openEnd: true }); } catch (err) { throw new UserError(`Period: ${err.message}`); }
  const opt = (k) => String(body[k] || '').replace(/\r\n/g, '\n').trim() || null;
  const sources = String(body.sources || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const { sources: _old, ...rest } = keepMetadata;
  const certainty = ['attested', 'probable', 'possible', 'disputed'].includes(body.certainty) ? body.certainty : 'attested';
  // the "Sources" lines are free-text citations now (050), not metadata: returned beside the column values
  return Object.assign([subject.type, subject.id, code, objectType, objectId, period && period.range,
    opt('period_label') ?? (period && period.label), opt('label'), certainty, opt('notes_md'), JSON.stringify(rest)], { sources });
}

function relForm({ action, types, entities, rel = {}, submit, entityType = 'entity' }) {
  const v = (k) => rel[k] ?? '';
  return html`<form method="post" action="${action}" class="form">
    <div class="row">
      <div class="field"><label for="r-type">Relationship</label>
        <select id="r-type" name="type" required>${[false, true].map((rev) => {
          const group = types.filter((t) => t.reverse === rev);
          const options = group.map((t) => html`<option value="${t.code}" data-object-types="${t.object_types.join(',')}"${t.code === rel.type ? ' selected' : ''}>${t.label} (${t.object_types.join(', ')})</option>`);
          return !group.length ? '' : types.some((t) => t.reverse) ? html`<optgroup label="${rev ? `Towards this ${entityType}` : `From this ${entityType}`}">${options}</optgroup>` : options;
        })}</select></div>
      <div class="field"><label for="r-to">Target</label>
        <input id="r-to" name="to" value="${v('to')}" list="r-to-list" required placeholder="start typing a name (typos are fine)" autocomplete="off" data-lookup-from="r-type">
        <datalist id="r-to-list">${entities.map((e) => html`<option value="${e.ref}">${e.name}</option>`)}</datalist></div>
    </div>
    <div class="row">
      <div class="field"><label for="r-period">Period</label><input id="r-period" name="period" value="${v('period')}" placeholder="date"></div>
      <div class="field"><label for="r-plabel">Period label</label><input id="r-plabel" name="period_label" value="${v('period_label')}" placeholder="optional, e.g. c. 1480"></div>
    </div>
    <div class="hint">${HINTS.period}</div>
    <div class="row">
      <div class="field"><label for="r-label">Label</label><input id="r-label" name="label" value="${v('label')}" placeholder="short qualifier, e.g. the Yellow House"></div>
      <div class="field"><label for="r-cert">Certainty</label><select id="r-cert" name="certainty">
        ${['attested', 'probable', 'possible', 'disputed'].map((c) => html`<option${c === (rel.certainty || 'attested') ? ' selected' : ''}>${c}</option>`)}</select></div>
    </div>
    <div class="field"><label for="r-notes">Notes</label><textarea class="md" id="r-notes" name="notes_md" rows="2">${v('notes_md')}</textarea><div class="hint">${HINTS.md}</div></div>
    <div class="field"><label for="r-src">Sources</label><textarea id="r-src" name="sources" rows="2">${(rel.sources || []).filter((s) => typeof s === 'string').join('\n')}</textarea><div class="hint">In words, one per line. Sources of the bibliography: the marker next to the relationship on the entry's page.</div></div>
    <div class="actions"><button>${submit}</button></div>
  </form>`;
}
// A Wikidata item of another kind than the entry's type (055): a warning, with the way to the right type — for a new
// entry its Wikidata page in the right type, for an existing one "Change type…".
const anOf = (x) => (/^[aeiou]/.test(x) ? `an ${x}` : `a ${x}`);
function typeWarning(t, types, qid, e) {
  const fit = types.filter((x) => BY_TYPE[x]);
  return html`<div class="flash warn type-warning"><b>Wikidata says this is ${fit.map(anOf).join(' or ')}, not ${anOf(t.type)}.</b>
    ${e ? html`If so: <a href="/${t.folder}/${e.slug}/convert?to=${fit[0]}">Change type…</a>`
      : html`Create it as ${fit.map((x, i) => html`${i ? ' or ' : ''}<a href="/${BY_TYPE[x].folder}/new/wikidata?q=${qid}">${anOf(x)}</a>`)} instead?`}</div>`;
}

// The types an entry can be changed into (convert_entry, migration 055)
const CONVERTIBLE = ['artist', 'person', 'institution', 'movement', 'place', 'polity', 'event', 'term'];
// a provenance step's form as posted → the values to show it again
const stepFromBody = (body) => ({ ...body, direct: body.direct === '1', sources: String(body.sources || '').split('\n') });

// ---------------------------------------------------------------------------------------------------------------
// Entries: the type from the address, not found, the form's context
// ---------------------------------------------------------------------------------------------------------------
// An old slug (migration 041) in an entry's address → the same page at its current slug; otherwise "Not found".
async function notFoundPage(req, res) {
  const t = req.t;
  if (req.method === 'GET' && t && req.params.slug && SLUG.test(req.params.slug)) {
    const moved = (await adminPool.query(`SELECT x.slug FROM slug_history h JOIN ${t.table} x ON x.id = h.entity_id
      WHERE h.entity_type = $1 AND h.old_slug = $2`, [t.type, req.params.slug])).rows[0];
    if (moved) return res.redirect(301, req.originalUrl.replace(`/${t.folder}/${req.params.slug}`, `/${t.folder}/${moved.slug}`));
    // moved to another type (055): /institutions/henry-clay-frick → /people/henry-clay-frick
    const other = (await adminPool.query(`SELECT m.new_type::text AS type, e.slug FROM entry_moves m
      JOIN entity_index e ON (e.type, e.id) = (m.new_type, m.new_id) WHERE m.old_type = $1 AND m.old_slug = $2`, [t.type, req.params.slug])).rows[0];
    if (other) return res.redirect(301, req.originalUrl.replace(`/${t.folder}/${req.params.slug}`, `/${BY_TYPE[other.type].folder}/${other.slug}`));
  }
  return notFoundPageNow(req, res);
}
function notFoundPageNow(req, res) {
  send(req, res, { title: 'Not found', status: 404, body: html`<h1>Not found</h1><p><a href="/">Dashboard</a></p>` });
}

// /:plural in a route → req.t (the entity type); an unknown one is not found. Each route file registers it.
function pluralParam(req, res, next, plural) {
  req.t = BY_FOLDER[plural];
  if (!req.t) return notFoundPage(req, res);
  next();
}

// Everything a form needs from the database: enum choices, suggestions from existing values, ref targets;
// for an existing artwork (id) also its co-creators, named under the creator field.
async function formContext(t, id = null) {
  const enumRows = (await adminPool.query(`
    SELECT a.attname, a.attnotnull, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS vals
    FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
    WHERE a.attrelid = $1::regclass GROUP BY a.attname, a.attnotnull`, [t.table])).rows;
  const enums = Object.fromEntries(enumRows.map((r) => [r.attname, r.vals]));
  // a column that may be empty gets an empty choice — else the menu always sends its first value (052's title_status)
  const enumsNullable = new Set(enumRows.filter((r) => !r.attnotnull).map((r) => r.attname));
  const suggestions = {};
  for (const key of ['kind', 'medium']) {
    if (t.fields[key] === 'text' && !enums[key]) {
      suggestions[key] = (await adminPool.query(`SELECT DISTINCT ${key} AS v FROM ${t.table} WHERE ${key} IS NOT NULL ORDER BY 1`)).rows.map((r) => r.v);
    }
  }
  // object types of immovable works, offered even before they are used (migration 034)
  if (t.type === 'artwork') {
    suggestions.kind = [...new Set([...suggestions.kind, 'building', 'garden', 'park', 'bridge', 'temple hall', 'shrine', 'pagoda', 'gate',
      'monument', 'tower', 'mural', 'series', 'album', 'diptych', 'triptych', 'polyptych', 'altarpiece', 'set'])].sort();
  }
  // kinds of events, offered before they are used (migration 047)
  if (t.type === 'event') {
    suggestions.kind = [...new Set([...suggestions.kind, 'fire', 'earthquake', 'flood', 'war', 'battle', 'siege', 'revolution', 'trial',
      'exhibition', 'auction', 'sale', 'theft', 'restitution', 'festival', 'ceremony', 'coronation', 'founding', 'treaty', 'journey'])].sort();
  }
  // lists whose terms should repeat exactly (the API filters by them): show what is already in use
  const used = {};
  for (const key of ['materials', 'occupations']) {
    if (t.fields[key] === 'text[]') used[key] = (await adminPool.query(`SELECT DISTINCT unnest(${key}) AS v FROM ${t.table} ORDER BY 1 LIMIT 200`)).rows.map((r) => r.v);
  }
  const refs = {};
  for (const [key, kind] of Object.entries(t.fields)) {
    const target = kind === 'parent' ? t : kind.startsWith('ref:') ? BY_TYPE[kind.slice(4)] : null;
    if (target) refs[key] = (await adminPool.query(`SELECT slug, ${target.name} AS name FROM ${target.table} ORDER BY 2`)).rows;
  }
  const coCreators = t.type === 'artwork' && id !== null ? (await adminPool.query(`
    SELECT a.name, r.label FROM relationships r JOIN artists a ON a.id = r.object_id
    WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.subject_id = $1 ORDER BY a.name`, [id])).rows : [];
  return { enums, enumsNullable, suggestions, refs, used, coCreators, errorKeys: new Set(), confirmNew: {} };
}

async function findEntity(t, slug) {
  if (!SLUG.test(slug)) return null;
  const e = (await readDocs(adminPool, t, 't.slug = $1', [slug]))[0];
  return e ? { ...e, name: names.plain(e.doc[t.name]) } : null;  // e.name: plain text (the doc keeps the furigana markup)
}

module.exports = {
  PAGE,
  an,
  DONE,
  send,
  when,
  draftBanner,
  unpublishedBanner,
  unpublishedFields,
  restoredBanner,
  withTx,
  UserError,
  RULES,
  friendly,
  HIDDEN_KEYS,
  GONE_NAME,
  history,
  short,
  historyTable,
  pager,
  pageParam,
  relationshipTypes,
  allEntities,
  relFromForm,
  relForm,
  anOf,
  typeWarning,
  CONVERTIBLE,
  stepFromBody,
  notFoundPage,
  notFoundPageNow,
  pluralParam,
  formContext,
  findEntity,
  pluralParam,
};
