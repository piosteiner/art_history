-- 251 — Gaps in 1933–1945 are a research question, not a data error (owner 2026-11-13: "i feel like its not really a
-- quality issue and more of a filter criterium"). The check provenance_gap_1933_1945 (084) put 602 warnings on the
-- Quality page — a change of owner undated or not documented as direct, which may have happened in the Nazi years.
-- That describes how far the research has come, not something wrong in the data. It leaves the Quality page; the
-- question lives on in
--   * the CMS research list /quality/provenance-gaps — works with a silence in 1933–1945 or such a change of owner,
--     by default those without a 1933–1945 status yet (setting the status = "looked at", it leaves the list);
--   * the site's list filter "Works with open questions 1933–1945" (?provenance_gap=1933-1945) and the page
--     /provenance/1933-1945.
-- The view provenance_gaps itself stays (the research list and the tests read it).
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  s int := position($s$ SELECT 'provenance_gap_1933_1945'::text AS check_id,$s$ IN def);
  e int;
BEGIN
  IF s = 0 THEN RETURN; END IF;  -- already gone
  -- the block ends at the next UNION ALL after it
  e := s + position('UNION ALL' IN substr(def, s)) - 1;
  IF e < s THEN RAISE EXCEPTION 'quality_issues_live: end of the provenance_gap_1933_1945 block not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || substr(def, 1, s - 1) || substr(def, e + length('UNION ALL'));
END $$;

-- the stored findings (058) of the check go now, not at the next full refresh
DELETE FROM quality_issues WHERE check_id = 'provenance_gap_1933_1945';
DELETE FROM quality_acks WHERE check_id = 'provenance_gap_1933_1945';
