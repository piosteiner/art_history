-- 156 — Two cases 155 left without a country: (1) a point just off a simplified coastline (Natural Earth 1:10m) —
-- Copenhagen, Lisbon, Le Havre, Vlissingen lay "in the sea": the nearest division within 10 km is taken when no
-- outline covers the point; (2) a region with its own boundary code but no point (Gerona ES-GI, Mantova IT-MN): its
-- country is the code's.
CREATE OR REPLACE FUNCTION boundary_at(pt geography) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT b.code FROM boundaries b WHERE pt IS NOT NULL AND ST_Covers(b.geom, pt) ORDER BY b.level DESC, b.code LIMIT 1),
    -- off the coast: the nearest division within 10 km, else country (ST_DWithin on geography: metres, GiST index)
    (SELECT b.code FROM boundaries b WHERE pt IS NOT NULL AND ST_DWithin(b.geom, pt, 10000)
      ORDER BY b.level DESC, ST_Distance(b.geom, pt) LIMIT 1));
$$;

SELECT set_config('arthistory.source', 'migration', true);
UPDATE places SET within_code = boundary_at(coalesce(location, ST_PointOnSurface(area::geometry)::geography))
 WHERE within_code IS NULL AND (location IS NOT NULL OR area IS NOT NULL) AND kind <> 'country';

-- the country: also from the place's own boundary code
CREATE OR REPLACE FUNCTION place_country(pid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT p.id, p.parent_id, coalesce(p.country_code, o.country_code, b.country_code) AS country_code, 0 AS depth
    FROM places p LEFT JOIN boundaries b ON b.code = p.within_code LEFT JOIN boundaries o ON o.code = p.boundary_code WHERE p.id = pid
    UNION ALL
    SELECT p.id, p.parent_id, coalesce(p.country_code, o.country_code, b.country_code), up.depth + 1
    FROM up JOIN places p ON p.id = up.parent_id LEFT JOIN boundaries b ON b.code = p.within_code LEFT JOIN boundaries o ON o.code = p.boundary_code
    WHERE up.country_code IS NULL AND up.depth < 20
  )
  SELECT jsonb_build_object('code', up.country_code, 'slug', c.slug, 'name', c.name)
  FROM up
  LEFT JOIN LATERAL (SELECT slug, name FROM places WHERE kind = 'country' AND country_code = up.country_code ORDER BY id LIMIT 1) c ON true
  WHERE up.country_code IS NOT NULL
  ORDER BY up.depth LIMIT 1
$$;
