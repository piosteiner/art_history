// Admin panel — Dashboard, search, pickers, data quality, global history, Markdown preview, place search for the map picker.
// Mounted by src/admin/index.js in a fixed order; shared helpers in src/admin/core.js.
const express = require('express');
const { adminPool } = require('../../db');
const { TYPES, BY_TYPE } = require('../../content');
const { renderMarkdown, linkNames } = require('../../markdown');
const { html } = require('../html');
const { search, resultsPage, lookup } = require('../search');
const quality = require('../quality');
const placefinder = require('../placefinder');
const { humanize } = require('../forms');
const { PAGE, send, when, history, historyTable, pager, pageParam } = require('../core');

const router = express.Router();

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
  const qaCounts = await quality.counts(adminPool, { live: !(await quality.current(adminPool)) });
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

// Data quality (checks: view quality_issues_live, migration 013; stored result: quality_issues, 058; src/admin/quality.js)
router.get('/quality', async (req, res) => {
  const filter = {
    severity: quality.SEVERITIES.includes(req.query.severity) ? req.query.severity : '',
    check: quality.CHECKS[req.query.check] ? req.query.check : '',
    type: BY_TYPE[req.query.type] ? req.query.type : '',
    acked: req.query.acked === '1' ? '1' : '',
  };
  // the stored result (058) — brought up to date first if a change is not in it yet
  const live = !(await quality.current(adminPool));
  const [rows, allCounts] = await Promise.all([
    quality.issues(adminPool, { severity: filter.severity, check: filter.check, type: filter.type, acked: !!filter.acked, live }),
    quality.counts(adminPool, { live })]);
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
  send(req, res, { title: 'History', body: html`<h1>History</h1>${historyTable(h.rows)}${pager('/history', page, h.more, { prev: '← newer', next: 'older →' })}` });
});

module.exports = router;
