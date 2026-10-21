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
const { humanize, formToDoc } = require('../forms');
const autocreate = require('../autocreate');
const provenance = require('../provenance');
const wikidata = require('../wikidata');
const { PAGE, send, when, history, historyTable, pager, pageParam, withTx, UserError, friendly } = require('../core');

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
  // the stored findings (never computed here: a page must not wait for the checks) — a moment behind after a change
  await quality.current(adminPool, { wait: 1500 });
  const [qaCounts, qaStatus] = await Promise.all([quality.counts(adminPool), quality.status(adminPool)]);
  const qaTotal = (s) => qaCounts.filter((c) => c.severity === s).reduce((n, c) => n + c.n, 0);
  const unpublishedRows = (await adminPool.query(`
    SELECT d.entity_type::text AS type, e.slug, e.name, d.contributors, d.updated_at FROM live_docs d
    JOIN entity_index e ON e.type = d.entity_type AND e.id = d.entity_id
    WHERE d.dirty ORDER BY d.updated_at DESC LIMIT 30`)).rows;
  const myDrafts = (await adminPool.query(`
    SELECT d.entity_type::text AS type, d.updated_at, e.slug, e.name FROM admin_drafts d
    LEFT JOIN entity_index e ON e.type = d.entity_type AND e.id = d.entity_id
    WHERE d.user_id = $1 AND d.entity_id IS NULL ORDER BY d.updated_at DESC`, [req.user.id])).rows;
  // planned provenance (096): steps dated after today — due ones ask whether they happened, the others wait
  const planned = (await adminPool.query(`
    SELECT p.id, p.check_after::text AS check_after, p.check_after < current_date AS check_due, w.slug, w.title,
           coalesce(pp.owner_name, p.label) AS who
    FROM provenance p JOIN artworks w ON w.id = p.artwork_id LEFT JOIN provenance_periods pp ON pp.id = p.id
    WHERE p.check_after IS NOT NULL ORDER BY p.check_after, w.title LIMIT 50`)).rows;
  const due = planned.filter((p) => p.check_due);
  const upcoming = planned.filter((p) => !p.check_due);
  send(req, res, {
    title: 'Dashboard',
    body: html`<h1>Dashboard</h1>
      ${quality.stale(qaStatus) || qaStatus.failures ? html`<div class="flash error qa-alert"><b>Data quality needs attention:</b>
        ${quality.stale(qaStatus) ? html`the checks are stuck (${qaStatus.waiting} waiting)` : ''}${quality.stale(qaStatus) && qaStatus.failures ? ' · ' : ''}${
        qaStatus.failures ? html`${qaStatus.failures} ${qaStatus.failures === 1 ? 'entry' : 'entries'} could not be checked` : ''} — <a href="/quality">Data quality</a>.</div>` : ''}
      ${unpublishedRows.length ? html`<div class="flash draft"><b>Unpublished changes:</b> ${unpublishedRows.map((d, i) => html`${i ? ' · ' : ''}<a href="/${BY_TYPE[d.type].folder}/${d.slug}/edit">${d.name}</a>
        <span class="muted small">${d.contributors.join(', ')} · ${when(d.updated_at)}</span>`)}</div>` : ''}
      ${myDrafts.length ? html`<div class="flash draft"><b>Your unsaved drafts:</b> ${myDrafts.map((d, i) => html`${i ? ' · ' : ''}<a href="/${BY_TYPE[d.type].folder}/${d.slug ? `${d.slug}/edit` : 'new'}?draft=1">${d.name || `new ${d.type}`}</a>
        <span class="muted small">${when(d.updated_at)}</span>`)}</div>` : ''}
      ${due.length ? html`<div class="flash warn planned-reminder"><b>Planned provenance — did it happen?</b>
        <ul>${due.map((p) => html`<li><a href="/artworks/${p.slug}#provenance">${p.title}</a>${p.who ? html` · ${p.who}` : ''}
          <span class="muted small">planned for ${provenance.dayText(p.check_after)}</span>
          <form method="post" action="/provenance/${p.id}/confirm?back=dashboard" class="inline"><button class="small">Went as planned</button></form>
          <a class="small" href="/provenance/${p.id}/edit">edit</a></li>`)}</ul></div>` : ''}
      ${upcoming.length ? html`<p class="muted small planned-upcoming">Planned provenance: ${upcoming.map((p, i) => html`${i ? ' · ' : ''}<a href="/artworks/${p.slug}#provenance">${p.title}</a>
        (${provenance.dayText(p.check_after)})`)} — you will be asked after each date whether it happened as planned.</p>` : ''}
      <div class="cards">${TYPES.map((t) => html`<a class="card" href="/${t.folder}"><b>${counts[t.type] || 0}</b>${humanize(t.folder)}</a>`)}
        <div class="card"><b>${rels}</b>Relationships</div>
        <a class="card qa-card" href="/quality"><b>${qaTotal('error')} · ${qaTotal('warning')}</b>Quality: errors · warnings${
          qaStatus.waiting || !qaStatus.global_current ? html` <span class="muted small">(updating…)</span>` : ''}</a></div>
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

// A new entry from a [[link]] being typed (editor: "+ Create …"): a minimal entry by its name, marked "to complete" —
// or the existing one of that type and name (no duplicates). A place needs a position: the place finder's first
// OpenStreetMap hit, drafted as on "+ find a place…" (names, Wikidata point, parent region).
router.post('/lookup/create', async (req, res) => {
  const type = String(req.body.type || '');
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const t = BY_TYPE[type];
  if (!t || !name) return res.status(400).json({ error: 'Pick a type and give a name.' });
  const same = (await adminPool.query(`SELECT slug, name FROM entity_index WHERE type = $1::entity_type
    AND lower(f_unaccent(name)) = lower(f_unaccent($2)) LIMIT 1`, [type, name])).rows[0];
  if (same) return res.json({ type, slug: same.slug, name: same.name, existing: true });
  try {
    const made = await withTx(req.user, async (db) => {
      if (type === 'place') {
        const hits = await placefinder.candidates(name);
        if (!hits.length) throw new UserError(`OpenStreetMap knows no place "${name}" — create it with "+ find a place…" on the Places page.`);
        const draft = await placefinder.draftFor(db, hits[0], wikidata.coordsOf, wikidata.slugify);
        const { doc } = formToDoc(draft.form, t.fields);
        const parent = await autocreate.resolveRefs(adminPool, t, doc, {});
        if (parent.errors.length) delete doc.parent;
        else {
          const slugs = await autocreate.create(db, parent.creates);
          if (slugs.has('parent')) doc.parent = slugs.get('parent');
        }
        const slug = await wikidata.createEntry(db, 'place', doc, null, req.user.id, doc.wikidata_id || null);
        return { slug, name: doc.name };
      }
      const c = [{ key: 'new', type, name }];
      await autocreate.create(db, c);
      await autocreate.flag(db, type, c[0].id, null, req.user.id);
      return { slug: c[0].slug, name };
    });
    res.json({ type, ...made });
  } catch (err) {
    res.status(422).json({ error: err instanceof UserError ? err.message : friendly(err) });
  }
});

// Data quality (checks: view quality_issues_live, migration 013; stored result: quality_issues, 058; src/admin/quality.js)
router.get('/quality', async (req, res) => {
  const filter = {
    severity: quality.SEVERITIES.includes(req.query.severity) ? req.query.severity : '',
    check: quality.CHECKS[req.query.check] ? req.query.check : '',
    type: BY_TYPE[req.query.type] ? req.query.type : '',
    acked: req.query.acked === '1' ? '1' : '',
  };
  // the stored result (058/125) — waiting a moment for a change just made; never computed here
  await quality.current(adminPool, { wait: 3000 });
  const [rows, allCounts, status, driftRows, failureRows] = await Promise.all([
    quality.issues(adminPool, { severity: filter.severity, check: filter.check, type: filter.type, acked: !!filter.acked }),
    quality.counts(adminPool), quality.status(adminPool), quality.drift(adminPool), quality.failures(adminPool)]);
  // start views (069) aren't entries — their problems are counted here, listed on /featured
  const featured = (await adminPool.query('SELECT count(DISTINCT id)::int AS n FROM featured_view_problems')).rows[0].n;
  send(req, res, { title: 'Data quality', body: quality.page({ rows, allCounts, filter, back: req.originalUrl, featured, status, driftRows, failureRows }) });
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
