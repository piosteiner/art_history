-- 147 — When an artist was active, where the dates of life are unknown (owner, 2026-10-28): an ancient sculptor known
-- from a signature (Cleomenes son of Apollodorus, first half of the 1st century BCE), a master named after a work.
-- As people have it (024): a period, open-ended allowed, with its label as written; birth and death stay empty rather
-- than guessed. The time filter and the timeline use the lifespan, else the active period (src/routes/entities.js).
ALTER TABLE artists ADD COLUMN active daterange, ADD COLUMN active_label text;
COMMENT ON COLUMN artists.active IS 'When the artist was active (147) — for artists whose dates of life are unknown; as people.active.';
-- the stored list rows carry it (127)
INSERT INTO list_queue (type, id) SELECT 'artist', id FROM artists;

-- the check artist_missing_dates (058) is quiet when the active period stands in for them
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  old_where text := $o$   FROM artists a
  WHERE ((a.birth IS NULL) OR (a.death IS NULL))$o$;
  new_where text := $n$   FROM artists a
  WHERE (((a.birth IS NULL) OR (a.death IS NULL)) AND (a.active IS NULL))$n$;
BEGIN
  IF (length(def) - length(replace(def, old_where, ''))) / length(old_where) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: the artist_missing_dates condition not found exactly once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old_where, new_where);
END $$;
