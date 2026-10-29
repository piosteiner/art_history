-- 155 — Every place knows its country and its first-level division from its coordinates (owner, 2026-10-29: "eine
-- stabile und verlässliche Lösung" for places). Two thirds of the places had no country: no parent, no code of their
-- own (Lisbon, Osaka, Weimar …), so the site couldn't say "Portugal". The Natural Earth boundaries (032) — 237 countries
-- and 4,313 first-level divisions (cantons, Länder, provinces, prefectures, départements) — answer it for every place
-- with a point: the division whose outline covers the point (PostGIS ST_Covers on geography, served by the GiST index
-- boundaries_geom_gist).
--
--   places.within_code   the most specific Natural Earth unit the place lies in (a division, else a country) —
--                        kept by a trigger when the point or the outline changes; not edited by hand
--   place_country()      the country: at each step up the parent chain a code set by hand wins over the one the
--                        point lies in — Campione d'Italia (an Italian exclave in Switzerland) keeps IT
--   checks               place_without_country, place_outside_country (a code by hand ≠ where the point lies —
--                        an exclave is marked OK once); place_without_parent exists since 013

ALTER TABLE places ADD COLUMN within_code text REFERENCES boundaries (code) ON UPDATE CASCADE ON DELETE SET NULL;
COMMENT ON COLUMN places.within_code IS 'the Natural Earth division (else country) its point lies in (155) — set by the trigger places_within';
CREATE INDEX places_within_idx ON places (within_code);

-- the most specific boundary covering a point (a division before its country)
CREATE FUNCTION boundary_at(pt geography) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT b.code FROM boundaries b WHERE pt IS NOT NULL AND ST_Covers(b.geom, pt) ORDER BY b.level DESC, b.code LIMIT 1;
$$;

CREATE FUNCTION places_within() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.within_code := boundary_at(coalesce(NEW.location, ST_PointOnSurface(NEW.area::geometry)::geography));
  RETURN NEW;
END $$;
CREATE TRIGGER places_within BEFORE INSERT OR UPDATE OF location, area ON places FOR EACH ROW EXECUTE FUNCTION places_within();

-- the places there are (a derived value: tagged so History shows where it came from) — not the countries, whose code
-- is their own (and whose update would let places_default_boundary give them their outline on the way)
SELECT set_config('arthistory.source', 'migration', true);
UPDATE places SET within_code = boundary_at(coalesce(location, ST_PointOnSurface(area::geometry)::geography))
 WHERE (location IS NOT NULL OR area IS NOT NULL) AND kind <> 'country';

-- the country: walking up, the own code by hand, else where the point lies, else the parent's
CREATE OR REPLACE FUNCTION place_country(pid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT p.id, p.parent_id, coalesce(p.country_code, b.country_code) AS country_code, 0 AS depth
    FROM places p LEFT JOIN boundaries b ON b.code = p.within_code WHERE p.id = pid
    UNION ALL
    SELECT p.id, p.parent_id, coalesce(p.country_code, b.country_code), up.depth + 1
    FROM up JOIN places p ON p.id = up.parent_id LEFT JOIN boundaries b ON b.code = p.within_code
    WHERE up.country_code IS NULL AND up.depth < 20
  )
  SELECT jsonb_build_object('code', up.country_code, 'slug', c.slug, 'name', c.name)
  FROM up
  LEFT JOIN LATERAL (SELECT slug, name FROM places WHERE kind = 'country' AND country_code = up.country_code ORDER BY id LIMIT 1) c ON true
  WHERE up.country_code IS NOT NULL
  ORDER BY up.depth LIMIT 1
$$;

-- the checks (view quality_issues_live, 058 — patched as it stands)
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('place_without_country' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'place_without_country'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    'country:'::text || p.id AS issue_key,
    'no country — neither a point inside a country, nor a country code, nor a parent that has one'::text AS detail
   FROM places p
  WHERE place_country(p.id) IS NULL
UNION ALL
 SELECT 'place_outside_country'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    'outside:'::text || p.id || ':' || b.country_code AS issue_key,
    format('country %s by hand, but the point lies in %s (%s)', p.country_code, b.country_code, b.name) AS detail
   FROM places p JOIN boundaries b ON b.code = p.within_code
  WHERE p.country_code IS NOT NULL AND p.kind <> 'country' AND b.country_code <> p.country_code$b$;
END $$;
