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
// There is no index for 2 and 3 yet: at this size a sequential scan of every table takes a few milliseconds.
// Once there are thousands of long texts, add an expression index per table, e.g.
//   CREATE INDEX artists_fts ON artists USING gin (to_tsvector('english', f_unaccent(coalesce(biography_md, ''))));
// (the query below uses exactly that expression, so the planner would pick it up).
const { html, raw } = require('./html');
const { BY_TYPE, TYPES } = require('../content');
const { THRESHOLD, likeParam, scoreSql, altScoreSql, altSql } = require('./match');

// ts_headline marks hits with these control characters; the page escapes the text, then turns them into <mark>.
const START = '\u0002';
const STOP = '\u0003';

// One row per entity, whatever its table, generated from the content model (src/content.js):
//   name · alt (alternative names/titles + sort name, fuzzy-matched) · other (short text fields, slug, Wikidata id,
//   metadata — substring-matched) · body (the Markdown text, full-text searched)
function docsSql() {
  return TYPES.map((t) => {
    const entries = Object.entries(t.fields);
    const shortText = [...entries.filter(([k, kind]) => kind === 'text' && k !== 'sort_name').map(([k]) => `t.${k}`),
      // lists (an artwork's materials) are searchable text too; other names are in alt (altSql)
      ...entries.filter(([, kind]) => kind === 'text[]').map(([k]) => `array_to_string(t.${k}, ' · ')`)];
    const body = entries.find(([, kind]) => kind === 'md');
    return `SELECT '${t.type}'::entity_type AS type, t.id, t.slug, t.${t.name} AS name, ${altSql(t, 't') || 'NULL'} AS alt,
         concat_ws(' · ', ${[...shortText, "nullif(t.metadata, '{}')::text"].join(', ')}) AS other,
         ${body ? `t.${body[0]}` : 'NULL'} AS body
    FROM ${t.table} t`;
  }).join('\n  UNION ALL\n  ');
}

const ENTITY_SQL = `
WITH q AS (SELECT websearch_to_tsquery('english', f_unaccent($1)) AS tsq),
docs AS (
  ${docsSql()}
),
scored AS (
  SELECT d.*,
         ${scoreSql('d.name')} AS name_score,
         ${altScoreSql('d.alt')} AS alt_score,
         f_unaccent(d.slug || ' · ' || d.other) ILIKE '%' || f_unaccent($2) || '%' AS other_hit,
         to_tsvector('english', f_unaccent(coalesce(d.body, ''))) AS body_tsv,
         q.tsq
  FROM docs d, q
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
ORDER BY score DESC, name
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
ORDER BY s.score DESC, s.name
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
ORDER BY s.name, rt.sort_order
LIMIT 50`;

async function search(db, q) {
  const params = [q, likeParam(q)];
  const [entities, relationships] = await Promise.all([db.query(ENTITY_SQL, params), db.query(RELATIONSHIP_SQL, params)]);
  return { entities: entities.rows, relationships: relationships.rows };
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
  const order = ['artist', 'artwork', 'place', 'movement', 'institution', 'person', 'polity', 'term'].filter((t) => byType[t]);
  const total = entities.length + relationships.length;
  return html`<h1>Search</h1>
    <form class="bar" method="get" action="/search">
      <input name="q" value="${q}" type="search" class="grow" placeholder="Name, alternative name, text, Wikidata id…" autofocus>
      <button>Search</button></form>
    <p class="muted">${q ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : ''}
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
    ${q && !total ? html`<p>Nothing found. The name search tolerates typos; text search matches whole words (and their forms).</p>` : ''}`;
}

async function lookup(db, q, types) {
  return (await db.query(LOOKUP_SQL, [q, likeParam(q), types])).rows;
}

module.exports = { search, resultsPage, lookup };
