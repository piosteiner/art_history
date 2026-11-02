-- 191: world regions (owner 2026-11-02: "Die Regionen von Kunstwerken werden bei Quizzes noch nicht berücksichtigt … could
-- we create regions something like Europe, East Asia, North America, South America, Africa, Middle East, Central Asia,
-- Oceania, Australia"). Ten regions as an enum (a fixed list — a menu in the forms by itself); South and Southeast Asia
-- added (India, Indonesia belong nowhere else), Australia within Oceania, Central America and the Caribbean within
-- North America, North Africa within the Middle East (Islamic art, the ancient Near East and Egypt together).
-- Every country has its region (country_regions — change a country's region there). Works, artists and movements get
-- theirs worked out (entry_regions), or set by hand (column region) where that is wrong.
CREATE TYPE world_region AS ENUM ('europe', 'middle_east', 'africa', 'central_asia', 'south_asia', 'east_asia',
  'southeast_asia', 'oceania', 'north_america', 'south_america');
CREATE TABLE world_regions (
  region world_region PRIMARY KEY,
  name text NOT NULL, name_de text NOT NULL,
  note text
);
INSERT INTO world_regions VALUES
  ('europe', 'Europe', 'Europa', 'with Russia, Cyprus'),
  ('middle_east', 'Middle East', 'Naher Osten', 'West Asia with Turkey, Iran and the Caucasus, and North Africa from Egypt to Morocco'),
  ('africa', 'Africa', 'Afrika', 'Africa south of the Sahara, Sudan'),
  ('central_asia', 'Central Asia', 'Zentralasien', 'Kazakhstan to Afghanistan'),
  ('south_asia', 'South Asia', 'Südasien', 'India, Pakistan, Bangladesh, Nepal, Bhutan, Sri Lanka, the Maldives'),
  ('east_asia', 'East Asia', 'Ostasien', 'China, Japan, Korea, Taiwan, Mongolia'),
  ('southeast_asia', 'Southeast Asia', 'Südostasien', 'Myanmar to the Philippines and Indonesia'),
  ('oceania', 'Oceania', 'Ozeanien', 'Australia, New Zealand and the Pacific islands'),
  ('north_america', 'North America', 'Nordamerika', 'with Mexico, Central America and the Caribbean'),
  ('south_america', 'South America', 'Südamerika', NULL);

CREATE TABLE country_regions (
  country_code char(2) PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),   -- ISO 3166-1 alpha-2, as places.country_code
  region world_region NOT NULL REFERENCES world_regions
);
INSERT INTO country_regions (country_code, region)
SELECT code, r::world_region FROM (VALUES
  ('europe', 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK'),
  ('middle_east', 'AE AM AZ BH DZ EG EH GE IL IQ IR JO KW LB LY MA OM PS QA SA SY TN TR YE'),
  ('africa', 'AO BF BI BJ BW CD CF CG CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TZ UG YT ZA ZM ZW'),
  ('central_asia', 'AF KG KZ TJ TM UZ'),
  ('south_asia', 'BD BT IN IO LK MV NP PK'),
  ('east_asia', 'CN HK JP KP KR MN MO TW'),
  ('southeast_asia', 'BN ID KH LA MM MY PH SG TH TL VN'),
  ('oceania', 'AS AU CC CK CX FJ FM GU HM KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS'),
  ('north_america', 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI'),
  ('south_america', 'AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE')
) x(r, codes) CROSS JOIN unnest(string_to_array(codes, ' ')) code;

-- set by hand: only where the worked-out region is wrong
ALTER TABLE artworks ADD COLUMN region world_region;
ALTER TABLE artists ADD COLUMN region world_region;
ALTER TABLE movements ADD COLUMN region world_region;
COMMENT ON COLUMN artworks.region IS 'World region set by hand (191); empty = worked out: entry_regions';

-- The worked-out regions, one row per work, artist and movement with the reason (basis):
--   artist:   set · worked (where they worked or lived, the most frequent region) · born · nationality (polities of
--             one region) · movement (their movements, if all of one region)
--   movement: set (on it or the nearest broader one) · artists (the most frequent region of its artists, from places)
--   artwork:  set · made (created_in) · artist (its creator's) · movement (its movements, if all of one region)
-- Stored (place_country() for every place takes ~100 ms) and refreshed with the global part of the derived data
-- (refresh_quality_global, ≤ every 30 s after a change) — CONCURRENTLY, so readers are never blocked.
-- a materialized view is refreshed with search_path = pg_catalog, pg_temp (PostgreSQL 17): the function it calls names its own
ALTER FUNCTION place_country(bigint) SET search_path = public, pg_temp;
CREATE MATERIALIZED VIEW entry_regions AS
WITH RECURSIVE place_regions AS MATERIALIZED (
  SELECT p.id AS place_id, cr.region FROM places p JOIN country_regions cr ON cr.country_code = place_country(p.id)->>'code'
),
placed AS (
  SELECT r.subject_id AS artist_id, r.relationship_type, pr.region
  FROM relationships r JOIN place_regions pr ON pr.place_id = r.object_id
  WHERE r.subject_type = 'artist' AND r.object_type = 'place' AND r.relationship_type IN ('worked_in', 'lived_in', 'born_in')
),
artist_placed AS MATERIALIZED (
  SELECT a.id AS artist_id, coalesce(a.region, w.region, b.region, n.region) AS region,
         CASE WHEN a.region IS NOT NULL THEN 'set' WHEN w.region IS NOT NULL THEN 'worked' WHEN b.region IS NOT NULL THEN 'born'
              WHEN n.region IS NOT NULL THEN 'nationality' END AS basis
  FROM artists a
  LEFT JOIN (SELECT artist_id, mode() WITHIN GROUP (ORDER BY region) AS region FROM placed
             WHERE relationship_type IN ('worked_in', 'lived_in') GROUP BY 1) w ON w.artist_id = a.id
  LEFT JOIN (SELECT artist_id, min(region) AS region FROM placed WHERE relationship_type = 'born_in' GROUP BY 1) b ON b.artist_id = a.id
  LEFT JOIN (SELECT r.subject_id AS artist_id, min(cr.region) AS region
             FROM relationships r JOIN polities po ON po.id = r.object_id CROSS JOIN unnest(po.country_codes) cc
             JOIN country_regions cr ON cr.country_code = cc
             WHERE r.subject_type = 'artist' AND r.object_type = 'polity' GROUP BY 1 HAVING count(DISTINCT cr.region) = 1) n ON n.artist_id = a.id
),
-- a movement's own region, or its nearest broader movement's: each movement with its ancestors (depth 0 = itself)
up (id, anc, depth) AS (
  SELECT id, id, 0 FROM movements
  UNION ALL
  SELECT u.id, m.parent_id, u.depth + 1 FROM up u JOIN movements m ON m.id = u.anc WHERE m.parent_id IS NOT NULL AND u.depth < 20
),
set_r AS (
  SELECT DISTINCT ON (u.id) u.id, m.region FROM up u JOIN movements m ON m.id = u.anc WHERE m.region IS NOT NULL ORDER BY u.id, u.depth
),
movement_r AS MATERIALIZED (
  SELECT m.id AS movement_id, coalesce(s.region, ma.region) AS region, CASE WHEN s.region IS NOT NULL THEN 'set' WHEN ma.region IS NOT NULL THEN 'artists' END AS basis
  FROM movements m
  LEFT JOIN set_r s ON s.id = m.id
  LEFT JOIN (SELECT mv.movement_id, mode() WITHIN GROUP (ORDER BY ap.region) AS region
             FROM (SELECT DISTINCT movement_id, artist_id FROM movement_artists) mv JOIN artist_placed ap ON ap.artist_id = mv.artist_id
             WHERE ap.region IS NOT NULL GROUP BY 1) ma ON ma.movement_id = m.id
),
artist_r AS MATERIALIZED (
  SELECT ap.artist_id, coalesce(ap.region, mv.region) AS region, coalesce(ap.basis, CASE WHEN mv.region IS NOT NULL THEN 'movement' END) AS basis
  FROM artist_placed ap
  LEFT JOIN (SELECT ma.artist_id, min(mr.region) AS region FROM movement_artists ma JOIN movement_r mr ON mr.movement_id = ma.movement_id
             WHERE ma.via <> 'works' AND mr.region IS NOT NULL GROUP BY 1 HAVING count(DISTINCT mr.region) = 1) mv ON mv.artist_id = ap.artist_id
),
artwork_r AS (
  SELECT w.id AS artwork_id,
         coalesce(w.region, made.region, ar.region, mv.region) AS region,
         CASE WHEN w.region IS NOT NULL THEN 'set' WHEN made.region IS NOT NULL THEN 'made' WHEN ar.region IS NOT NULL THEN 'artist'
              WHEN mv.region IS NOT NULL THEN 'movement' END AS basis
  FROM artworks w
  LEFT JOIN LATERAL (SELECT pr.region FROM relationships r JOIN place_regions pr ON pr.place_id = r.object_id
                     WHERE r.subject_type = 'artwork' AND r.subject_id = w.id AND r.object_type = 'place' AND r.relationship_type = 'created_in'
                     ORDER BY lower(r.period) NULLS LAST, r.id LIMIT 1) made ON true
  LEFT JOIN artist_r ar ON ar.artist_id = w.creator_id
  LEFT JOIN (SELECT mw.artwork_id, min(mr.region) AS region FROM movement_works mw JOIN movement_r mr ON mr.movement_id = mw.movement_id
             WHERE mr.region IS NOT NULL GROUP BY 1 HAVING count(DISTINCT mr.region) = 1) mv ON mv.artwork_id = w.id
)
SELECT 'artwork'::entity_type AS entity_type, artwork_id AS entity_id, region, basis FROM artwork_r WHERE region IS NOT NULL
UNION ALL SELECT 'artist', artist_id, region, basis FROM artist_r WHERE region IS NOT NULL
UNION ALL SELECT 'movement', movement_id, region, basis FROM movement_r WHERE region IS NOT NULL;
CREATE UNIQUE INDEX entry_regions_key ON entry_regions (entity_type, entity_id);
CREATE INDEX entry_regions_region ON entry_regions (region, entity_type);
GRANT SELECT ON world_regions, country_regions, entry_regions TO arthistory_api, arthistory_admin;
GRANT INSERT, UPDATE, DELETE ON country_regions TO arthistory_admin;

CREATE OR REPLACE FUNCTION public.refresh_quality_global()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET client_min_messages TO 'warning'
AS $function$
DECLARE
  seen bigint;
  globals text := quote_literal(quality_global_checks()) || '::text[]';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  REFRESH MATERIALIZED VIEW search_words;
  REFRESH MATERIALIZED VIEW CONCURRENTLY entry_regions;   -- 191
  DROP TABLE IF EXISTS d_global;
  EXECUTE 'CREATE TEMP TABLE d_global ON COMMIT DROP AS SELECT DISTINCT ON (q.check_id, q.issue_key, q.entity_type, q.entity_id) q.*
           FROM quality_issues_live q WHERE q.check_id = ANY (' || globals || ')';
  DELETE FROM quality_issues q WHERE q.check_id = ANY (quality_global_checks()) AND NOT EXISTS (SELECT 1 FROM d_global f
    WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id));
  INSERT INTO quality_issues AS q SELECT * FROM d_global
  ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
  WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail);
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp(), global_at = clock_timestamp();
END $function$

;
