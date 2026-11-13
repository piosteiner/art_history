-- 252 — Auto-created provenance holders as "info" (owner 2026-11-13). About 1,100 people and firms came in with museum
-- provenances (the Kunsthaus import above all) with nothing but the name the museum gives — "M. B. Pellet", "Galerie X".
-- They are as complete as the source allows; researching each is not realistic, and "Mark as OK" a thousand times
-- would hide them. Now an auto-created person or institution
--   * without a Wikidata item,
--   * holder (owner_person_id / owner_institution_id) of at least one provenance step that cites a source,
--   * with no stored relationship
-- is reported as "info", not as a warning — findable, complete when more is known. Created
-- through a provenance or relationship picker (via 'provenance' / 'relationship', 142/149) stays an error.
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  s int := position($s$ SELECT 'auto_created'::text AS check_id,$s$ IN def);
  old text := $o$        CASE
            WHEN (ac.via = ANY (ARRAY['provenance'::text, 'relationship'::text])) THEN 'error'::text
            ELSE 'warning'::text
        END AS severity,$o$;
  new text := $n$        CASE
            WHEN (ac.via = ANY (ARRAY['provenance'::text, 'relationship'::text])) THEN 'error'::text
            WHEN ((ac.entity_type = ANY (ARRAY['person'::entity_type, 'institution'::entity_type]))
              AND (NOT EXISTS (SELECT 1 FROM people x WHERE ac.entity_type = 'person'::entity_type AND x.id = ac.entity_id AND x.wikidata_id IS NOT NULL))
              AND (NOT EXISTS (SELECT 1 FROM institutions x WHERE ac.entity_type = 'institution'::entity_type AND x.id = ac.entity_id AND x.wikidata_id IS NOT NULL))
              AND (EXISTS (SELECT 1 FROM provenance p JOIN citations c ON c.provenance_id = p.id
                    WHERE (ac.entity_type = 'person'::entity_type AND p.owner_person_id = ac.entity_id)
                       OR (ac.entity_type = 'institution'::entity_type AND p.owner_institution_id = ac.entity_id)))
              AND (NOT EXISTS (SELECT 1 FROM relationships r
                    WHERE (r.subject_type = ac.entity_type AND r.subject_id = ac.entity_id) OR (r.object_type = ac.entity_type AND r.object_id = ac.entity_id))))
              THEN 'info'::text
            ELSE 'warning'::text
        END AS severity,$n$;
  o int;
BEGIN
  IF s = 0 THEN RAISE EXCEPTION 'quality_issues_live: the auto_created block not found'; END IF;
  IF position(old IN substr(def, s)) = 0 AND position('THEN ''info''::text' IN substr(def, s, 2000)) > 0 THEN RETURN; END IF;  -- applied
  o := s + position(old IN substr(def, s)) - 1;
  IF o < s THEN RAISE EXCEPTION 'quality_issues_live: the auto_created severity not found'; END IF;
  def := substr(def, 1, o - 1) || new || substr(def, o + length(old));
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def;
END $$;
