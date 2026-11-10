-- 244 — Living artists (owner 2026-11-10: "if an artist is still alive like Vyacheslav Akhunov i still get a quality
-- notice"). artist_missing_dates said "no death date" for everyone without one — 21 of the 28 such artists were born
-- within the last 100 years and are most likely alive. Now:
--   no birth date                                         → warning, as before
--   born more than 100 years ago, no death date           → warning, as before (the death date is really missing)
--   born within the last 100 years, no death date:
--     with a Wikidata item                                → nothing: taken as living; when Wikidata records a death,
--                                                           the Wikidata comparison shows the new date
--     without                                             → info "may be living — please check"
-- The 100 years are counted from today (current_date), so the line moves with time. Artists with an `active` period
-- (dates of life unknown) stay out, as before.
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  s int := position($s$ SELECT 'artist_missing_dates'::text AS check_id,$s$ IN def);
  e int := position($e$ SELECT 'auto_created'::text AS check_id,$e$ IN def);
  new text := $n$ SELECT 'artist_missing_dates'::text AS check_id,
        CASE
            WHEN ((a.birth IS NULL) OR (lower(a.birth) < (CURRENT_DATE - '100 years'::interval))) THEN 'warning'::text
            ELSE 'info'::text
        END AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('artist:'::text || a.id) AS issue_key,
    concat_ws(' and '::text,
        CASE
            WHEN (a.birth IS NULL) THEN 'no birth date'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.death IS NULL) AND (a.birth IS NOT NULL) AND (lower(a.birth) >= (CURRENT_DATE - '100 years'::interval))) THEN 'no death date — born within the last 100 years: may be living, please check'::text
            WHEN (a.death IS NULL) THEN 'no death date'::text
            ELSE NULL::text
        END) AS detail
   FROM artists a
  WHERE ((a.active IS NULL) AND ((a.birth IS NULL) OR ((a.death IS NULL) AND NOT ((lower(a.birth) >= (CURRENT_DATE - '100 years'::interval)) AND (a.wikidata_id IS NOT NULL)))))
UNION ALL
$n$;
BEGIN
  IF s = 0 OR e = 0 OR e < s THEN RAISE EXCEPTION 'quality_issues_live: the artist_missing_dates block not found'; END IF;
  IF position('may be living' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || substr(def, 1, s - 1) || new || substr(def, e);
END $$;
