-- 128 — The worker can't get stuck on one entry. process_derived() (125) works through the queue a batch at a time; if
-- one entry makes its batch fail (a bug in a check, a value no function expected, a check over the timeout for just
-- that entry), every retry took the same batch first and failed again — nothing behind it was computed any more.
-- Now the worker (src/admin/quality.js) takes a failed batch's entries one at a time; one that fails alone is set
-- aside: derived_quarantine() takes it out of the queue and records it in derived_failures with the error, shown on
-- the dashboard and the Quality page. It is tried again with the nightly full run, or with its next change; a
-- success clears the record. (Errors that aren't an entry's — the database unreachable, several entries failing in
-- a row — set nothing aside: the worker tries again a minute later.)
CREATE TABLE derived_failures (
  type      entity_type NOT NULL,
  id        bigint NOT NULL,
  what      text NOT NULL CHECK (what IN ('derived', 'list row')),
  error     text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (type, id, what)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON derived_failures TO arthistory_admin;
COMMENT ON TABLE derived_failures IS 'entries the worker set aside because computing them failed (128)';

-- the oldest entry in the queue (what process_derived(1) would take) set aside with the error → 'type/id'
CREATE FUNCTION derived_quarantine(p_error text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH oldest AS (SELECT q.type, q.id FROM derived_queue q GROUP BY q.type, q.id ORDER BY min(q.seq) LIMIT 1),
  gone AS (DELETE FROM derived_queue q USING oldest o WHERE q.type = o.type AND q.id = o.id RETURNING q.type, q.id),
  kept AS (INSERT INTO derived_failures (type, id, what, error)
             SELECT DISTINCT g.type, g.id, 'derived', left(p_error, 2000) FROM gone g
           ON CONFLICT (type, id, what) DO UPDATE SET error = EXCLUDED.error, failed_at = EXCLUDED.failed_at
           RETURNING type, id)
  SELECT k.type || '/' || k.id FROM kept k
$$;
REVOKE ALL ON FUNCTION derived_quarantine(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derived_quarantine(text) TO arthistory_admin;

-- a batch that went through clears its entries' records (patched in before the batch leaves the queue)
DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  anchor text := '  DELETE FROM derived_queue q USING';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'process_derived: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, '  DELETE FROM derived_failures f USING d_batch b WHERE f.type = b.type AND f.id = b.id AND f.what = ''derived'';
' || anchor);
END $$;

-- for the pages: how many set aside
DROP FUNCTION quality_status();
CREATE FUNCTION quality_status(OUT waiting integer, OUT oldest timestamptz, OUT global_current boolean,
                               OUT refreshed_at timestamptz, OUT full_at timestamptz, OUT drift_week integer,
                               OUT failures integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*)::int FROM (SELECT q.type, q.id FROM derived_queue q UNION SELECT l.type, l.id FROM list_queue l) x),
         (SELECT min(t) FROM (SELECT min(q.queued_at) AS t FROM derived_queue q) x), r.changes_seen >= s.last_value, r.refreshed_at, r.full_at,
         (SELECT count(*)::int FROM derived_drift d WHERE d.found_at > now() - interval '7 days'),
         (SELECT count(*)::int FROM derived_failures)
  FROM quality_refresh r, quality_changes s
$$;
GRANT EXECUTE ON FUNCTION quality_status() TO arthistory_admin;
