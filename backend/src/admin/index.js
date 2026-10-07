// Admin panel (admin.arthistory.piogino.ch/…): server-rendered pages, forms generated from src/content.js.
// Writes go through arthistory_admin in a transaction tagged with the user, so the audit_log trigger records who.
//
//   /                          dashboard: counts + recent changes
//   /<plural>                  list + search            /<plural>/new        create
//   /<plural>/<slug>           view + relationships     /<plural>/<slug>/edit · /delete · /history
//   /relationships/<id>/edit   edit one relationship    /history             all changes
//   /images/<id>/edit          edit one image           (images are added and reordered on the entry's page)
const express = require('express');
const path = require('path');
const config = require('../config');
const { adminPool } = require('../db');
const { TYPES, BY_FOLDER, BY_TYPE, SLUG, REF_COLUMNS, toRow, readDocs, readRelationships, readImages } = require('../content');
const autocreate = require('./autocreate');
const names = require('../names');
const dimensionsLib = require('../dimensions');
const { parseFuzzyDate } = require('../fuzzy-date');
const { renderMarkdown, linkNames } = require('../markdown');
const { html, raw, layout } = require('./html');
const { login, logout, loadUser, checkOrigin } = require('./auth');
const { search, resultsPage, lookup } = require('./search');
const { planChangeSet, planVersion, execute, fingerprint, revertedBy, unconfirmed } = require('./revert');
const { planPage } = require('./revert-ui');
const { wordDiff, isLongText } = require('./textdiff');
const drafts = require('./drafts');
const wikidata = require('./wikidata');
const quality = require('./quality');
const images = require('./images');
const provenance = require('./provenance');
const imagesearch = require('./imagesearch');
const placefinder = require('./placefinder');
const bibliography = require('../bibliography');

const { thumbUrl } = images;
const { searchPage, reviewPage } = require('./wikidata-ui');
const collab = require('./collab');
const { THRESHOLD, likeParam, scoreSql, altSql } = require('./match');
const { docToForm, formToDoc, entityForm, humanize, fieldLabel, HINTS } = require('./forms');

const router = express.Router();
const PAGE = 50;
const an = (word) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

// Development serves its own bundles first (npm run build:admin:dev → static-dev/): this checkout is also production,
// and a dev build must never replace the bundles the live site serves from static/.
if (config.env !== 'production') router.use('/static', express.static(path.join(__dirname, 'static-dev'), { index: false }));
router.use('/static', express.static(path.join(__dirname, 'static'), { index: false, maxAge: '1h' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(express.urlencoded({ extended: false, limit: '1mb' }));
router.use(checkOrigin);
router.use(loadUser);

// Fixed messages for ?done=… after a redirect (never reflect arbitrary text).
const DONE = {
  created: 'Created.', saved: 'Saved.', deleted: 'Deleted.', unchanged: 'No changes.',
  wikidata: 'Wikidata values applied — the field values are in the working copy: check them below and Publish.',
  published: 'Published — the working copy is now the public version.',
  discarded: 'Unpublished changes discarded — the working copy is back to the published version.',
  reverted: 'Change reverted — the revert itself is in the history and can be reverted too.',
  restored: 'Version restored.',
  'rel-added': 'Relationship added.', 'rel-saved': 'Relationship saved.', 'rel-deleted': 'Relationship deleted.',
  'auto-done': 'Marked as complete.',
  'img-added': 'Image added.', 'img-saved': 'Image saved.', 'img-deleted': 'Image removed.', 'img-moved': 'Order changed.',
  'prov-added': 'Provenance step added.', 'prov-saved': 'Provenance step saved.', 'prov-deleted': 'Provenance step removed.', 'prov-moved': 'Order changed.',
};

function send(req, res, { title, body, status = 200, flash, page = null }) {
  if (!flash && DONE[req.query.done]) {
    // Numbers only from the URL — never reflect free text.
    const n = (k) => Math.max(0, Number.parseInt(req.query[k], 10) || 0);
    const extra = req.query.done === 'wikidata' ? [n('rels') && `${n('rels')} relationship${n('rels') === 1 ? '' : 's'} added`,
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
  polities_country_codes_check: 'Country codes: two capital letters each (ISO 3166, e.g. CN, UA), one per line.',
  polities_check: 'A polity cannot be part of itself.',
  provenance_check: 'Provenance: one owner — an entry or a description, not both kinds of entry at once.',
  provenance_check1: 'Provenance: pick an owner or describe them.',
  provenance_check2: 'Provenance: the end lies before the acquisition.',
  artworks_dimensions_check: 'Dimensions: height alone, height × width, or height × width × depth.',
};
function friendly(err) {
  if (err instanceof UserError) return err.message;
  if (err.code === '23505') {
    if (/^images_\w+_url$/.test(err.constraint || '')) return 'This image is already one of the entry\'s images.';
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
// Login
// ---------------------------------------------------------------------------------------------------------------
const loginPage = (error) => html`<div class="login"><h1>Art history admin</h1>
  ${error ? html`<p class="flash error">${error}</p>` : ''}
  <form method="post" action="/login" class="form">
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <div class="actions"><button>Log in</button></div>
  </form></div>`;

router.get('/login', (req, res) => (req.user ? res.redirect('/') : send(req, res, { title: 'Log in', body: loginPage() })));

router.post('/login', async (req, res) => {
  const result = await login(req, res, req.body.username, req.body.password);
  if (result.error) return send(req, res, { title: 'Log in', body: loginPage(result.error), status: 401 });
  res.redirect(303, '/');
});

router.post('/logout', async (req, res) => {
  await logout(req, res);
  res.redirect(303, '/login');
});

// Everything below needs a logged-in user.
router.use((req, res, next) => {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/login');
  res.status(401).type('text').send('Not logged in.');
});

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
             WHEN a.table_name = 'provenance'
             THEN concat_ws(' ', 'provenance of', coalesce(pa.name, ${gone("'artwork'", "r->>'artwork_id'")}), '—',
                            coalesce(po.name, r->>'owner_label', 'owner #' || px.id), nullif(r->>'acquired_label', ''))
             ELSE coalesce(r->>'name', r->>'title', r->>'slug') END AS what,
           CASE WHEN a.table_name = 'relationships' THEN s.type::text || 's/' || s.slug
                WHEN a.table_name = 'images' THEN ie.type::text || 's/' || ie.slug
                WHEN a.table_name = 'provenance' THEN 'artworks/' || pa.slug
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
    -- an image row belongs to whichever of its three foreign keys is set (migration 017)
    LEFT JOIN LATERAL (SELECT CASE WHEN r->>'artwork_id' IS NOT NULL THEN 'artwork' WHEN r->>'artist_id' IS NOT NULL THEN 'artist'
                                   WHEN r->>'glossary_id' IS NOT NULL THEN 'term' ELSE 'institution' END AS type,
                              coalesce(r->>'artwork_id', r->>'artist_id', r->>'institution_id', r->>'glossary_id') AS id) ix ON a.table_name = 'images'
    LEFT JOIN entity_index ie ON a.table_name = 'images' AND ie.type = ix.type::entity_type AND ie.id = ix.id::bigint
    -- a provenance step (031): its artwork, and its owner from whichever arm of the owner arc is set
    LEFT JOIN entity_index pa ON a.table_name = 'provenance' AND pa.type = 'artwork' AND pa.id = (r->>'artwork_id')::bigint
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
// Revert a change set / restore a version (src/admin/revert.js, revert-ui.js)
// ---------------------------------------------------------------------------------------------------------------
// One transaction per request: plan → fingerprint → execute every step (with savepoints) → COMMIT only when "Apply"
// was pressed, the state is unchanged since the preview, everything is confirmed and nothing failed; otherwise
// ROLLBACK — which makes the same code the dry run. The markers make the audit trigger record what was undone.
async function runPlan(req, res, kind, id) {
  const choices = req.method === 'POST' ? req.body : {};
  const submitted = choices.submitted === '1';
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', $2, true),
                               set_config('arthistory.reverts', $3, true), set_config('arthistory.restores', $4, true)`,
    [String(req.user.id), kind, kind === 'revert' ? id : '', kind === 'restore' ? id : '']);
    const plan = kind === 'revert' ? await planChangeSet(client, id, choices, submitted) : await planVersion(client, id, choices, submitted);
    if (!plan || !plan.items.length) {
      await client.query('ROLLBACK');
      return notFoundPage(req, res);
    }
    const fp = await fingerprint(client, plan.items);
    const problems = [];
    let apply = choices.do === 'apply';
    if (apply && choices.fingerprint !== fp) {
      problems.push('Something changed since this preview was shown. The plan below is up to date — please check it again.');
      apply = false;
    }
    if (apply && unconfirmed(plan.items).length) {
      problems.push('Some steps need your confirmation (see below) — confirm them or untick them.');
      apply = false;
    }
    const raw = await execute(client, plan.items);
    const results = Object.fromEntries(Object.entries(raw).map(([k, r]) => {
      let message = null;
      if (!r.ok) { try { message = friendly(r.error); } catch { message = r.error.message; } }
      return [k, { ok: r.ok, message }];
    }));
    const active = plan.items.filter((i) => i.include && i.op !== 'none' && !i.blocked);
    if (apply && active.length && Object.values(results).every((r) => r.ok)) {
      await client.query('COMMIT');
      // Entries changed here may have open working copies (live step 2): rebase them, or close them if deleted.
      for (const item of plan.items.filter((i) => BY_FOLDER[i.table] && i.include && i.op !== 'none' && !i.blocked)) {
        const tt = BY_FOLDER[item.table];
        if (item.op === 'delete') await collab.gone(tt, item.rowId); else await collab.changedElsewhere(tt, item.rowId);
      }
      if (kind === 'restore') {
        const [item] = plan.items;
        const { rows } = await adminPool.query(`SELECT slug FROM ${item.table} WHERE id = $1`, [item.rowId]);
        return res.redirect(303, rows[0] ? `/${item.table}/${rows[0].slug}?done=restored` : '/history?done=restored');
      }
      return res.redirect(303, '/history?done=reverted');
    }
    // Geography values are stored as hex in the audit log — show them as WKT.
    const hex = [...new Set(plan.items.flatMap((i) => i.fields).filter((f) => ['location', 'area'].includes(f.name))
      .flatMap((f) => [f.before, f.after, f.now]).filter((v) => typeof v === 'string'))];
    const geo = hex.length ? Object.fromEntries((await client.query(
      'SELECT h, ST_AsText(h::geography) AS wkt FROM unnest($1::text[]) h', [hex])).rows.map((r) => [r.h, r.wkt])) : {};
    await client.query('ROLLBACK');

    let intro;
    if (kind === 'revert') {
      const first = plan.entries[0];
      const done = await revertedBy(adminPool, id);
      intro = html`<p>Undo what one save did on <b>${first.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</b>
        by ${first.username || 'an unknown user'} <span class="tag">${first.source}</span>. Fields changed later are kept unless you choose otherwise.</p>
        ${done.length ? html`<p class="flash ok">Already reverted on ${done.map((d) => d.at.toISOString().slice(0, 16).replace('T', ' ')).join(', ')} — steps that are already undone show as “nothing to do”.</p>` : ''}`;
    } else {
      const e = plan.entry;
      intro = html`<p>Bring <b>${plan.items[0].label}</b> back to how it was right after the change of
        <b>${e.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</b> (${e.username || 'unknown user'}). Untick fields to leave them as they are now.
        Relationships are not touched — revert their changes individually.</p>`;
    }
    send(req, res, {
      title: kind === 'revert' ? 'Revert a change' : 'Restore a version',
      body: planPage({ title: kind === 'revert' ? 'Revert a change' : 'Restore a version', intro, action: `/${kind}/${id}`,
        items: plan.items, results, fingerprint: fp, problems, geo, version: kind === 'restore' }),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.get('/revert/:txid', (req, res, next) => (/^\d+$/.test(req.params.txid) ? runPlan(req, res, 'revert', req.params.txid) : next()));
router.post('/revert/:txid', (req, res, next) => (/^\d+$/.test(req.params.txid) ? runPlan(req, res, 'revert', req.params.txid) : next()));
router.get('/restore/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? runPlan(req, res, 'restore', req.params.id) : next()));
router.post('/restore/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? runPlan(req, res, 'restore', req.params.id) : next()));

// ---------------------------------------------------------------------------------------------------------------
// Dashboard + global history
// ---------------------------------------------------------------------------------------------------------------
// Markdown preview for the editor (src/admin/editor): exactly what the public API will serve for this text.
router.post('/preview', async (req, res) => {
  const text = String(req.body.text || '').slice(0, 100000);
  res.type('html').send(renderMarkdown(text, { names: await linkNames(adminPool, [text]) }) || '');
});

// Place search for the map picker (src/admin/editor/map.js), proxied to OpenStreetMap's Nominatim so the browser
// needs no extra CSP exception and we can send the identifying User-Agent its usage policy asks for
// (https://operations.osmfoundation.org/policies/nominatim/: max 1 request/s, searches only on explicit submit).
// polygon_geojson + polygon_threshold: the boundary of regions/cities, simplified to ~500 m, as an area suggestion.
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json([]);
  try {
    const hits = await placefinder.nominatim({ q, limit: '5', polygon_geojson: '1', polygon_threshold: '0.005' });
    res.json(hits.map((h) => ({
      name: h.display_name, lat: Number(h.lat), lon: Number(h.lon),
      bbox: h.boundingbox ? h.boundingbox.map(Number) : null,  // [south, north, west, east]
      geojson: h.geojson && /Polygon$/.test(h.geojson.type) ? h.geojson : null,
    })));
  } catch (err) {
    console.warn(`geocode failed: ${err.message}`);
    res.status(502).json({ error: 'search unavailable' });
  }
});

router.get('/', async (req, res) => {
  const counts = Object.fromEntries((await adminPool.query(
    'SELECT type::text, count(*)::int AS n FROM entity_index GROUP BY type')).rows.map((r) => [r.type, r.n]));
  const rels = (await adminPool.query('SELECT count(*)::int AS n FROM relationships')).rows[0].n;
  const recent = await history(adminPool, 'true', [], { limit: 15 });
  const qaCounts = await quality.counts(adminPool);
  const qaTotal = (s) => qaCounts.filter((c) => c.severity === s).reduce((n, c) => n + c.n, 0);
  const unpublishedRows = (await adminPool.query(`
    SELECT d.entity_type::text AS type, e.slug, e.name, d.contributors, d.updated_at FROM live_docs d
    JOIN entity_index e ON e.type = d.entity_type AND e.id = d.entity_id
    WHERE d.dirty ORDER BY d.updated_at DESC LIMIT 30`)).rows;
  const myDrafts = (await adminPool.query(`
    SELECT d.entity_type::text AS type, d.updated_at, e.slug, e.name FROM admin_drafts d
    LEFT JOIN entity_index e ON e.type = d.entity_type AND e.id = d.entity_id
    WHERE d.user_id = $1 AND d.entity_id IS NULL ORDER BY d.updated_at DESC`, [req.user.id])).rows;
  send(req, res, {
    title: 'Dashboard',
    body: html`<h1>Dashboard</h1>
      ${unpublishedRows.length ? html`<div class="flash draft"><b>Unpublished changes:</b> ${unpublishedRows.map((d, i) => html`${i ? ' · ' : ''}<a href="/${BY_TYPE[d.type].folder}/${d.slug}/edit">${d.name}</a>
        <span class="muted small">${d.contributors.join(', ')} · ${when(d.updated_at)}</span>`)}</div>` : ''}
      ${myDrafts.length ? html`<div class="flash draft"><b>Your unsaved drafts:</b> ${myDrafts.map((d, i) => html`${i ? ' · ' : ''}<a href="/${BY_TYPE[d.type].folder}/${d.slug ? `${d.slug}/edit` : 'new'}?draft=1">${d.name || `new ${d.type}`}</a>
        <span class="muted small">${when(d.updated_at)}</span>`)}</div>` : ''}
      <div class="cards">${TYPES.map((t) => html`<a class="card" href="/${t.folder}"><b>${counts[t.type] || 0}</b>${humanize(t.folder)}</a>`)}
        <div class="card"><b>${rels}</b>Relationships</div>
        <a class="card qa-card" href="/quality"><b>${qaTotal('error')} · ${qaTotal('warning')}</b>Quality: errors · warnings</a></div>
      <h2>Recent changes</h2>${historyTable(recent.rows)}
      <p><a href="/history">All changes →</a></p>`,
  });
});

// Search across all entity types and relationships (src/admin/search.js).
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  const results = q ? await search(adminPool, q) : { entities: [], relationships: [] };
  send(req, res, { title: q ? `Search: ${q}` : 'Search', body: resultsPage(q, results) });
});

// Suggestions for the pickers in forms (src/admin/editor/autocomplete.js): ?q=…&types=place,artist
router.get('/lookup', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const types = String(req.query.types || '').split(',').filter((x) => BY_TYPE[x]);
  if (!q || !types.length) return res.json([]);
  res.json(await lookup(adminPool, q, types));
});

// Data quality (view quality_issues, migration 013; src/admin/quality.js)
router.get('/quality', async (req, res) => {
  const filter = {
    severity: quality.SEVERITIES.includes(req.query.severity) ? req.query.severity : '',
    check: quality.CHECKS[req.query.check] ? req.query.check : '',
    type: BY_TYPE[req.query.type] ? req.query.type : '',
    acked: req.query.acked === '1' ? '1' : '',
  };
  const [rows, allCounts] = await Promise.all([
    quality.issues(adminPool, { severity: filter.severity, check: filter.check, type: filter.type, acked: !!filter.acked }),
    quality.counts(adminPool)]);
  send(req, res, { title: 'Data quality', body: quality.page({ rows, allCounts, filter, back: req.originalUrl }) });
});

// "Mark as OK" / undo — back to where it was clicked (only local paths).
const backTo = (b) => (typeof b === 'string' && /^\/[a-z0-9/_?=&.%-]*$/i.test(b) && !b.startsWith('//') ? b : '/quality');
router.post('/quality/ack', async (req, res) => {
  await quality.ack(adminPool, req.body, req.user.id);
  res.redirect(303, backTo(req.body.back));
});
router.post('/quality/unack', async (req, res) => {
  await quality.unack(adminPool, req.body);
  res.redirect(303, backTo(req.body.back));
});

router.get('/history', async (req, res) => {
  const page = pageParam(req);
  const h = await history(adminPool, 'true', [], { offset: (page - 1) * PAGE });
  send(req, res, { title: 'History', body: html`<h1>History</h1>${historyTable(h.rows)}${pager('/history', page, h.more)}` });
});

// ---------------------------------------------------------------------------------------------------------------
// Relationships (declared on the subject's page)
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
  return [subject.type, subject.id, code, objectType, objectId, period && period.range,
    opt('period_label') ?? (period && period.label), opt('label'), certainty, opt('notes_md'),
    JSON.stringify(sources.length ? { ...rest, sources } : rest)];
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
    <div class="field"><label for="r-src">Sources</label><textarea id="r-src" name="sources" rows="2">${(rel.sources || []).join('\n')}</textarea><div class="hint">One per line.</div></div>
    <div class="actions"><button>${submit}</button></div>
  </form>`;
}

router.get('/relationships/:id/edit', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  const [types, entities] = await Promise.all([relationshipTypes(adminPool, found.subject.type), allEntities(adminPool)]);
  send(req, res, {
    title: 'Edit relationship',
    body: html`<h1>Edit relationship</h1><p><a href="${found.subjectUrl}">← ${found.subject.name}</a></p>
      ${relForm({ action: `/relationships/${found.id}`, types, entities, rel: found.rel, submit: 'Save' })}
      <form method="post" action="/relationships/${found.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Delete this relationship</button></form>`,
  });
});

async function relationshipById(db, id) {
  if (!/^\d+$/.test(id)) return null;
  const { rows } = await db.query(`
    SELECT r.id, r.metadata, s.type::text AS type, s.id AS subject_id, s.slug, s.name
    FROM relationships r JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id WHERE r.id = $1`, [id]);
  if (!rows.length) return null;
  const x = rows[0];
  const rel = (await readRelationships(db, x.type, x.subject_id)).find((r) => r.id === x.id).rel;
  return { id: x.id, metadata: x.metadata, rel, subject: { type: x.type, id: x.subject_id, name: x.name },
    subjectUrl: `/${BY_TYPE[x.type].folder}/${x.slug}` };
}

router.post('/relationships/:id', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const p = await relFromForm(db, req.body, found.subject, found.metadata);
      await db.query(`UPDATE relationships SET relationship_type = $3, object_type = $4, object_id = $5, period = $6::daterange,
        period_label = $7, label = $8, certainty = $9, notes_md = $10, metadata = $11::jsonb
        WHERE id = $12 AND subject_type = $1 AND subject_id = $2`, [...p, found.id]);
    });
  } catch (err) {
    const [types, entities] = await Promise.all([relationshipTypes(adminPool, found.subject.type), allEntities(adminPool)]);
    return send(req, res, {
      title: 'Edit relationship', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Edit relationship</h1><p><a href="${found.subjectUrl}">← ${found.subject.name}</a></p>
        ${relForm({ action: `/relationships/${found.id}`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Save' })}`,
    });
  }
  res.redirect(303, `${found.subjectUrl}?done=rel-saved#relationships`);
});

router.post('/relationships/:id/delete', async (req, res) => {
  const found = await relationshipById(adminPool, req.params.id);
  if (!found) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM relationships WHERE id = $1', [found.id]));
  res.redirect(303, `${found.subjectUrl}?done=rel-deleted#relationships`);
});

function imageEditPage(req, res, img, { status = 200, flash, values = img } = {}) {
  return images.licenses(adminPool).then((licenseList) => send(req, res, {
    title: 'Edit image', status, flash,
    body: html`<h1>Edit image</h1><p><a href="${img.entityUrl}#images">← ${img.name}</a></p>
      <p><img class="image-edit-preview" src="${thumbUrl(img.url, 250)}" alt=""></p>
      ${images.form({ action: `/images/${img.id}`, img: values, submit: 'Save', licenseList })}
      <form method="post" action="/images/${img.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Remove this image</button></form>`,
  }));
}

router.get('/images/:id/edit', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  return imageEditPage(req, res, img);
});

router.post('/images/:id', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  try {
    const values = images.fromForm(req.body);
    await withTx(req.user, (db) => images.update(db, img.id, values));
  } catch (err) {
    return imageEditPage(req, res, img, { status: 422, values: req.body,
      flash: { kind: 'error', text: err instanceof images.ImageError ? err.message : friendly(err) } });
  }
  res.redirect(303, `${img.entityUrl}?done=img-saved#images`);
});

router.post('/images/:id/delete', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM images WHERE id = $1', [img.id]));
  res.redirect(303, `${img.entityUrl}?done=img-deleted#images`);
});

router.post('/images/:id/move', async (req, res) => {
  const img = await images.byId(adminPool, req.params.id);
  if (!img) return notFoundPage(req, res);
  if (['up', 'down', 'first'].includes(req.body.dir)) await withTx(req.user, (db) => images.move(db, img, req.body.dir));
  res.redirect(303, `${img.entityUrl}?done=img-moved#images`);
});

// Provenance steps: added on the artwork's page, edited / removed / reordered under /provenance/<id> (src/admin/provenance.js).
function provenanceEditPage(req, res, step, { status = 200, flash, values = provenance.formValues(step) } = {}) {
  send(req, res, {
    title: 'Edit provenance step', status, flash,
    body: html`<h1>Edit provenance step</h1><p><a href="${step.artworkUrl}#provenance">← ${step.artwork_title}</a></p>
      ${provenance.form({ action: `/provenance/${step.id}`, step: values, submit: 'Save' })}
      <form method="post" action="/provenance/${step.id}/delete" class="actions" style="margin-top:1.5rem">
        <button class="danger">Remove this step</button></form>`,
  });
}
const stepFromBody = (body) => ({ ...body, direct: body.direct === '1', sources: String(body.sources || '').split('\n') });

router.get('/provenance/:id/edit', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  provenanceEditPage(req, res, step);
});

router.post('/provenance/:id', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => provenance.update(db, step.id, await provenance.fromForm(db, req.body, step.metadata)));
  } catch (err) {
    return provenanceEditPage(req, res, step, { status: 422, values: stepFromBody(req.body),
      flash: { kind: 'error', text: err instanceof provenance.ProvenanceError ? err.message : friendly(err) } });
  }
  res.redirect(303, `${step.artworkUrl}?done=prov-saved#provenance`);
});

router.post('/provenance/:id/delete', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  await withTx(req.user, (db) => provenance.remove(db, step));
  res.redirect(303, `${step.artworkUrl}?done=prov-deleted#provenance`);
});

router.post('/provenance/:id/move', async (req, res) => {
  const step = await provenance.byId(adminPool, req.params.id);
  if (!step) return notFoundPage(req, res);
  if (['up', 'down'].includes(req.body.dir)) await withTx(req.user, (db) => provenance.move(db, step, req.body.dir));
  res.redirect(303, `${step.artworkUrl}?done=prov-moved#provenance`);
});

// ---------------------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------------------
function notFoundPage(req, res) {
  send(req, res, { title: 'Not found', status: 404, body: html`<h1>Not found</h1><p><a href="/">Dashboard</a></p>` });
}

// Patrons became people (migration 024): old admin links keep working.
router.get(/^\/patrons(\/.*)?$/, (req, res) => res.redirect(301, req.originalUrl.replace(/^\/patrons/, '/people')));

router.param('plural', (req, res, next, plural) => {
  req.t = BY_FOLDER[plural];
  if (!req.t) return notFoundPage(req, res);
  next();
});

// Everything a form needs from the database: enum choices, suggestions from existing values, ref targets;
// for an existing artwork (id) also its co-creators, named under the creator field.
async function formContext(t, id = null) {
  const enums = Object.fromEntries((await adminPool.query(`
    SELECT a.attname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS vals
    FROM pg_attribute a JOIN pg_enum e ON e.enumtypid = a.atttypid
    WHERE a.attrelid = $1::regclass GROUP BY a.attname`, [t.table])).rows.map((r) => [r.attname, r.vals]));
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
  return { enums, suggestions, refs, used, coCreators, errorKeys: new Set(), confirmNew: {} };
}

async function findEntity(t, slug) {
  if (!SLUG.test(slug)) return null;
  const e = (await readDocs(adminPool, t, 't.slug = $1', [slug]))[0];
  return e ? { ...e, name: names.plain(e.doc[t.name]) } : null;  // e.name: plain text (the doc keeps the furigana markup)
}

router.get('/:plural', async (req, res) => {
  const { t } = req;
  const q = String(req.query.q || '').trim();
  const page = pageParam(req);
  // With a query: typo-tolerant match on name, alternative names and slug, best first (src/admin/match.js).
  const params = q ? [q, likeParam(q)] : [];
  const score = q ? `greatest(${scoreSql(`t.${t.name}`, altSql(t, 't'))}, CASE WHEN t.slug ILIKE '%' || $2 || '%' THEN 1.0 ELSE 0 END)` : 'NULL';
  const { rows } = await adminPool.query(`
    SELECT * FROM (
      SELECT t.slug, t.${t.name} AS name, t.updated_at, ${altSql(t, 't') || 'NULL'} AS alt, ${score} AS score,
             name_sort_key(t.${t.name}, t.${t.name}_ruby, t.names) AS sort_key,
             ${t.imageFk ? `(SELECT i.url FROM images i WHERE i.${t.imageFk} = t.id ORDER BY i.position, i.id LIMIT 1)` : 'NULL'} AS image_url,
             EXISTS (SELECT 1 FROM auto_created ac WHERE ac.entity_type = $${params.length + 1}::entity_type AND ac.entity_id = t.id) AS to_complete,
             ${t.type === 'source' ? 't.reading_status::text' : 'NULL'} AS status,
             (SELECT count(*)::int FROM relationships r WHERE (r.subject_type, r.subject_id) = ($${params.length + 1}::entity_type, t.id)
                                                           OR (r.object_type, r.object_id) = ($${params.length + 1}::entity_type, t.id)) AS rels
      FROM ${t.table} t) x
    ${q ? `WHERE score >= ${THRESHOLD} ORDER BY score DESC, sort_key` : 'ORDER BY lower(f_unaccent(sort_key))'}
    LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`, [...params, t.type]);
  // the bibliography: short references and how much has been read
  const sources = t.type === 'source' ? await bibliography.loadCatalogue(adminPool) : null;
  const stats = sources ? (await adminPool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE reading_status = 'read')::int AS read, count(*) FILTER (WHERE reading_status = 'reading')::int AS reading,
      count(*) FILTER (WHERE reading_status = 'to_read')::int AS to_read FROM bibliography`)).rows[0] : null;
  send(req, res, {
    title: humanize(t.folder),
    body: html`<h1>${humanize(t.folder)}</h1>
      ${stats ? html`<p class="muted">${stats.total} sources — <b>${stats.read}</b> read · ${stats.reading} reading · ${stats.to_read} to read</p>` : ''}
      <form class="bar" method="get"><input name="q" value="${q}" placeholder="Search name, other names or slug (typos are fine)" class="grow" type="search">
        <button class="secondary">Search</button><a class="button" href="/${t.folder}/new">+ New ${t.type}</a>
        <a class="button secondary" href="/${t.folder}/new/wikidata">+ from Wikidata…</a>
        ${t.type === 'place' ? html`<a class="button secondary" href="/places/new/find">+ find a place…</a>` : ''}</form>
      ${rows.length ? html`<div class="table-wrap"><table${t.imageFk ? html` class="with-thumbs thumbs-${t.type}"` : ''}><thead><tr>${t.imageFk ? html`<th></th>` : ''}<th>Name</th><th>Slug</th><th>Links</th><th>Updated</th></tr></thead><tbody>
        ${rows.slice(0, PAGE).map((r) => html`<tr>${t.imageFk ? html`<td class="thumb">${r.image_url
          ? html`<a href="/${t.folder}/${r.slug}" tabindex="-1"><img src="${thumbUrl(r.image_url, 120)}" alt="" loading="lazy" decoding="async"></a>`
          : html`<span class="thumb-empty" title="no image"></span>`}</td>` : ''}<td><a href="/${t.folder}/${r.slug}">${r.name}</a>${r.to_complete ? html` <span class="tag warn" title="created automatically — fill in the details">to complete</span>` : ''}
          ${sources && sources.get(r.slug) ? html`<div class="small">${sources.get(r.slug).siglum}${r.status ? html` <span class="tag">${r.status.replace('_', ' ')}</span>` : ''}</div>` : ''}
          ${r.sort_key !== r.name ? html`<div class="muted small">${r.sort_key}</div>` : q && r.alt ? html`<div class="muted small">${r.alt}</div>` : ''}</td><td class="muted">${r.slug}</td>
          <td>${r.rels}</td><td class="muted">${r.updated_at.toISOString().slice(0, 10)}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nothing found.</p>`}
      ${pager(`/${t.folder}${q ? `?q=${encodeURIComponent(q)}` : ''}`, page, rows.length > PAGE)}`,
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Wikidata: find the item, review field by field, apply only what was ticked (src/admin/wikidata.js)
// ---------------------------------------------------------------------------------------------------------------
const wdLinks = { folderOf: (type) => BY_TYPE[type].folder };

async function wikidataPage(req, res, t, e) {
  const action = e ? `/${t.folder}/${e.slug}/wikidata` : `/${t.folder}/new/wikidata`;
  const title = e ? `Compare ${e.name} with Wikidata` : `New ${t.type} from Wikidata`;
  const page = { type: t.type, slug: e ? e.slug : null, mode: 'view' };
  const qid = String(req.query.q || (e && !req.query.search && e.doc.wikidata_id) || '').trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/.test(qid)) {
    const q = String(req.query.search ?? (e ? e.name : '')).trim();
    let results = null;
    let error = null;
    if (/^Q[1-9][0-9]*$/i.test(q)) return res.redirect(`${action}?q=${q.toUpperCase()}`);
    if (q) { try { results = await wikidata.search(q); } catch (err) { error = `Wikidata search failed: ${err.message}`; } }
    return send(req, res, { title, page, body: searchPage({ title, action, q, results, error }) });
  }
  const ours = e ? (await collab.currentForm(t, e.id)).form : {};
  let plan;
  try {
    plan = await wikidata.compare(adminPool, t, qid, ours, e ? { type: t.type, id: e.id } : null);
  } catch (err) {
    return send(req, res, { title, page, status: 502, body: searchPage({ title, action, q: qid, results: null, error: `Could not load ${qid}: ${err.message}` }) });
  }
  send(req, res, { title, page, body: reviewPage({ title, plan, t: wdLinks, action, isNew: !e }) });
}

async function wikidataApply(req, res, t, e) {
  const qid = String(req.body.qid || '');
  if (!/^Q[1-9][0-9]*$/.test(qid)) return notFoundPage(req, res);
  const ours = e ? (await collab.currentForm(t, e.id)).form : {};
  const plan = await wikidata.compare(adminPool, t, qid, ours, e ? { type: t.type, id: e.id } : null);
  let result;
  try {
    result = await withTx(req.user, (db) => wikidata.apply(db, t, e ? { type: t.type, id: e.id } : null, plan, req.body, req.user.id), { source: 'wikidata' });
  } catch (err) {
    return send(req, res, { title: 'Wikidata', status: 422, flash: { kind: 'error', text: `Nothing was applied: ${err.message}` },
      body: reviewPage({ title: 'Wikidata', plan, t: wdLinks, action: req.originalUrl, isNew: !e }) });
  }
  // Provenance: the item goes into the sources (metadata) and, if empty, the Wikidata id field.
  const form = { ...result.form };
  if (Object.keys(form).length) {
    let meta = {};
    try { meta = JSON.parse(ours['f.metadata'] || '{}') || {}; } catch { meta = {}; }
    const sources = Array.isArray(meta.sources) ? meta.sources : [];
    if (!sources.some((s) => String(s).startsWith(`Wikidata ${qid}`))) meta.sources = [...sources, wikidata.sourceNote(qid)];
    form['f.metadata'] = JSON.stringify(meta, null, 2);
    if (!ours['f.wikidata_id']) form['f.wikidata_id'] = qid;
  }
  if (!e) {  // a new entry: prefill the new-entry form (the user's draft), created with "Create"
    const base = Object.fromEntries(Object.entries(docToForm({}, t.fields)).map(([k, v]) => [`f.${k}`, v]));
    const slug = wikidata.slugify(plan.label || qid);
    await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, $2, NULL, $3)
      ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`,
    [req.user.id, t.type, JSON.stringify({ slug, ...base, ...form,
      ...(result.pendingImages.length ? { 'wd.images': JSON.stringify(result.pendingImages) } : {}) })]);
    return res.redirect(303, `/${t.folder}/new?draft=1`);
  }
  if (Object.keys(form).length) await collab.applyForm(t, e.id, form, req.user.username);
  res.redirect(303, `/${t.folder}/${e.slug}/edit?done=wikidata&rels=${result.relationships}&created=${result.created.length}&imgs=${result.images}`);
}

router.get('/:plural/new/wikidata', (req, res) => wikidataPage(req, res, req.t, null));
router.post('/:plural/new/wikidata', (req, res) => wikidataApply(req, res, req.t, null));
router.get('/:plural/:slug/wikidata', async (req, res) => {
  const e = await findEntity(req.t, req.params.slug);
  return e ? wikidataPage(req, res, req.t, e) : notFoundPage(req, res);
});
router.post('/:plural/:slug/wikidata', async (req, res) => {
  const e = await findEntity(req.t, req.params.slug);
  return e ? wikidataApply(req, res, req.t, e) : notFoundPage(req, res);
});

// Find a place and fill the new-place form from it (src/admin/placefinder.js, migration 032).
router.get('/places/new/find', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  let hits = [];
  let error = null;
  if (q) { try { hits = await placefinder.candidates(q); } catch (err) { error = `Place search failed: ${err.message}`; } }
  send(req, res, {
    title: 'Find a place', page: { type: 'place', slug: null, mode: 'new' },
    body: html`<p class="muted"><a href="/places">Places</a></p><h1>New place from a search</h1>
      <p class="muted">Pick the place: its name (also in other languages), kind and country are filled in; countries and
        regions get their outline from Natural Earth, smaller places a point (Wikidata's when there is an item); the
        parent is found from what we already have. You check the form and press Create.</p>
      <form method="get" action="/places/new/find" class="bar"><input type="search" name="q" value="${q}" class="grow" aria-label="place"
        placeholder="e.g. Arles · Kyoto · Saitama Prefecture · Louvre"><button>Search</button></form>
      ${error ? html`<p class="flash error">${error}</p>` : ''}
      ${q && !error && !hits.length ? html`<p class="muted">Nothing found.</p>` : ''}
      <div class="table-wrap"><table class="place-hits"><tbody>${hits.map((h) => html`<tr>
        <td><b>${h.name}</b> <span class="tag">${h.kind}</span>${h.country_code ? html` <span class="tag">${h.country_code}</span>` : ''}
          <div class="muted small">${h.label}</div></td>
        <td><form method="post" action="/places/new/find"><input type="hidden" name="pick" value="${JSON.stringify(h)}">
          <button class="small">Use this</button></form></td></tr>`)}</tbody></table></div>
      <p class="muted small">Search: © OpenStreetMap contributors (Nominatim) — used for finding only.</p>`,
  });
});

router.post('/places/new/find', async (req, res) => {
  let pick;
  try { pick = JSON.parse(String(req.body.pick || '')); } catch { pick = null; }
  if (!pick || typeof pick !== 'object') return res.redirect(303, '/places/new/find');
  let draft;
  try {
    draft = await placefinder.draftFor(adminPool, pick, wikidata.coordsOf, wikidata.slugify);
  } catch (err) {
    return send(req, res, { title: 'Find a place', status: 422, flash: { kind: 'error', text: `That result can't be used: ${err.message}` },
      body: html`<p><a href="/places/new/find">← search again</a></p>` });
  }
  const t = BY_TYPE.place;
  const base = Object.fromEntries(Object.entries(docToForm({}, t.fields)).map(([k, v]) => [`f.${k}`, v]));
  await adminPool.query(`INSERT INTO admin_drafts (user_id, entity_type, entity_id, form) VALUES ($1, 'place', NULL, $2)
    ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET form = EXCLUDED.form, updated_at = now()`,
  [req.user.id, JSON.stringify({ ...base, ...draft.form })]);
  res.redirect(303, '/places/new?draft=1');
});

// A new part of a series / album …: "+ New part" links to /artworks/new?part_of=<slug> — prefilled with the whole and
// its creator (the part may still differ).
async function newDocFrom(t, query) {
  if (t.type !== 'artwork' || !SLUG.test(String(query.part_of || ''))) return {};
  const w = await findEntity(t, String(query.part_of));
  return w ? { parent: w.slug, ...(w.doc.creator ? { creator: w.doc.creator } : {}) } : {};
}

router.get('/:plural/new', async (req, res) => {
  const { t } = req;
  const draft = await drafts.getDraft(adminPool, req.user.id, t.type, null);
  const useDraft = draft && req.query.draft === '1';
  const changed = draft ? Object.keys(draft.form).filter((k) => k.startsWith('f.') && draft.form[k].trim()).map((k) => humanize(k.slice(2).replace(/_(lon|lat|label)$/, ''))) : [];
  send(req, res, {
    title: `New ${t.type}`,
    page: { type: t.type, slug: null, mode: 'new' },
    body: html`<h1>New ${t.type}</h1>
      ${useDraft ? restoredBanner({ draft, rb: { stale: false, merged: [], conflicts: [] }, t })
        : draftBanner({ draft, changed: [...new Set(changed)], restoreUrl: `/${t.folder}/new?draft=1`, t })}
      ${entityForm({ t, slug: useDraft ? draft.form.slug || '' : '', f: useDraft ? formFromBody(draft.form) : docToForm(await newDocFrom(t, req.query), t.fields),
        ctx: await formContext(t), action: `/${t.folder}`, errors: [], isNew: true,
        pendingImages: useDraft ? draft.form['wd.images'] : null })}`,
  });
});

// Throw away this user's draft for an entry (or for a new one of this type), then back to the form.
router.post('/drafts/discard', async (req, res) => {
  const t = BY_TYPE[req.body.type];
  if (!t) return notFoundPage(req, res);
  const slug = String(req.body.slug || '');
  const e = slug ? await findEntity(t, slug) : null;
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e ? e.id : null);
  res.redirect(303, e ? `/${t.folder}/${e.slug}/edit` : `/${t.folder}/new`);
});

// Shared by create and update: validate, resolve slugs to ids, write. Returns the (possibly new) slug.
async function saveEntity(user, t, body, existing) {
  const slug = String(body.slug || '').trim();
  const { doc, errors } = formToDoc(body, t.fields);
  if (!SLUG.test(slug)) errors.push('slug: lowercase letters, digits and single hyphens only');
  if (!doc[t.name]) errors.push(`${t.name}: required`);
  // A creator / institution typed as a new name becomes a new (flagged) entry — src/admin/autocreate.js
  const auto = await autocreate.resolveRefs(adminPool, t, doc, body);
  errors.push(...auto.errors);
  // The city of an exact location, so it needn't be entered by hand (placefinder.cityAt): an institution with a point
  // but no place gets its city; a work that doesn't move gets "created in" that city. Ours if we have it, else created.
  const city = errors.length ? null : await cityFor(t, doc, existing);
  if (city && city.slug && t.type === 'institution') doc.place = city.slug;
  const row = toRow(doc, t.fields);
  errors.push(...row.errors);
  if (errors.length) return { errors, confirm: auto.confirm };

  let created = [];
  try {
    await withTx(user, async (db) => {
      const idOf = async (type, s) => (await db.query('SELECT entity_id($1, $2) AS id', [type, s])).rows[0].id;
      const newSlugs = await autocreate.create(db, auto.creates);
      for (const [key, s] of newSlugs) {
        if (key === 'parent') row.parent = s; else row.refs.find((r) => r.col === REF_COLUMNS[key]).slug = s;
      }
      created = auto.creates;
      if (t.fields.parent) {
        const id = row.parent === null ? null : await idOf(t.type, row.parent);
        if (row.parent !== null && id === null) throw new UserError(`parent ${t.type} "${row.parent}" does not exist.`);
        if (existing && id === existing.id) throw new UserError('An entity cannot be its own parent.');
        row.cols.parent_id = ['$', id];
      }
      if (city && city.draft) {  // a new city (and its region, from Natural Earth, if we don't have that either)
        const parentSlugs = await autocreate.create(db, city.creates);
        if (parentSlugs.has('parent')) city.doc.parent = parentSlugs.get('parent');
        city.slug = await wikidata.createEntry(db, 'place', city.doc, null, user.id, city.doc.wikidata_id || null, false);
        city.created = 1 + city.creates.length;
        if (t.type === 'institution') row.refs.find((r) => r.col === 'place_id').slug = city.slug;
      }
      for (const r of row.refs) {
        const id = r.slug === null ? null : await idOf(r.type, r.slug);
        if (r.slug !== null && id === null) throw new UserError(`${r.type} "${r.slug}" does not exist.`);
        row.cols[r.col] = ['$', id];
      }
      const names = Object.keys(row.cols);
      const values = [slug];
      const exprs = names.map((c) => { values.push(row.cols[c][1]); return row.cols[c][0].replace('$', () => `$${values.length}`); });
      // an artwork that doesn't move: "created in" its city, dated like the work (unless it has a place of creation)
      const createdIn = async (id) => {
        if (!city || !city.slug || t.type !== 'artwork') return;
        await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label)
          SELECT 'artwork', w.id, 'created_in', 'place', entity_id('place', $2), w.created, w.created_label FROM artworks w
          WHERE w.id = $1 AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'artwork' AND r.subject_id = w.id
                                           AND r.relationship_type = 'created_in' AND r.object_type = 'place')`, [id, city.slug]);
      };
      if (!existing) {
        const { rows } = await db.query(`INSERT INTO ${t.table} (slug, ${names.join(', ')}) VALUES ($1, ${exprs.join(', ')}) RETURNING id`, values);
        await createdIn(rows[0].id);
        // images picked in the Wikidata review of this new entry (wd.images): saved together with it
        for (const img of pendingImagesOf(t, body)) await images.add(db, t.type, rows[0].id, img);
        for (const c of created) await autocreate.flag(db, c.type, c.id, { type: t.type, id: rows[0].id }, user.id);
        return;
      }
      for (const c of created) await autocreate.flag(db, c.type, c.id, { type: t.type, id: existing.id }, user.id);
      await autocreate.unflag(db, t.type, existing.id);  // published by someone: no longer "to complete"
      // Optimistic locking: only if nobody saved this row since the form was opened.
      values.push(existing.id, String(body.version || ''));
      const { rowCount } = await db.query(`
        UPDATE ${t.table} SET slug = $1, ${names.map((c, i) => `${c} = ${exprs[i]}`).join(', ')}
        WHERE id = $${values.length - 1} AND updated_at::text = $${values.length}`, values);
      if (!rowCount) throw new UserError('Someone saved this record while you were editing. Open it again to see their changes, then redo yours.');
      await createdIn(existing.id);
    });
  } catch (err) {
    return { errors: [friendly(err)] };
  }
  return { slug, created, city: city && city.slug ? { created: city.created || 0 } : null };
}

// Does this save need a city looked up, and which one? (see saveEntity) → null | { slug } | { draft …, doc, creates }
// Lookup failures (no network, open sea) only mean no city: the save goes on, the quality hint stays.
async function cityFor(t, doc, existing) {
  let at = null;
  if (t.type === 'institution' && doc.location && !doc.place) at = doc.location;
  if (t.type === 'artwork' && (doc.location || doc.area)) {
    const before = existing ? existing.doc : {};
    const moved = JSON.stringify([doc.location, doc.area]) !== JSON.stringify([before.location, before.area]);
    const hasPlace = existing && (await adminPool.query(`SELECT 1 FROM relationships WHERE subject_type = 'artwork' AND subject_id = $1
      AND relationship_type = 'created_in' AND object_type = 'place'`, [existing.id])).rows.length;
    if (moved && !hasPlace) {
      at = doc.location || (await adminPool.query(`SELECT array[ST_X(p), ST_Y(p)] AS xy
        FROM (SELECT ST_PointOnSurface(ST_GeomFromGeoJSON($1)) AS p) x`, [JSON.stringify(doc.area)])).rows[0].xy;
    }
  }
  if (!at) return null;
  let city;
  try { city = await placefinder.cityAt(adminPool, at, wikidata.coordsOf, wikidata.slugify); } catch { return null; }
  if (!city || city.slug) return city;
  // a new place: the place finder's draft as a doc; a parent region we don't have yet comes from Natural Earth
  const placeT = BY_TYPE.place;
  const { doc: placeDoc, errors } = formToDoc(city.draft.form, placeT.fields);
  if (errors.length) return null;
  const parent = await autocreate.resolveRefs(adminPool, placeT, placeDoc, {});
  if (parent.errors.length) delete placeDoc.parent;
  return { draft: city.draft, doc: placeDoc, creates: parent.errors.length ? [] : parent.creates };
}

// wd.images (JSON from the Wikidata review of a new entry) → value lists for images.add(); checked like the form.
function pendingImagesOf(t, body) {
  if (!t.imageFk || !body['wd.images']) return [];
  let list;
  try { list = JSON.parse(String(body['wd.images'])); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).flatMap((img) => {
    try { return [images.fromForm({ url: img.url, source_url: img.source_url, license: img.license, credit: img.credit })]; } catch { return []; }
  });
}

// Re-show a rejected form with exactly what was typed.
function formFromBody(body) {
  const f = {};
  for (const [k, v] of Object.entries(body)) if (k.startsWith('f.')) f[k.slice(2)] = v;
  return f;
}
function errorKeysOf(errors) {
  return new Set(errors.map((e) => (/^([a-z_]+):/.exec(e) || [])[1]).filter(Boolean));
}

router.post('/:plural', async (req, res) => {
  const { t } = req;
  const result = await saveEntity(req.user, t, req.body, null);
  if (result.errors) {
    const ctx = await formContext(t);
    ctx.errorKeys = errorKeysOf(result.errors);
    ctx.confirmNew = result.confirm || {};
    return send(req, res, {
      title: `New ${t.type}`, status: 422,
      page: { type: t.type, slug: null, mode: 'new' },
      body: html`<h1>New ${t.type}</h1>${entityForm({ t, slug: req.body.slug, f: formFromBody(req.body), ctx, action: `/${t.folder}`,
        errors: result.errors, isNew: true, pendingImages: req.body['wd.images'] })}`,
    });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, null);
  res.redirect(303, `/${t.folder}/${result.slug}?done=created${result.created.length ? `&auto=${result.created.length}` : ''}${result.city ? `&city=1${result.city.created ? `&places=${result.city.created}` : ''}` : ''}`);
});

// Display of one field's value on the view page.
// links: "type/slug" → name, for [[links]] in Markdown (loaded by the page, linkNames)
function showValue(t, key, kind, doc, links = new Map()) {
  const v = doc[key];
  if (kind === 'md') return v ? html`<div class="md">${raw(renderMarkdown(v, { names: links }))}</div>` : null;
  if (kind === 'date' || kind === 'period') {
    if (v === undefined) return doc[`${key}_label`] || null;
    const generated = parseFuzzyDate(v, { openEnd: kind === 'period' }).label;
    return html`${doc[`${key}_label`] || generated} <span class="muted">(${v})</span>`;
  }
  if (v === undefined) return null;
  if (kind === 'text[]') return v.join(' · ');
  if (kind === 'dimsets') return html`<ul class="names-list">${v.map((s) => html`<li><b>${s.part}</b>: ${dimensionsLib.label(s.cm)}</li>`)}</ul>`;
  if (kind === 'names') {
    return html`<ul class="names-list">${v.map((n) => (typeof n === 'string' ? { text: n, role: 'alternative' } : n)).map((n) => html`<li>
      <span${n.lang ? html` lang="${n.lang}"` : ''}>${names.hasRuby(n.text) ? raw(names.rubyHtml(n.text)) : n.text}</span>
      ${n.lang ? html`<span class="tag">${n.lang}</span>` : ''} <span class="muted small">${n.role}</span></li>`)}</ul>`;
  }
  if (kind === 'dimensions') return `${v.join(' × ')} cm${v.length === 1 ? ' (height)' : ''}${doc.dimensions_note ? ` (${doc.dimensions_note})` : ''}`;
  if (kind === 'point') return html`${v[1]}, ${v[0]} <a href="https://www.openstreetmap.org/?mlat=${v[1]}&mlon=${v[0]}#map=12/${v[1]}/${v[0]}" rel="noopener" target="_blank">map ↗</a>`;
  if (kind === 'json' || kind === 'area') return html`<pre>${JSON.stringify(v, null, 2)}</pre>`;
  if (kind === 'parent') return html`<a href="/${t.folder}/${v}">${v}</a>`;
  if (kind.startsWith('ref:')) return html`<a href="/${BY_TYPE[kind.slice(4)].folder}/${v}">${v}</a>`;
  if (/_url$/.test(key)) return html`<a href="${v}" rel="noopener" target="_blank">${v}</a>`;
  return v;
}

// An artwork's creators in one place: the creator field (main creator) and the co_creator relationships
// (migration 028) — each with its part, certainty and an edit link — plus a short form to add one.
function creatorsRow(e, main, coCreators) {
  if (!main && !coCreators.length) return '';
  return html`<dt id="creators">Creator${coCreators.length ? 's' : ''}</dt><dd class="creators">
    ${main ? html`<a href="/artists/${main.slug}">${main.name}</a>` : html`<span class="muted">no main creator</span>`}
    ${coCreators.map(({ id, to_name: toName, rel }) => html`<div>+ <a href="/artists/${rel.to.split('/')[1]}">${toName}</a>
      <span class="muted">${[rel.label, rel.certainty !== 'attested' && rel.certainty].filter(Boolean).join(' · ')}</span>
      <a class="small" href="/relationships/${id}/edit">edit</a></div>`)}
    <details class="add-co-creator"><summary class="small">+ Add co-creator</summary>
      <form method="post" action="/artworks/${e.slug}/relationships?from=creators" class="form">
        <select id="cc-type" name="type" hidden><option value="co_creator" data-object-types="artist" selected>co-creator</option></select>
        <div class="row">
          <div class="field"><label for="cc-to">Artist</label>
            <input id="cc-to" name="to" required placeholder="start typing a name" autocomplete="off" data-lookup-from="cc-type"></div>
          <div class="field"><label for="cc-label">Part</label><input id="cc-label" name="label" placeholder="optional, e.g. landscape, figures"></div>
          <div class="field"><label for="cc-cert">Certainty</label><select id="cc-cert" name="certainty">
            ${['attested', 'probable', 'possible', 'disputed'].map((c) => html`<option>${c}</option>`)}</select></div>
        </div>
        <div class="hint">Period, notes and sources: <i>edit</i> after adding. The main creator is the Creator field (Edit).</div>
        <div class="actions"><button>Add</button></div>
      </form></details></dd>`;
}

router.get('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const [outgoing, incoming, types, entities] = await Promise.all([
    readRelationships(adminPool, t.type, e.id),
    // links towards this entry, plus the derived ones from it (view edges, 031: provenance, the creator field) —
    // except an artwork's own derived edges, which its creator row and Provenance section show
    adminPool.query(`
      SELECT r.id, r.source, r.provenance_id, s.type::text AS type, s.slug, s.name,
             CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN rt.inverse_label ELSE rt.label END AS inverse_label,
             r.period_label, r.label, r.end_basis
      FROM edges r JOIN relationship_types rt ON rt.code = r.relationship_type
      JOIN entity_index s ON (s.type, s.id) = (CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN r.subject_type ELSE r.object_type END,
                                               CASE WHEN (r.object_type, r.object_id) = ($1::entity_type, $2) THEN r.subject_id ELSE r.object_id END)
      WHERE (r.object_type = $1 AND r.object_id = $2)
         OR (r.subject_type = $1 AND r.subject_id = $2 AND r.source <> 'relationship' AND r.subject_type <> 'artwork')
      ORDER BY rt.sort_order, lower(r.period) NULLS FIRST`, [t.type, e.id]),
    relationshipTypes(adminPool, t.type, { reverse: true }),
    allEntities(adminPool),
  ]);
  const labels = Object.fromEntries(types.map((x) => [x.code, x.label]));
  // an artwork's further creators are shown with the creator (creatorsRow), not among the relationships
  const coCreators = outgoing.filter((o) => o.rel.type === 'co_creator');
  const otherRels = outgoing.filter((o) => o.rel.type !== 'co_creator');
  const mainCreator = t.type === 'artwork' && e.doc.creator
    ? (await adminPool.query('SELECT slug, name FROM artists WHERE slug = $1', [e.doc.creator])).rows[0] : null;
  const name = e.name;
  const qa = await quality.issues(adminPool, { entity: { type: t.type, id: e.id } });
  const pending = await collab.unpublished(t, e.id);
  const imgs = t.imageFk ? await readImages(adminPool, t.type, e.id) : [];
  const autoFlag = await autocreate.flagOf(adminPool, t.type, e.id);
  const provSteps = t.type === 'artwork' ? await provenance.read(adminPool, e.id) : [];
  const webAccessed = t.type === 'artwork' && e.doc.web_url
    ? (await adminPool.query("SELECT to_char(web_url_accessed, 'FMDD FMMonth YYYY') AS d FROM artworks WHERE id = $1", [e.id])).rows[0].d : null;
  const boundary = t.type === 'place' && e.doc.boundary_code
    ? (await adminPool.query('SELECT code, name FROM boundaries WHERE code = $1', [e.doc.boundary_code])).rows[0] : null;
  // series and other wholes (migration 037)
  const series = t.type === 'artwork' ? await seriesOf(e) : null;
  const citation = t.type === 'source' ? (await bibliography.loadCatalogue(adminPool)).get(e.slug) : null;
  const linkMap = await linkNames(adminPool, [...Object.entries(t.fields).filter(([, k]) => k === 'md').map(([key]) => e.doc[key]),
    ...provSteps.map((p) => p.notes_md)]);
  // the entries whose texts [[link]] this one (view content_links, migration 030) — for a term: where it is used
  const usedIn = (await adminPool.query(`
    SELECT DISTINCT e.type::text AS type, e.slug, e.name, e.sort_key FROM content_links l JOIN entity_index e ON (e.type, e.id) = (l.entity_type, l.entity_id)
    WHERE l.target_type = $1 AND l.target_slug = $2 AND NOT (e.type = $1::entity_type AND e.id = $3) ORDER BY e.sort_key`, [t.type, e.slug, e.id])).rows;
  const main = imgs[0];
  send(req, res, {
    title: name, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}">${humanize(t.folder)}</a> / ${e.slug}</p>
      <div class="bar"><h1 class="grow">${name}</h1>
        <a class="button" href="/${t.folder}/${e.slug}/edit">Edit</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/wikidata">Wikidata…</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/history">History</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/delete">Delete</a></div>
      ${pending ? unpublishedBanner(t, e, { ...pending, fields: await unpublishedFields(t, e) }, false) : ''}
      ${autoFlag ? html`<div class="flash warn auto-banner"><b>To complete:</b> created automatically
        ${autoFlag.from ? html`while adding <a href="/${BY_TYPE[autoFlag.from.type].folder}/${autoFlag.from.slug}">${autoFlag.from.name}</a>` : ''}
        on ${autoFlag.created_at.toISOString().slice(0, 10)} — it has little more than a name.
        <a class="button" href="/${t.folder}/${e.slug}/edit">Fill in the details</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/wikidata">Compare with Wikidata…</a>
        <form method="post" action="/${t.folder}/${e.slug}/auto-done" class="inline"><button class="link">it's complete — remove the mark</button></form>
        <div class="muted small">The mark goes away by itself when the entry is next published.</div></div>` : ''}
      ${quality.entityBox(qa, `/${t.folder}/${e.slug}`)}
      ${citation ? html`<p class="citation"><b>${citation.siglum}:</b> ${raw(citation.full)}</p>` : ''}
      ${series && series.whole ? html`<p class="part-of">${series.number ? html`<b>${/^\d+$/.test(series.number) ? `No. ${series.number}` : series.number}</b>
        ${series.whole.parts_count && /^\d+$/.test(series.number) ? `of ${series.whole.parts_count} ` : ''}in ` : 'Part of '}<a href="/artworks/${series.whole.slug}">${series.whole.title}</a>
        ${series.prev ? html` · <a href="/artworks/${series.prev.slug}">← ${series.prev.title}</a>` : ''}${series.next ? html` · <a href="/artworks/${series.next.slug}">${series.next.title} →</a>` : ''}</p>` : ''}
      ${main ? html`<figure class="image-preview"><a href="${main.source_url || main.url}" target="_blank" rel="noopener">
        <img src="${thumbUrl(main.url, 500)}" alt="${name}"></a>
        <figcaption class="muted small">${[main.caption, main.credit, main.license].filter(Boolean).join(' · ') || 'no credit / license yet'}
          ${imgs.length > 1 ? html` · <a href="#images">${imgs.length} images</a>` : ''}</figcaption></figure>` : ''}
      ${names.hasRuby(e.doc[t.name]) || e.doc[`${t.name}_lang`] ? html`<p class="main-name"${e.doc[`${t.name}_lang`] ? html` lang="${e.doc[`${t.name}_lang`]}"` : ''}>
        ${names.hasRuby(e.doc[t.name]) ? raw(names.rubyHtml(e.doc[t.name])) : name}
        ${e.doc[`${t.name}_lang`] ? html` <span class="tag" lang="en">${e.doc[`${t.name}_lang`]}</span>` : ''}</p>` : ''}
      <dl class="fields">${Object.entries(t.fields).filter(([k]) => k !== t.name && !(k === 'dimensions_note' && e.doc.dimensions)).map(([key, kind]) => {
        if (t.type === 'artwork' && key === 'creator') return creatorsRow(e, mainCreator, coCreators);
        const shown = key === 'boundary_code' && boundary
          ? html`${boundary.code} — ${boundary.name} <span class="muted">(outline and marker from Natural Earth)</span>`
          : showValue(t, key, kind, e.doc, linkMap);
        // the web page with the day the link was added (set by the database, migration 039)
        if (key === 'web_url' && shown !== null && webAccessed) return html`<dt>${fieldLabel(t.type, key)}</dt><dd>${shown} <span class="muted small">· added ${webAccessed}</span></dd>`;
        return shown === null ? '' : html`<dt>${fieldLabel(t.type, key)}</dt><dd>${shown}</dd>`;
      })}</dl>
      ${t.type === 'term' || usedIn.length ? html`<h2 id="used-in">${t.type === 'term' ? 'Used in' : 'Mentioned in'}</h2>${usedIn.length ? html`<ul>${usedIn.map((u) => html`<li><a href="/${BY_TYPE[u.type].folder}/${u.slug}">${u.name}</a> <span class="tag">${u.type}</span></li>`)}</ul>`
        : html`<p class="muted">No text links it yet — write <code>[[${e.slug}]]</code> in a description.</p>`}` : ''}
      ${series && (series.parts.length || series.isWhole) ? html`<h2 id="parts">Parts</h2>
        <p class="muted">${series.parts.length}${e.doc.parts_count ? ` of ${e.doc.parts_count}` : ''} entered${series.missing.length ? ` — missing numbers: ${series.missing.join(', ')}` : ''}</p>
        <div class="image-list parts-list">${series.parts.map((p) => html`<figure class="image-item"><a href="/artworks/${p.slug}">${p.image_url
          ? html`<img src="${thumbUrl(p.image_url, 250)}" alt="" loading="lazy">` : html`<span class="thumb-empty"></span>`}</a>
          <figcaption>${p.part_number ? html`<b>${p.part_number}</b> · ` : ''}<a href="/artworks/${p.slug}">${p.title}</a></figcaption></figure>`)}</div>` : ''}
      ${t.type === 'artwork' ? html`<details${series && series.isWhole ? ' open' : ''}><summary><b>+ Add a part</b> <span class="muted small">(for a series, album, triptych …)</span></summary>
        <form method="post" action="/artworks/${e.slug}/parts" class="form bar">
          <input name="part" placeholder="an existing artwork (slug)" list="part-candidates" class="grow" aria-label="artwork" data-lookup="artwork" autocomplete="off">
          <input name="part_number" placeholder="number, e.g. 21" aria-label="number" class="short">
          <button>Add</button> <a class="button secondary" href="/artworks/new?part_of=${e.slug}">+ New part</a></form></details>` : ''}
      ${t.imageFk ? images.section({ t, e, images: imgs, licenseList: await images.licenses(adminPool) }) : ''}
      ${t.type === 'artwork' ? provenance.section({ e, steps: provSteps, names: linkMap }) : ''}
      <h2 id="relationships">Relationships</h2>
      ${otherRels.length ? html`<div class="table-wrap"><table><tbody>${otherRels.map(({ id, to_name: toName, rel }) => {
        const [type, slug] = rel.to.split('/');
        return html`<tr><td>${labels[rel.type] || rel.type}</td>
          <td><a href="/${BY_TYPE[type].folder}/${slug}">${toName}</a> <span class="tag">${type}</span></td>
          <td>${rel.period_label || (rel.period ? parseFuzzyDate(String(rel.period), { openEnd: true }).label : '')}</td>
          <td class="muted">${[rel.label, rel.certainty].filter(Boolean).join(' · ')}</td>
          <td><a href="/relationships/${id}/edit">edit</a></td></tr>`;
      })}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}
      ${incoming.rows.length ? html`<h3>Linked from</h3><div class="table-wrap"><table><tbody>${incoming.rows.map((r) => html`<tr>
          <td>${r.inverse_label}</td><td><a href="/${BY_TYPE[r.type].folder}/${r.slug}">${r.name}</a> <span class="tag">${r.type}</span></td>
          <td>${r.period_label || ''}${r.end_basis === 'implied' ? html` <span class="tag implied">end implied</span>` : ''}</td><td class="muted">${r.label || ''}</td>
          <td>${r.source === 'provenance' ? html`<a href="/provenance/${r.provenance_id}/edit" title="from the provenance">provenance</a>`
            : r.source === 'creator' ? html`<a href="/artworks/${r.slug}/edit" title="the artwork's creator field">creator field</a>`
            : html`<a href="/relationships/${r.id}/edit">edit</a>`}</td></tr>`)}</tbody></table></div>` : ''}
      <details><summary><b>+ Add relationship</b></summary>
        ${types.length ? relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, submit: 'Add', entityType: t.type })
          : html`<p class="muted">No relationship types start from ${an(t.type)}; link to it from the other entity.</p>`}
      </details>`,
  });
});

router.post('/:plural/:slug/relationships', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => {
      const p = await relFromForm(db, req.body, { type: t.type, id: e.id }, {}, { reverse: true });
      await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period,
        period_label, label, certainty, notes_md, metadata) VALUES ($1, $2, $3, $4, $5, $6::daterange, $7, $8, $9, $10, $11::jsonb)`, p);
    });
  } catch (err) {
    const [types, entities] = await Promise.all([relationshipTypes(adminPool, t.type, { reverse: true }), allEntities(adminPool)]);
    return send(req, res, {
      title: 'Add relationship', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Add relationship</h1><p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
        ${relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Add', entityType: t.type })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=rel-added#${req.query.from === 'creators' ? 'creators' : 'relationships'}`);  // back to where it was added
});

// The published values as form keys — the edit page refetches them when someone else publishes or reverts.
router.get('/:plural/:slug/published.json', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return res.status(404).json({ error: 'not_found' });
  res.json(drafts.formKeys(e.doc, t, e.slug));
});

router.post('/:plural/:slug/auto-done', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  await autocreate.unflag(adminPool, t.type, e.id);
  res.redirect(303, `/${t.folder}/${e.slug}?done=auto-done`);
});

// Series and other wholes (migration 037): what an artwork is part of, its neighbours, its parts; numbers 1…parts_count
// that no part has yet.
async function seriesOf(e) {
  const { rows: parts } = await adminPool.query(`
    SELECT a.slug, a.title, a.part_number, a.part_sort,
           (SELECT i.url FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) AS image_url
    FROM artworks a WHERE a.parent_id = $1 ORDER BY a.part_sort NULLS LAST, a.part_number, a.title`, [e.id]);
  const { rows: [me] } = await adminPool.query(`
    SELECT w.slug, w.title, w.parts_count, a.part_number FROM artworks a LEFT JOIN artworks w ON w.id = a.parent_id WHERE a.id = $1`, [e.id]);
  let prev = null;
  let next = null;
  if (me.slug) {
    const { rows: sib } = await adminPool.query(`
      SELECT a.slug, a.title FROM artworks a WHERE a.parent_id = (SELECT parent_id FROM artworks WHERE id = $1)
      ORDER BY a.part_sort NULLS LAST, a.part_number, a.title`, [e.id]);
    const at = sib.findIndex((s) => s.slug === e.slug);
    prev = sib[at - 1] || null;
    next = sib[at + 1] || null;
  }
  const have = new Set(parts.map((p) => Number(p.part_sort)).filter(Number.isFinite));
  const count = Number(e.doc.parts_count) || 0;
  const missing = count && count <= 500 ? [...Array(count).keys()].map((n) => n + 1).filter((n) => !have.has(n)) : [];
  return { parts, isWhole: !!count || /^(series|album|diptych|triptych|polyptych|altarpiece|set)$/.test(e.doc.kind || ''),
    whole: me.slug ? { slug: me.slug, title: me.title, parts_count: me.parts_count } : null, number: me.part_number, prev, next,
    missing: missing.length > 30 ? [...missing.slice(0, 30), '…'] : missing };
}

// An existing artwork becomes a part of this one (with its number); audited like any change.
router.post('/artworks/:slug/parts', async (req, res) => {
  const t = BY_TYPE.artwork;
  const e = await findEntity(t, req.params.slug);
  const part = await findEntity(t, String(req.body.part || '').trim());
  if (!e) return notFoundPage(req, res);
  if (!part) {
    return send(req, res, { title: 'Add a part', status: 422, flash: { kind: 'error', text: 'Pick an existing artwork (its slug) — or use “+ New part”.' },
      body: html`<p><a href="/artworks/${e.slug}#parts">← ${e.name}</a></p>` });
  }
  try {
    await withTx(req.user, (db) => db.query('UPDATE artworks SET parent_id = $1, part_number = $2 WHERE id = $3',
      [e.id, String(req.body.part_number || '').trim() || null, part.id]));
  } catch (err) {
    return send(req, res, { title: 'Add a part', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<p><a href="/artworks/${e.slug}#parts">← ${e.name}</a></p>` });
  }
  await collab.changedElsewhere(t, part.id);  // its working copy, if open, takes the new values
  res.redirect(303, `/artworks/${e.slug}?done=saved#parts`);
});

// Images: added here, edited / removed / reordered under /images/<id> (src/admin/images.js). Saved immediately and
// audited, like relationships.
router.post('/:plural/:slug/images', async (req, res) => {
  const { t } = req;
  const e = t.imageFk && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    const values = images.fromForm(req.body);
    await withTx(req.user, (db) => images.add(db, t.type, e.id, values));
  } catch (err) {
    return send(req, res, {
      title: 'Add image', status: 422, flash: { kind: 'error', text: err instanceof images.ImageError ? err.message : friendly(err) },
      body: html`<h1>Add image</h1><p><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
        ${images.form({ action: `/${t.folder}/${e.slug}/images`, img: req.body, submit: 'Add', licenseList: await images.licenses(adminPool) })}`,
    });
  }
  // from the image search: back to the results (only that page of this entry — never an arbitrary address)
  const back = String(req.body.back || '');
  if (back.startsWith(`/${t.folder}/${e.slug}/images/find?`)) return res.redirect(303, `${back}&done=img-added`);
  res.redirect(303, `/${t.folder}/${e.slug}?done=img-added#images`);
});

router.post('/:plural/:slug/provenance', async (req, res) => {
  const { t } = req;
  const e = t.type === 'artwork' && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, async (db) => provenance.add(db, e.id, await provenance.fromForm(db, req.body)));
  } catch (err) {
    return send(req, res, {
      title: 'Add provenance step', status: 422,
      flash: { kind: 'error', text: err instanceof provenance.ProvenanceError ? err.message : friendly(err) },
      body: html`<h1>Add provenance step</h1><p><a href="/${t.folder}/${e.slug}#provenance">← ${e.name}</a></p>
        ${provenance.form({ action: `/${t.folder}/${e.slug}/provenance`, step: stepFromBody(req.body), submit: 'Add' })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=prov-added#provenance`);
});

// Find freely licensed images (Wikimedia Commons, Met, Art Institute of Chicago, Cleveland — src/admin/imagesearch.js).
router.get('/:plural/:slug/images/find', async (req, res) => {
  const { t } = req;
  const e = t.imageFk && await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const source = imagesearch.SOURCES[req.query.source] ? req.query.source : 'commons';
  // default search: the name, for an artwork with its creator ("The Great Wave off Kanagawa Hokusai")
  let q = String(req.query.q ?? '').trim().slice(0, 200);
  if (!req.query.q) {
    const creator = t.type === 'artwork' && e.doc.creator
      ? (await adminPool.query('SELECT name FROM artists WHERE slug = $1', [e.doc.creator])).rows[0] : null;
    q = [e.name, creator && creator.name].filter(Boolean).join(' ');
  }
  const { results, error } = await imagesearch.find(source, q);
  const have = new Set((await readImages(adminPool, t.type, e.id)).map((i) => i.url));
  const self = `/${t.folder}/${e.slug}/images/find?${new URLSearchParams({ source, q })}`;
  send(req, res, {
    title: `Find images · ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}#images">← ${e.name}</a></p><h1>Find images</h1>
      <p class="muted">Only freely usable images are shown — public domain / CC0, or with a free licence on Commons.
        Licence, credit and source are added with the image.</p>
      <form method="get" action="/${t.folder}/${e.slug}/images/find" class="bar">
        <input type="search" name="q" value="${q}" class="grow" aria-label="search">
        <select name="source" aria-label="where">${Object.entries(imagesearch.SOURCES).map(([k, s]) => html`<option value="${k}"${k === source ? ' selected' : ''}>${s.name}</option>`)}</select>
        <button>Search</button></form>
      <p class="source-tabs">${Object.entries(imagesearch.SOURCES).map(([k, s]) => (k === source ? html`<b>${s.name}</b>`
        : html`<a href="/${t.folder}/${e.slug}/images/find?${new URLSearchParams({ source: k, q })}">${s.name}</a>`))}</p>
      ${error ? html`<p class="flash error">${error}</p>` : ''}
      ${!error && !results.length ? html`<p class="muted">Nothing found here — try another source or fewer words (e.g. only the artist).</p>` : ''}
      <div class="find-results">${results.map((r) => html`<figure class="image-item find-item">
        <a href="${r.source_url || r.url}" target="_blank" rel="noopener"><img src="${r.thumb}" alt="" loading="lazy" decoding="async"></a>
        <figcaption><b>${r.title || ''}</b>${r.by ? html`<div class="small">${r.by}</div>` : ''}
          <div class="muted small">${[r.credit, r.license].filter(Boolean).join(' · ')}</div>
          ${have.has(r.url) ? html`<div class="tag">added ✓</div>` : html`<form method="post" action="/${t.folder}/${e.slug}/images">
            <input type="hidden" name="url" value="${r.url}"><input type="hidden" name="source_url" value="${r.source_url || ''}">
            <input type="hidden" name="license" value="${r.license || ''}"><input type="hidden" name="credit" value="${r.credit || ''}">
            <input type="hidden" name="back" value="${self}"><button class="small">Add</button></form>`}
        </figcaption></figure>`)}</div>`,
  });
});

router.get('/:plural/:slug/edit', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  // The shared working copy (collab.js): the page shows it even before scripts connect, then stays bound to it.
  const { form: working, epoch, state } = await collab.currentForm(t, e.id);
  const pending = await collab.unpublished(t, e.id);
  const banner = pending ? unpublishedBanner(t, e, { ...pending, fields: await unpublishedFields(t, e) }, true) : '';
  // published: the public values, so the browser can mark every field the working copy changes (editor/unpublished.js)
  const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx: await formContext(t, e.id),
    action: `/${t.folder}/${e.slug}`, errors: [], version: working.version,
    collab: { key: `${t.type}:${e.id}:${epoch}`, state, published: drafts.formKeys(e.doc, t, e.slug) } });
  send(req, res, { title: `Edit ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'edit' },
    body: html`<h1>Edit ${e.name}</h1>${banner}${form}` });
});

router.post('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const result = await saveEntity(req.user, t, req.body, e);
  if (result.errors) {
    // Refused (validation, or the entry changed elsewhere meanwhile): the working copy is rebased if needed and shown
    // again with the messages — nothing typed is lost, it is all in the shared copy.
    await collab.changedElsewhere(t, e.id);
    const { form: working, epoch, state } = await collab.currentForm(t, e.id);
    const ctx = await formContext(t, e.id);
    ctx.errorKeys = errorKeysOf(result.errors);
    ctx.confirmNew = result.confirm || {};
    const published = drafts.formKeys((await findEntity(t, e.slug) || e).doc, t, e.slug);
    const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx,
      action: `/${t.folder}/${e.slug}`, errors: result.errors, version: working.version, collab: { key: `${t.type}:${e.id}:${epoch}`, state, published } });
    return send(req, res, { title: `Edit ${e.name}`, status: 422, page: { type: t.type, slug: e.slug, mode: 'edit' },
      body: html`<h1>Edit ${e.name}</h1>${form}` });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e.id);  // step-1 draft, if any from before
  await collab.publishedNow(t, e.id, req.user.username);
  res.redirect(303, `/${t.folder}/${result.slug}?done=published${result.created.length ? `&auto=${result.created.length}` : ''}${result.city ? `&city=1${result.city.created ? `&places=${result.city.created}` : ''}` : ''}`);
});

// Discarding resets everyone's working copy, so it is confirmed on a page that lists what would be lost.
router.get('/:plural/:slug/discard-changes', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const { form: working } = await collab.currentForm(t, e.id);
  const changed = drafts.changedFields(working, t, e);
  const pending = await collab.unpublished(t, e.id);
  send(req, res, {
    title: `Discard unpublished changes · ${e.name}`,
    page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<h1>Discard unpublished changes?</h1>
      ${changed.length ? html`<p>The working copy of <b>${e.name}</b> differs from the published version in:
        <b>${changed.join(', ')}</b>${pending && pending.contributors.length ? html` (changes by ${pending.contributors.join(', ')})` : ''}.
        Discarding resets it to the published version <b>for everyone</b> editing it. This cannot be undone.</p>
        <form method="post" action="/${t.folder}/${e.slug}/discard-changes" class="actions">
          <button class="danger">Discard for everyone</button><a class="button secondary" href="/${t.folder}/${e.slug}/edit">Cancel</a></form>`
      : html`<p>There are no unpublished changes. <a href="/${t.folder}/${e.slug}/edit">Back to the editor</a></p>`}`,
  });
});

router.post('/:plural/:slug/discard-changes', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  await collab.discard(t, e.id);
  res.redirect(303, `/${t.folder}/${e.slug}/edit?done=discarded`);
});

router.get('/:plural/:slug/delete', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const { rows } = await adminPool.query(`
    SELECT s.name AS subject, rt.label, o.name AS object, r.period_label
    FROM relationships r JOIN relationship_types rt ON rt.code = r.relationship_type
    JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
    JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
    WHERE (r.subject_type, r.subject_id) = ($1, $2) OR (r.object_type, r.object_id) = ($1, $2)
    ORDER BY rt.sort_order, s.name`, [t.type, e.id]);
  send(req, res, {
    title: `Delete ${e.name}`,
    body: html`<h1>Delete ${e.name}?</h1>
      ${rows.length ? html`<p>This also deletes <b>${rows.length}</b> relationship${rows.length === 1 ? '' : 's'}, including ones
        entered on other entities' pages:</p>
        <div class="table-wrap"><table><tbody>${rows.map((r) => html`<tr><td>${r.subject}</td><td>${r.label}</td><td>${r.object}</td>
          <td class="muted">${r.period_label || ''}</td></tr>`)}</tbody></table></div>` : html`<p>It has no relationships.</p>`}
      <p class="muted">Everything stays in the history, but there is no one-click undo yet.</p>
      <form method="post" action="/${t.folder}/${e.slug}/delete" class="actions">
        <button class="danger">Delete${rows.length ? ` with ${rows.length} relationship${rows.length === 1 ? '' : 's'}` : ''}</button>
        <a class="button secondary" href="/${t.folder}/${e.slug}">Cancel</a></form>`,
  });
});

router.post('/:plural/:slug/delete', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  try {
    await withTx(req.user, (db) => db.query(`DELETE FROM ${t.table} WHERE id = $1`, [e.id]));
    await collab.gone(t, e.id);  // close the working copy for everyone editing it
  } catch (err) {
    return send(req, res, {
      title: `Delete ${e.name}`, status: 409, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Can't delete ${e.name}</h1><p>Other records still point to it (see above). Change or delete those first.</p>
        <p><a href="/${t.folder}/${e.slug}">← back</a></p>`,
    });
  }
  res.redirect(303, `/${t.folder}?done=deleted`);
});

router.get('/:plural/:slug/history', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const page = pageParam(req);
  const h = await history(adminPool, `(a.table_name = $1 AND a.row_id = $2) OR (a.table_name = 'relationships' AND (
      ((r->>'subject_type') = $3 AND (r->>'subject_id')::bigint = $2) OR ((r->>'object_type') = $3 AND (r->>'object_id')::bigint = $2)))
      OR (a.table_name = 'images' AND (r->>$4)::bigint = $2)
      OR (a.table_name = 'provenance' AND (($3 = 'artwork' AND (r->>'artwork_id')::bigint = $2) OR (r->>('owner_' || $3 || '_id'))::bigint = $2
                                            OR ($3 = 'place' AND (r->>'location_id')::bigint = $2)))`,
  [t.table, e.id, t.type, t.imageFk || '-'], { offset: (page - 1) * PAGE });
  send(req, res, {
    title: `History of ${e.name}`, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p><h1>History</h1>
      ${historyTable(h.rows, { restoreFor: { table: t.table, rowId: e.id } })}${pager(`/${t.folder}/${e.slug}/history`, page, h.more)}`,
  });
});

router.use((req, res) => notFoundPage(req, res));

// Errors inside the admin panel → an HTML page, not the API's JSON.
router.use((err, req, res, next) => {
  console.error(err);
  res.status(500).type('html').send(String(layout({ title: 'Error', user: req.user,
    body: html`<h1>Something went wrong</h1><p>The error was logged. <a href="/">Back to the dashboard</a></p>` })));
});

module.exports = router;
