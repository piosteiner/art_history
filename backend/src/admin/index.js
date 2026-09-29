// Admin panel (admin.arthistory.piogino.ch/…): server-rendered pages, forms generated from src/content.js.
// Writes go through arthistory_admin in a transaction tagged with the user, so the audit_log trigger records who.
//
//   /                          dashboard: counts + recent changes
//   /<plural>                  list + search            /<plural>/new        create
//   /<plural>/<slug>           view + relationships     /<plural>/<slug>/edit · /delete · /history
//   /relationships/<id>/edit   edit one relationship    /history             all changes
const express = require('express');
const path = require('path');
const { adminPool } = require('../db');
const { TYPES, BY_FOLDER, BY_TYPE, SLUG, toRow, readDocs, readRelationships } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');
const { renderMarkdown } = require('../markdown');
const { html, raw, layout } = require('./html');
const { login, logout, loadUser, checkOrigin } = require('./auth');
const { docToForm, formToDoc, entityForm, humanize, HINTS } = require('./forms');

const router = express.Router();
const PAGE = 50;
const an = (word) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;

router.use('/static', express.static(path.join(__dirname, 'static'), { index: false, maxAge: '1h' }));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(express.urlencoded({ extended: false, limit: '1mb' }));
router.use(checkOrigin);
router.use(loadUser);

// Fixed messages for ?done=… after a redirect (never reflect arbitrary text).
const DONE = {
  created: 'Created.', saved: 'Saved.', deleted: 'Deleted.', unchanged: 'No changes.',
  'rel-added': 'Relationship added.', 'rel-saved': 'Relationship saved.', 'rel-deleted': 'Relationship deleted.',
};

function send(req, res, { title, body, status = 200, flash }) {
  if (!flash && DONE[req.query.done]) flash = { kind: 'ok', text: DONE[req.query.done] };
  res.status(status).type('html').send(String(layout({ title, body, user: req.user, flash })));
}

// One transaction per save; set_config(…, true) is transaction-local, so the pooled connection forgets it at COMMIT.
async function withTx(user, fn) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', 'admin', true)",
      [String(user.id)]);
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
};
function friendly(err) {
  if (err instanceof UserError) return err.message;
  if (err.code === '23505') return /slug/.test(err.constraint || '') ? 'That slug is already taken.' : `Duplicate: ${err.detail || err.message}`;
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
// A deleted entity's name comes from its last recorded version (table name = type + 's').
const GONE_NAME = `(SELECT coalesce(x.old_row->>'name', x.old_row->>'title') FROM audit_log x
  WHERE x.table_name = ($T) || 's' AND x.row_id = ($I)::bigint AND x.old_row IS NOT NULL ORDER BY x.id DESC LIMIT 1)`;
async function history(db, where, params, { limit = PAGE, offset = 0 } = {}) {
  const gone = (typeExpr, idExpr) => `coalesce(${GONE_NAME.replace('$T', () => typeExpr).replace('$I', () => idExpr)}, (${typeExpr}) || ' #' || (${idExpr}))`;
  const { rows } = await db.query(`
    SELECT a.id, a.changed_at, a.action, a.source, a.table_name, a.row_id, u.username,
           CASE WHEN a.table_name = 'relationships'
             THEN concat_ws(' ', coalesce(s.name, ${gone("r->>'subject_type'", "r->>'subject_id'")}), '—',
                            rt.label, '→', coalesce(o.name, ${gone("r->>'object_type'", "r->>'object_id'")}))
             ELSE coalesce(r->>'name', r->>'title', r->>'slug') END AS what,
           CASE WHEN a.table_name = 'relationships' THEN s.type::text || 's/' || s.slug
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

function historyTable(rows, { showWhat = true } = {}) {
  if (!rows.length) return html`<p class="muted">No changes recorded yet.</p>`;
  return html`<div class="table-wrap"><table class="diff"><thead><tr><th>When</th><th>Who</th>${showWhat ? html`<th>What</th>` : ''}<th>Changes</th></tr></thead><tbody>
  ${rows.map((h) => {
    const entries = Object.entries(h.diff || {}).filter(([, [o, n]]) => !(h.action !== 'update' && (o ?? n) === null));
    return html`<tr>
      <td><span title="${h.changed_at.toISOString()}">${h.changed_at.toISOString().slice(0, 16).replace('T', ' ')}</span></td>
      <td>${h.username || html`<span class="muted">—</span>`} <span class="tag">${h.source}</span></td>
      ${showWhat ? html`<td><span class="tag">${h.action}</span> ${h.link ? html`<a href="/${h.link}">${h.what}</a>` : h.what}</td>` : ''}
      <td>${h.action === 'update' ? html`<table>${entries.map(([k, [o, n]]) => html`<tr><th>${k}</th><td class="old">${short(o)}</td><td class="new">${short(n)}</td></tr>`)}</table>`
        : html`<span class="tag">${h.action}</span> <span class="muted">${entries.map(([k, [o, n]]) => `${k}: ${short(o ?? n)}`).join(' · ')}</span>`}</td>
    </tr>`;
  })}</tbody></table></div>`;
}

const pager = (base, page, more) => html`<div class="actions">
  ${page > 1 ? html`<a href="${base}${base.includes('?') ? '&' : '?'}page=${page - 1}">← newer</a>` : ''}
  ${more ? html`<a href="${base}${base.includes('?') ? '&' : '?'}page=${page + 1}">older →</a>` : ''}</div>`;

const pageParam = (req) => Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));

// ---------------------------------------------------------------------------------------------------------------
// Dashboard + global history
// ---------------------------------------------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const counts = Object.fromEntries((await adminPool.query(
    'SELECT type::text, count(*)::int AS n FROM entity_index GROUP BY type')).rows.map((r) => [r.type, r.n]));
  const rels = (await adminPool.query('SELECT count(*)::int AS n FROM relationships')).rows[0].n;
  const recent = await history(adminPool, 'true', [], { limit: 15 });
  send(req, res, {
    title: 'Dashboard',
    body: html`<h1>Dashboard</h1>
      <div class="cards">${TYPES.map((t) => html`<a class="card" href="/${t.folder}"><b>${counts[t.type] || 0}</b>${humanize(t.folder)}</a>`)}
        <div class="card"><b>${rels}</b>Relationships</div></div>
      <h2>Recent changes</h2>${historyTable(recent.rows)}
      <p><a href="/history">All changes →</a></p>`,
  });
});

router.get('/history', async (req, res) => {
  const page = pageParam(req);
  const h = await history(adminPool, 'true', [], { offset: (page - 1) * PAGE });
  send(req, res, { title: 'History', body: html`<h1>History</h1>${historyTable(h.rows)}${pager('/history', page, h.more)}` });
});

// ---------------------------------------------------------------------------------------------------------------
// Relationships (declared on the subject's page)
// ---------------------------------------------------------------------------------------------------------------
async function relationshipTypes(db, subjectType) {
  const { rows } = await db.query(`
    SELECT code, label, object_types::text[] AS object_types FROM relationship_types
    WHERE $1::entity_type = ANY (subject_types) ORDER BY sort_order`, [subjectType]);
  return rows;
}

async function allEntities(db) {
  const { rows } = await db.query("SELECT type::text || '/' || slug AS ref, name, type::text AS type FROM entity_index ORDER BY name");
  return rows;
}

// Form body → validated params for INSERT/UPDATE relationships. Throws UserError.
async function relFromForm(db, body, subject, keepMetadata = {}) {
  const type = String(body.type || '');
  const types = await relationshipTypes(db, subject.type);
  const rt = types.find((x) => x.code === type);
  if (!rt) throw new UserError(`"${type}" is not a relationship type for ${an(subject.type)}.`);
  const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(String(body.to || '').trim());
  if (!m) throw new UserError('Target must look like place/paris — pick one from the suggestions.');
  if (!rt.object_types.includes(m[1])) throw new UserError(`"${rt.label}" needs ${rt.object_types.map(an).join(' or ')} as target, not ${an(m[1])}.`);
  const objectId = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
  if (objectId === null) throw new UserError(`${m[0]} does not exist.`);
  let period = null;
  try { period = parseFuzzyDate(String(body.period || '').trim() || null, { openEnd: true }); } catch (err) { throw new UserError(`Period: ${err.message}`); }
  const opt = (k) => String(body[k] || '').replace(/\r\n/g, '\n').trim() || null;
  const sources = String(body.sources || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const { sources: _old, ...rest } = keepMetadata;
  const certainty = ['attested', 'probable', 'possible', 'disputed'].includes(body.certainty) ? body.certainty : 'attested';
  return [subject.type, subject.id, type, m[1], objectId, period && period.range,
    opt('period_label') ?? (period && period.label), opt('label'), certainty, opt('notes_md'),
    JSON.stringify(sources.length ? { ...rest, sources } : rest)];
}

function relForm({ action, types, entities, rel = {}, submit }) {
  const v = (k) => rel[k] ?? '';
  return html`<form method="post" action="${action}" class="form">
    <div class="row">
      <div class="field"><label for="r-type">Relationship</label>
        <select id="r-type" name="type" required>${types.map((t) => html`<option value="${t.code}"${t.code === rel.type ? ' selected' : ''}>${t.label} (${t.object_types.join(', ')})</option>`)}</select></div>
      <div class="field"><label for="r-to">Target</label>
        <input id="r-to" name="to" value="${v('to')}" list="r-to-list" required placeholder="type a name, pick e.g. place/paris" autocomplete="off">
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
    <div class="field"><label for="r-notes">Notes</label><textarea id="r-notes" name="notes_md" rows="2">${v('notes_md')}</textarea><div class="hint">${HINTS.md}</div></div>
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
  for (const key of ['kind', 'medium', 'image_license']) {
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
  const params = [];
  let where = 'true';
  if (q) {
    params.push(q);
    where = `(f_unaccent(t.${t.name}) ILIKE '%' || f_unaccent($1) || '%' OR t.slug ILIKE '%' || $1 || '%')`;
  }
  const { rows } = await adminPool.query(`
    SELECT t.slug, t.${t.name} AS name, t.updated_at,
           (SELECT count(*)::int FROM relationships r WHERE (r.subject_type, r.subject_id) = ($${params.length + 1}::entity_type, t.id)
                                                         OR (r.object_type, r.object_id) = ($${params.length + 1}::entity_type, t.id)) AS rels
    FROM ${t.table} t WHERE ${where} ORDER BY t.${t.name}
    LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`, [...params, t.type]);
  send(req, res, {
    title: humanize(t.folder),
    body: html`<h1>${humanize(t.folder)}</h1>
      <form class="bar" method="get"><input name="q" value="${q}" placeholder="Search name or slug" class="grow" type="search">
        <button class="secondary">Search</button><a class="button" href="/${t.folder}/new">+ New ${t.type}</a></form>
      ${rows.length ? html`<div class="table-wrap"><table><thead><tr><th>Name</th><th>Slug</th><th>Links</th><th>Updated</th></tr></thead><tbody>
        ${rows.slice(0, PAGE).map((r) => html`<tr><td><a href="/${t.folder}/${r.slug}">${r.name}</a></td><td class="muted">${r.slug}</td>
          <td>${r.rels}</td><td class="muted">${r.updated_at.toISOString().slice(0, 10)}</td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nothing found.</p>`}
      ${pager(`/${t.folder}${q ? `?q=${encodeURIComponent(q)}` : ''}`, page, rows.length > PAGE)}`,
  });
});

router.get('/:plural/new', async (req, res) => {
  const { t } = req;
  send(req, res, {
    title: `New ${t.type}`,
    body: html`<h1>New ${t.type}</h1>${entityForm({ t, slug: '', f: docToForm({}, t.fields), ctx: await formContext(t), action: `/${t.folder}`, errors: [], isNew: true })}`,
  });
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
      body: html`<h1>New ${t.type}</h1>${entityForm({ t, slug: req.body.slug, f: formFromBody(req.body), ctx, action: `/${t.folder}`, errors: result.errors, isNew: true })}`,
    });
  }
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
    relationshipTypes(adminPool, t.type),
    allEntities(adminPool),
  ]);
  const labels = Object.fromEntries(types.map((x) => [x.code, x.label]));
  const name = e.doc[t.name];
  send(req, res, {
    title: name,
    body: html`<p class="muted"><a href="/${t.folder}">${humanize(t.folder)}</a> / ${e.slug}</p>
      <div class="bar"><h1 class="grow">${name}</h1>
        <a class="button" href="/${t.folder}/${e.slug}/edit">Edit</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/history">History</a>
        <a class="button secondary" href="/${t.folder}/${e.slug}/delete">Delete</a></div>
      <dl class="fields">${Object.entries(t.fields).filter(([k]) => k !== t.name).map(([key, kind]) => {
        const shown = showValue(t, key, kind, e.doc);
        return shown === null ? '' : html`<dt>${humanize(key)}</dt><dd>${shown}</dd>`;
      })}</dl>
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
        ${types.length ? relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, submit: 'Add' })
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
      const p = await relFromForm(db, req.body, { type: t.type, id: e.id });
      await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period,
        period_label, label, certainty, notes_md, metadata) VALUES ($1, $2, $3, $4, $5, $6::daterange, $7, $8, $9, $10, $11::jsonb)`, p);
    });
  } catch (err) {
    const [types, entities] = await Promise.all([relationshipTypes(adminPool, t.type), allEntities(adminPool)]);
    return send(req, res, {
      title: 'Add relationship', status: 422, flash: { kind: 'error', text: friendly(err) },
      body: html`<h1>Add relationship</h1><p><a href="/${t.folder}/${e.slug}">← ${e.doc[t.name]}</a></p>
        ${relForm({ action: `/${t.folder}/${e.slug}/relationships`, types, entities, rel: { ...req.body, sources: String(req.body.sources || '').split('\n') }, submit: 'Add' })}`,
    });
  }
  res.redirect(303, `/${t.folder}/${e.slug}?done=rel-added#relationships`);
});

router.get('/:plural/:slug/edit', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const form = entityForm({ t, slug: e.slug, f: docToForm(e.doc, t.fields), ctx: await formContext(t),
    action: `/${t.folder}/${e.slug}`, errors: [], version: e.version });
  send(req, res, { title: `Edit ${e.doc[t.name]}`, body: html`<h1>Edit ${e.doc[t.name]}</h1>${form}` });
});

router.post('/:plural/:slug', async (req, res) => {
  const { t } = req;
  const e = await findEntity(t, req.params.slug);
  if (!e) return notFoundPage(req, res);
  const result = await saveEntity(req.user, t, req.body, e);
  if (result.errors) {
    const ctx = await formContext(t);
    ctx.errorKeys = errorKeysOf(result.errors);
    const form = entityForm({ t, slug: req.body.slug, f: formFromBody(req.body), ctx,
      action: `/${t.folder}/${e.slug}`, errors: result.errors, version: req.body.version });
    return send(req, res, { title: `Edit ${e.doc[t.name]}`, status: 422, body: html`<h1>Edit ${e.doc[t.name]}</h1>${form}` });
  }
  res.redirect(303, `/${t.folder}/${result.slug}?done=saved`);
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
      ((r->>'subject_type') = $3 AND (r->>'subject_id')::bigint = $2) OR ((r->>'object_type') = $3 AND (r->>'object_id')::bigint = $2)))`,
  [t.table, e.id, t.type], { offset: (page - 1) * PAGE });
  send(req, res, {
    title: `History of ${e.doc[t.name]}`,
    body: html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.doc[t.name]}</a></p><h1>History</h1>
      ${historyTable(h.rows)}${pager(`/${t.folder}/${e.slug}/history`, page, h.more)}`,
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
