// Citable versions (migration 089): an entry as it was recorded at a moment, rebuilt from the audit log.
//   GET /v1/<plural>/<number or slug>?as_of=2026-10-12            the entry as of the end of that day (Zurich time)
//   GET /v1/<plural>/<number or slug>?as_of=2026-10-12T14:03:00Z  … as of that moment
//   GET /v1/history/<plural>/<number or slug>                     its versions: every transaction that changed it
// The as-of view is the recorded data — the entry's own fields, its relationships, an artwork's provenance steps —
// with references to the other entries as they are now (their current addresses), and the changes made since.
// Also for entries deleted or merged away since (deleted: true): a citation of them keeps working.
const express = require('express');
const { apiPool } = require('../db');
const { badRequest, notFound } = require('../http');

const router = express.Router();
const ENTITIES = () => require('./entities').ENTITIES;   // lazily: entities.js requires this file
const plurals = () => Object.fromEntries(Object.entries(ENTITIES()).map(([k, v]) => [v.type, k]));

// '2026-10-12' → the end of that day in Zurich; an ISO timestamp as given. Postgres does the arithmetic.
// Moments travel as text with microseconds (as Postgres stores them): a JavaScript Date keeps milliseconds only, and
// a version's moment rounded down would lie just before its own change.
const iso = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
function asOfParam(raw) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { sql: `(($1::date + 1)::timestamp AT TIME ZONE 'Europe/Zurich') - interval '1 microsecond'`, value: s };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return { sql: '$1::timestamptz', value: s };
  throw badRequest('as_of: a date (2026-10-12) or a moment (2026-10-12T14:03:00Z)');
}

async function findEntry(plural, key) {
  const e = ENTITIES()[plural];
  if (!e) throw notFound();
  const { rows: [hit] } = await apiPool.query('SELECT id, deleted FROM entry_row_id($1, $2)', [e.table, key]);
  if (!hit || hit.id === null) throw notFound(`no ${e.type} "${key}"`);
  return { e, id: Number(hit.id), deleted: hit.deleted };
}

// (type, id) pairs → current references { type, slug, public_id, name, path }
async function refs(pairs) {
  const ok = pairs.filter((p) => p.type && p.id != null);
  if (!ok.length) return new Map();
  const { rows } = await apiPool.query(`SELECT e.type::text AS type, e.id, e.slug, e.public_id, e.name, e.kind
    FROM unnest($1::entity_type[], $2::bigint[]) k(t, i) JOIN entity_index e ON (e.type, e.id) = (k.t, k.i)`,
  [ok.map((p) => p.type), ok.map((p) => p.id)]);
  const pl = plurals();
  return new Map(rows.map(({ id, ...r }) => [`${r.type}:${id}`, { ...r, public_id: Number(r.public_id), path: `/${pl[r.type]}/${r.public_id}/${r.slug}` }]));
}
// an entry that no longer exists: what is known of it
const ref = (m, type, id) => (id == null ? null : m.get(`${type}:${id}`) || { type, name: null, gone: true });

async function asOf(req, res, plural, key) {
  const t = asOfParam(req.query.as_of);
  const { e, id, deleted } = await findEntry(plural, key);
  // today's date ends in the future: as of now
  const { rows: [when] } = await apiPool.query(`SELECT ${iso(`least(${t.sql}, now())`)} AS ts, ${t.sql} > now() + interval '1 day' AS future,
    ${t.sql} > now() - interval '1 hour' AS recent, ${t.sql} < history_since() AS early,
    ${iso('history_since()')} AS since`, [t.value]);
  if (when.future) throw badRequest('as_of lies in the future');
  if (when.early) throw badRequest(`the history begins on ${when.since.slice(0, 10)}`);
  const ts = when.ts;
  const { rows: [own] } = await apiPool.query(`SELECT r FROM rows_as_of($1, $2, jsonb_build_object('id', $3::bigint)) r`, [e.table, ts, id]);
  const { rows: versions } = await apiPool.query(`SELECT ${iso('changed_at')} AS changed_at, changed_at <= $3::timestamptz AS before
    FROM entry_versions($1, $2) ORDER BY changed_at`, [e.type, id, ts]);
  const version = versions.filter((v) => v.before).at(-1) || null;
  const current = deleted ? null : (await refs([{ type: e.type, id }])).get(`${e.type}:${id}`) || null;
  if (!own) {
    return res.status(404).json({ error: 'not_found', message: `no ${e.type} "${key}" on ${req.query.as_of} — ${versions.length ? `first recorded ${versions[0].changed_at}` : 'not recorded then'}`,
      current, first_recorded: versions[0] ? versions[0].changed_at : null });
  }

  const { rows: rels } = await apiPool.query(`
    SELECT DISTINCT ON (r->>'id') r->>'relationship_type' AS relationship_type,
           (r->>'subject_type', (r->>'subject_id')::bigint) = ($2::text, $3::bigint) AS outgoing,
           r->>'subject_type' AS s_type, (r->>'subject_id')::bigint AS s_id, r->>'object_type' AS o_type, (r->>'object_id')::bigint AS o_id,
           range_json((r->>'period')::daterange, r->>'period_label') AS period, r->>'label' AS label, r->>'certainty' AS certainty,
           r->>'notes_md' AS notes_md, rt.label AS type_label, rt.inverse_label
    FROM (SELECT r FROM rows_as_of('relationships', $1, jsonb_build_object('subject_type', $2::text, 'subject_id', $3::bigint)) r
          UNION ALL
          SELECT r FROM rows_as_of('relationships', $1, jsonb_build_object('object_type', $2::text, 'object_id', $3::bigint)) r) x
    LEFT JOIN relationship_types rt ON rt.code = r->>'relationship_type'
    ORDER BY r->>'id'`, [ts, e.type, id]);
  let steps = [];
  if (e.type === 'artwork') {
    ({ rows: steps } = await apiPool.query(`
      SELECT (r->>'id')::bigint AS id, (r->>'position')::int AS position, r->>'role' AS role, r->>'method' AS method,
             (r->>'direct')::boolean AS direct, r->>'certainty' AS certainty,
             CASE WHEN r->>'owner_artist_id' IS NOT NULL THEN 'artist' WHEN r->>'owner_person_id' IS NOT NULL THEN 'person'
                  WHEN r->>'owner_institution_id' IS NOT NULL THEN 'institution' WHEN r->>'owner_place_id' IS NOT NULL THEN 'place' END AS h_type,
             coalesce(r->>'owner_artist_id', r->>'owner_person_id', r->>'owner_institution_id', r->>'owner_place_id')::bigint AS h_id,
             r->>'owner_label' AS holder_label,
             range_json((r->>'acquired')::daterange, r->>'acquired_label') AS acquired, range_json((r->>'ended')::daterange, r->>'ended_label') AS ended,
             r->>'label' AS label, r->>'notes_md' AS notes_md, (r->>'alternative_to')::bigint AS alternative_to
      FROM rows_as_of('provenance', $1, jsonb_build_object('artwork_id', $2::bigint)) r
      ORDER BY (r->>'alternative_to') IS NOT NULL, (r->>'position')::int, (r->>'id')::bigint`, [ts, id]));
  }
  const { rows: since } = await apiPool.query(`SELECT ${iso('changed_at')} AS changed_at, table_name, action, changed_fields(old_row, new_row) AS fields, source
    FROM entry_log($1, $2) WHERE changed_at > $3 ORDER BY id`, [e.type, id, ts]);

  const m = await refs([...rels.flatMap((r) => [{ type: r.s_type, id: r.s_id }, { type: r.o_type, id: r.o_id }]),
    ...steps.map((s) => ({ type: s.h_type, id: s.h_id }))]);
  if (!when.recent) res.set('Cache-Control', 'public, max-age=3600');   // a past moment doesn't change (today's end may)
  res.json({
    type: e.type, as_of: ts, requested: req.query.as_of, history_since: when.since,
    // the version this is: the last change at or before the moment (cite it with this timestamp)
    version: version ? version.changed_at : null,
    current, deleted,
    entry: own.r,
    relationships: rels.map((r) => ({
      relationship_type: r.relationship_type, reads: r.outgoing ? r.type_label : (r.inverse_label || r.type_label), direction: r.outgoing ? 'out' : 'in',
      other: r.outgoing ? ref(m, r.o_type, r.o_id) : ref(m, r.s_type, r.s_id), period: r.period, label: r.label, certainty: r.certainty, notes_md: r.notes_md })),
    ...(e.type === 'artwork' ? { provenance: steps.map(({ h_type: ht, h_id: hid, holder_label: hl, id: sid, ...s }) => ({
      id: Number(sid), ...s, holder: hid != null ? ref(m, ht, hid) : null, holder_label: hl,
      alternative_to: s.alternative_to && Number(s.alternative_to) })) } : {}),
    changes_since: since.map((c) => ({ changed_at: c.changed_at, table: c.table_name, action: c.action, fields: c.fields, source: c.source })),
  });
}

router.get('/:plural/:key', async (req, res) => {
  const { e, id, deleted } = await findEntry(req.params.plural, req.params.key);
  const { rows } = await apiPool.query(`SELECT ${iso('changed_at')} AS changed_at, sources, tables, changes FROM entry_versions($1, $2)`, [e.type, id]);
  const { rows: [{ since }] } = await apiPool.query(`SELECT ${iso('history_since()')} AS since`);
  const current = deleted ? null : (await refs([{ type: e.type, id }])).get(`${e.type}:${id}`) || null;
  res.json({
    type: e.type, current, deleted, history_since: since,
    // newest first; as_of = the address of that version
    versions: rows.reverse().map((v) => ({ changed_at: v.changed_at, as_of: v.changed_at,
      sources: v.sources, tables: v.tables, changes: v.changes })),
  });
});

module.exports = { router, asOf };
