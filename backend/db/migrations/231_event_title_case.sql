-- 231 — Event names are written like English titles (owner 2026-11-05: "treat event names like titles in the english
-- language" — "surrender of Japan" came from Wikidata's lowercase style). A new check, event_name_not_title_case
-- (warning), lists an English event's name (or other English name) with a word that should be capitalised.
--
-- title_case_slip(name) is the one definition → the first word that breaks the rule, or NULL. The rule (Chicago style):
--   the first word always capitalised; every other word too, except articles, coordinating conjunctions and
--   prepositions (a, the, and, of, to, against, between …). Not looked at: words that don't start with a Latin small
--   letter (1170, Tōdai-ji, 이), what follows a hyphen inside a word (Kinkaku-ji, Dan-no-ura, Fujiwara-kyō — Japanese
--   suffixes stay small; "Eye-Opening" is written by hand), and particles of names in other languages (Minamoto no
--   Yoritomo, Dos de Mayo, van, von …). A name that is right as it is: Mark as OK.
-- Only English names are checked: name_lang empty or en…; a German event (Gemäldebrand im Flakbunker …) is not.

CREATE OR REPLACE FUNCTION title_case_slip(name text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT w.word
    FROM regexp_split_to_table(btrim(name), '\s+') WITH ORDINALITY w(word, n)
   WHERE regexp_replace(w.word, '^[("“‘''\[]+', '') ~ '^[a-z]'            -- starts with a small Latin letter (after an opening bracket or quote)
     AND (w.n = 1 OR lower(regexp_replace(w.word, '[^[:alpha:]’''-].*$', '')) <> ALL (ARRAY[
           -- articles, coordinating conjunctions
           'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as',
           -- prepositions (lowercase whatever their length)
           'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'from', 'into', 'onto', 'over', 'with', 'upon', 'than',
           'against', 'between', 'during', 'after', 'before', 'under', 'without', 'through', 'about', 'among', 'around',
           'toward', 'towards', 'across', 'behind', 'beyond', 'near', 'since', 'until', 'within', 'versus', 'vs',
           -- particles of names in other languages
           'no', 'de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'du', 'des', 'la', 'le', 'les', 'van', 'von', 'der',
           'den', 'ten', 'ter', 'zu', 'y', 'e', 'el', 'al', 'bin', 'ibn', 'ap', 'af', 'av']))
   ORDER BY w.n LIMIT 1
$$;
COMMENT ON FUNCTION title_case_slip IS 'The first word of an English title that should be capitalised, or NULL (231; Chicago style).';

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('event_name_not_title_case' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'event_name_not_title_case'::text AS check_id,
    'warning'::text AS severity,
    'event'::entity_type AS entity_type,
    e.id AS entity_id,
    'title_case:'::text || n.name AS issue_key,
    format('%s “%s”: “%s” should be capitalised — event names are written like English titles'::text, n.what, n.name, title_case_slip(n.name)) AS detail
   FROM events e
     CROSS JOIN LATERAL ( SELECT 'name'::text AS what, e.name WHERE e.name_lang IS NULL OR e.name_lang LIKE 'en%'
        UNION ALL SELECT 'other name'::text, x.n->>'text' FROM jsonb_array_elements(coalesce(e.names, '[]'::jsonb)) x(n)
          WHERE coalesce(x.n->>'lang', 'en') LIKE 'en%' AND (e.name_lang IS NULL OR e.name_lang LIKE 'en%' OR x.n->>'lang' LIKE 'en%')) n
  WHERE title_case_slip(n.name) IS NOT NULL$b$;
END $$;
