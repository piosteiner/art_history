-- Schema smoke test. Runs as arthistory_admin inside a transaction and ROLLS BACK — leaves no data.
--   psql -h localhost -U arthistory_admin -d arthistory_dev -f backend/db/tests/schema_smoke.sql
\set ON_ERROR_STOP on
\pset footer off
BEGIN;

-- Start from an empty slate so imported content can't collide with the sample slugs (all rolled back at the end).
DELETE FROM relationships;
DELETE FROM artworks;
DELETE FROM institutions;
DELETE FROM artists;
DELETE FROM people;
UPDATE polities SET parent_id = NULL;
DELETE FROM polities;
UPDATE movements SET parent_id = NULL;
DELETE FROM movements;
UPDATE places SET parent_id = NULL;
DELETE FROM places;

-- Sample data ---------------------------------------------------------------
INSERT INTO places (slug, name, kind, country_code, location) VALUES
  ('zundert', 'Zundert', 'settlement', 'NL', 'POINT(4.6556 51.4697)'),
  ('paris',   'Paris',   'settlement', 'FR', 'POINT(2.3522 48.8566)'),
  ('arles',   'Arles',   'settlement', 'FR', 'POINT(4.6278 43.6768)'),
  ('auvers-sur-oise', 'Auvers-sur-Oise', 'settlement', 'FR', 'POINT(2.1703 49.0717)'),
  ('marseille', 'Marseille', 'settlement', 'FR', 'POINT(5.3698 43.2965)'),
  ('edo',     'Edo (Tokyo)', 'settlement', 'JP', 'POINT(139.6917 35.6895)'),
  ('japan',   'Japan',   'country', 'JP', 'POINT(138.2529 36.2048)');

INSERT INTO artists (slug, name, sort_name, birth, birth_label, death, death_label) VALUES
  ('katsushika-hokusai', 'Katsushika Hokusai', 'Hokusai', year_range(1760), '1760', year_range(1849), '1849'),
  ('utagawa-hiroshige',  'Utagawa Hiroshige',  'Hiroshige', year_range(1797), '1797', year_range(1858), '1858'),
  ('vincent-van-gogh',   'Vincent van Gogh',   'Gogh, Vincent van',
     daterange('1853-03-30','1853-03-31'), '30 March 1853', daterange('1890-07-29','1890-07-30'), '29 July 1890'),
  ('paul-gauguin',       'Paul Gauguin',       'Gauguin, Paul', year_range(1848), '1848', year_range(1903), '1903');

INSERT INTO movements (slug, name, kind, period, period_label) VALUES
  ('japonisme', 'Japonisme', 'movement', year_range(1860, 1910), 'c. 1860–1910');

-- An institution that moved: place_id = where it is now, located_in = where it was before
INSERT INTO institutions (slug, name, kind, place_id) VALUES ('sample-museum', 'Sample Museum', 'museum', entity_id('place', 'paris'));
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label)
VALUES ('institution', entity_id('institution', 'sample-museum'), 'located_in', 'place', entity_id('place', 'marseille'), year_range(1850, 1899), '1850–1899');


INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label) VALUES
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'born_in',  'place', entity_id('place', 'zundert'), daterange('1853-03-30','1853-03-31'), NULL),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'lived_in', 'place', entity_id('place', 'paris'),   daterange('1886-03-01','1888-02-20'), '1886–1888'),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'lived_in', 'place', entity_id('place', 'arles'),   daterange('1888-02-20','1889-05-08'), '1888–1889'),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'died_in',  'place', entity_id('place', 'auvers-sur-oise'), daterange('1890-07-29','1890-07-30'), NULL),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'influenced_by_culture_of', 'place', entity_id('place', 'japan'), year_range(1886,1890), NULL),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'influenced_by', 'artist', entity_id('artist', 'utagawa-hiroshige'), NULL, NULL),
  ('artist', entity_id('artist', 'utagawa-hiroshige'), 'influenced_by', 'artist', entity_id('artist', 'katsushika-hokusai'), NULL, NULL),
  ('artist', entity_id('artist', 'vincent-van-gogh'), 'associated_with', 'movement', entity_id('movement', 'japonisme'), NULL, NULL),
  ('artist', entity_id('artist', 'katsushika-hokusai'), 'lived_in', 'place', entity_id('place', 'edo'), NULL, NULL);

-- Symmetric edge given in the "wrong" direction is stored canonically
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
VALUES ('artist', entity_id('artist', 'vincent-van-gogh'), 'contemporary_of', 'artist', entity_id('artist', 'paul-gauguin'));

-- Rule checks (each must fail) ----------------------------------------------
DO $$
DECLARE
  cases text[][] := ARRAY[
    ['movement as subject of born_in',   $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('movement', entity_id('movement', 'japonisme'), 'born_in', 'place', entity_id('place', 'paris'))$q$],
    ['artist as subject of located_in', $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'paul-gauguin'), 'located_in', 'place', entity_id('place', 'paris'))$q$],
    ['non-existent object id',          $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'paul-gauguin'), 'visited', 'place', 999999)$q$],
    ['symmetric duplicate B↔A',         $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'paul-gauguin'), 'contemporary_of', 'artist', entity_id('artist', 'vincent-van-gogh'))$q$],
    ['self relationship',               $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'paul-gauguin'), 'influenced_by', 'artist', entity_id('artist', 'paul-gauguin'))$q$],
    ['unknown relationship type',       $q$INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'paul-gauguin'), 'married_to', 'artist', entity_id('artist', 'vincent-van-gogh'))$q$],
    ['death before birth',              $q$UPDATE artists SET death = year_range(1800) WHERE slug = 'paul-gauguin'$q$],
    ['bad slug',                        $q$INSERT INTO places (slug, name, kind, location) VALUES ('Not A Slug', 'x', 'site', 'POINT(0 0)')$q$],
    ['place without coordinates',       $q$INSERT INTO places (slug, name, kind) VALUES ('nowhere', 'Nowhere', 'site')$q$],
    ['admin role tries DDL',            $q$CREATE TABLE hack (i int)$q$],
    ['admin role tries TRUNCATE',       $q$TRUNCATE artists CASCADE$q$],
    ['admin role forges history',       $q$INSERT INTO audit_log (table_name, row_id, action, source) VALUES ('artists', 1, 'delete', 'admin')$q$],
    ['admin role rewrites history',     $q$UPDATE audit_log SET source = 'x'$q$],
    ['admin role creates a user',       $q$INSERT INTO admin_users (username, password_hash) VALUES ('eve', 'x')$q$],
    ['admin role renames a user',       $q$UPDATE admin_users SET username = 'eve'$q$]
  ];
  c text[];
BEGIN
  FOREACH c SLICE 1 IN ARRAY cases LOOP
    BEGIN
      EXECUTE c[2];
      RAISE EXCEPTION 'FAIL — accepted: %', c[1];
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
      RAISE NOTICE 'ok  rejected %: %', rpad(c[1], 32), SQLERRM;
    END;
  END LOOP;
END $$;

\echo '\n== contemporary_of stored canonically (lower id first):'
SELECT a.name AS subject, r.relationship_type, b.name AS object
FROM relationships r JOIN artists a ON a.id = r.subject_id JOIN artists b ON b.id = r.object_id
WHERE r.relationship_type = 'contemporary_of';

\echo '== year_range(-500) (BCE) and year_range(1478,1482):'
SELECT year_range(-500) AS bce, year_range(1478, 1482) AS circa_1480;

\echo '== influence chain from Van Gogh (WITH RECURSIVE, cycle-safe):'
WITH RECURSIVE chain AS (
  SELECT r.object_type, r.object_id, 1 AS depth
  FROM relationships r
  WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'vincent-van-gogh') AND r.relationship_type = 'influenced_by'
  UNION ALL
  SELECT r.object_type, r.object_id, c.depth + 1
  FROM chain c JOIN relationships r
    ON r.subject_type = c.object_type AND r.subject_id = c.object_id AND r.relationship_type = 'influenced_by'
  WHERE c.depth < 10
) CYCLE object_type, object_id SET is_cycle USING path
SELECT depth, a.name FROM chain JOIN artists a ON a.id = chain.object_id WHERE NOT is_cycle ORDER BY depth;

\echo '== reverse direction: who was influenced by Hokusai (uses object index):'
SELECT a.name FROM relationships r JOIN artists a ON a.id = r.subject_id
WHERE r.object_type = 'artist' AND r.object_id = entity_id('artist', 'katsushika-hokusai') AND r.relationship_type = 'influenced_by';

\echo '== artists alive on 1 Jan 1850 (daterange containment, GiST):'
SELECT name, lifespan FROM artists WHERE lifespan @> date '1850-01-01' ORDER BY name;

\echo '== places within 150 km of Arles (ST_DWithin on geography, metres):'
SELECT p.name, round(ST_Distance(p.location, a.location) / 1000) AS km
FROM places p, places a
WHERE a.slug = 'arles' AND p.id <> a.id AND ST_DWithin(p.location, a.location, 150000)
ORDER BY km;

\echo '== Van Gogh travel route: physical-presence only, chronological, as GeoJSON:'
SELECT ST_AsGeoJSON(ST_MakeLine(p.location::geometry ORDER BY lower(r.period))) AS route_geojson,
       string_agg(p.name, ' → ' ORDER BY lower(r.period)) AS stops
FROM relationships r
JOIN relationship_types rt ON rt.code = r.relationship_type AND rt.is_physical_presence
JOIN places p ON p.id = r.object_id
WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'vincent-van-gogh') AND r.object_type = 'place';

\echo '== non-physical place links (separate map layer, not travel):'
SELECT rt.label, p.name FROM relationships r
JOIN relationship_types rt ON rt.code = r.relationship_type AND NOT rt.is_physical_presence
JOIN places p ON p.id = r.object_id
WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'vincent-van-gogh') AND r.object_type = 'place';

\echo '== institution location history (located_in periods, then current place_id):'
SELECT p.name, r.period_label AS period FROM relationships r JOIN places p ON p.id = r.object_id
WHERE r.subject_type = 'institution' AND r.subject_id = entity_id('institution', 'sample-museum') AND r.relationship_type = 'located_in'
UNION ALL
SELECT p.name, 'now' FROM institutions i JOIN places p ON p.id = i.place_id WHERE i.slug = 'sample-museum';

\echo '== polities (019): nationality in sequence, "USSR (today Ukraine)", Han dynasty → CN without a place:'
INSERT INTO places (slug, name, kind, country_code, location) VALUES
  ('ukraine', 'Ukraine', 'country', 'UA', 'POINT(31.17 48.38)');
INSERT INTO places (slug, name, kind, parent_id, location) VALUES      -- no code of its own: inherited from Ukraine
  ('kyiv', 'Kyiv', 'settlement', entity_id('place', 'ukraine'), 'POINT(30.52 50.45)');
INSERT INTO polities (slug, name, kind, period, period_label, country_codes) VALUES
  ('russian-empire', 'Russian Empire', 'empire', '[1721-01-01,1917-09-15)', '1721–1917', '{RU,UA,BY,FI,PL}'),
  ('ussr', 'Soviet Union', 'federation', '[1922-12-30,1991-12-27)', '1922–1991', '{RU,UA,BY,KZ}'),
  ('han-dynasty', 'Han dynasty', 'dynasty', '[0206-01-01 BC,0221-01-01)', '206 BCE–220 CE', '{CN}');
INSERT INTO artists (slug, name, birth, birth_label) VALUES ('sample-painter', 'Sample Painter', year_range(1879), '1879');
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period) VALUES
  ('artist', entity_id('artist', 'sample-painter'), 'born_in', 'place', entity_id('place', 'kyiv'), year_range(1879)),
  ('artist', entity_id('artist', 'sample-painter'), 'nationality', 'polity', entity_id('polity', 'russian-empire'), year_range(1879, 1917)),
  ('artist', entity_id('artist', 'sample-painter'), 'nationality', 'polity', entity_id('polity', 'ussr'), year_range(1922, 1935));
SELECT p->>'name' || ' (today ' || (entity_country('artist', a.id)->>'name') || ')' AS shown
FROM artists a, jsonb_array_elements(entity_polities('artist', a.id)) p WHERE a.slug = 'sample-painter';
INSERT INTO artworks (slug, title) VALUES ('sample-bronze', 'Sample bronze');
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
VALUES ('artwork', entity_id('artwork', 'sample-bronze'), 'created_in_polity', 'polity', entity_id('polity', 'han-dynasty'));
SELECT entity_country('artwork', entity_id('artwork', 'sample-bronze')) ->> 'code' = 'CN' AS han_bronze_today_cn,
       entity_country('artwork', entity_id('artwork', 'sample-bronze')) ->> 'source' AS source;
SAVEPOINT bad_code;
\set ON_ERROR_STOP off
INSERT INTO polities (slug, name, country_codes) VALUES ('bad', 'Bad', '{ukr}');  -- must fail: not an ISO alpha-2 code
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT bad_code;
SELECT check_id, detail FROM quality_issues WHERE check_id = 'outside_polity_period';  -- none yet
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period)
VALUES ('artist', entity_id('artist', 'sample-painter'), 'nationality', 'polity', entity_id('polity', 'ussr'), year_range(1900, 1905));
SELECT check_id, detail FROM quality_issues WHERE check_id = 'outside_polity_period';  -- USSR in 1900: flagged

\echo '== delete Van Gogh → relationships cleaned up in both directions:'
SELECT count(*) AS edges_before FROM relationships
WHERE (subject_type = 'artist' AND subject_id = entity_id('artist', 'vincent-van-gogh')) OR (object_type = 'artist' AND object_id = entity_id('artist', 'vincent-van-gogh'));
DELETE FROM artists WHERE slug = 'vincent-van-gogh';
SELECT count(*) AS edges_after FROM relationships
WHERE (subject_type = 'artist' AND subject_id = entity_id('artist', 'vincent-van-gogh')) OR (object_type = 'artist' AND object_id = entity_id('artist', 'vincent-van-gogh'));

\echo '== audit_log: changes made by this test, recorded by the trigger (source sql = not tagged by admin/import):'
SELECT table_name, action, source, count(*) FROM audit_log WHERE txid = pg_current_xact_id() GROUP BY 1, 2, 3 ORDER BY 1, 2;

\echo '== updated_at trigger:'
SELECT created_at = updated_at AS same_before FROM artists WHERE slug = 'paul-gauguin';
UPDATE artists SET biography_md = 'French *Post-Impressionist*.' WHERE slug = 'paul-gauguin';
SELECT updated_at >= created_at AS touched FROM artists WHERE slug = 'paul-gauguin';

ROLLBACK;
\echo '✓ smoke test passed (rolled back)'
