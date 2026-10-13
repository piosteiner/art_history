-- 062: the stored data-quality findings (058) are keyed by check, key AND entry.
--
-- A possible duplicate is one finding shown on both entries: two rows with the same issue_key ("dup:6:26"), one per
-- entry. 058's primary key (check_id, issue_key) refused the second — refresh_quality() failed whenever two entries
-- looked like duplicates, and pages waited in vain for an up-to-date result. Acknowledgements stay per (check_id,
-- issue_key): "not the same" is said once for the pair.
-- The refresh also takes each finding once (DISTINCT ON), so no check can block it with a repeated row again.

ALTER TABLE quality_issues DROP CONSTRAINT quality_issues_pkey,
  ADD PRIMARY KEY (check_id, issue_key, entity_type, entity_id);

CREATE OR REPLACE FUNCTION refresh_quality() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE seen bigint;
BEGIN
  -- one at a time: a second caller waits, then finds little to do
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  CREATE TEMP TABLE fresh ON COMMIT DROP AS
    SELECT DISTINCT ON (check_id, issue_key, entity_type, entity_id) * FROM quality_issues_live;
  DELETE FROM quality_issues q WHERE NOT EXISTS (SELECT 1 FROM fresh f
    WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id));
  INSERT INTO quality_issues AS q SELECT * FROM fresh
  ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
  -- an unchanged finding isn't written again (no new row version, nothing for VACUUM)
  WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail);
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp();
END $$;
