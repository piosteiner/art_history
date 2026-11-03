-- 206 — entry_regions: the country of only the places it reads (perf, 2026-11-03). The view (191/194/199) asked
-- place_country() — a walk up the place hierarchy — for every place: 9,160 on the perf data (10× today), 0.74 s of its
-- 1.0 s; it reads only the places of artists' births, homes and workplaces and of works' making (4,050). The same rows.
-- quiz_pictured (202) reads entry_regions: dropped and made again as it was.
DROP MATERIALIZED VIEW quiz_pictured;
DROP MATERIALIZED VIEW entry_regions;
CREATE MATERIALIZED VIEW entry_regions AS
WITH RECURSIVE place_regions AS MATERIALIZED (
  SELECT p.id AS place_id, cr.region FROM places p JOIN country_regions cr ON cr.country_code = place_country(p.id)->>'code'
  -- only the places the regions are read from (206): where artists were born, lived, worked, where works were made
  WHERE p.id IN (SELECT r.object_id FROM relationships r WHERE r.object_type = 'place'
                 AND ((r.subject_type = 'artist' AND r.relationship_type IN ('worked_in', 'lived_in', 'born_in'))
                      OR (r.subject_type = 'artwork' AND r.relationship_type = 'created_in')))
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
  -- its artists' region: a period or school takes the most frequent one; a movement or style (modern art, mail art …
  -- can be anywhere) only when at least three of its artists are known and four in five of them share it
  LEFT JOIN (SELECT x.movement_id, x.region FROM (
               SELECT mv.movement_id, ap.region, count(*) AS n, sum(count(*)) OVER (PARTITION BY mv.movement_id) AS total,
                      row_number() OVER (PARTITION BY mv.movement_id ORDER BY count(*) DESC, ap.region) AS rank
               FROM (SELECT DISTINCT movement_id, artist_id FROM movement_artists) mv JOIN artist_placed ap ON ap.artist_id = mv.artist_id
               WHERE ap.region IS NOT NULL GROUP BY mv.movement_id, ap.region) x
             JOIN movements mm ON mm.id = x.movement_id
             WHERE x.rank = 1 AND (mm.kind IN ('period', 'school') OR (x.total >= 3 AND x.n >= 0.8 * x.total))) ma ON ma.movement_id = m.id
),
artist_r AS MATERIALIZED (
  SELECT ap.artist_id, coalesce(ap.region, mv.region) AS region, coalesce(ap.basis, CASE WHEN mv.region IS NOT NULL THEN 'movement' END) AS basis
  FROM artist_placed ap
  LEFT JOIN (SELECT ma.artist_id, min(mr.region) AS region FROM movement_artists ma JOIN movement_r mr ON mr.movement_id = ma.movement_id
             WHERE ma.via <> 'works' AND mr.region IS NOT NULL GROUP BY 1 HAVING count(DISTINCT mr.region) = 1) mv ON mv.artist_id = ap.artist_id
),
-- where each work was made: its first "created in" place, for all works at once (199: not a lookup per work)
made_r AS MATERIALIZED (
  SELECT DISTINCT ON (r.subject_id) r.subject_id AS artwork_id, pr.region
  FROM relationships r JOIN place_regions pr ON pr.place_id = r.object_id
  WHERE r.subject_type = 'artwork' AND r.object_type = 'place' AND r.relationship_type = 'created_in'
  ORDER BY r.subject_id, lower(r.period) NULLS LAST, r.id
),
-- a work's movements of one region only, for all works at once (199)
work_mv AS MATERIALIZED (
  SELECT mw.artwork_id, min(mr.region) AS region FROM movement_works mw JOIN movement_r mr ON mr.movement_id = mw.movement_id
  WHERE mr.region IS NOT NULL GROUP BY 1 HAVING count(DISTINCT mr.region) = 1
),
artwork_r AS (
  SELECT w.id AS artwork_id,
         coalesce(w.region, made.region, ar.region, mv.region) AS region,
         CASE WHEN w.region IS NOT NULL THEN 'set' WHEN made.region IS NOT NULL THEN 'made' WHEN ar.region IS NOT NULL THEN 'artist'
              WHEN mv.region IS NOT NULL THEN 'movement' END AS basis
  FROM artworks w
  LEFT JOIN made_r made ON made.artwork_id = w.id
  LEFT JOIN artist_r ar ON ar.artist_id = w.creator_id
  LEFT JOIN work_mv mv ON mv.artwork_id = w.id
)
SELECT 'artwork'::entity_type AS entity_type, artwork_id AS entity_id, region, basis FROM artwork_r WHERE region IS NOT NULL
UNION ALL SELECT 'artist', artist_id, region, basis FROM artist_r WHERE region IS NOT NULL
UNION ALL SELECT 'movement', movement_id, region, basis FROM movement_r WHERE region IS NOT NULL;
CREATE UNIQUE INDEX entry_regions_key ON entry_regions (entity_type, entity_id);
CREATE INDEX entry_regions_region ON entry_regions (region, entity_type);
GRANT SELECT ON entry_regions TO arthistory_api, arthistory_admin;

CREATE MATERIALIZED VIEW quiz_pictured AS
SELECT a.id, a.slug, a.public_id, a.title, a.creator_id, a.created, a.created_label, a.kind, a.names, img.url AS image_url,
         CASE WHEN img.url IS NOT NULL THEN img.credit END AS credit, CASE WHEN img.url IS NOT NULL THEN img.license END AS license,
         (SELECT er.region::text FROM entry_regions er WHERE er.entity_type = 'artwork' AND er.entity_id = a.id) AS region
  FROM artworks a
  LEFT JOIN LATERAL (SELECT i.url, i.credit, i.license FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  
  WHERE (a.kind_term_id IS NULL OR NOT artwork_is_group(a.kind_term_id)) AND img.url IS NOT NULL;
CREATE UNIQUE INDEX quiz_pictured_key ON quiz_pictured (id);
CREATE INDEX quiz_pictured_creator ON quiz_pictured (creator_id);
GRANT SELECT ON quiz_pictured TO arthistory_api, arthistory_admin;
