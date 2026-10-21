-- 127 — The lists' rows stored (step 3 of the scaling plan). The site loads whole lists (pickers, list pages, the header
-- search filter them in the browser, at once and with facets). Each row was computed per request: an artwork's
-- country, holders now and before, provenance coverage, creators and search fields — ≈ 4 ms a row, the list of 3,500
-- artworks on the copy at 10× 15 s (over the API's statement timeout when several lists load at once). Now
-- entry_list_rows keeps each entry's row (jsonb, exactly what the list endpoint served), and the list endpoint reads it.
-- The rows are written by the server's worker (src/admin/quality.js), not in SQL: the list's columns are defined in
-- src/routes/entities.js (listRows) — one definition. process_derived() hands every entry of a batch to list_queue;
-- the worker computes those rows after the batch and writes only those that changed (a change the nightly full run
-- makes is drift 'list row'). An entry not stored yet (created a moment ago) is computed by the endpoint itself.
CREATE TABLE entry_list_rows (
  type entity_type NOT NULL, id bigint NOT NULL,
  row  jsonb NOT NULL,
  PRIMARY KEY (type, id)
);
COMMENT ON TABLE entry_list_rows IS 'each entry''s row in the API''s lists, written by the worker (src/admin/quality.js, 127)';
CREATE TABLE list_queue (
  seq  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type entity_type NOT NULL, id bigint NOT NULL,
  full_run boolean NOT NULL DEFAULT false    -- queued only by the nightly full run (a change found = drift)
);
GRANT SELECT ON entry_list_rows TO arthistory_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON entry_list_rows, list_queue TO arthistory_admin;
GRANT INSERT ON derived_drift TO arthistory_admin;

-- every entry of a batch: its row is computed again after the batch (patched in before the batch leaves the queue)
DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  anchor text := '  DELETE FROM derived_queue q USING';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'process_derived: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, '  INSERT INTO list_queue (type, id, full_run) SELECT b.type, b.id, b.full FROM d_batch b;
  PERFORM pg_notify(''quality_changed'', '''');   -- the worker computes the rows (also after refresh_quality() called elsewhere)
' || anchor);
END $$;

-- up to date = the list rows too
CREATE OR REPLACE FUNCTION quality_fresh() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM derived_queue) AND NOT EXISTS (SELECT 1 FROM list_queue)
     AND r.changes_seen >= s.last_value FROM quality_refresh r, quality_changes s
$$;
CREATE OR REPLACE FUNCTION quality_status(OUT waiting integer, OUT oldest timestamptz, OUT global_current boolean,
                               OUT refreshed_at timestamptz, OUT full_at timestamptz, OUT drift_week integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(*)::int FROM (SELECT q.type, q.id FROM derived_queue q UNION SELECT l.type, l.id FROM list_queue l) x),
         (SELECT min(q.queued_at) FROM derived_queue q), r.changes_seen >= s.last_value, r.refreshed_at, r.full_at,
         (SELECT count(*)::int FROM derived_drift d WHERE d.found_at > now() - interval '7 days')
  FROM quality_refresh r, quality_changes s
$$;

-- filled once: every entry queued (the worker fills the table within a minute or so; meanwhile the endpoint computes)
INSERT INTO list_queue (type, id) SELECT type, id FROM entity_index;
NOTIFY quality_changed;

-- a museum's row names the artists of the works it holds and held (artists_held, 107): an artist's change reaches
-- those museums too (two steps away: artist → work → museum)
DO $$
DECLARE
  def text := pg_get_functiondef('derived_neighbours(entity_type, bigint)'::regprocedure);
  anchor text := '  UNION SELECT ''artwork'', w.id FROM artworks w WHERE t = ''artist'' AND w.creator_id = i';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'derived_neighbours: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, anchor || '
  UNION SELECT ''institution'', h.institution_id FROM artwork_artists aa JOIN artwork_holders h ON h.artwork_id = aa.artwork_id
    WHERE t = ''artist'' AND aa.artist_id = i');
END $$;
