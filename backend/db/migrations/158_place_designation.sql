-- 158 — What a place is called as a unit (owner, 2026-10-29, places plan step B): places.designation, the precise
-- term — "canton of Switzerland", "province of Italy", "prefecture of Japan", "commune of France", "London borough".
-- More precise than a level number: Natural Earth's first level is a département in France, a province in Italy, a
-- canton in Switzerland. Filled from the item's Wikidata class ("instance of"), editable.
ALTER TABLE places ADD COLUMN designation text CHECK (btrim(designation) <> '');
COMMENT ON COLUMN places.designation IS 'what the place is as a unit, e.g. "canton of Switzerland", "province of Italy" (158) — from Wikidata P31, editable';

-- the checks that meant "every place but a country" now also spare a continent
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  def := replace(def, $q$(c.kind <> 'country'::place_kind)$q$, $q$(c.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind]))$q$);
  def := replace(def, $q$(p.kind <> 'country'::place_kind)$q$, $q$(p.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind]))$q$);
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def;
END $$;
