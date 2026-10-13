// Data quality (the checks themselves are the SQL view quality_issues_live, migrations 013 … 058).
// This module: what each check means and how to fix it, the /quality page, the box on entity pages, acknowledgements,
// and keeping the stored result (table quality_issues, 058) up to date.
const { Client } = require('pg');
const { html } = require('./html');
const { BY_TYPE } = require('../content');
const config = require('../config');

const CHECKS = {
  presence_outside_lifespan: { title: 'Presence outside the lifespan', fix: 'Correct the period of the relationship, or the birth/death date.' },
  birth_death_mismatch: { title: '"Born in" / "died in" dated differently', fix: 'The period of "born in"/"died in" should match the birth/death date.' },
  inventory_without_institution: { title: 'Inventory number without institution', fix: 'Set the institution whose collection numbered it — or clear the number (it can go into a "housed at" relationship\'s label for a former holder).' },
  outside_polity_period: { title: 'Linked to a polity outside its existence', fix: 'Check the period of the relationship, or the polity\'s dates (e.g. USSR only 1922–1991).' },
  artwork_outside_creator_life: { title: 'Artwork dated outside its creator\'s life', fix: 'Check the date and the creator — or mark as OK (e.g. a posthumous cast).' },
  never_alive_together: { title: 'Linked people who never lived at the same time', fix: 'Probably "influenced by" was meant, or a date is wrong.' },
  overlapping_residences: { title: 'Two residences at the same time', fix: 'Correct a period — or mark as OK if both are right (e.g. a summer house).' },
  held_before_founded: { title: 'Held before the institution was founded', fix: 'Check the period of "housed at" and the founding date.' },
  outside_parent_area: { title: 'Place outside its parent region', fix: 'Check the coordinates, the parent, or the parent\'s outline.' },
  possible_duplicate: { title: 'Possible duplicates', fix: 'Weighed by names and evidence (creator, dates, dimensions, places, identifiers). The same thing: Merge… into the better entry. Two things: Not the same — remembered for good.' },
  broken_link: { title: 'Link to a missing entry', fix: 'Correct the [[type/slug]] link in the text (type [[ and a name to pick one) — the entry may have been renamed or deleted.' },
  broken_glossary_link: { title: 'Link to a missing glossary term', fix: 'Create the term in the Glossary (with this slug) — or correct the [[link]] in the text.' },
  artwork_without_creator: { title: 'Artwork without creator', fix: 'Add the creator — or an attribution such as "Workshop of …" / "Anonymous".' },
  image_without_license: { title: 'Image without license or credit', fix: 'Add license and credit (e.g. via Wikidata/Commons) before the image is shown publicly.' },
  no_relationships: { title: 'Not connected to anything', fix: 'Add relationships — unconnected entries don\'t appear on the map or in the graph.' },
  artist_missing_dates: { title: 'Artist without birth or death date', fix: 'Add the dates (fuzzy dates are fine) — the timeline needs them.' },
  presence_without_period: { title: 'Presence without a date', fix: 'Add a period so it appears on the timeline and the travel route.' },
  place_without_parent: { title: 'Place without parent', fix: 'Set the region/country it belongs to.' },
  missing_description: { title: 'No description', fix: 'Write a short description or biography.' },
  parent_suggestion: { title: 'Parent suggested from the map', fix: 'The place lies inside the outline of another place — set it as the parent.' },
  boundary_available: { title: 'Outline available', fix: 'Set the boundary code (ISO, e.g. JP or JP-13) — the outline and marker then come from Natural Earth.' },
  institution_without_place: { title: 'Institution without its city', fix: 'Set the place (the city) — a nearby one is suggested when the institution has an exact location.' },
  missing_romanization: { title: 'Name without romanization', fix: 'Add one under "Other names" (e.g. Kanagawa-oki nami ura | ja-Latn | romanization) — it is used for sorting, search and the slug.' },
  event_without_place: { title: 'Event without a place', fix: 'Set its place (the city), or an exact spot or area — otherwise it can\'t appear on the map.' },
  type_doubtful: { title: 'Perhaps the wrong kind of entry', fix: 'If it is: “Change type…” on its page moves it (a person entered as an institution) — with its relationships, images and sources. Otherwise: Mark as OK.' },
  title_translation: { title: 'Title is not an official translation', fix: 'Look up the title the holding institution uses (its online collection); if it has one, use it, set “official translation” and cite the page with the marker.' },
  loan_owner: { title: 'On loan — but who lent it?', fix: 'Add the owner (the lender) as the last step of the provenance — the institution where it is now only holds it.' },
  citation_outdated: { title: 'Changed since cited', fix: 'The value changed after the source was cited: check the source still says so — remove the citation, or cite the source of the new value.' },
  weakly_sourced: { title: 'Facts without a good source', fix: 'Cite the museum, a catalogue raisonné or the literature for these fields (the W / ? markers on the entry’s page). Wikidata is a start, not a source.' },
  no_wikidata_id: { title: 'No Wikidata id', fix: 'Use "Wikidata…" on the entry to find and link it.' },
};
const SEVERITIES = ['error', 'warning', 'info'];
const SEVERITY_TEXT = { error: 'Errors — contradictions', warning: 'Warnings — probably a problem', info: 'Info — incomplete' };

// ---------------------------------------------------------------------------------------------------------------
// The stored result (migration 058). Every change bumps a counter and sends NOTIFY quality_changed at its commit;
// this process LISTENs and calls refresh_quality() half a second later (several saves in a row: one refresh). One
// refresh at a time; a change during it → once more right after. A page that must be exact waits (current()).
// ---------------------------------------------------------------------------------------------------------------
let running = null;  // the refresh in progress (a promise)
let again = false;   // a change came in while it ran
let timer = null;
let pool = null;     // the admin pool (start())

function refresh() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await pool.query('SELECT refresh_quality()'); } while (again);
    } catch (err) {
      console.error('quality: refresh failed —', err.message);
    } finally { running = null; }
  })();
  return running;
}
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 500); };

// Is the stored result up to date? Not: refresh now (or join the one running) and wait — at most `wait` ms; false =
// still not (the caller then computes the checks live, as before 058).
async function current(db, { wait = 5000 } = {}) {
  const fresh = async () => (await db.query('SELECT quality_fresh() AS f')).rows[0].f === true;
  if (await fresh()) return true;
  if (!pool) return false;
  let timeout;
  const late = new Promise((resolve) => { timeout = setTimeout(resolve, wait, false); });
  const done = refresh().then(fresh);
  try { return await Promise.race([done, late]); } finally { clearTimeout(timeout); }
}
const isFresh = async (db) => (await db.query('SELECT quality_fresh() AS f')).rows[0].f === true;

// LISTEN on a connection of its own (a pooled one goes back to the pool); reconnects after an outage and refreshes
// then — a change during it sent its notice to nobody.
let listener = null;
let stopped = false;
async function listen() {
  const client = new Client({ connectionString: config.db.adminUrl, application_name: 'arthistory-quality' });
  client.on('notification', refreshSoon);
  const retry = () => { if (listener === client) listener = null; if (!stopped) setTimeout(listen, 5000).unref(); };
  client.on('error', (err) => { console.error('quality: listener —', err.message); client.end().catch(() => {}); });
  client.on('end', retry);
  try {
    await client.connect();
    await client.query('LISTEN quality_changed');
    listener = client;
    refreshSoon();
  } catch (err) {
    console.error('quality: cannot listen —', err.message);
    client.end().catch(() => {});
  }
}
// on server start (src/server.js): also brings the result up to date after a deploy (a migration may change checks)
function start(adminPool) {
  pool = adminPool;
  stopped = false;
  return listen();
}
async function stop() {
  stopped = true;
  clearTimeout(timer);
  if (listener) await listener.end().catch(() => {});
  if (running) await running;
}

// Findings with names, filtered; acknowledged ones only when asked for. live: computed now (quality_issues_live) —
// when the stored result is behind and couldn't be brought up to date in time.
async function issues(db, { severity, check, type, entity, acked = false, live = false } = {}) {
  const where = ['true'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (severity) where.push(`q.severity = ${p(severity)}`);
  if (check) where.push(`q.check_id = ${p(check)}`);
  if (type) where.push(`q.entity_type = ${p(type)}::entity_type`);
  if (entity) where.push(`q.entity_type = ${p(entity.type)}::entity_type AND q.entity_id = ${p(entity.id)}`);
  where.push(acked ? 'a.check_id IS NOT NULL' : 'a.check_id IS NULL');
  const { rows } = await db.query(`
    SELECT q.check_id, q.severity, q.entity_type::text AS type, q.issue_key, q.detail, e.slug, e.name,
           a.note, a.acked_at, u.username AS acked_by
    FROM ${live ? 'quality_issues_live' : 'quality_issues'} q
    JOIN entity_index e ON e.type = q.entity_type AND e.id = q.entity_id
    LEFT JOIN quality_acks a ON a.check_id = q.check_id AND a.issue_key = q.issue_key
    LEFT JOIN admin_users u ON u.id = a.acked_by
    WHERE ${where.join(' AND ')}
    ORDER BY array_position(ARRAY['error', 'warning', 'info'], q.severity), q.check_id, e.sort_key COLLATE sort_natural`, params);
  return rows;
}

async function counts(db, { live = false } = {}) {
  const { rows } = await db.query(`
    SELECT q.severity, q.check_id, count(*)::int AS n FROM ${live ? 'quality_issues_live' : 'quality_issues'} q
    LEFT JOIN quality_acks a ON a.check_id = q.check_id AND a.issue_key = q.issue_key
    WHERE a.check_id IS NULL GROUP BY 1, 2`);
  return rows;
}

const link = (r) => `/${BY_TYPE[r.type].folder}/${r.slug}`;

// ---------------------------------------------------------------------------------------------------------------
// The queue: work through the findings of a filter entry by entry. The entry page shows a bar (queueBar) with "Next
// issue →" → /quality/next, which opens the next entry of the same filter, in the order of the list. An entry whose
// finding was fixed or marked OK has left the list — the position (pos) then already points at the next one.
// ---------------------------------------------------------------------------------------------------------------
const FILTER_KEYS = ['severity', 'check', 'type'];
// a filter from the address (only known values) → { severity, check, type }
function filterOf(query) {
  return {
    severity: SEVERITIES.includes(query.severity) ? query.severity : '',
    check: CHECKS[query.check] ? query.check : '',
    type: BY_TYPE[query.type] ? query.type : '',
  };
}
const filterQuery = (f, extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([k, v]) => v !== '' && v !== undefined && (FILTER_KEYS.includes(k) || k in extra))).toString();

// the entries of a filter, each once, in the list's order
async function queue(db, filter) {
  const rows = await issues(db, filter);
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.type}/${r.slug}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
// after: "type/slug" of the entry just seen; pos: its position then → the next entry (with its position) or null
async function next(db, filter, after, pos) {
  const list = await queue(db, filter);
  const i = list.findIndex((r) => `${r.type}/${r.slug}` === after);
  const n = i >= 0 ? i + 1 : Math.max(0, pos);
  return n < list.length ? { ...list[n], pos: n, total: list.length } : null;
}
// The address of an entry in the queue
const queueLink = (r, filter, pos) => `${link(r)}?queue=${encodeURIComponent(filterQuery(filter, { pos: String(pos) }))}`;

// The bar on an entry page opened from the queue (?queue=…); rows: this entry's findings
function queueBar(t, e, queueParam, rows) {
  const q = new URLSearchParams(String(queueParam || ''));
  const filter = filterOf(Object.fromEntries(q));
  const pos = Math.max(0, Number.parseInt(q.get('pos'), 10) || 0);
  const mine = rows.filter((r) => (!filter.check || r.check_id === filter.check) && (!filter.severity || r.severity === filter.severity));
  const title = filter.check ? CHECKS[filter.check].title : filter.severity ? SEVERITY_TEXT[filter.severity] : 'All findings';
  return html`<div class="queue-bar"><div class="grow"><b>Quality queue:</b> ${title}${filter.type ? html` · ${filter.type}` : ''} · No. ${pos + 1}
      ${mine.length ? html`<div class="small">${mine.map((r) => html`<div><span class="tag qa-${r.severity}">${r.severity}</span> ${(CHECKS[r.check_id] || {}).title || r.check_id}: ${r.detail}</div>`)}</div>`
        : html`<div class="small cite-ok">Done here — nothing left of this filter.</div>`}
      ${filter.check && CHECKS[filter.check].fix ? html`<div class="muted small">${CHECKS[filter.check].fix}</div>` : ''}</div>
    <a class="button" href="/quality/next?${filterQuery(filter, { after: `${t.type}/${e.slug}`, pos: String(pos) })}">Next issue →</a>
    <a class="button secondary" href="/quality?${filterQuery(filter)}">Back to the list</a></div>`;
}

// batch pages for some checks (routes/queue.js)
const BATCH = {
  no_wikidata_id: { href: '/quality/batch/wikidata', label: 'Find Wikidata items for these…' },
  weakly_sourced: { href: '/quality/batch/cite', label: 'Cite where the GND or SIKART agrees…' },
};
// checks the Enrich page helps with
const ENRICH = ['weakly_sourced', 'no_wikidata_id', 'artist_missing_dates', 'missing_romanization', 'institution_without_place', 'auto_created'];

function ackForm(r, back, acked) {
  return acked
    ? html`<form method="post" action="/quality/unack" class="inline"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <button class="link">undo “${r.check_id === 'possible_duplicate' ? 'not the same' : 'OK'}”</button></form>`
    // a duplicate pair: "not the same" (the same acknowledgement — duplicate_candidates() leaves the pair out) or merge
    : r.check_id === 'possible_duplicate'
      ? html`<a class="button secondary" href="/${BY_TYPE[r.type].folder}/${r.slug}/merge?pair=${r.issue_key}">Merge…</a>
        <form method="post" action="/quality/ack" class="inline qa-ack"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <input type="hidden" name="note" value="not the same"><button class="secondary">Not the same</button></form>`
    : html`<form method="post" action="/quality/ack" class="inline qa-ack"><input type="hidden" name="check_id" value="${r.check_id}">
        <input type="hidden" name="issue_key" value="${r.issue_key}"><input type="hidden" name="back" value="${back}">
        <input name="note" placeholder="why it is right (optional)" aria-label="note"><button class="secondary">Mark as OK</button></form>`;
}

function page({ rows, allCounts, filter, back }) {
  const total = (s) => allCounts.filter((c) => c.severity === s).reduce((n, c) => n + c.n, 0);
  const q = (params) => `/quality?${new URLSearchParams(Object.entries({ ...filter, ...params }).filter(([, v]) => v)).toString()}`;
  const groups = {};
  for (const r of rows) (groups[r.check_id] ||= []).push(r);
  return html`<h1>Data quality</h1>
    <div class="cards" data-live-results="cards">${SEVERITIES.map((s) => html`<a class="card qa-${s}${filter.severity === s ? ' active' : ''}" href="${q({ severity: filter.severity === s ? '' : s, check: '' })}">
      <b>${total(s)}</b>${SEVERITY_TEXT[s]}</a>`)}</div>
    <form class="bar" method="get" action="/quality" data-live>
      <select name="severity"><option value="">all levels</option>${SEVERITIES.map((s) => html`<option${filter.severity === s ? ' selected' : ''}>${s}</option>`)}</select>
      <select name="check"><option value="">all checks</option>${Object.entries(CHECKS).map(([id, c]) => html`<option value="${id}"${filter.check === id ? ' selected' : ''}>${c.title}</option>`)}</select>
      <select name="type"><option value="">all types</option>${Object.keys(BY_TYPE).map((t) => html`<option${filter.type === t ? ' selected' : ''}>${t}</option>`)}</select>
      <label class="choice"><input type="checkbox" name="acked" value="1"${filter.acked ? ' checked' : ''}> show only entries marked OK</label>
      <button class="secondary">Filter</button></form>
    <div data-live-results="quality">${!rows.length ? html`<p class="flash ok">${filter.acked ? 'Nothing marked as OK here.' : 'Nothing found — all clear for this filter.'}</p>` : ''}
    ${Object.entries(groups).map(([id, list]) => {
      // the queue of this group: the page's filter narrowed to this check — positions among its entries
      const qf = { ...filterOf(filter), check: id };
      const order = [];
      for (const r of list) if (!order.includes(`${r.type}/${r.slug}`)) order.push(`${r.type}/${r.slug}`);
      const posOf = (r) => order.indexOf(`${r.type}/${r.slug}`);
      const head = html`<h2><span class="tag qa-${list[0].severity}">${list[0].severity}</span> ${CHECKS[id] ? CHECKS[id].title : id} <span class="muted">(${list.length})</span></h2>`;
      const body = html`${CHECKS[id] ? html`<p class="muted small">${CHECKS[id].fix}</p>` : ''}
        ${!filter.acked ? html`<p class="actions qa-tools"><a class="button" href="${queueLink(list[0], qf, 0)}">Work through these →</a>
          ${BATCH[id] ? html`<a class="button secondary" href="${BATCH[id].href}${filter.type ? `?type=${filter.type}` : ''}">${BATCH[id].label}</a>` : ''}</p>` : ''}
        <div class="table-wrap"><table><tbody>${list.map((r) => html`<tr>
          <td><a href="${filter.acked ? link(r) : queueLink(r, qf, posOf(r))}">${r.name}</a> <span class="tag">${r.type}</span></td><td>${r.detail}
            ${r.acked_at ? html`<div class="muted small">OK’d by ${r.acked_by || '?'} on ${r.acked_at.toISOString().slice(0, 10)}${r.note ? ` — ${r.note}` : ''}</div>` : ''}</td>
          <td class="qa-actions">${ENRICH.includes(id) && !filter.acked ? html`<a class="button secondary" href="${link(r)}/enrich">Enrich…</a> ` : ''}${ackForm(r, back, !!r.acked_at)}</td></tr>`)}</tbody></table></div>`;
      // completeness hints (info) folded away unless asked for: the errors and warnings first
      return list[0].severity === 'info' && filter.severity !== 'info' && !filter.check
        ? html`<details class="qa-group qa-folded"><summary>${head}</summary>${body}</details>`
        : html`<section class="qa-group">${head}${body}</section>`;
    })}</div>`;
}

// Box on an entity page: its errors and warnings (info only as a count).
function entityBox(rows, back) {
  const serious = rows.filter((r) => r.severity !== 'info');
  const infos = rows.length - serious.length;
  if (!rows.length) return '';
  return html`<div class="qa-box${serious.some((r) => r.severity === 'error') ? ' has-error' : ''}">
    <b>Data quality:</b> ${serious.length ? '' : html`<span class="muted">no problems.</span>`}
    ${serious.length ? html`<ul>${serious.map((r) => html`<li><span class="tag qa-${r.severity}">${r.severity}</span>
      ${CHECKS[r.check_id] ? CHECKS[r.check_id].title : r.check_id}: ${r.detail} ${ackForm(r, back, false)}</li>`)}</ul>` : ''}
    ${infos ? html`<span class="muted small">${infos} hint${infos === 1 ? '' : 's'} on completeness (${rows.filter((r) => r.severity === 'info').map((r) => (CHECKS[r.check_id] || {}).title || r.check_id).join(', ')}).</span>` : ''}
  </div>`;
}

async function ack(db, { check_id: checkId, issue_key: issueKey, note }, userId) {
  if (!CHECKS[checkId] || !issueKey) return;
  await db.query(`INSERT INTO quality_acks (check_id, issue_key, note, acked_by) VALUES ($1, $2, $3, $4)
    ON CONFLICT (check_id, issue_key) DO UPDATE SET note = EXCLUDED.note, acked_by = EXCLUDED.acked_by, acked_at = now()`,
  [checkId, String(issueKey).slice(0, 200), String(note || '').trim().slice(0, 500) || null, userId]);
}

async function unack(db, { check_id: checkId, issue_key: issueKey }) {
  await db.query('DELETE FROM quality_acks WHERE check_id = $1 AND issue_key = $2', [checkId, issueKey]);
}

module.exports = { CHECKS, SEVERITIES, issues, counts, page, entityBox, ack, unack, start, stop, current, isFresh, refresh,
  filterOf, filterQuery, queue, next, queueLink, queueBar };
