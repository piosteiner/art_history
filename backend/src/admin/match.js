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

module.exports = { THRESHOLD, likeParam, scoreSql, altScoreSql, altSql };
