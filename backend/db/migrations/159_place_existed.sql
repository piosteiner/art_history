-- 159 — Places in time (owner, 2026-10-29, places plan step D): a place can have existed only for a while — an
-- administrative unit dissolved (Seine-et-Oise 1790–1968), a city merged (Tokyo City 1889–1943), the former
-- arrondissements of Paris (1795–1860). places.existed (a daterange like every period, with its label) says when;
-- open = still there. Renamed places keep one entry: their former names carry the time (152), and a relationship
-- shows the name the place had then (API: entity.name_then, name_then()).
-- Check place_used_outside_existence (info): a relationship dated when the place didn't exist.
ALTER TABLE places ADD COLUMN existed daterange CHECK (NOT isempty(existed)), ADD COLUMN existed_label text;
COMMENT ON COLUMN places.existed IS 'when the place existed as such — a dissolved unit, a merged city (159); NULL = not known / still there';
CREATE INDEX places_existed_idx ON places USING gist (existed) WHERE existed IS NOT NULL;

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('place_used_outside_existence' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'place_used_outside_existence'::text AS check_id,
    'info'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    'existed:'::text || r.id AS issue_key,
    format('%s %s (%s), but %s existed %s', rt.label, p.name, coalesce(r.period_label, r.period::text), p.name, coalesce(p.existed_label, p.existed::text)) AS detail
   FROM relationships r JOIN places p ON r.object_type = 'place' AND p.id = r.object_id
   JOIN relationship_types rt ON rt.code = r.relationship_type
  WHERE p.existed IS NOT NULL AND r.period IS NOT NULL AND NOT (r.period && p.existed)$b$;
END $$;
