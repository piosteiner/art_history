-- 151 — Merging two institutions failed every time: merge_entries() (044) moves every foreign key pointing at the
-- table, and since 094 editor_scopes (accounts limited to collections) is one of them — a table the admin role may
-- read but not change (set only by the owner, npm run admin:scope). The UPDATE is refused even when it would change no
-- row. Now editor_scopes is skipped; if an account is limited to the duplicate, the merge stops and says so (the owner
-- moves that scope first), instead of silently leaving the account with a collection that no longer exists.
DO $$
DECLARE
  def text := pg_get_functiondef('merge_entries'::regproc);
  old text := $q$    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.child, r.col, r.col) USING keep_id, dup_id;$q$;
BEGIN
  IF position(old IN def) = 0 THEN RAISE EXCEPTION 'merge_entries: the foreign-key UPDATE line was not found'; END IF;
  EXECUTE replace(def, old, $q$    IF r.child = 'editor_scopes' THEN
      IF EXISTS (SELECT 1 FROM editor_scopes WHERE institution_id = dup_id) THEN
        RAISE EXCEPTION 'An account is limited to this collection — move its scope to the kept entry first (npm run admin:scope).';
      END IF;
      CONTINUE;
    END IF;
$q$ || old);
END $$;
