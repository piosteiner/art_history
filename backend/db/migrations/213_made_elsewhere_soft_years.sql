-- 213 — A year-only boundary is no proof of presence (owner 2026-11-04). The check created_where_artist_was_not
-- flagged Kuroda's Maiko, made in Gion in 1893, because his stay in Paris runs "1884–1893": a year-only date means
-- the whole year, so the stay covered the creation span — but he could have left Paris and painted in Kyoto within
-- that year (he landed in Japan on 30 July 1893). Now a stay's first and last calendar year count only when its
-- boundary is more precise than a year: the union of the stays elsewhere, shrunk by a year at each boundary that is
-- a 1 January, must still cover the creation span. A stay with exact dates is taken as it is.
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  old text := $o$(range_agg(e.period) @> w.created)$o$;
  new text := $n$((range_agg(e.period) * datemultirange(daterange(
      CASE WHEN lower(range_agg(e.period)) = date_trunc('year', lower(range_agg(e.period)))::date THEN (lower(range_agg(e.period)) + interval '1 year')::date ELSE lower(range_agg(e.period)) END,
      CASE WHEN upper(range_agg(e.period)) = date_trunc('year', upper(range_agg(e.period)))::date THEN (upper(range_agg(e.period)) - interval '1 year')::date ELSE upper(range_agg(e.period)) END))) @> w.created)$n$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: the made-elsewhere covering test not found once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old, new);
END $$;
