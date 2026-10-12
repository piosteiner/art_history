-- 058: the data-quality findings computed once after changes, not on every page view.
--
-- The checks (a view of ~35 UNION ALL branches, migration 013 and later) took ~1 s for the whole database and ~0.3 s
-- for one entry: a filter on the entry can't be pushed into every branch. Now:
--   quality_issues_live  the checks themselves — the view as it was (renamed). Later migrations that change a check
--                        replace THIS view (CREATE OR REPLACE VIEW quality_issues_live …).
--   quality_issues       a table with the last result, read in milliseconds; refresh_quality() brings it up to date.
--
-- Why not a MATERIALIZED VIEW (the obvious tool)? Since PostgreSQL 17, CREATE/REFRESH MATERIALIZED VIEW run with a
-- restricted search_path (pg_catalog, pg_temp — so a function can't be tricked into using someone's look-alike table).
-- Several of our functions the checks call (dup_score, place_country …) name tables without "public." and fail there.
-- A SECURITY DEFINER function with its own search_path doesn't have that problem, and writing only the rows that
-- changed is what REFRESH … CONCURRENTLY does internally too. Readers never wait: until the refresh commits they see
-- the old rows (MVCC).
--
-- When to refresh: a deferred constraint trigger on every table the checks read fires at COMMIT and
--   · takes a number from the sequence quality_changes — sequences are not transactional and take no lock, so many
--     writers never wait for each other (a counter row would make them queue);
--   · sends NOTIFY quality_changed — delivered only after the commit; the server LISTENs and refreshes shortly after.
-- refresh_quality() remembers the sequence's value it has seen; quality_fresh() compares — a page that must be exact
-- (the Quality page) waits for a refresh when they differ.

ALTER VIEW quality_issues RENAME TO quality_issues_live;

CREATE TABLE quality_issues (
  check_id text NOT NULL,
  severity text NOT NULL,
  entity_type entity_type NOT NULL,
  entity_id bigint NOT NULL,
  issue_key text NOT NULL,
  detail text,
  PRIMARY KEY (check_id, issue_key)
);
CREATE INDEX quality_issues_entity ON quality_issues (entity_type, entity_id);
INSERT INTO quality_issues SELECT * FROM quality_issues_live;

CREATE SEQUENCE quality_changes;
CREATE TABLE quality_refresh (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),  -- exactly one row
  changes_seen bigint NOT NULL,
  refreshed_at timestamptz NOT NULL
);
-- (a new sequence hands out its first number without raising last_value — so one is drawn now: from here on every
-- change raises it)
SELECT nextval('quality_changes');
INSERT INTO quality_refresh (changes_seen, refreshed_at) SELECT last_value, now() FROM quality_changes;

CREATE FUNCTION quality_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nextval('quality_changes');
  PERFORM pg_notify('quality_changed', '');  -- the same notice twice in one transaction is sent once
  RETURN NULL;
END $$;

-- Every table the checks may read (some only through functions — dup_score, entity_country …), except bookkeeping
-- that changes all the time and is never checked: sessions, drafts, working copies, the audit log itself.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    AND c.relname NOT IN ('admin_sessions', 'admin_drafts', 'admin_users', 'live_docs', 'audit_log', 'schema_migrations',
                          'quality_refresh', 'quality_issues', 'spatial_ref_sys', 'wikidata_reviews')
  LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER quality_changed AFTER INSERT OR UPDATE OR DELETE ON %I
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quality_changed()', t);
  END LOOP;
END $$;

-- The admin role reads the result and may ask for a refresh — which writes as the owner: SECURITY DEFINER runs it
-- with the owner's rights (search_path fixed, as every such function must).
CREATE FUNCTION refresh_quality() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE seen bigint;
BEGIN
  -- one at a time: a second caller waits, then finds little to do
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  CREATE TEMP TABLE fresh ON COMMIT DROP AS SELECT * FROM quality_issues_live;
  DELETE FROM quality_issues q WHERE NOT EXISTS (SELECT 1 FROM fresh f WHERE (f.check_id, f.issue_key) = (q.check_id, q.issue_key));
  INSERT INTO quality_issues AS q SELECT * FROM fresh
  ON CONFLICT (check_id, issue_key) DO UPDATE SET severity = EXCLUDED.severity, entity_type = EXCLUDED.entity_type,
    entity_id = EXCLUDED.entity_id, detail = EXCLUDED.detail
  -- an unchanged finding isn't written again (no new row version, nothing for VACUUM)
  WHERE (q.severity, q.entity_type, q.entity_id, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.entity_type, EXCLUDED.entity_id, EXCLUDED.detail);
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp();
END $$;

CREATE FUNCTION quality_fresh() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.changes_seen >= s.last_value FROM quality_refresh r, quality_changes s
$$;

REVOKE ALL ON FUNCTION refresh_quality(), quality_fresh() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_quality(), quality_fresh() TO arthistory_admin;
-- (the default privileges gave the admin role INSERT/UPDATE/DELETE too: only refresh_quality() writes here)
REVOKE INSERT, UPDATE, DELETE ON quality_issues, quality_refresh FROM arthistory_admin;
GRANT SELECT ON quality_issues, quality_refresh TO arthistory_admin;
