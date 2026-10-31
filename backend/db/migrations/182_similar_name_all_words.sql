-- 182 — a "similar name" needs all of its words (owner 2026-10-31: Wikidata offered our "Department of Near Eastern
-- Antiquities of the Louvre" for "Eastern Bloc", and the "National Museum of Western Art" for "Western Bloc").
-- strict_word_similarity measures how well the label is found *somewhere* in the name: one long word found whole
-- ("eastern") gives 0.62 though "bloc" is missing. Now, besides that score, every word of one of the two names must
-- be in the other — each word with strict_word_similarity ≥ 0.35, so spelling variants still count (Velasko/Velasco
-- 0.45, Rembrant/Rembrandt 0.58, Gogh/Gough 0.38) while a missing word scores near 0 ("bloc" in either name: 0); words under three letters and articles/prepositions don't count. Either direction: the
-- label inside a longer name ("Impressionism" → "Early Impressionism") or a shorter name inside the label. Used by
-- the Wikidata comparison (similarEntry) and the "did you mean" of automatically created entries (autocreate.js).

CREATE OR REPLACE FUNCTION name_words_in(a text, b text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM regexp_split_to_table(lower(f_unaccent(a)), '[^[:alnum:]]+') w
    WHERE length(w) >= 3
      AND w <> ALL (ARRAY['the', 'and', 'des', 'les', 'der', 'die', 'das', 'den', 'dem', 'von', 'und', 'del', 'della', 'dei',
                          'degli', 'van', 'het', 'aux', 'for', 'with', 'zum', 'zur', 'sur'])
      AND strict_word_similarity(w, lower(f_unaccent(b))) < 0.35)
$$;

CREATE OR REPLACE FUNCTION similar_name(label text, name text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT strict_word_similarity(f_unaccent(label), f_unaccent(name)) >= 0.6
     AND (name_words_in(label, name) OR name_words_in(name, label))
$$;
