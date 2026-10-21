-- 129 — How completely each work's provenance is documented (provenance_completeness, 078) stored, kept up to date per
-- change by the worker like the search fields (125). The view computes provenance_coverage() for every work it is
-- asked about — ≈ 1.7 ms a work, 6 s for all of them on ten times today's data: the admin's page "Provenance gaps
-- 1933–1945" took 8.5 s, the API's list filter ?provenance_gap= read it for every work. The view stays the
-- definition; provenance_completeness_stored is its copy, written by process_derived() for the batch's works (only
-- rows that changed; drift 'coverage' when the nightly full run changes one). A work's coverage depends on its
-- provenance and on its holders' lives (implied ends) — a holder's change reaches the works it held as neighbours.
CREATE TABLE provenance_completeness_stored AS SELECT * FROM provenance_completeness;
ALTER TABLE provenance_completeness_stored ADD PRIMARY KEY (artwork_id);
GRANT SELECT ON provenance_completeness_stored TO arthistory_api, arthistory_admin;
COMMENT ON TABLE provenance_completeness_stored IS 'provenance_completeness (078) stored, kept up to date by process_derived() (129)';

DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  anchor text := '  -- what the full run changed, the incremental path had missed';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'process_derived: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, $add$  -- how completely the batch's works' provenance is documented (078/129): only rows that changed
  ids := ARRAY(SELECT b.id FROM d_batch b WHERE b.type = 'artwork');
  IF cardinality(ids) > 0 THEN
    DROP TABLE IF EXISTS d_cov;
    CREATE TEMP TABLE d_cov ON COMMIT DROP AS SELECT * FROM provenance_completeness_stored WITH NO DATA;
    EXECUTE 'INSERT INTO d_cov SELECT * FROM provenance_completeness c WHERE c.artwork_id = ANY ($1)' USING ids;
    WITH del AS (
      DELETE FROM provenance_completeness_stored s WHERE s.artwork_id = ANY (ids)
        AND NOT EXISTS (SELECT 1 FROM d_cov c WHERE c.artwork_id = s.artwork_id)
      RETURNING s.artwork_id),
    up AS (
      INSERT INTO provenance_completeness_stored AS s SELECT * FROM d_cov
      ON CONFLICT (artwork_id) DO UPDATE SET has_provenance = EXCLUDED.has_provenance, life_days = EXCLUDED.life_days,
        documented_days = EXCLUDED.documented_days, presumed_days = EXCLUDED.presumed_days, gap_days = EXCLUDED.gap_days,
        gap_1933_1945_days = EXCLUDED.gap_1933_1945_days, documented_percent = EXCLUDED.documented_percent
      WHERE (s.has_provenance, s.life_days, s.documented_days, s.presumed_days, s.gap_days, s.gap_1933_1945_days, s.documented_percent)
            IS DISTINCT FROM (EXCLUDED.has_provenance, EXCLUDED.life_days, EXCLUDED.documented_days, EXCLUDED.presumed_days,
                              EXCLUDED.gap_days, EXCLUDED.gap_1933_1945_days, EXCLUDED.documented_percent)
      RETURNING s.artwork_id)
    INSERT INTO d_touched SELECT 'artwork', x.artwork_id, 'coverage' FROM (SELECT * FROM del UNION SELECT * FROM up) x;
  END IF;

$add$ || anchor);
END $$;
