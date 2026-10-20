-- 113 — Search: "did you mean …?" and the reach of a provenance number (owner, 2026-10-20).
--
-- 1. search_words (MATERIALIZED VIEW): every word of every entry's names (3 letters or more), folded and lower case,
--    how often it occurs, the form it is usually written in (mode() WITHIN GROUP — an ordered-set aggregate: the
--    most frequent value; it skips NULLs, the folded-only forms) and its Double Metaphone key (092). GIN trigram index on the word, b-tree on the key.
--    Refreshed by refresh_quality() after changes.
--    search_suggest(q): for each word of the query that is no word of ours, the nearest that is — few edits
--    (Levenshtein ≤ a third of its length, at least 1), found through shared trigrams (%) or the same sound key —
--    the fewest edits first, then the same sound, then the most frequent: hokusia → Hokusai, gaugin → Gauguin.
-- 2. provenance_number_kinds.scope: how far a number reaches. 'global': one series for every holder (ERR, Munich,
--    Linz, Aussee, "Entartete Kunst", Lugt marks) — two works with the same number are related. 'holder': numbers of
--    the holder's own series (inventory, stock book, lot, catalogue) — "244" of one inventory has nothing to do with
--    "244" of another. The site links a number only when another work shares it within its reach.
CREATE MATERIALIZED VIEW search_words AS
  -- the names as dup_facts has them: the name as written, and all names folded (other names, translations, readings).
  -- (Not entity_index: it inlines older functions that fail under a refresh's search_path — 093.)
  WITH words AS (
    SELECT x AS written, lower(f_unaccent(x)) AS word
    FROM dup_facts f, regexp_split_to_table(f.name, '[^[:alpha:]]+') x WHERE length(x) >= 3
    UNION ALL
    SELECT NULL, x FROM dup_facts f, unnest(f.names) n, regexp_split_to_table(n, '[^[:alpha:]]+') x WHERE length(x) >= 3)
  SELECT word, coalesce(mode() WITHIN GROUP (ORDER BY written), word) AS display, count(*)::integer AS n, dmetaphone(word) AS sound
  FROM words GROUP BY word;
CREATE UNIQUE INDEX search_words_word ON search_words (word);
CREATE INDEX search_words_trgm ON search_words USING gin (word gin_trgm_ops);
CREATE INDEX search_words_sound ON search_words (sound);
COMMENT ON MATERIALIZED VIEW search_words IS 'the words of the entries'' names for "did you mean" (113), refreshed by refresh_quality()';
GRANT SELECT ON search_words TO arthistory_api, arthistory_admin;

-- SQL-standard body: bound at creation (no search_path surprises, 093)
CREATE FUNCTION search_suggest(q text) RETURNS TABLE (word text, suggestion text, edits integer)
LANGUAGE sql STABLE
BEGIN ATOMIC
  SELECT x.w, best.display, best.d
  FROM (SELECT DISTINCT lower(f_unaccent(t)) AS w FROM regexp_split_to_table(q, '[^[:alpha:]]+') t WHERE length(t) >= 3) x
  CROSS JOIN LATERAL (
    SELECT s.display, levenshtein(s.word, x.w) AS d
    FROM search_words s
    WHERE (s.word % x.w OR s.sound = dmetaphone(x.w)) AND s.word <> x.w
      AND levenshtein_less_equal(s.word, x.w, greatest(1, length(x.w) / 3)) <= greatest(1, length(x.w) / 3)
    ORDER BY levenshtein(s.word, x.w), (s.sound = dmetaphone(x.w)) DESC, s.n DESC, s.word
    LIMIT 1) best
  WHERE NOT EXISTS (SELECT 1 FROM search_words k WHERE k.word = x.w);
END;
COMMENT ON FUNCTION search_suggest IS 'per unknown word of a query, the nearest word of the entries'' names (113)';
GRANT EXECUTE ON FUNCTION search_suggest(text) TO arthistory_api;

ALTER TABLE provenance_number_kinds ADD COLUMN scope text NOT NULL DEFAULT 'holder' CHECK (scope IN ('global', 'holder'));
COMMENT ON COLUMN provenance_number_kinds.scope IS 'global: one series for all holders (ERR, Munich …); holder: the holder''s own series (inventory, lot …) — 113';
UPDATE provenance_number_kinds SET scope = 'global' WHERE code IN ('ek', 'err', 'munich', 'linz', 'aussee', 'lugt');

-- The other works' steps that record the same number within its reach: any holder's for a global series, else only
-- steps of the same holder (a step without any holder has no series to share).
CREATE FUNCTION provenance_number_peers(nid bigint) RETURNS TABLE (provenance_id bigint, artwork_id bigint)
LANGUAGE sql STABLE
BEGIN ATOMIC
  SELECT o.provenance_id, op.artwork_id
  FROM provenance_numbers n
  JOIN provenance p ON p.id = n.provenance_id
  JOIN provenance_number_kinds k ON k.code = n.kind
  JOIN provenance_numbers o ON o.kind = n.kind AND lower(btrim(o.number)) = lower(btrim(n.number)) AND o.id <> n.id
  JOIN provenance op ON op.id = o.provenance_id AND op.artwork_id <> p.artwork_id
  WHERE n.id = nid
    AND (k.scope = 'global'
         OR (num_nonnulls(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id, p.owner_label) > 0
             AND (op.owner_artist_id, op.owner_person_id, op.owner_institution_id, op.owner_place_id, op.owner_label)
                 IS NOT DISTINCT FROM (p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id, p.owner_label)));
END;

-- A record's number (104) — an entry of one inventory, catalogue or exhibition — shared by another work only in the
-- same record: the same kind, document, place and date ("1701 · inventory · Buen Retiro · no. 244").
CREATE FUNCTION provenance_record_peers(rid bigint) RETURNS TABLE (record_id bigint, artwork_id bigint)
LANGUAGE sql STABLE
BEGIN ATOMIC
  SELECT o.id, op.artwork_id
  FROM provenance_records r
  JOIN provenance p ON p.id = r.provenance_id
  JOIN provenance_records o ON o.id <> r.id AND o.kind = r.kind AND lower(btrim(o.number)) = lower(btrim(r.number))
       AND o.document IS NOT DISTINCT FROM r.document AND o.place_id IS NOT DISTINCT FROM r.place_id AND o.date IS NOT DISTINCT FROM r.date
  JOIN provenance op ON op.id = o.provenance_id AND op.artwork_id <> p.artwork_id
  WHERE r.id = rid AND r.number IS NOT NULL;
END;
GRANT EXECUTE ON FUNCTION provenance_number_peers(bigint), provenance_record_peers(bigint) TO arthistory_api;

CREATE OR REPLACE FUNCTION refresh_quality()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE seen bigint;
BEGIN
  -- one at a time: a second caller waits, then finds little to do
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  -- the names for the duplicate check (093), before the checks read them
  REFRESH MATERIALIZED VIEW dup_name_keys;
  -- the words for "did you mean …?" (113)
  REFRESH MATERIALIZED VIEW search_words;
  -- the search fields (110/111): only what changed is written
  CREATE TEMP TABLE fresh_fields ON COMMIT DROP AS SELECT * FROM entry_search_fields;
  DELETE FROM entry_search_fields_stored s WHERE NOT EXISTS (SELECT 1 FROM fresh_fields f
    WHERE (f.type, f.id, f.position) = (s.type, s.id, s.position));
  INSERT INTO entry_search_fields_stored AS s SELECT * FROM fresh_fields
  ON CONFLICT (type, id, position) DO UPDATE SET label = EXCLUDED.label, text = EXCLUDED.text, match = EXCLUDED.match,
    tier_rank = EXCLUDED.tier_rank, tier_heading = EXCLUDED.tier_heading, shown = EXCLUDED.shown
  WHERE (s.label, s.text, s.match, s.tier_rank, s.tier_heading, s.shown)
        IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.text, EXCLUDED.match, EXCLUDED.tier_rank, EXCLUDED.tier_heading, EXCLUDED.shown);
  CREATE TEMP TABLE fresh ON COMMIT DROP AS
    SELECT DISTINCT ON (check_id, issue_key, entity_type, entity_id) * FROM quality_issues_live;
  DELETE FROM quality_issues q WHERE NOT EXISTS (SELECT 1 FROM fresh f
    WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id));
  INSERT INTO quality_issues AS q SELECT * FROM fresh
  ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
  -- an unchanged finding isn't written again (no new row version, nothing for VACUUM)
  WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail);
  -- the stored graph (088) goes with it
  DELETE FROM graph_links;
  INSERT INTO graph_links
    SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period, e.period_label,
           e.label, e.certainty, e.source, e.provenance_id, e.id
    FROM edges e
    WHERE (e.subject_type, e.subject_id) IS DISTINCT FROM (e.object_type, e.object_id) AND e.subject_id IS NOT NULL AND e.object_id IS NOT NULL;
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp();
END $function$;

SELECT refresh_quality();
