-- 207 — The quiz's stored basis (202) refreshed at most every 5 minutes, like search_words (199): it was ~0.4 s of
-- every global part (the perf data, 10× today; budget 3 s). A quiz may be up to 5 minutes behind a change — at the
-- latest the next global part after that, or the nightly full run's. After entry_regions, which quiz_pictured carries.
ALTER TABLE quality_refresh ADD COLUMN IF NOT EXISTS quiz_at timestamptz;
DO $$
DECLARE
  def text := pg_get_functiondef('refresh_quality_global'::regproc);
  old text := 'REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_works;
  REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_artists;
  REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_pictured;';
  new text := $n$IF (SELECT quiz_at IS NULL OR quiz_at < clock_timestamp() - interval '5 minutes' FROM quality_refresh) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_works;
    REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_movement_artists;
    REFRESH MATERIALIZED VIEW CONCURRENTLY quiz_pictured;
    UPDATE quality_refresh SET quiz_at = clock_timestamp();
  END IF;$n$;
BEGIN
  IF position('quiz_at' IN def) > 0 THEN RETURN; END IF;
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'refresh_quality_global: the quiz refreshes not found once';
  END IF;
  EXECUTE replace(def, old, new);
END $$;
