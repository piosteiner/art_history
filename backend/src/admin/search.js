// Admin search across everything: GET /search?q=…
//
// Unlike the public /v1/search (names only), this finds an entity by
//   1. its name — accent-insensitive and typo-tolerant (pg_trgm word_similarity), ranked highest
//   2. alternative names/titles and sort name — also typo-tolerant (src/admin/match.js)
//      other identifiers — slug, medium, Wikidata id, metadata … (ILIKE substring)
//   3. its text — biography / description / notes, with Postgres full-text search: to_tsvector('english', …) stems
//      words ("painted" matches "painting"), websearch_to_tsquery understands  "exact phrase", -exclude, a OR b
// and separately finds relationships by their label, notes and sources.
//
// Searched in stored documents (admin_search_docs, migration 201) through trigram and full-text indexes; the
// derived-data worker keeps them (refreshDocs).
const { html, raw } = require('./html');
const { BY_TYPE, TYPES } = require('../content');
const { THRESHOLD, likeParam, scoreSql, altScoreSql, altSql } = require('./match');

// ts_headline marks hits with these control characters; the page escapes the text, then turns them into <mark>.
const START = '\u0002';
const STOP = '\u0003';

// One row per entity, whatever its table, generated from the content model (src/content.js):
//   name · alt (alternative names/titles + sort name, fuzzy-matched) · other (short text fields, slug, Wikidata id,
//   metadata — substring-matched) · body (the Markdown text, full-text searched)
function docSql(t) {
    const entries = Object.entries(t.fields);
    const shortText = [...entries.filter(([k, kind]) => kind === 'text' && k !== 'sort_name').map(([k]) => `t.${k}`),
      // lists (an artwork's materials) are searchable text too; other names are in alt (altSql)
      ...entries.filter(([, kind]) => kind === 'text[]').map(([k]) => `array_to_string(t.${k}, ' · ')`)];
    const body = entries.find(([, kind]) => kind === 'md');
    return `SELECT '${t.type}'::entity_type AS type, t.id, t.slug, t.${t.name} AS name, ${altSql(t, 't') || 'NULL'} AS alt,
         concat_ws(' · ', ${[...shortText, "nullif(t.metadata, '{}')::text"].join(', ')}) AS other,
         ${body ? `t.${body[0]}` : 'NULL'} AS body
    FROM ${t.table} t`;
}
const docsSql = () => TYPES.map(docSql).join('\n  UNION ALL\n  ');

// The stored documents (admin_search_docs, 201) of some entries brought up to date — by the derived-data worker with
// the list rows (src/admin/quality.js), so every changed entry is refreshed; an entry gone loses its document.
async function refreshDocs(db, type, ids) {
  const t = BY_TYPE[type];
  if (!t || !ids.length) return;
  await db.query(`
    WITH d AS (SELECT * FROM (${docSql(t)}) x WHERE x.id = ANY ($1::bigint[]))
    INSERT INTO admin_search_docs AS a (type, id, slug, name, alt, other, body, fname, falt, fother, body_tsv)
      SELECT d.type, d.id, d.slug, d.name, d.alt, d.other, d.body, f_unaccent(d.name), f_unaccent(coalesce(d.alt, '')),
             f_unaccent(d.slug || ' · ' || coalesce(d.other, '')), to_tsvector('english', f_unaccent(coalesce(d.body, '')))
      FROM d
    ON CONFLICT (type, id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, alt = EXCLUDED.alt, other = EXCLUDED.other,
      body = EXCLUDED.body, fname = EXCLUDED.fname, falt = EXCLUDED.falt, fother = EXCLUDED.fother, body_tsv = EXCLUDED.body_tsv
    WHERE (a.slug, a.name, a.alt, a.other, a.body) IS DISTINCT FROM (EXCLUDED.slug, EXCLUDED.name, EXCLUDED.alt, EXCLUDED.other, EXCLUDED.body)`, [ids]);
  await db.query(`DELETE FROM admin_search_docs a WHERE a.type = $1 AND a.id = ANY ($2::bigint[])
    AND NOT EXISTS (SELECT 1 FROM ${t.table} x WHERE x.id = a.id)`, [type, ids]);
}

// The stored documents (admin_search_docs, 201: folded once, text vector stored): first the candidates through the
// indexes — trigram matches of the name (also without spaces), the other names and the identifiers, or the full text
// (word similarity from 0.5, set for this transaction: search()) — then scored by match.js's rules (scoreSql,
// altScoreSql), which every candidate set holds: 0.11 s instead of 5.3 on the perf data.
const ENTITY_SQL = `
WITH q AS (SELECT websearch_to_tsquery('english', f_unaccent($1)) AS tsq, f_unaccent($1) AS fq, f_unaccent($2) AS fl),
cand AS (
  SELECT d.* FROM admin_search_docs d, q
  WHERE d.fname ILIKE '%' || q.fl || '%' OR q.fq <% d.fname OR replace(q.fq, ' ', '') <% replace(d.fname, ' ', '')
     OR d.falt ILIKE '%' || q.fl || '%' OR q.fq <% d.falt
     OR d.fother ILIKE '%' || q.fl || '%'
     OR d.body_tsv @@ q.tsq
),
scored AS (
  SELECT d.*,
         CASE WHEN d.fname ILIKE q.fl || '%' THEN 1.1
              WHEN ' ' || d.fname ILIKE '% ' || q.fl || '%' THEN 1.05
              WHEN d.fname ILIKE '%' || q.fl || '%' THEN 1.0
              ELSE greatest(word_similarity(q.fq, d.fname), word_similarity(replace(q.fq, ' ', ''), replace(d.fname, ' ', ''))) END AS name_score,
         CASE WHEN d.falt ILIKE '%' || q.fl || '%' THEN 0.9 ELSE 0.9 * word_similarity(q.fq, d.falt) END AS alt_score,
         d.fother ILIKE '%' || q.fl || '%' AS other_hit,
         q.tsq
  FROM cand d, q
)
SELECT type::text, slug, name,
       name_score >= ${THRESHOLD} AS name_hit,
       CASE WHEN alt_score >= ${THRESHOLD} AND name_score < ${THRESHOLD} THEN alt END AS alt,
       CASE WHEN other_hit THEN other END AS other,
       CASE WHEN body_tsv @@ tsq
            THEN ts_headline('english', body, tsq, 'StartSel=${START}, StopSel=${STOP}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "')
       END AS snippet,
       -- Names first, then alternative names, identifiers, and text hits by relevance (ts_rank is small, ~0–0.1).
       greatest(CASE WHEN name_score >= ${THRESHOLD} THEN name_score ELSE 0 END,
                CASE WHEN alt_score >= ${THRESHOLD} THEN alt_score ELSE 0 END,
                CASE WHEN other_hit THEN 0.45 ELSE 0 END,
                CASE WHEN body_tsv @@ tsq THEN 0.2 + ts_rank(body_tsv, tsq) ELSE 0 END) AS score
FROM scored
WHERE name_score >= ${THRESHOLD} OR alt_score >= ${THRESHOLD} OR other_hit OR body_tsv @@ tsq
ORDER BY score DESC, name COLLATE sort_natural, slug   -- two of one name and score (Emil Bührle): always one order
LIMIT 100`;

// Picker suggestions (GET /lookup): best name / alternative-name matches of the given types.
const LOOKUP_SQL = `
WITH docs AS (
  ${docsSql()}
),
scored AS (
  SELECT d.type, d.id, d.slug, d.name, d.alt, greatest(${scoreSql('d.name', 'd.alt')},
         CASE WHEN d.slug ILIKE $2 || '%' THEN 1.05 ELSE 0 END) AS score
  FROM docs d
  WHERE d.type = ANY ($3::entity_type[])
)
SELECT s.type::text, s.slug, s.name, s.alt, e.period_label, round(s.score::numeric, 2) AS score
FROM scored s JOIN entity_index e ON e.type = s.type AND e.id = s.id
WHERE s.score >= ${THRESHOLD}
ORDER BY s.score DESC, s.name COLLATE sort_natural
LIMIT 12`;

const RELATIONSHIP_SQL = `
WITH q AS (
  SELECT '%' || f_unaccent($2) || '%' AS pattern, websearch_to_tsquery('english', f_unaccent($1)) AS tsq
)
SELECT r.id, s.type::text AS subject_type, s.slug AS subject_slug, s.name AS subject_name, rt.label,
       o.type::text AS object_type, o.slug AS object_slug, o.name AS object_name, r.period_label,
       concat_ws(' · ', r.label, r.metadata->'sources') AS details,
       CASE WHEN to_tsvector('english', f_unaccent(coalesce(r.notes_md, ''))) @@ q.tsq
            THEN ts_headline('english', r.notes_md, q.tsq, 'StartSel=${START}, StopSel=${STOP}, MaxWords=25, MinWords=10')
            WHEN r.notes_md IS NOT NULL AND f_unaccent(r.notes_md) ILIKE q.pattern THEN left(r.notes_md, 200)
       END AS snippet
FROM relationships r
JOIN relationship_types rt ON rt.code = r.relationship_type
JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
CROSS JOIN q
WHERE f_unaccent(concat_ws(' ', r.label, r.notes_md, nullif(r.metadata, '{}')::text)) ILIKE q.pattern
   OR to_tsvector('english', f_unaccent(coalesce(r.notes_md, ''))) @@ q.tsq
ORDER BY s.name COLLATE sort_natural, rt.sort_order
LIMIT 50`;

async function search(db, q) {
  const params = [q, likeParam(q)];
  // the entities in a transaction of their own: <% at match.js's THRESHOLD (pg_trgm's default is 0.6)
  const entities = async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('pg_trgm.word_similarity_threshold', $1, true)", [String(THRESHOLD)]);
      const r = await client.query(ENTITY_SQL, params);
      await client.query('COMMIT');
      return r;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  };
  const [ents, relationships] = await Promise.all([entities(), db.query(RELATIONSHIP_SQL, params)]);
  return { entities: ents.rows, relationships: relationships.rows };
}

// Escaped text with the ts_headline markers turned into <mark>.
const marked = (s) => html`${s}`.toString().replace(new RegExp(START, 'g'), '<mark>').replace(new RegExp(STOP, 'g'), '</mark>');

// Plain substring highlight (accent-sensitive; only for display).
function highlight(text, q) {
  const escaped = html`${text}`.toString();
  const needle = html`${q}`.toString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return needle ? escaped.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`) : escaped;
}

function resultsPage(q, { entities, relationships }) {
  const byType = {};
  for (const e of entities) (byType[e.type] ||= []).push(e);
  const order = ['artist', 'artwork', 'place', 'movement', 'institution', 'person', 'polity', 'event', 'literature', 'term', 'source'].filter((t) => byType[t]);
  const total = entities.length + relationships.length;
  return html`<h1>Search</h1>
    <form class="bar" method="get" action="/search" data-live data-live-min="2">
      <input name="q" value="${q}" type="search" class="grow" placeholder="Name, alternative name, text, Wikidata id…" autofocus autocomplete="off">
      <button>Search</button></form>
    <div data-live-results="search"><p class="muted">${q ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : ''}
      ${q ? html` · tips: <code>"exact phrase"</code>, <code>-exclude</code>, <code>monet or manet</code>` : ''}</p>
    ${order.length ? html`<p class="actions">${order.map((t) => html`<a href="#r-${t}">${BY_TYPE[t].folder} (${byType[t].length})</a>`)}
      ${relationships.length ? html`<a href="#r-relationships">relationships (${relationships.length})</a>` : ''}</p>` : ''}
    ${order.map((t) => html`<h2 id="r-${t}">${BY_TYPE[t].folder[0].toUpperCase() + BY_TYPE[t].folder.slice(1)}</h2>
      <div class="search-results">${byType[t].map((e) => html`<div class="search-hit">
        <a href="/${BY_TYPE[t].folder}/${e.slug}">${raw(e.name_hit ? highlight(e.name, q) : html`${e.name}`.toString())}</a>
        <span class="muted">${e.slug}</span>
        ${e.alt ? html`<div class="muted small">also: ${raw(highlight(e.alt, q))}</div>` : ''}
        ${e.other ? html`<div class="muted small">${raw(highlight(e.other, q))}</div>` : ''}
        ${e.snippet ? html`<div class="small">${raw(marked(e.snippet))}</div>` : ''}
      </div>`)}</div>`)}
    ${relationships.length ? html`<h2 id="r-relationships">Relationships</h2><div class="search-results">
      ${relationships.map((r) => html`<div class="search-hit">
        <a href="/${BY_TYPE[r.subject_type].folder}/${r.subject_slug}">${r.subject_name}</a> ${r.label}
        <a href="/${BY_TYPE[r.object_type].folder}/${r.object_slug}">${r.object_name}</a>
        <span class="muted">${r.period_label || ''}</span> · <a href="/relationships/${r.id}/edit">edit</a>
        ${r.details ? html`<div class="muted small">${raw(highlight(r.details, q))}</div>` : ''}
        ${r.snippet ? html`<div class="small">${raw(r.snippet.includes(START) ? marked(r.snippet) : highlight(r.snippet, q))}</div>` : ''}
      </div>`)}</div>` : ''}
    ${q && !total ? html`<p>Nothing found. The name search tolerates typos; text search matches whole words (and their forms).</p>` : ''}</div>`;
}

async function lookup(db, q, types) {
  return (await db.query(LOOKUP_SQL, [q, likeParam(q), types])).rows;
}

module.exports = { search, resultsPage, lookup, refreshDocs };
