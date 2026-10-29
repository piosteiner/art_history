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
  place_without_parent: { title: 'Place without parent', fix: 'Set the larger place it belongs to: a building or street → its city, a city → its region (canton, Land, province), a region → its country.' },
  missing_description: { title: 'No description', fix: 'Write a short description or biography.' },
  parent_suggestion: { title: 'Parent suggested from the map', fix: 'The place lies inside the outline of another place — set it as the parent.' },
  boundary_available: { title: 'Outline available', fix: 'Set the boundary code (ISO, e.g. JP or JP-13) — the outline and marker then come from Natural Earth.' },
  // places (155): the country and the first-level division come from the point (Natural Earth outlines)
  place_without_country: { title: 'Place without a country', fix: 'Give it a point (map picker) — the country then follows from where it lies; or set its parent (the city of a building, the region of a city); a country code by hand only for special cases.' },
  place_used_outside_existence: { title: 'Place used when it didn’t exist', fix: 'The relationship is dated outside the time the place existed (its “Existed”): link the place of that time instead (Seine-et-Oise before 1968, its successor after), or correct the dates.' },
  place_outside_country: { title: 'Point outside its country', fix: 'The country code set by hand differs from where the point lies: correct the point or the code. An exclave or a border case (Campione d’Italia): Mark as OK.' },
  institution_without_place: { title: 'Institution without its city', fix: 'Set the place (the city) — a nearby one is suggested when the institution has an exact location.' },
  missing_romanization: { title: 'Name without romanization', fix: 'Add one under "Other names" (e.g. Kanagawa-oki nami ura | ja-Latn | romanization) — it is used for sorting, search and the slug.' },
  event_without_place: { title: 'Event without a place', fix: 'Set its place (the city), or an exact spot or area — otherwise it can\'t appear on the map.' },
  type_doubtful: { title: 'Perhaps the wrong kind of entry', fix: 'If it is: “Change type…” on its page moves it (a person entered as an institution) — with its relationships, images and sources. Otherwise: Mark as OK.' },
  title_translation: { title: 'Title is not an official translation', fix: 'Look up the title the holding institution uses (its online collection); if it has one, use it, set “official translation” and cite the page with the marker.' },
  creation_span_unstated: { title: 'Creation span: worked on, or made at some point?', fix: 'Say what the span under “Created” means (field “The span means”): “worked on throughout” when the artist worked on it over the whole time (the museum speaks of the work’s genesis, an unfinished work, a commission over years); “made at some point in it” when the date is only uncertain. Cite the source that says so. The provenance reads it: worked on = the artist held it from the start.' },
  artwork_without_web_page: { title: 'Artwork without a web page', fix: 'Add its page at the museum or collection that holds it (field “Web page”, under the inventory number) — from the museum’s online collection; Enrich offers Wikidata’s “described at URL” where there is one.' },
  loan_owner: { title: 'On loan — but who lent it?', fix: 'Add the owner (the lender) as the last step of the provenance — the institution where it is now only holds it.' },
  citation_outdated: { title: 'Changed since cited', fix: 'The value changed after the source was cited: check the source — if it still says so, “Yes, it still does” in its sources; if not, remove the citation or cite the source of the new value.' },
  unlinked_term: { title: 'Type or material that is no glossary term', fix: 'Sort these out on “Types and materials to sort out” (Quality → batch pages): replace by terms, move a phrase to the medium, or make it a term.' },
  provenance_stolen: { title: 'Stolen, not recovered', fix: 'Report it (Art Loss Register, Interpol Stolen Works of Art, Lost Art) — and when it is found, record the end of the theft step (the recovery).' },
  provenance_seizure_as_owner: { title: 'A seizure recorded as ownership', fix: 'Whoever seized, looted or stole a work held it without good title — give the step the role “possessor”; the dispossessed owner’s ownership then goes on until the restitution.' },
  holder_after_death: { title: 'Acquired after the holder’s death', fix: 'A date or a holder is wrong — or it went to the estate (role “estate”) or the heirs.' },
  holder_before_birth: { title: 'Acquired before the holder’s birth', fix: 'A date or the holder is wrong (a namesake? the father?).' },
  acquired_before_creation: { title: 'Acquired before it was made', fix: 'Check the date of the work and of the acquisition — or it was a commission (method “commission”).' },
  created_where_artist_was_not: { title: 'Made where the artist was not', fix: 'The place of creation contradicts the artist’s dated whereabouts: check the place, the date, the artist’s stays — or the work was made elsewhere and sent.' },
  provenance_record_outside: { title: 'A provenance record outside its step', fix: 'An inventory, catalogue or sighting dated outside the holder’s period: it belongs under another step — or a date is wrong.' },
  provenance_date_narrowable: { title: 'A provenance date can be narrowed', fix: 'Derived from a death: the acquisition from that holder must lie within their lifetime. If the source agrees, enter the narrower date (and cite it).' },
  flagged_holder: { title: 'Flagged holders in the provenance', fix: 'A holder on your list (“Provenance flag” on the person / institution): check this step in the provenance research databases (links under the provenance) — and record what you find, or Mark as OK.' },
  weakly_sourced: { title: 'Facts without a good source', fix: 'Cite the museum, a catalogue raisonné or the literature for these fields (the W / ? markers on the entry’s page). Wikidata is a start, not a source.' },
  no_wikidata_id: { title: 'No Wikidata id', fix: 'Use "Wikidata…" on the entry to find and link it.' },
};
const SEVERITIES = ['error', 'warning', 'info'];
const SEVERITY_TEXT = { error: 'Errors — contradictions', warning: 'Warnings — probably a problem', info: 'Info — incomplete' };

// ---------------------------------------------------------------------------------------------------------------
// The stored result (058), kept up to date incrementally (125). Every change appends the entries it affects to
// derived_queue and sends NOTIFY quality_changed at its commit; this process LISTENs and, half a second later, works
// through the queue a batch at a time (process_derived — each batch its own short transaction: search fields,
// findings, duplicate pairs of those entries). Then the global part (refresh_quality_global: the checks over all
// entries, the words for "did you mean", the graph) — at most every GLOBAL_EVERY ms, at once when a page waits for
// it. One worker at a time; a change during it → once more right after. Each night every entry is queued once
// (refresh_quality_full): what that changes was missed and is logged as drift (quality page).
// ---------------------------------------------------------------------------------------------------------------
const BATCH_SIZE = 100;     // entries per batch (process_derived)
const GLOBAL_EVERY = Number(process.env.QUALITY_GLOBAL_EVERY_MS || 30000);
const FULL_HOUR = 3;       // the nightly full run, server time
let running = null;  // the refresh in progress (a promise)
let again = false;   // a change came in while it ran
let urgent = false;  // a page waits: the global part now, not at its next turn
let lastGlobal = 0;
let timer = null;
let globalTimer = null;
let nightly = null;
let retry = null;
let pool = null;     // the admin pool (start())

const isFresh = async (db) => (await db.query('SELECT quality_fresh() AS f')).rows[0].f === true;

// Errors that aren't an entry's: the database gone or restarting, connections refused — nothing is set aside then.
const SYSTEMIC = (err) => /^(08|57P0|53)/.test(err.code || '') || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(err.code)
  || /terminat|Connection terminated/i.test(err.message);
const QUARANTINE_MAX = 5;   // this many single entries failing in a row: not the entries — stop and try again later

// One batch of the queue (128). A failed batch: its entries one at a time — one that fails alone is set aside
// (derived_quarantine: out of the queue, into derived_failures with the error) and the rest goes on.
async function nextBatch() {
  try {
    return (await pool.query('SELECT process_derived($1) AS n', [BATCH_SIZE])).rows[0].n;
  } catch (err) {
    if (SYSTEMIC(err)) throw err;
    console.error(`quality: a batch failed (${err.message}) — its entries one at a time`);
  }
  let done = 0;
  let inRow = 0;
  for (let i = 0; i < BATCH_SIZE; i++) {
    try {
      const n = (await pool.query('SELECT process_derived(1) AS n')).rows[0].n;
      if (!n) break;
      done += n;
      inRow = 0;
    } catch (err) {
      if (SYSTEMIC(err) || ++inRow >= QUARANTINE_MAX) throw err;
      const who = (await pool.query('SELECT derived_quarantine($1) AS q', [err.message])).rows[0].q;
      console.error(`quality: ${who} set aside — ${err.message}`);
      done++;
    }
  }
  return done;
}

function refresh() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        // a batch, then its entries' list rows (127) — until the queue is empty
        for (;;) {
          const n = await nextBatch();
          await refreshLists();
          if (!n) break;
        }
        if (await isFresh(pool)) continue;
        const wait = lastGlobal + GLOBAL_EVERY - Date.now();
        if (urgent || wait <= 0) {
          urgent = false;
          await pool.query('SELECT refresh_quality_global()');
          lastGlobal = Date.now();
        } else {
          clearTimeout(globalTimer);
          globalTimer = setTimeout(refresh, wait);
        }
      } while (again);
    } catch (err) {
      console.error('quality: refresh failed —', err.message);
    } finally { running = null; }
  })();
  return running;
}
// The lists' rows (entry_list_rows, 127): computed here with the list endpoint's own query (src/routes/entities.js
// listRows — one definition) for the entries in list_queue, a batch per transaction; only changed rows are written.
// A row changed for an entry queued only by the nightly full run = drift ('list row').
const LIST_BATCH = 200;
async function refreshLists() {
  let size = LIST_BATCH;
  let single = 0;      // after a failed batch: this many entries one at a time
  let inRow = 0;
  for (;;) {
    try {
      const n = await listBatch(single ? 1 : size);
      if (!n) return;
      if (single) { single -= 1; inRow = 0; }
    } catch (err) {
      if (SYSTEMIC(err)) throw err;
      if (!single) { console.error(`quality: list rows failed (${err.message}) — one at a time`); single = LIST_BATCH; continue; }
      if (++inRow >= QUARANTINE_MAX) throw err;
      // the oldest one alone failed: set aside
      const { rows: [q] } = await pool.query(`
        WITH oldest AS (SELECT type, id FROM list_queue ORDER BY seq LIMIT 1),
        gone AS (DELETE FROM list_queue l USING oldest o WHERE l.type = o.type AND l.id = o.id RETURNING l.type, l.id)
        INSERT INTO derived_failures (type, id, what, error) SELECT DISTINCT type, id, 'list row', left($1, 2000) FROM gone
        ON CONFLICT (type, id, what) DO UPDATE SET error = EXCLUDED.error, failed_at = EXCLUDED.failed_at
        RETURNING type || '/' || id AS who`, [err.message]);
      console.error(`quality: list row of ${q ? q.who : '?'} set aside — ${err.message}`);
      single -= 1;
    }
  }
}
// The oldest `size` entries of list_queue in one transaction → how many there were (0: empty)
async function listBatch(size) {
  const { ENTITIES, listRows } = require('../routes/entities');   // here: the routes load after this module
  const pluralOf = Object.fromEntries(Object.entries(ENTITIES).map(([plural, e]) => [e.type, plural]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: queued } = await client.query(`
      DELETE FROM list_queue WHERE seq IN (SELECT seq FROM list_queue ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING type::text AS type, id::text AS id, full_run`, [size]);
    if (!queued.length) { await client.query('COMMIT'); return 0; }
    const byType = new Map();
    for (const q of queued) {
      if (!byType.has(q.type)) byType.set(q.type, new Map());
      const ids = byType.get(q.type);
      ids.set(q.id, (ids.get(q.id) ?? true) && q.full_run);   // full only if every queuing was the full run
    }
    for (const [type, ids] of byType) {
      if (!pluralOf[type]) continue;
      const rows = await listRows(client, pluralOf[type], [...ids.keys()]);
      const { rows: written } = await client.query(`
        INSERT INTO entry_list_rows AS r (type, id, row)
          SELECT $1::entity_type, x.id::bigint, x.row FROM jsonb_to_recordset($2::jsonb) x(id text, row jsonb)
        ON CONFLICT (type, id) DO UPDATE SET row = EXCLUDED.row WHERE r.row IS DISTINCT FROM EXCLUDED.row
        RETURNING id::text`, [type, JSON.stringify([...rows].map(([id, row]) => ({ id, row })))]);
      const { rows: gone } = await client.query(`
        DELETE FROM entry_list_rows WHERE type = $1 AND id = ANY ($2::bigint[]) AND NOT (id = ANY ($3::bigint[]))
        RETURNING id::text`, [type, [...ids.keys()], [...rows.keys()]]);
      const drift = [...written, ...gone].map((r) => r.id).filter((id) => ids.get(id));
      if (drift.length) {
        await client.query("INSERT INTO derived_drift (type, id, what) SELECT $1, unnest($2::bigint[]), 'list row'", [type, drift]);
      }
      // computed: no longer set aside (128)
      await client.query("DELETE FROM derived_failures WHERE type = $1 AND id = ANY ($2::bigint[]) AND what = 'list row'", [type, [...ids.keys()]]);
    }
    await client.query('COMMIT');
    return queued.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 500); };

// Is the stored result up to date? Not: bring it up to date now (or join the worker) and wait — at most `wait` ms;
// false = still not (the page then shows the stored result with a note that it is being updated).
async function current(db, { wait = 5000 } = {}) {
  if (await isFresh(db)) return true;
  if (!pool) return false;
  urgent = true;
  let timeout;
  const late = new Promise((resolve) => { timeout = setTimeout(resolve, wait, false); });
  const done = refresh().then(() => isFresh(db));
  try { return await Promise.race([done, late]); } finally { clearTimeout(timeout); }
}

// How far behind: { waiting, oldest, global_current, refreshed_at, full_at, drift_week }
const status = async (db) => (await db.query('SELECT * FROM quality_status()')).rows[0];
// Is this entry waiting to be checked again?
const queued = async (db, type, id) => (await db.query(
  'SELECT EXISTS (SELECT 1 FROM derived_queue WHERE type = $1 AND id = $2) AS q', [type, id])).rows[0].q;

// Wait until this entry is checked again after a change (at most `wait` ms; the global part isn't waited for):
// true = done, false = still queued (the page says so).
async function settled(db, type, id, { wait = 2000 } = {}) {
  const until = Date.now() + wait;
  while (await queued(db, type, id)) {
    if (Date.now() >= until) return false;
    if (pool && !running) refresh();
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  return true;
}

// the nightly full run, once a day after FULL_HOUR
async function fullRunDue() {
  if (new Date().getHours() < FULL_HOUR) return;
  const { rows } = await pool.query("SELECT full_at IS NULL OR full_at < date_trunc('day', now()) + make_interval(hours => $1) AS due FROM quality_refresh", [FULL_HOUR]);
  if (!rows[0].due) return;
  const n = (await pool.query('SELECT refresh_quality_full() AS n')).rows[0].n;
  console.log(`quality: nightly full run — ${n} entries queued`);
}

// LISTEN on a connection of its own (a pooled one goes back to the pool); reconnects after an outage and refreshes
// then — a change during it sent its notice to nobody (its entries wait in the queue).
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
function start(adminPool, { nightlyRun = true } = {}) {
  pool = adminPool;
  stopped = false;
  if (nightlyRun) {
    nightly = setInterval(() => fullRunDue().catch((err) => console.error('quality: nightly run —', err.message)), 15 * 60 * 1000);
    nightly.unref();
  }
  // a refresh that failed (database restarting, an error not set aside) is tried again within a minute, also when no
  // change comes to wake the worker
  retry = setInterval(() => { if (!running) isFresh(pool).then((fresh) => { if (!fresh) refresh(); }).catch(() => {}); }, 60 * 1000);
  retry.unref();
  return listen();
}
async function stop() {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(globalTimer);
  clearInterval(nightly);
  clearInterval(retry);
  if (listener) await listener.end().catch(() => {});
  if (running) await running;
}

// Findings with names, filtered; acknowledged ones only when asked for — always the stored result: computed live,
// the checks would take as long as a refresh (seconds, more as the database grows).
// perCheck: at most this many per check (the page; the queue needs them all) — each row also says how many its check has
async function issues(db, { severity, check, type, entity, acked = false, perCheck = null } = {}) {
  const where = ['true'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (severity) where.push(`q.severity = ${p(severity)}`);
  if (check) where.push(`q.check_id = ${p(check)}`);
  if (type) where.push(`q.entity_type = ${p(type)}::entity_type`);
  if (entity) where.push(`q.entity_type = ${p(entity.type)}::entity_type AND q.entity_id = ${p(entity.id)}`);
  where.push(acked ? 'a.check_id IS NOT NULL' : 'a.check_id IS NULL');
  // the rank and the count per check by window functions over the filtered findings; the cut after them
  const { rows } = await db.query(`
    SELECT * FROM (
      SELECT q.check_id, q.severity, q.entity_type::text AS type, q.issue_key, q.detail, e.slug, e.name,
             a.note, a.acked_at, u.username AS acked_by,
             row_number() OVER w AS rank, count(*) OVER (PARTITION BY q.check_id)::int AS of_check,
             array_position(ARRAY['error', 'warning', 'info'], q.severity) AS sev_order, e.sort_key
      FROM quality_issues q
      JOIN entity_index e ON e.type = q.entity_type AND e.id = q.entity_id
      LEFT JOIN quality_acks a ON a.check_id = q.check_id AND a.issue_key = q.issue_key
      LEFT JOIN admin_users u ON u.id = a.acked_by
      WHERE ${where.join(' AND ')}
      WINDOW w AS (PARTITION BY q.check_id ORDER BY e.sort_key COLLATE sort_natural)) x
    ${perCheck ? `WHERE x.rank <= ${p(perCheck)}` : ''}
    ORDER BY x.sev_order, x.check_id, x.sort_key COLLATE sort_natural`, params);
  return rows;
}

async function counts(db) {
  const { rows } = await db.query(`
    SELECT q.severity, q.check_id, count(*)::int AS n FROM quality_issues q
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
  auto_created: { href: '/quality/batch/wikidata?only=auto', label: 'Find Wikidata items for these…' },
};
// checks the Enrich page helps with
const ENRICH = ['artwork_without_web_page', 'weakly_sourced', 'no_wikidata_id', 'artist_missing_dates', 'missing_romanization', 'institution_without_place', 'auto_created'];

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

function page({ rows, allCounts, filter, back, featured = 0, status: st = null, driftRows = [], failureRows = [] }) {
  const total = (s) => allCounts.filter((c) => c.severity === s).reduce((n, c) => n + c.n, 0);
  const q = (params) => `/quality?${new URLSearchParams(Object.entries({ ...filter, ...params }).filter(([, v]) => v)).toString()}`;
  const groups = {};
  for (const r of rows) (groups[r.check_id] ||= []).push(r);
  return html`<h1>Data quality</h1>
    ${statusLine(st)}${failuresBox(failureRows)}${driftBox(driftRows)}
    ${featured ? html`<p class="flash error">${featured} start view${featured === 1 ? ' has' : 's have'} problems (an entry deleted, a key the site doesn't know …) —
      <a href="/featured">Start views</a>.</p>` : ''}
    <p class="small">Batch pages: <a href="/quality/batch/wikidata">find Wikidata items</a> ·
      <a href="/quality/batch/wikidata?only=auto">… for entries created automatically</a> ·
      <a href="/quality/batch/images">images for artworks without one</a> ·
      <a href="/quality/batch/terms">types and materials to sort out</a> ·
      <a href="/provenance/numbers">provenance numbers</a> ·
      <a href="/quality/provenance-gaps">provenance gaps 1933–1945</a></p>
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
      const total = list[0].of_check || list.length;
      const head = html`<h2><span class="tag qa-${list[0].severity}">${list[0].severity}</span> ${CHECKS[id] ? CHECKS[id].title : id} <span class="muted">(${total})</span></h2>`;
      const more = total > list.length ? html`<p class="muted small qa-more">The first ${list.length} of ${total} —
        ${filter.check ? 'narrow them by type above.' : html`<a href="${q({ check: id, severity: '' })}">all ${total} of this check</a>.`}</p>` : '';
      const body = html`${CHECKS[id] ? html`<p class="muted small">${CHECKS[id].fix}</p>` : ''}
        ${!filter.acked ? html`<p class="actions qa-tools"><a class="button" href="${queueLink(list[0], qf, 0)}">Work through these →</a>
          ${BATCH[id] ? html`<a class="button secondary" href="${BATCH[id].href}${filter.type ? `${BATCH[id].href.includes('?') ? '&' : '?'}type=${filter.type}` : ''}">${BATCH[id].label}</a>` : ''}</p>` : ''}
        <div class="table-wrap"><table><tbody>${list.map((r) => html`<tr>
          <td><a href="${filter.acked ? link(r) : queueLink(r, qf, posOf(r))}">${r.name}</a> <span class="tag">${r.type}</span></td><td>${r.detail}
            ${r.acked_at ? html`<div class="muted small">OK’d by ${r.acked_by || '?'} on ${r.acked_at.toISOString().slice(0, 10)}${r.note ? ` — ${r.note}` : ''}</div>` : ''}</td>
          <td class="qa-actions">${ENRICH.includes(id) && !filter.acked ? html`<a class="button secondary" href="${link(r)}/enrich">Enrich…</a> ` : ''}${ackForm(r, back, !!r.acked_at)}</td></tr>`)}</tbody></table></div>${more}`;
      // completeness hints (info) folded away unless asked for: the errors and warnings first
      return list[0].severity === 'info' && filter.severity !== 'info' && !filter.check
        ? html`<details class="qa-group qa-folded"><summary>${head}</summary>${body}</details>`
        : html`<section class="qa-group">${head}${body}</section>`;
    })}</div>`;
}

// How current the stored result is (125): a line for the quality page and the dashboard.
const clock = (d) => (d ? d.toISOString().slice(11, 16) : '—');   // UTC, as when() in core.js
const STALE_MINUTES = 10;   // the queue's oldest entry waiting longer: the worker is stuck or failing — said loudly
const stale = (st) => st && st.oldest && Date.now() - st.oldest.getTime() > STALE_MINUTES * 60000;
function statusLine(st) {
  if (!st) return '';
  if (stale(st)) return html`<p class="flash error qa-status stale">The checks are stuck: ${st.waiting} ${st.waiting === 1 ? 'entry has' : 'entries have'} waited since ${clock(st.oldest)} UTC
    — the findings, search fields and lists below are out of date. The server log says why (<code>pm2 logs arthistory-api</code>).</p>`;
  if (st.waiting) return html`<p class="muted small qa-status updating">Updating — ${st.waiting} ${st.waiting === 1 ? 'entry' : 'entries'} waiting to be checked again (since ${clock(st.oldest)}); the lists below are a moment behind.</p>`;
  if (!st.global_current) return html`<p class="muted small qa-status updating">Updating the checks over all entries (broken links, narrowable dates) — a moment behind.</p>`;
  return html`<p class="muted small qa-status">Up to date · checked ${clock(st.refreshed_at)}${st.full_at ? html` · last full check ${st.full_at.toISOString().slice(0, 16).replace('T', ' ')}` : ''}</p>`;
}
// Entries the worker set aside because computing them failed (128) — their findings, search fields or list row are
// out of date until the cause is fixed (then the next change or the nightly run computes them again).
async function failures(db) {
  const { rows } = await db.query(`
    SELECT f.type::text AS type, f.what, f.error, f.failed_at, e.slug, e.name FROM derived_failures f
    LEFT JOIN entity_index e ON e.type = f.type AND e.id = f.id ORDER BY f.failed_at DESC LIMIT 100`);
  return rows;
}
const failuresBox = (rows) => (rows.length ? html`<div class="flash error qa-failures"><b>${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} could not be checked</b>
    — set aside so the others go on; their findings, search fields or list rows are out of date. The error says why (a bug to report):
    <ul>${rows.map((r) => html`<li>${r.slug ? html`<a href="${link(r)}">${r.name}</a>` : html`<i>deleted</i>`} <span class="tag">${r.type}</span> ${r.what}:
      <code>${r.error}</code> <span class="muted small">${r.failed_at.toISOString().slice(0, 16).replace('T', ' ')}</span></li>`)}</ul></div>` : '');

// What the nightly full run changed that the incremental path had missed (the last week) — each a dependency the
// triggers of 125 don't know yet.
async function drift(db) {
  const { rows } = await db.query(`
    SELECT d.type::text AS type, d.what, max(d.found_at) AS found_at, e.slug, e.name FROM derived_drift d
    LEFT JOIN entity_index e ON e.type = d.type AND e.id = d.id
    WHERE d.found_at > now() - interval '7 days'
    GROUP BY d.type, d.id, d.what, e.slug, e.name ORDER BY max(d.found_at) DESC LIMIT 100`);
  return rows;
}
const driftBox = (rows) => (rows.length ? html`<details class="flash warn qa-drift"><summary><b>${rows.length} correction${rows.length === 1 ? '' : 's'} by the nightly full check</b>
    — the incremental checks had missed ${rows.length === 1 ? 'this' : 'these'} (a dependency they don’t know: worth reporting).</summary>
    <ul>${rows.map((r) => html`<li>${r.slug ? html`<a href="${link(r)}">${r.name}</a>` : html`<i>deleted</i>`} <span class="tag">${r.type}</span> ${r.what}
      <span class="muted small">${r.found_at.toISOString().slice(0, 16).replace('T', ' ')}</span></li>`)}</ul></details>` : '');

// Box on an entity page: its errors and warnings (info only as a count).
// queued: a change to it (or to an entry it depends on) isn't checked yet — said, not waited for.
function entityBox(rows, back, { queued = false } = {}) {
  const serious = rows.filter((r) => r.severity !== 'info');
  const infos = rows.length - serious.length;
  const checking = queued ? html` <span class="muted small qa-checking">Being checked again after a change — reload in a moment.</span>` : '';
  if (!rows.length) return queued ? html`<div class="qa-box"><b>Data quality:</b>${checking}</div>` : '';
  return html`<div class="qa-box${serious.some((r) => r.severity === 'error') ? ' has-error' : ''}">
    <b>Data quality:</b> ${serious.length ? '' : html`<span class="muted">no problems.</span>`}${checking}
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

module.exports = { CHECKS, SEVERITIES, issues, counts, page, entityBox, ack, unack, start, stop, current, isFresh, refresh, status, queued, settled, statusLine, stale, drift, failures,
  filterOf, filterQuery, queue, next, queueLink, queueBar };
