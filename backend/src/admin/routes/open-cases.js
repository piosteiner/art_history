// Admin panel — open cases (migration 198, owner 2026-11-03): what can't be solved at once, moved out of the Quality
// page (or opened from an entry) with a description, followed up here. While a case is open its finding is left out
// of the Quality page (quality.js: issues(), counts()); closed with a result, the finding — if it still holds — is back.
// The list groups the open cases by where the answer is to be found: a source of the bibliography (a book with its
// shelfmark), else the host of a link (the library catalogue), else "no place given".
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { renderMarkdown, linkNames } = require('../../markdown');
const { html, raw } = require('../html');
const quality = require('../quality');
const { send, withTx, friendly, notFoundPage, findEntity } = require('../core');

const router = express.Router();
const ID = /^[1-9][0-9]*$/;
const day = (d) => (d ? d.toISOString().slice(0, 10) : '');
const entryLink = (c) => (c.slug ? `/${BY_TYPE[c.entity_type].folder}/${c.slug}` : null);
// a "back" address of this panel only (the Quality page with its filter, an entry page)
const backTo = (b, fallback) => (typeof b === 'string' && /^\/[a-z0-9/_?=&.%#-]*$/i.test(b) && !b.startsWith('//') ? b : fallback);

const SELECT = `
  SELECT oc.*, oc.entity_type::text AS entity_type, e.slug, e.name, b.slug AS source_slug, coalesce(b.siglum, b.name) AS source_label,
         b.shelfmark AS source_shelfmark, b.archive AS source_archive, b.url AS source_url,
         cu.username AS created_by_name, xu.username AS closed_by_name
  FROM open_cases oc
  LEFT JOIN entity_index e ON (e.type, e.id) = (oc.entity_type, oc.entity_id)
  LEFT JOIN bibliography b ON b.id = oc.source_id
  LEFT JOIN admin_users cu ON cu.id = oc.created_by
  LEFT JOIN admin_users xu ON xu.id = oc.closed_by`;

// a case's updates (214), oldest first — a log reads downwards; attached to each case as c.updates
async function withUpdates(db, cases) {
  if (!cases.length) return cases;
  const { rows } = await db.query(`SELECT u.*, au.username AS by_name FROM open_case_updates u LEFT JOIN admin_users au ON au.id = u.created_by
    WHERE u.case_id = ANY($1) ORDER BY u.case_id, u.on_day, u.id`, [cases.map((c) => c.id)]);
  for (const c of cases) c.updates = rows.filter((u) => String(u.case_id) === String(c.id));
  return cases;
}
/** The open cases of one entry (the box on its page). */
async function ofEntry(db, type, id) {
  return withUpdates(db, (await db.query(`${SELECT} WHERE oc.entity_type = $1 AND oc.entity_id = $2 AND oc.closed_at IS NULL ORDER BY oc.created_at`, [type, id])).rows);
}
/** The texts of cases and their updates, for the [[link]] names of the Markdown. */
const textsOf = (cases) => cases.flatMap((c) => [c.description_md, c.resolution_md, ...(c.updates || []).map((u) => u.text_md)]);
// today in Zürich (the date field's default): the day of the work, not UTC's
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const dayOf = (d) => (d instanceof Date ? d.toLocaleDateString('sv-SE') : String(d || '').slice(0, 10));
/** How many cases are open (the menu, the Quality page). */
async function openCount(db) {
  return (await db.query('SELECT count(*)::int AS n FROM open_cases WHERE closed_at IS NULL')).rows[0].n;
}

// where to look: a source of the bibliography (with shelfmark), else the link's host
const whereOf = (c) => (c.source_slug ? `source:${c.source_slug}` : c.look_url ? `url:${new URL(c.look_url).hostname.replace(/^www\./, '')}` : '');
const whereLabel = (c) => (c.source_slug
  ? html`<a href="/bibliography/${c.source_slug}">${c.source_label}</a>${c.source_archive || c.source_shelfmark ? html` <span class="muted">— ${[c.source_archive, c.source_shelfmark].filter(Boolean).join(', ')}</span>` : ''}`
  : c.look_url ? new URL(c.look_url).hostname.replace(/^www\./, '') : 'No place given');

function caseItem(c, names, { back = '/open-cases' } = {}) {
  const link = entryLink(c);
  const check = c.check_id ? (quality.CHECKS[c.check_id] || {}).title || c.check_id : null;
  return html`<li class="oc-case" id="case-${String(c.id)}">
    <div class="oc-head">${link ? html`<a href="${link}"><b>${c.name}</b></a>` : html`<i>deleted entry</i>`} <span class="tag">${c.entity_type}</span>
      ${check ? html`<span class="tag oc-check">${check}</span>` : ''}
      <span class="muted small">opened ${day(c.created_at)}${c.created_by_name ? ` by ${c.created_by_name}` : ''}</span></div>
    ${c.finding ? html`<div class="muted small oc-finding">${c.finding}</div>` : ''}
    <div class="md oc-text">${raw(renderMarkdown(c.description_md, { names }))}</div>
    ${c.look_url ? html`<p class="small"><a href="${c.look_url}" rel="noopener" target="_blank">${c.look_url}</a></p>` : ''}
    ${(c.updates || []).length ? html`<ol class="oc-updates">${c.updates.map((u) => html`<li id="update-${String(u.id)}">
      <span class="oc-update-day">${dayOf(u.on_day)}</span>${u.by_name ? html` <span class="muted small">${u.by_name}</span>` : ''}
      <div class="md">${raw(renderMarkdown(u.text_md, { names }))}</div>
      ${!c.closed_at ? html`<form method="post" action="/open-cases/${String(c.id)}/updates/${String(u.id)}/delete" class="inline oc-update-delete">
        <input type="hidden" name="back" value="${back}"><button class="link small" title="Delete this update">delete</button></form>` : ''}</li>`)}</ol>` : ''}
    ${c.closed_at
      ? html`<div class="oc-result"><b>Closed ${day(c.closed_at)}${c.closed_by_name ? ` by ${c.closed_by_name}` : ''}:</b>
          ${c.resolution_md ? html`<div class="md">${raw(renderMarkdown(c.resolution_md, { names }))}</div>` : ''}
          <form method="post" action="/open-cases/${String(c.id)}/reopen" class="inline"><input type="hidden" name="back" value="${back}"><button class="link">reopen</button></form></div>`
      : html`<div class="actions oc-actions">
          <details class="oc-update-add"><summary class="button">Add an update…</summary>
            <form method="post" action="/open-cases/${String(c.id)}/updates" class="form">
              <input type="hidden" name="back" value="${back}">
              <div class="field"><label for="upd-day-${String(c.id)}">Date</label>
                <input id="upd-day-${String(c.id)}" name="on_day" type="date" value="${today()}" required max="${today()}"></div>
              <div class="field"><label for="upd-${String(c.id)}">What happened</label>
                <textarea id="upd-${String(c.id)}" name="text_md" rows="4" class="md" required placeholder="asked the library; the catalogue has no picture either …"></textarea></div>
              <button>Add the update</button></form></details>
          <a class="button secondary" href="/open-cases/${String(c.id)}/edit?back=${encodeURIComponent(back)}">Edit</a>
          <details class="oc-close"><summary class="button danger-outline" title="Closes the case with a result — reopen it from the list if needed">Close the case…</summary>
            <form method="post" action="/open-cases/${String(c.id)}/close" class="form">
              <input type="hidden" name="back" value="${back}">
              <div class="field"><label for="res-${String(c.id)}">Result</label>
                <textarea id="res-${String(c.id)}" name="resolution_md" rows="4" class="md" placeholder="what was found, where — the entry corrected?"></textarea></div>
              <button class="danger">Close the case</button></form></details></div>`}
  </li>`;
}

/** The box on an entry's admin page: its open cases, and a link to open one. */
function entryBox(t, e, cases, names) {
  return html`<div class="oc-box${cases.length ? ' has-cases' : ''}">
    ${cases.length ? html`<b>Open case${cases.length === 1 ? '' : 's'}:</b><ul class="oc-list">${cases.map((c) => caseItem(c, names, { back: `/${t.folder}/${e.slug}` }))}</ul>` : ''}
    <a class="small" href="/open-cases/new?type=${t.type}&amp;slug=${encodeURIComponent(e.slug)}&amp;back=${encodeURIComponent(`/${t.folder}/${e.slug}`)}">+ Open a case for this entry</a></div>`;
}

router.get('/open-cases', async (req, res) => {
  const open = await withUpdates(adminPool, (await adminPool.query(`${SELECT} WHERE oc.closed_at IS NULL ORDER BY oc.created_at`)).rows);
  const closed = await withUpdates(adminPool, (await adminPool.query(`${SELECT} WHERE oc.closed_at IS NOT NULL ORDER BY oc.closed_at DESC LIMIT 50`)).rows);
  const names = await linkNames(adminPool, textsOf([...open, ...closed]));
  const groups = new Map();
  for (const c of open) {
    const k = whereOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  // places first (a library visit takes them all), "no place given" last
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b));
  send(req, res, { title: 'Open cases', body: html`<h1>Open cases <span class="muted">(${open.length})</span></h1>
    <p class="muted">Questions that take longer than a look — a book to consult, a museum to ask. Moved here from the
      <a href="/quality">Quality page</a> (“Open case…” next to a finding) or opened from an entry. While a case is open,
      its finding is left out of the Quality page; closed, it shows there again if it still holds.</p>
    ${!open.length ? html`<p class="flash ok">No open cases.</p>` : ''}
    ${ordered.map(([, list]) => html`<section class="oc-group"><h2>${whereLabel(list[0])} <span class="muted">(${list.length})</span></h2>
      <ul class="oc-list">${list.map((c) => caseItem(c, names))}</ul></section>`)}
    ${closed.length ? html`<details class="oc-closed"><summary><h2>Closed (${closed.length}${closed.length === 50 ? ', the latest' : ''})</h2></summary>
      <ul class="oc-list">${closed.map((c) => caseItem(c, names))}</ul></details>` : ''}` });
});

function form({ e, t, values = {}, action, submit, finding = null, back }) {
  const v = (k) => values[k] ?? '';
  return html`<form method="post" action="${action}" class="form oc-form">
    <input type="hidden" name="back" value="${back}">
    <input type="hidden" name="check_id" value="${v('check_id')}"><input type="hidden" name="issue_key" value="${v('issue_key')}">
    <p>For <a href="/${t.folder}/${e.slug}"><b>${e.name}</b></a> <span class="tag">${t.type}</span></p>
    ${finding ? html`<p class="qa-box">Finding moved here: <b>${(quality.CHECKS[values.check_id] || {}).title || values.check_id}</b> — ${finding}
      <input type="hidden" name="finding" value="${finding}"></p>` : ''}
    <div class="field"><label for="oc-text">Description</label>
      <textarea id="oc-text" name="description_md" rows="8" class="md" required placeholder="What is open, what to compare — e.g. the provenance against the catalogue">${v('description_md')}</textarea>
      <div class="hint">Markdown as in every text: [[type/slug]] links, [[source/…]] footnotes, lists.</div></div>
    <div class="row">
      <div class="field"><label for="oc-source">Where to look: a source</label>
        <input id="oc-source" name="source" value="${v('source')}" placeholder="start typing: a book, an archive …" autocomplete="off" data-lookup="source">
        <div class="hint">A source of the bibliography — with its shelfmark the list is your library list. Empty = none.</div></div>
      <div class="field"><label for="oc-url">… or a link</label>
        <input id="oc-url" name="look_url" value="${v('look_url')}" type="url" placeholder="https://uzb.swisscovery.ch/permalink/…">
        <div class="hint">The catalogue record, the archive's page.</div></div></div>
    <p class="actions"><button>${submit}</button> <a href="${back}">Cancel</a></p></form>`;
}

// checked values from a form → { row } or { error }
async function checked(db, body) {
  const text = String(body.description_md ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return { error: 'a case needs a description' };
  const url = String(body.look_url ?? '').trim();
  if (url && !/^https?:\/\/\S+$/.test(url)) return { error: 'the link must start with http:// or https://' };
  let sourceId = null;
  const slug = String(body.source ?? '').trim();
  if (slug) {
    const { rows } = await db.query('SELECT id FROM bibliography WHERE slug = $1', [slug]);
    if (!rows.length) return { error: `no source “${slug}” in the bibliography` };
    sourceId = rows[0].id;
  }
  return { row: { description_md: text, look_url: url || null, source_id: sourceId } };
}

async function entryOf(req, res) {
  const t = BY_TYPE[req.query.type || req.body.type];
  const slug = req.query.slug || req.body.slug;
  const e = t && typeof slug === 'string' ? await findEntity(t, slug) : null;
  if (!e) { notFoundPage(req, res); return {}; }
  return { t, e };
}

router.get('/open-cases/new', async (req, res) => {
  const { t, e } = await entryOf(req, res); if (!e) return;
  const back = backTo(req.query.back, `/${t.folder}/${e.slug}`);
  // from the Quality page: the finding it parks (as stored now)
  let finding = null;
  const values = {};
  if (req.query.check && req.query.key) {
    const { rows } = await adminPool.query('SELECT detail FROM quality_issues WHERE check_id = $1 AND issue_key = $2 AND entity_type = $3 AND entity_id = $4',
      [req.query.check, req.query.key, t.type, e.id]);
    if (rows.length) Object.assign(values, { check_id: req.query.check, issue_key: req.query.key }), finding = rows[0].detail;
  }
  send(req, res, { title: `Open a case — ${e.name}`, body: html`<h1>Open a case</h1>
    ${form({ e, t, values, finding, back, action: `/open-cases?type=${t.type}&slug=${encodeURIComponent(e.slug)}`, submit: 'Open the case' })}` });
});

router.post('/open-cases', async (req, res) => {
  const { t, e } = await entryOf(req, res); if (!e) return;
  const back = backTo(req.body.back, '/open-cases');
  const c = await checked(adminPool, req.body);
  const again = (text) => send(req, res, { title: 'Open a case', status: 422, flash: { kind: 'error', text },
    body: html`<h1>Open a case</h1>${form({ e, t, values: req.body, finding: req.body.finding || null, back,
      action: `/open-cases?type=${t.type}&slug=${encodeURIComponent(e.slug)}`, submit: 'Open the case' })}` });
  if (c.error) return again(c.error);
  const parks = req.body.check_id && req.body.issue_key && quality.CHECKS[req.body.check_id];
  try {
    await withTx(req.user, (db) => db.query(`INSERT INTO open_cases (entity_type, entity_id, check_id, issue_key, finding, description_md, source_id, look_url, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [t.type, e.id, parks ? req.body.check_id : null, parks ? String(req.body.issue_key).slice(0, 200) : null,
      parks ? String(req.body.finding || '').slice(0, 1000) || null : null, c.row.description_md, c.row.source_id, c.row.look_url, req.user.id]));
  } catch (err) {
    return again(err.code === '23505' ? 'this finding is in an open case already' : friendly(err));
  }
  res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}done=case-opened`);
});

async function caseOf(req, res) {
  if (!ID.test(req.params.id)) { notFoundPage(req, res); return null; }
  const { rows } = await adminPool.query(`${SELECT} WHERE oc.id = $1`, [req.params.id]);
  if (!rows.length) notFoundPage(req, res);
  return rows[0] || null;
}

router.get('/open-cases/:id/edit', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  const t = BY_TYPE[c.entity_type];
  const e = { slug: c.slug, name: c.name };
  const back = backTo(req.query.back, '/open-cases');
  send(req, res, { title: `Edit a case — ${c.name}`, body: html`<h1>Edit a case</h1>
    ${form({ e, t, values: { ...c, source: c.source_slug || '', look_url: c.look_url || '' }, finding: c.finding, back, action: `/open-cases/${String(c.id)}`, submit: 'Save' })}` });
});

router.post('/open-cases/:id', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  const back = backTo(req.body.back, '/open-cases');
  const v = await checked(adminPool, req.body);
  if (v.error) {
    return send(req, res, { title: 'Edit a case', status: 422, flash: { kind: 'error', text: v.error }, body: html`<h1>Edit a case</h1>
      ${form({ e: { slug: c.slug, name: c.name }, t: BY_TYPE[c.entity_type], values: { ...c, ...req.body }, finding: c.finding, back, action: `/open-cases/${String(c.id)}`, submit: 'Save' })}` });
  }
  await withTx(req.user, (db) => db.query('UPDATE open_cases SET description_md = $2, source_id = $3, look_url = $4 WHERE id = $1',
    [c.id, v.row.description_md, v.row.source_id, v.row.look_url]));
  res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}done=saved#case-${c.id}`);
});

// an update (214): the day it happened (today unless set; not in the future) and what was found
router.post('/open-cases/:id/updates', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  const back = backTo(req.body.back, '/open-cases');
  const text = String(req.body.text_md ?? '').replace(/\r\n/g, '\n').trim();
  const onDay = String(req.body.on_day || '').trim() || today();
  const fail = (msg) => send(req, res, { title: 'Open cases', status: 422, flash: { kind: 'error', text: msg },
    body: html`<p><a href="${back}">← back</a></p>` });
  if (!text) return fail('an update needs a text');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDay) || Number.isNaN(Date.parse(onDay))) return fail('the date must be a day (YYYY-MM-DD)');
  if (onDay > today()) return fail('an update is about a day that has come — not one in the future');
  if (c.closed_at) return fail('the case is closed — reopen it to add an update');
  const { rows: [u] } = await withTx(req.user, (db) => db.query(
    'INSERT INTO open_case_updates (case_id, on_day, text_md, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [c.id, onDay, text, req.user.id]));
  res.redirect(303, `${back.split('#')[0]}${back.includes('?') ? '&' : '?'}done=case-updated#update-${u.id}`);
});
router.post('/open-cases/:id/updates/:update/delete', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  if (!ID.test(req.params.update)) return notFoundPage(req, res);
  await withTx(req.user, (db) => db.query('DELETE FROM open_case_updates WHERE id = $1 AND case_id = $2', [req.params.update, c.id]));
  const back = backTo(req.body.back, '/open-cases');
  res.redirect(303, `${back.split('#')[0]}${back.includes('?') ? '&' : '?'}done=deleted#case-${c.id}`);
});

router.post('/open-cases/:id/close', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  const result = String(req.body.resolution_md ?? '').replace(/\r\n/g, '\n').trim();
  await withTx(req.user, (db) => db.query('UPDATE open_cases SET closed_at = now(), closed_by = $2, resolution_md = $3 WHERE id = $1 AND closed_at IS NULL',
    [c.id, req.user.id, result || null]));
  const back = backTo(req.body.back, '/open-cases');
  res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}done=case-closed`);
});

router.post('/open-cases/:id/reopen', async (req, res) => {
  const c = await caseOf(req, res); if (!c) return;
  try {
    await withTx(req.user, (db) => db.query('UPDATE open_cases SET closed_at = NULL, closed_by = NULL, resolution_md = NULL WHERE id = $1', [c.id]));
  } catch (err) {
    return send(req, res, { title: 'Open cases', status: 409, flash: { kind: 'error', text: err.code === '23505' ? 'its finding is in another open case now' : friendly(err) },
      body: html`<p><a href="/open-cases">← Open cases</a></p>` });
  }
  const back = backTo(req.body.back, '/open-cases');
  res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}done=case-reopened#case-${c.id}`);
});

module.exports = router;
module.exports.ofEntry = ofEntry;
module.exports.openCount = openCount;
module.exports.entryBox = entryBox;
module.exports.textsOf = textsOf;
