-- 094 — Row-level security: editors limited to their collection (owner, 2026-10-17 — "relevant once other museums
-- or co-editors join"). Nothing changes for today's accounts: an account without a scope may change everything.
--   editor_scopes (user_id, institution_id): an account with rows here may create, change and delete only artworks
--     whose current institution is one of these — and those artworks' provenance, further numbers and images.
--     Everything else (people, places, institutions, the glossary …) stays shared, as do all reads.
--   The database enforces it, not the admin's code: ROW LEVEL SECURITY on the tables, with policies per command.
--     USING decides which existing rows a command may touch (others are invisible to it: an UPDATE changes 0 rows),
--     WITH CHECK which new rows it may write (others are an error). For UPDATE both: the work must be in the
--     collection before and after — so it can't be moved into one's own collection either.
--   Who is asking: the admin sets arthistory.user_id in every transaction (as for the audit log, 006).
--     editor_institutions() reads it: NULL = no limits (no scope, or no user: scripts, migrations). In the policies
--     it stands as (SELECT editor_institutions()): a sub-select without references to the row is computed once per
--     statement (an "InitPlan") instead of once per row. (In "x = ANY (…)" it needs ::bigint[]: ANY of a bare
--     sub-select means "any of its rows", not "any element of the array it returns".)
--   The table owner (migrations, refresh_quality(), imports as owner) isn't subject to the policies — unless FORCE
--     ROW LEVEL SECURITY, which we don't set. The API role only reads: its policy is "all rows".
-- Known limit: changes that triggers make in other entries (a renamed person's [[links]] rewritten in descriptions,
-- 042) run with the editor's rights too — an artwork of another collection keeps the old link text until its next
-- save (the link itself still works: it follows slug_history).
CREATE TABLE editor_scopes (
  user_id bigint NOT NULL REFERENCES admin_users ON DELETE CASCADE,
  institution_id bigint NOT NULL REFERENCES institutions ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, institution_id)
);
COMMENT ON TABLE editor_scopes IS 'accounts limited to collections (094): such an account changes only artworks of these institutions';
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON editor_scopes FROM arthistory_admin;   -- set by the owner (npm run admin:scope)

-- the institutions the current account may change artworks of; NULL = all (no scope set, or no account)
CREATE FUNCTION editor_institutions() RETURNS bigint[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN u IS NULL OR NOT EXISTS (SELECT 1 FROM editor_scopes WHERE user_id = u) THEN NULL
              ELSE ARRAY(SELECT institution_id FROM editor_scopes WHERE user_id = u ORDER BY institution_id) END
  FROM (SELECT nullif(current_setting('arthistory.user_id', true), '')::bigint AS u) s
$$;

-- for the admin's messages and buttons: may the current account change this artwork?
CREATE FUNCTION may_edit_artwork(aid bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT editor_institutions() IS NULL
      OR (SELECT current_institution_id FROM artworks WHERE id = aid) = ANY (editor_institutions())
$$;

ALTER TABLE artworks ENABLE ROW LEVEL SECURITY;
CREATE POLICY artworks_read ON artworks FOR SELECT USING (true);
CREATE POLICY artworks_insert ON artworks FOR INSERT
  WITH CHECK ((SELECT editor_institutions()) IS NULL OR current_institution_id = ANY ((SELECT editor_institutions())::bigint[]));
CREATE POLICY artworks_update ON artworks FOR UPDATE
  USING ((SELECT editor_institutions()) IS NULL OR current_institution_id = ANY ((SELECT editor_institutions())::bigint[]))
  WITH CHECK ((SELECT editor_institutions()) IS NULL OR current_institution_id = ANY ((SELECT editor_institutions())::bigint[]));
CREATE POLICY artworks_delete ON artworks FOR DELETE
  USING ((SELECT editor_institutions()) IS NULL OR current_institution_id = ANY ((SELECT editor_institutions())::bigint[]));

-- the parts of an artwork: allowed when its artwork is (one policy for every command: FOR ALL)
ALTER TABLE provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY provenance_read ON provenance FOR SELECT USING (true);
CREATE POLICY provenance_write ON provenance FOR ALL
  USING ((SELECT editor_institutions()) IS NULL OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]))
  WITH CHECK ((SELECT editor_institutions()) IS NULL OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]));

ALTER TABLE artwork_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY artwork_numbers_read ON artwork_numbers FOR SELECT USING (true);
CREATE POLICY artwork_numbers_write ON artwork_numbers FOR ALL
  USING ((SELECT editor_institutions()) IS NULL OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]))
  WITH CHECK ((SELECT editor_institutions()) IS NULL OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]));

-- images of artists, people, institutions … stay shared; an artwork's images follow the artwork
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
CREATE POLICY images_read ON images FOR SELECT USING (true);
CREATE POLICY images_write ON images FOR ALL
  USING ((SELECT editor_institutions()) IS NULL OR artwork_id IS NULL
         OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]))
  WITH CHECK ((SELECT editor_institutions()) IS NULL OR artwork_id IS NULL
         OR (SELECT w.current_institution_id FROM artworks w WHERE w.id = artwork_id) = ANY ((SELECT editor_institutions())::bigint[]));
