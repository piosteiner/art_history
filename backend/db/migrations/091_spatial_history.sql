-- 091 — Spatial history with PostGIS (owner, 2026-10-17).
--   provenance_stops(artwork)  where the work was at each step of its provenance, in the chain's order — moved here
--                              from the map's route (src/routes/map.js uses it) so the map and the distance agree
--   artwork_travel(artwork)    how far it travelled: the stops as one line (ST_MakeLine), its length on the
--                              spheroid (ST_Length on geography, metres) — "Idylle à Tahiti ≈ 40,000 km"
--   encounters(…)              who was near whom: two dated stays at the same place — or within a distance
--                              (ST_DWithin on geography) — whose periods overlap (&&); the overlap is the range
--                              intersection (*). The site computed this in the browser from what the maps loaded.
--   place_clusters(zoom, …)    places with presence grouped for a map at low zoom: ST_ClusterDBSCAN in Web Mercator
--                              (the map's own projection, so the radius is the same number of pixels everywhere)

-- Where the work was at each step. The creation: its recorded place (created_in), else the one place the artist is
-- recorded at while it was made, else the artist's one undated place of work; an institution holder without a
-- place: its seat; a step's further places (077) as parts 1, 2 … Events (077) are no stops.
CREATE FUNCTION provenance_stops(aid bigint)
RETURNS TABLE (step bigint, steps bigint, provenance_id bigint, chain_kind text, part integer, part_label text,
               place_id bigint, place_basis text, marker geography)
LANGUAGE sql STABLE AS $$
  WITH chain AS (
    SELECT c.*, row_number() OVER (ORDER BY c.position, c.kind, c.id) AS step, count(*) OVER () AS steps
    FROM provenance_chain c WHERE c.artwork_id = aid AND c.role IS DISTINCT FROM 'event')
  SELECT ch.step, ch.steps, ch.id, ch.kind, pl.part, pl.part_label, pl.place_id, pl.place_basis, g.marker
  FROM chain ch
  LEFT JOIN LATERAL (
    SELECT * FROM (
      (SELECT rel.object_id AS place_id, 'created_in' AS basis, 1 AS pref FROM relationships rel
       WHERE rel.subject_type = 'artwork' AND rel.subject_id = ch.artwork_id
         AND rel.relationship_type = 'created_in' AND rel.object_type = 'place' ORDER BY rel.id LIMIT 1)
      UNION ALL
      -- relationships, not the edges view: between an artist and a place there are only stored ones (the derived edges
      -- all have an artwork or a holder at the other end), and the view costs ~70 ms to compute
      (SELECT min(x.object_id), 'artist_residence', 2 FROM artworks w
       JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                   AND x.period && w.created
       JOIN relationship_types rt ON rt.code = x.relationship_type AND rt.is_physical_presence
       WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
      UNION ALL
      -- a workshop artist's one place of work, undated ("worked in Ulm" — Wikidata P937 has no dates)
      (SELECT min(x.object_id), 'artist_workplace', 3 FROM artworks w
       JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                           AND x.relationship_type = 'worked_in' AND x.period IS NULL
       WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
    ) m ORDER BY pref LIMIT 1
  ) made ON ch.location_id IS NULL AND (ch.kind = 'creation' OR ch.method = 'creation')
  LEFT JOIN LATERAL (
    SELECT i.place_id, 'holder_seat' AS basis FROM institutions i WHERE i.id = ch.owner_id
  ) seat ON ch.location_id IS NULL AND ch.owner_type = 'institution' AND ch.kind <> 'creation'
  CROSS JOIN LATERAL (
    SELECT coalesce(ch.location_id, made.place_id, seat.place_id) AS place_id,
           CASE WHEN ch.location_id IS NOT NULL THEN CASE WHEN ch.kind = 'loan' THEN 'holder_seat' ELSE 'recorded' END
                ELSE coalesce(made.basis, seat.basis) END AS place_basis, 0 AS part, NULL::text AS part_label
    UNION ALL
    SELECT x.place_id, 'recorded', x.position + 1, x.period_label FROM provenance_places x WHERE x.provenance_id = ch.id AND ch.kind = 'step'
  ) pl
  LEFT JOIN site_geo g ON (g.type, g.id) = ('place', pl.place_id)
$$;
COMMENT ON FUNCTION provenance_stops IS 'an artwork''s provenance stops in chain order with the place and how it is known (091; used by the map)';

-- The distance along the stops: one line through them, its geodesic length. Consecutive stops at the same point
-- add nothing. Also how many stops have a place — "≈ 18,400 km over 7 of 9 steps".
CREATE FUNCTION artwork_travel(aid bigint, OUT km integer, OUT legs integer, OUT placed integer, OUT steps integer)
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM provenance_stops(aid)),
  moves AS (
    SELECT marker, lag(marker) OVER (ORDER BY step, part) AS prev FROM s WHERE marker IS NOT NULL)
  SELECT (SELECT round(ST_Length(ST_MakeLine(array_agg(m.marker::geometry))::geography) / 1000)::integer
          FROM (SELECT marker FROM s WHERE marker IS NOT NULL ORDER BY step, part) m),
         (SELECT count(*)::integer FROM moves WHERE prev IS NOT NULL AND NOT ST_Equals(prev::geometry, marker::geometry)),
         (SELECT count(DISTINCT step)::integer FROM s WHERE marker IS NOT NULL AND part = 0),
         (SELECT max(steps)::integer FROM s)
$$;
COMMENT ON FUNCTION artwork_travel IS 'how far an artwork travelled along its provenance stops (091): geodesic length of the line through them';

-- Who was near whom. Stays: dated physical presence (lived, worked, visited, born, died, kept in …) at a place or a
-- venue (an institution or an immovable artwork: then place = its city). Two stays of different entries meet when
-- their periods overlap and they were at the same place — or, with within_km > 0, at places at most that far apart.
-- Not two artworks (works in one city say nothing), not an artwork with its own artist. venue: both at the same
-- institution or building ("could have met there"). approximate: a date known only to the year or circa.
-- Optional: only one entry's encounters (etype + eid), only within a window. Stays with an open start ("until
-- 1912") are left out — like on the site: from when? An open end counts until today.
CREATE FUNCTION encounters(win daterange DEFAULT NULL, within_km numeric DEFAULT 0,
                           etype entity_type DEFAULT NULL, eid bigint DEFAULT NULL)
RETURNS TABLE (a_type entity_type, a_id bigint, b_type entity_type, b_id bigint, a_place bigint, b_place bigint,
               venue_type entity_type, venue_id bigint, overlap daterange, km integer, approximate boolean,
               a_relationship text, b_relationship text)
LANGUAGE sql STABLE AS $$
  WITH stays AS MATERIALIZED (
    SELECT e.subject_type AS t, e.subject_id AS id, e.relationship_type AS rel, e.object_type AS vt, e.object_id AS vid,
           g.place_id, coalesce(g.marker, pg.marker) AS marker,
           -- an open end = still there (until today); an open start ("until 1912") isn't a stay we can date
           e.period * daterange(NULL, current_date + 1) * coalesce(win, '(,)') AS period,
           coalesce(e.period_label, '') ~* '^\s*(c\.\s*)?-?\d{1,4}(\s*[–-]\s*-?\d{1,4})?\s*$|c\.|century|circa|ca\.' AS coarse
    FROM edges e
    JOIN relationship_types rt ON rt.code = e.relationship_type AND rt.is_physical_presence
    JOIN site_geo g ON (g.type, g.id) = (e.object_type, e.object_id)
    LEFT JOIN site_geo pg ON (pg.type, pg.id) = ('place', g.place_id)
    WHERE e.period IS NOT NULL AND NOT lower_inf(e.period) AND e.subject_type IN ('artist', 'person', 'artwork')
      AND (win IS NULL OR e.period && win) AND g.place_id IS NOT NULL)
  SELECT DISTINCT x.t, x.id, y.t, y.id, x.place_id, y.place_id,
         CASE WHEN x.vt <> 'place' AND (x.vt, x.vid) = (y.vt, y.vid) THEN x.vt END,
         CASE WHEN x.vt <> 'place' AND (x.vt, x.vid) = (y.vt, y.vid) THEN x.vid END,
         x.period * y.period,
         CASE WHEN x.place_id = y.place_id THEN 0 ELSE round(ST_Distance(x.marker, y.marker) / 1000)::integer END,
         x.coarse OR y.coarse, x.rel, y.rel
  FROM stays x
  JOIN stays y ON (x.t, x.id) < (y.t, y.id)                     -- each pair once
              AND x.period && y.period
              AND (x.place_id = y.place_id OR (within_km > 0 AND ST_DWithin(x.marker, y.marker, within_km * 1000)))
  WHERE NOT isempty(x.period * y.period)
    AND NOT (x.t = 'artwork' AND y.t = 'artwork')
    -- the enum orders artist before artwork: an artwork pair has the artist in x
    AND NOT (x.t = 'artist' AND y.t = 'artwork' AND (
          EXISTS (SELECT 1 FROM artworks w WHERE w.id = y.id AND w.creator_id = x.id)
          OR EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id, r.relationship_type, r.object_type, r.object_id)
                                                       = ('artwork', y.id, 'co_creator', 'artist', x.id))))
    AND (etype IS NULL OR (x.t, x.id) = (etype, eid) OR (y.t, y.id) = (etype, eid))
$$;
COMMENT ON FUNCTION encounters IS 'pairs of dated stays at the same place (or within within_km) with overlapping periods (091)';

-- Places with presence for a map at low zoom, grouped: ST_ClusterDBSCAN numbers the groups — points within eps of
-- each other (transitively) share a number; minpoints 1 = every place in some group. eps in Web Mercator metres =
-- radius_px × the metres per pixel at that zoom (156543.03 / 2^zoom at the equator — Mercator's stretching towards
-- the poles is exactly the map's, so the radius is the same on screen everywhere). A window counts only the stays
-- in it. Each group: its centre, how many places, how much presence, its biggest places.
CREATE FUNCTION place_clusters(zoom numeric, win daterange DEFAULT NULL, radius_px numeric DEFAULT 40)
RETURNS TABLE (cluster integer, center geometry, places integer, presence integer, top jsonb, bbox geometry)
LANGUAGE sql STABLE AS $$
  WITH counted AS (
    SELECT p.id, p.slug, p.name, ST_Transform(g.marker::geometry, 3857) AS pt, count(*)::integer AS presence
    FROM places p
    JOIN site_geo g ON (g.type, g.id) = ('place', p.id)
    JOIN graph_links l ON (l.object_type, l.object_id) = ('place', p.id)
    JOIN relationship_types rt ON rt.code = l.relationship_type AND rt.is_physical_presence
    WHERE g.marker IS NOT NULL AND (win IS NULL OR l.period && win)
    GROUP BY p.id, p.slug, p.name, g.marker),
  grouped AS (
    SELECT c.*, ST_ClusterDBSCAN(c.pt, eps => radius_px * 156543.03392804097 / power(2, zoom), minpoints => 1) OVER () AS k
    FROM counted c)
  SELECT k, ST_Transform(ST_Centroid(ST_Collect(pt)), 4326), count(*)::integer, sum(presence)::integer,
         jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'presence', presence) ORDER BY presence DESC, name),
         ST_Transform(ST_Envelope(ST_Collect(pt)), 4326)
  FROM grouped GROUP BY k
$$;
COMMENT ON FUNCTION place_clusters IS 'places with presence clustered for a map zoom (091): ST_ClusterDBSCAN in EPSG:3857';
