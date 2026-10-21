// Fuzzy name matching shared by every admin search box (list pages, /search, the form pickers' /lookup).
// The SQL expects two parameters: $1 = what was typed, $2 = the same with LIKE wildcards escaped (likeParam()).
//
// Score (higher = better), all accent-insensitive through f_unaccent():
//   1.1  name starts with the query          ("hok" → Hokusai)
//   1.05 a word of the name starts with it   ("hok" → Katsushika Hokusai)
//   1.0  name contains it                    ("ogh" → Vincent van Gogh)
//   0–1  pg_trgm word_similarity(query, name): how well the query matches the most similar stretch of the name,
//        by shared three-letter fragments — this is what tolerates typos ("hokusia" → Hokusai ≈ 0.6). Compared
//        once more with spaces removed, so run-together or split words match too ("vangog" → Van Gogh)
//   0.9× the same against alternative names  ("antwerpen" → Antwerp, "ando hiroshige" → Utagawa Hiroshige)
// A row counts as a match from THRESHOLD up. 0.5 is a little looser than pg_trgm's default for <% (0.6), which
// suits short names; anything below starts matching unrelated names.
const THRESHOLD = 0.5;

const likeParam = (q) => q.replace(/[\\%_]/g, '\\$&');

function altScoreSql(altExpr) {
  return `(CASE WHEN f_unaccent(${altExpr}) ILIKE '%' || f_unaccent($2) || '%' THEN 0.9
                ELSE 0.9 * word_similarity(f_unaccent($1), f_unaccent(coalesce(${altExpr}, ''))) END)`;
}

function scoreSql(nameExpr, altExpr = null) {
  const n = `f_unaccent(${nameExpr})`;
  const name = `(CASE WHEN ${n} ILIKE f_unaccent($2) || '%' THEN 1.1
                      WHEN ' ' || ${n} ILIKE '% ' || f_unaccent($2) || '%' THEN 1.05
                      WHEN ${n} ILIKE '%' || f_unaccent($2) || '%' THEN 1.0
                      ELSE greatest(word_similarity(f_unaccent($1), ${n}),
                                    word_similarity(replace(f_unaccent($1), ' ', ''), replace(${n}, ' ', ''))) END)`;
  return altExpr ? `greatest(${name}, ${altScoreSql(altExpr)})` : name;
}

// SQL for an entity's other names as one string: translations, romanizations, alternatives with their furigana
// readings, the main name's reading, kana readings in Latin letters (name_alt_text(), migrations 022/023 — the
// expression of the <table>_alt_trgm index), plus an artist's sort name.
function altSql(t, alias) {
  const parts = [`name_alt_text(${alias}.${t.name}_ruby, ${alias}.names)`,
    t.fields.sort_name && `${alias}.sort_name`].filter(Boolean);
  return parts.length ? `nullif(concat_ws(' · ', ${parts.join(', ')}), '')` : null;
}

// The field search (migration 110) — the same rules as the site's lists (frontend/src/catalog.ts: matches, explain,
// ordered): every word of the query ($1) in the name, the other names, the slug or one of the entry's search fields
// (view entry_search_fields), folded alike (f_unaccent ≙ fold.ts); fields the list shows anyway (shown) count as visible. → SQL of a query over the type's table, one row per
// hit: id, score (3 the name starts with the query, 2 every word in the name, 1 found elsewhere), why ([{label, text}]:
// the fields that matched words the name doesn't have), tier_rank / tier_heading (found only through a tiered field:
// "Now in the collection" before "Formerly in the collection"). Order: by tier (none first), then score, then name.
// The fields are the stored copy (111), brought up to date for each changed entry (125) — never the view itself, which
// computes every entry's fields (seconds).
function fieldSearchSql(t, alias = 't') {
  const own = [`${alias}.${t.name}`, altSql(t, alias), `${alias}.slug`].filter(Boolean).join(', ');
  return `
    WITH q AS (SELECT array_remove(regexp_split_to_array(lower(f_unaccent(btrim($1))), '\\s+'), '') AS words,
                      lower(f_unaccent(btrim($1))) AS phrase),
    fields AS (SELECT f.id, f.position, f.label, f.text, f.tier_rank, f.tier_heading, f.shown, lower(f_unaccent(coalesce(f.match, f.text))) AS hay
               FROM entry_search_fields_stored f WHERE f.type = '${t.type}'),
    -- visible: the name, other names, slug and what the list shows under the name anyway (shown fields)
    base AS (SELECT ${alias}.id, lower(f_unaccent(${alias}.${t.name})) AS fname,
                    concat_ws(' ', lower(f_unaccent(concat_ws(' ', ${own}))), (SELECT string_agg(f.hay, ' ') FROM fields f WHERE f.id = ${alias}.id AND f.shown)) AS own
             FROM ${t.table} ${alias}),
    -- per entry: the words its name and other names don't have, and the fields that have them
    found AS (
      SELECT b.id, b.fname, b.own,
             (SELECT coalesce(array_agg(w), '{}') FROM unnest(q.words) w WHERE strpos(b.own, w) = 0) AS hidden
      FROM base b, q)
    SELECT x.id,
           CASE WHEN x.fname LIKE q.phrase || '%' THEN 3
                WHEN NOT EXISTS (SELECT 1 FROM unnest(q.words) w WHERE strpos(x.fname, w) = 0) THEN 2 ELSE 1 END AS score,
           m.why, CASE WHEN m.untiered THEN NULL ELSE m.tier_rank END AS tier_rank,
           CASE WHEN m.untiered THEN NULL ELSE m.tier_heading END AS tier_heading
    FROM found x CROSS JOIN q
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('label', f.label, 'text', f.text) ORDER BY f.position) AS why,
             bool_or(f.tier_rank IS NULL) AS untiered, min(f.tier_rank) AS tier_rank,
             (array_agg(f.tier_heading ORDER BY f.tier_rank NULLS LAST))[1] AS tier_heading
      FROM fields f WHERE f.id = x.id AND NOT f.shown AND EXISTS (SELECT 1 FROM unnest(x.hidden) w WHERE strpos(f.hay, w) > 0)) m
    -- every word somewhere: each hidden word in one of its fields
    WHERE cardinality(q.words) > 0
      AND NOT EXISTS (SELECT 1 FROM unnest(x.hidden) w
                      WHERE NOT EXISTS (SELECT 1 FROM fields f WHERE f.id = x.id AND strpos(f.hay, w) > 0))`;
}

module.exports = { THRESHOLD, likeParam, scoreSql, altScoreSql, altSql, fieldSearchSql };
