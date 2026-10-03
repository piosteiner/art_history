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
const { TYPES, BY_FOLDER, BY_TYPE, SLUG, toRow, readDocs, readRelationships, readImages } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');
const { renderMarkdown } = require('../markdown');
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

const { thumbUrl } = images;
const { searchPage, reviewPage } = require('./wikidata-ui');
const collab = require('./collab');
const { THRESHOLD, likeParam, scoreSql, altSql } = require('./match');
const { docToForm, formToDoc, entityForm, humanize, HINTS } = require('./forms');

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
  'img-added': 'Image added.', 'img-saved': 'Image saved.', 'img-deleted': 'Image removed.', 'img-moved': 'Order changed.',
};

function send(req, res, { title, body, status = 200, flash, page = null }) {
  if (!flash && DONE[req.query.done]) {
    // Numbers only from the URL — never reflect free text.
    const n = (k) => Math.max(0, Number.parseInt(req.query[k], 10) || 0);
    const extra = req.query.done === 'wikidata' ? [n('rels') && `${n('rels')} relationship${n('rels') === 1 ? '' : 's'} added`,
      n('created') && `${n('created')} new entr${n('created') === 1 ? 'y' : 'ies'} created`,
      n('imgs') && `${n('imgs')} image${n('imgs') === 1 ? '' : 's'} added`].filter(Boolean).join(', ') : '';
    flash = { kind: 'ok', text: DONE[req.query.done] + (extra ? ` (${extra})` : '') };
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
function unpublishedBanner(t, e, pending, onEditPage) {
  const who = pending.contributors.length ? pending.contributors.join(', ') : 'someone';
  return html`<div class="flash draft"><b>Unpublished changes</b> by ${who} (last ${when(pending.updated_at)}).
    ${onEditPage ? html`They are shown below — <b>Publish</b> makes them public.`
    : html`This page shows the published version. <a href="/${t.folder}/${e.slug}/edit">Open the working copy</a>`}</div>`;
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
  places_check: 'A place needs coordinates (or an area).',
  places_check1: 'A place cannot be its own parent.',
  movements_check: 'A movement cannot be its own parent.',
  artists_check: 'Death cannot be before birth.',
  relationships_check: 'An entity cannot be related to itself.',
  artworks_inventory_needs_institution: 'An inventory number belongs to a collection: set the institution (current holder) too, or leave the number empty.',
  polities_country_codes_check: 'Country codes: two capital letters each (ISO 3166, e.g. CN, UA), one per line.',
  polities_check: 'A polity cannot be part of itself.',
  artworks_dimensions_check: 'Dimensions: height and width go together; a depth only with both.',
};
function friendly(err) {
  if (err instanceof UserError) return err.message;
  if (err.code === '23505') {
    if (/^images_\w+_url$/.test(err.constraint || '')) return 'This image is already one of the entry\'s images.';
    return /slug/.test(err.constraint || '') ? 'That slug is already taken.' : `Duplicate: ${err.detail || err.message}`;
  }
  if (err.code === '23503' || err.code === '23001') {
    const m = /referenced from table "(\w+)"/.exec(err.detail || '');
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
const HIDDEN_KEYS = ['id', 'created_at', 'updated_at', 'lifespan'];

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
             ELSE coalesce(r->>'name', r->>'title', r->>'slug') END AS what,
           CASE WHEN a.table_name = 'relationships' THEN s.type::text || 's/' || s.slug
                WHEN a.table_name = 'images' THEN ie.type::text || 's/' || ie.slug
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
    LEFT JOIN LATERAL (SELECT CASE WHEN r->>'artwork_id' IS NOT NULL THEN 'artwork'
                                   WHEN r->>'artist_id' IS NOT NULL THEN 'artist' ELSE 'institution' END AS type,
                              coalesce(r->>'artwork_id', r->>'artist_id', r->>'institution_id') AS id) ix ON a.table_name = 'images'
    LEFT JOIN entity_index ie ON a.table_name = 'images' AND ie.type = ix.type::entity_type AND ie.id = ix.id::bigint
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
router.post('/preview', (req, res) => {
  res.type('html').send(renderMarkdown(String(req.body.text || '').slice(0, 100000)) || '');
});

// Place search for the map picker (src/admin/editor/map.js), proxied to OpenStreetMap's Nominatim so the browser
// needs no extra CSP exception and we can send the identifying User-Agent its usage policy asks for
// (https://operations.osmfoundation.org/policies/nominatim/: max 1 request/s, searches only on explicit submit).
// polygon_geojson + polygon_threshold: the boundary of regions/cities, simplified to ~500 m, as an area suggestion.
let lastGeocode = 0;
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json([]);
  const wait = lastGeocode + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocode = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '5', polygon_geojson: '1', polygon_threshold: '0.005',
    'accept-language': 'en' });
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'arthistory-admin/1.0 (+https://arthistory.piogino.ch)' },
      signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    const hits = await r.json();
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
// Symmetric types have no reverse entry (they already read both ways).
async function relationshipTypes(db, entityType, { reverse = false } = {}) {
  const { rows } = await db.query(`
    SELECT code, label, object_types::text[] AS object_types, false AS reverse, sort_order FROM relationship_types
    WHERE $1::entity_type = ANY (subject_types)
    UNION ALL
    SELECT '~' || code, inverse_label, subject_types::text[], true, sort_order FROM relationship_types
    WHERE $2 AND $1::entity_type = ANY (object_types) AND NOT is_symmetric
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

// ---------------------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------------------
function notFoundPage(req, res) {
  send(req, res, { title: 'Not found', status: 404, body: html`<h1>Not found</h1><p><a href="/">Dashboard</a></p>` });
}

router.param('plural', (req, res, next, plural) => {
  req.t = BY_FOLDER[plural];
  if (!req.t) return notFoundPage(req, res);
  next();
});

// Everything a form needs from the database: enum choices, suggestions from existing values, ref targets.
async function formContext(t) {
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
  const refs = {};
  for (const [key, kind] of Object.entries(t.fields)) {
    const target = kind === 'parent' ? t : kind.startsWith('ref:') ? BY_TYPE[kind.slice(4)] : null;
    if (target) refs[key] = (await adminPool.query(`SELECT slug, ${target.name} AS name FROM ${target.table} ORDER BY 2`)).rows;
  }
  return { enums, suggestions, refs, errorKeys: new Set() };
}

async function findEntity(t, slug) {
  if (!SLUG.test(slug)) return null;
  return (await readDocs(adminPool, t, 't.slug = $1', [slug]))[0] || null;
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
             ${t.imageFk ? `(SELECT i.url FROM images i WHERE i.${t.imageFk} = t.id ORDER BY i.position, i.id LIMIT 1)` : 'NULL'} AS image_url,
             (SELECT count(*)::int FROM relationships r WHERE (r.subject_type, r.subject_id) = ($${params.length + 1}::entity_type, t.id)
                                                           OR (r.object_type, r.object_id) = ($${params.length + 1}::entity_type, t.id)) AS rels
      FROM ${t.table} t) x
    ${q ? `WHERE score >= ${THRESHOLD} ORDER BY score DESC, name` : 'ORDER BY name'}
    LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`, [...params, t.type]);
  send(req, res, {
    title: humanize(t.folder),
    body: html`<h1>${humanize(t.folder)}</h1>
      <form class="bar" method="get"><input name="q" value="${q}" placeholder="Search name, other names or slug (typos are fine)" class="grow" type="search">
        <button class="secondary">Search</button><a class="button" href="/${t.folder}/new">+ New ${t.type}</a>
        <a class="button secondary" href="/${t.folder}/new/wikidata">+ from Wikidata…</a></form>
      ${rows.length ? html`<div class="table-wrap"><table${t.imageFk ? html` class="with-thumbs thumbs-${t.type}"` : ''}><thead><tr>${t.imageFk ? html`<th></th>` : ''}<th>Name</th><th>Slug</th><th>Links</th><th>Updated</th></tr></thead><tbody>
        ${rows.slice(0, PAGE).map((r) => html`<tr>${t.imageFk ? html`<td class="thumb">${r.image_url
          ? html`<a href="/${t.folder}/${r.slug}" tabindex="-1"><img src="${thumbUrl(r.image_url, 120)}" alt="" loading="lazy" decoding="async"></a>`
          : html`<span class="thumb-empty" title="no image"></span>`}</td>` : ''}<td><a href="/${t.folder}/${r.slug}">${r.name}</a>
          ${q && r.alt ? html`<div class="muted small">${r.alt}</div>` : ''}</td><td class="muted">${r.slug}</td>
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
  const title = e ? `Compare ${e.doc[t.name]} with Wikidata` : `New ${t.type} from Wikidata`;
  const page = { type: t.type, slug: e ? e.slug : null, mode: 'view' };
  const qid = String(req.query.q || (e && !req.query.search && e.doc.wikidata_id) || '').trim().toUpperCase();
  if (!/^Q[1-9][0-9]*$/.test(qid)) {
    const q = String(req.query.search ?? (e ? e.doc[t.name] : '')).trim();
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
    [req.user.id, t.type, JSON.stringify({ slug, ...base, ...form })]);
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
      ${entityForm({ t, slug: useDraft ? draft.form.slug || '' : '', f: useDraft ? formFromBody(draft.form) : docToForm({}, t.fields),
        ctx: await formContext(t), action: `/${t.folder}`, errors: [], isNew: true })}`,
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
  const row = toRow(doc, t.fields);
  errors.push(...row.errors);
  if (errors.length) return { errors };

  try {
    await withTx(user, async (db) => {
      const idOf = async (type, s) => (await db.query('SELECT entity_id($1, $2) AS id', [type, s])).rows[0].id;
      for (const r of row.refs) {
        const id = r.slug === null ? null : await idOf(r.type, r.slug);
        if (r.slug !== null && id === null) throw new UserError(`${r.type} "${r.slug}" does not exist.`);
        row.cols[r.col] = ['$', id];
      }
      if (t.fields.parent) {
        const id = row.parent === null ? null : await idOf(t.type, row.parent);
        if (row.parent !== null && id === null) throw new UserError(`parent ${t.type} "${row.parent}" does not exist.`);
        if (existing && id === existing.id) throw new UserError('An entity cannot be its own parent.');
        row.cols.parent_id = ['$', id];
      }
      const names = Object.keys(row.cols);
      const values = [slug];
      const exprs = names.map((c) => { values.push(row.cols[c][1]); return row.cols[c][0].replace('$', () => `$${values.length}`); });
      if (!existing) {
        await db.query(`INSERT INTO ${t.table} (slug, ${names.join(', ')}) VALUES ($1, ${exprs.join(', ')})`, values);
        return;
      }
      // Optimistic locking: only if nobody saved this row since the form was opened.
      values.push(existing.id, String(body.version || ''));
      const { rowCount } = await db.query(`
        UPDATE ${t.table} SET slug = $1, ${names.map((c, i) => `${c} = ${exprs[i]}`).join(', ')}
        WHERE id = $${values.length - 1} AND updated_at::text = $${values.length}`, values);
      if (!rowCount) throw new UserError('Someone saved this record while you were editing. Open it again to see their changes, then redo yours.');
    });
  } catch (err) {
    return { errors: [friendly(err)] };
  }
  return { slug };
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
    return send(req, res, {
      title: `New ${t.type}`, status: 422,
      page: { type: t.type, slug: null, mode: 'new' },
      body: html`<h1>New ${t.type}</h1>${entityForm({ t, slug: req.body.slug, f: formFromBody(req.body), ctx, action: `/${t.folder}`, errors: result.errors, isNew: true })}`,
    });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, null);
  res.redirect(303, `/${t.folder}/${result.slug}?done=created`);
});

// Display of one field's value on the view page.
function showValue(t, key, kind, doc) {
  const v = doc[key];
  if (kind === 'md') return v ? html`<div class="md">${raw(renderMarkdown(v))}</div>` : null;
  if (kind === 'date' || kind === 'period') {
    if (v === undefined) return doc[`${key}_label`] || null;
    const generated = parseFuzzyDate(v, { openEnd: kind === 'period' }).label;
    return html`${doc[`${key}_label`] || generated} <span class="muted">(${v})</span>`;
  }
  if (v === undefined) return null;
  if (kind === 'text[]') return v.join(' · ');
  if (kind === 'dimensions') return `${v.join(' × ')} cm${doc.dimensions_note ? ` (${doc.dimensions_note})` : ''}`;
  if (kind === 'point') return html`${v[1]}, ${v[0]} <a href="https://www.openstreetmap.org/?mlat=${v[1]}&mlon=${v[0]}#map=12/${v[1]}/${v[0]}" rel="noopener" target="_blank">map ↗</a>`;
  if (kind === 'json' || kind === 'area') return html`<pre>${JSON.stringify(v, null, 2)}</pre>`;
  if (kind === 'parent') return html`<a href="/${t.folder}/${v}">${v}</a>`;
  if (kind.startsWith('ref:')) return html`<a href="/${BY_TYPE[kind.slice(4)].folder}/${v}">${v}</a>`;
  if (/_url$/.test(key)) return html`<a href="${v}" rel="noopener" target="_blank">${v}</a>`;
  return v;
}

router.get('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const [outgoing, incoming, types, entities] = await Promise.all([
    readRelationships(adminPool, t.type, e.id),
    adminPool.query(`
      SELECT r.id, s.type::text AS type, s.slug, s.name, rt.inverse_label, r.period_label, r.label
      FROM relationships r JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
      JOIN relationship_types rt ON rt.code = r.relationship_type
      WHERE r.object_type = $1 AND r.object_id = $2 ORDER BY rt.sort_order, lower(r.period) NULLS FIRST`, [t.type, e.id]),
    relationshipTypes(adminPool, t.type, { reverse: true }),
    allEntities(adminPool),
  ]);
  const labels = Object.fromEntries(types.map((x) => [x.code, x.label]));
  const name = e.doc[t.name];
  const qa = await quality.issues(adminPool, { entity: { type: t.type, id: e.id } });
  const pending = await collab.unpublished(t, e.id);
  const imgs = t.imageFk ? await readImages(adminPool, t.type, e.id) : [];
  const main = imgs[0];
  send(req, res, {
    title: name, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}">${humanize(t.folder)}</a> / ${e.slug}</p>
      <div class="bar"><h1 class="grow">${name}</h1>
        <a class="button" href="/${t.folder}/${e.slug}/edit">Edit</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/wikidata">Wikidata…</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/history">History</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/delete">Delete</a></div>
      ${pending ? unpublishedBanner(t, e, pending, false) : ''}
      ${quality.entityBox(qa, `/${t.folder}/${e.slug}`)}
      ${main ? html`<figure class="image-preview"><a href="${main.source_url || main.url}" target="_blank" rel="noopener">
        <img src="${thumbUrl(main.url, 500)}" alt="${name}"></a>
        <figcaption class="muted small">${[main.caption, main.credit, main.license].filter(Boolean).join(' · ') || 'no credit / license yet'}
          ${imgs.length > 1 ? html` · <a href="#images">${imgs.length} images</a>` : ''}</figcaption></figure>` : ''}
      <dl class="fields">${Object.entries(t.fields).filter(([k]) => k !== t.name && !(k === 'dimensions_note' && e.doc.dimensions)).map(([key, kind]) => {
        const shown = showValue(t, key, kind, e.doc);
        return shown === null ? '' : html`<dt>${humanize(key)}</dt><dd>${shown}</dd>`;
      })}</dl>
      ${t.imageFk ? images.section({ t, e, images: imgs, licenseList: await images.licenses(adminPool) }) : ''}
      <h2 id="relationships">Relationships</h2>
      ${outgoing.length ? html`<div class="table-wrap"><table><tbody>${outgoing.map(({ id, to_name: toName, rel }) => {
        const [type, slug] = rel.to.split('/');
        return html`<tr><td>${labels[rel.type] || rel.type}</td>
          <td><a href="/${BY_TYPE[type].folder}/${slug}">${toName}</a> <span class="tag">${type}</span></td>
          <td>${rel.period_label || (rel.period ? parseFuzzyDate(String(rel.period), { openEnd: true }).label : '')}</td>
          <td class="muted">${[rel.label, rel.certainty].filter(Boolean).join(' · ')}</td>
          <td><a href="/relationships/${id}/edit">edit</a></td></tr>`;
      })}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}
      ${incoming.rows.length ? html`<h3>Linked from</h3><div class="table-wrap"><table><tbody>${incoming.rows.map((r) => html`<tr>
          <td>${r.inverse_label}</td><td><a href="/${BY_TYPE[r.type].folder}/${r.slug}">${r.name}</a> <span class="tag">${r.type}</span></td>
          <td>${r.period_label || ''}</td><td class="muted">${r.label || ''}</td>
          <td><a href="/relationships/${r.id}/edit">edit</a></td></tr>`)}</tbody></table></div>` : ''}
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
      body: html`<h1>Add relationship</h1><p><a href="/${t.folder}/${e.slug}">← ${e.doc[t.name]}</a></p>
        ${relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Add', entityType: t.type })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=rel-added#relationships`);
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
      body: html`<h1>Add image</h1><p><a href="/${t.folder}/${e.slug}">← ${e.doc[t.name]}</a></p>
        ${images.form({ action: `/${t.folder}/${e.slug}/images`, img: req.body, submit: 'Add', licenseList: await images.licenses(adminPool) })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=img-added#images`);
});

router.get('/:plural/:slug/edit', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  // The shared working copy (collab.js): the page shows it even before scripts connect, then stays bound to it.
  const { form: working, epoch, state } = await collab.currentForm(t, e.id);
  const pending = await collab.unpublished(t, e.id);
  const banner = pending ? unpublishedBanner(t, e, pending, true) : '';
  const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx: await formContext(t),
    action: `/${t.folder}/${e.slug}`, errors: [], version: working.version, collab: { key: `${t.type}:${e.id}:${epoch}`, state } });
  send(req, res, { title: `Edit ${e.doc[t.name]}`, page: { type: t.type, slug: e.slug, mode: 'edit' },
    body: html`<h1>Edit ${e.doc[t.name]}</h1>${banner}${form}` });
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
    const ctx = await formContext(t);
    ctx.errorKeys = errorKeysOf(result.errors);
    const form = entityForm({ t, slug: working.slug || e.slug, f: formFromBody(working), ctx,
      action: `/${t.folder}/${e.slug}`, errors: result.errors, version: working.version, collab: { key: `${t.type}:${e.id}:${epoch}`, state } });
    return send(req, res, { title: `Edit ${e.doc[t.name]}`, status: 422, page: { type: t.type, slug: e.slug, mode: 'edit' },
      body: html`<h1>Edit ${e.doc[t.name]}</h1>${form}` });
  }
  await drafts.deleteDraft(adminPool, req.user.id, t.type, e.id);  // step-1 draft, if any from before
  await collab.publishedNow(t, e.id, req.user.username);
  res.redirect(303, `/${t.folder}/${result.slug}?done=published`);
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
    title: `Discard unpublished changes · ${e.doc[t.name]}`,
    page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<h1>Discard unpublished changes?</h1>
      ${changed.length ? html`<p>The working copy of <b>${e.doc[t.name]}</b> differs from the published version in:
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
    title: `Delete ${e.doc[t.name]}`,
    body: html`<h1>Delete ${e.doc[t.name]}?</h1>
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
      title: `Delete ${e.doc[t.name]}`, status: 409, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Can't delete ${e.doc[t.name]}</h1><p>Other records still point to it (see above). Change or delete those first.</p>
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
      OR (a.table_name = 'images' AND (r->>($3 || '_id'))::bigint = $2)`,
  [t.table, e.id, t.type], { offset: (page - 1) * PAGE });
  send(req, res, {
    title: `History of ${e.doc[t.name]}`, page: { type: t.type, slug: e.slug, mode: 'view' },
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.doc[t.name]}</a></p><h1>History</h1>
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
