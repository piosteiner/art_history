-- 246 — A merge keeps the redirects of entries that were moved into the removed one (owner 2026-11-10).
-- merge_entries() already handed the removed entry's slug_history (old slugs of the same type) to the kept entry, but not
-- its entry_moves: the addresses of entries that had been converted into the removed one (convert_entry(), 055) — a
-- person converted to an artist and then merged into the artist that was already there (Lambert of Saint-Omer,
-- Joachim of Fiore) left /people/<slug> pointing at a row that no longer exists. Now those redirects follow to the kept
-- entry, in the same statement where the slug history does.
-- The function is patched in place (pg_get_functiondef + replace), like the views in 244: the anchor line must exist
-- exactly once, else the migration stops rather than guess.
DO $$
DECLARE
  def text := pg_get_functiondef('public.merge_entries(entity_type, bigint, bigint)'::regprocedure);
  anchor text := '  UPDATE slug_history SET entity_id = keep_id WHERE entity_type = etype AND entity_id = dup_id;';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'merge_entries: anchor line not found exactly once';
  END IF;
  IF position('entry_moves' IN def) > 0 THEN
    RAISE EXCEPTION 'merge_entries already mentions entry_moves';
  END IF;
  EXECUTE replace(def, anchor, anchor || E'\n'
    || '  -- entries converted into the removed one (entry_moves, 055) now lead to the kept one (246)' || E'\n'
    || '  UPDATE entry_moves SET new_id = keep_id WHERE new_type = etype AND new_id = dup_id;');
END $$;
