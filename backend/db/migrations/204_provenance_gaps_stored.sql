-- 204 — The gaps of 1933–1945 stored (perf, 2026-11-03). The CMS page /quality/provenance-gaps computed each listed
-- work's coverage (provenance_coverage(), 078) on every view: 2,220 works on the perf data (10× today), 4.2 s (budget 4 s).
-- Now each work's gaps in 1933–1945 are kept beside its completeness (provenance_completeness_stored, 129), by the same
-- step of the worker (process_derived), for the works with such a gap.
CREATE TABLE provenance_gaps_stored (
  artwork_id bigint PRIMARY KEY REFERENCES artworks (id) ON DELETE CASCADE,
  gaps       jsonb NOT NULL
);
COMMENT ON TABLE provenance_gaps_stored IS 'The gaps in 1933–1945 of the works that have one (204), kept with provenance_completeness_stored.';
GRANT SELECT ON provenance_gaps_stored TO arthistory_admin, arthistory_api;

-- one work's gaps then, as the page shows them
CREATE FUNCTION provenance_gaps_1933_1945(wid bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_agg(jsonb_build_object('from', extract(year FROM lower(g.period)), 'to', extract(year FROM upper(g.period) - 1),
           'before', g.before_name, 'after', g.after_name, 'candidates', coalesce(g.candidates, '{}')) ORDER BY g.period)
  FROM provenance_coverage(wid) g WHERE g.kind = 'gap' AND g.in_1933_1945
$$;

INSERT INTO provenance_gaps_stored
  SELECT c.artwork_id, provenance_gaps_1933_1945(c.artwork_id) FROM provenance_completeness_stored c
  WHERE c.has_provenance AND c.gap_1933_1945_days > 0 AND provenance_gaps_1933_1945(c.artwork_id) IS NOT NULL;

-- the worker: with the batch's completeness, its gaps
DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  old text := $o$INSERT INTO d_touched SELECT 'artwork', x.artwork_id, 'coverage' FROM (SELECT * FROM del UNION SELECT * FROM up) x;$o$;
  new text := $n$INSERT INTO d_touched SELECT 'artwork', x.artwork_id, 'coverage' FROM (SELECT * FROM del UNION SELECT * FROM up) x;
    -- their gaps in 1933–1945 (204)
    DELETE FROM provenance_gaps_stored s WHERE s.artwork_id = ANY (ids);
    INSERT INTO provenance_gaps_stored (artwork_id, gaps)
      SELECT c.artwork_id, g.gaps FROM d_cov c CROSS JOIN LATERAL (SELECT provenance_gaps_1933_1945(c.artwork_id) AS gaps) g
      WHERE c.has_provenance AND c.gap_1933_1945_days > 0 AND g.gaps IS NOT NULL;$n$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'process_derived: the coverage step not found once';
  END IF;
  EXECUTE replace(def, old, new);
END $$;
