-- 203 — Crossed paths of one entry without everyone's (perf, 2026-11-03). encounters(…, etype, eid) (091) computed every
-- dated stay of everyone (25,000 on the perf data: 0.5 s) and all their pairs, then kept those of the one entry: 1.9 s
-- for Goya (budget 1.5 s), the entry pages' "Crossed paths". With an entry, now: its own stays, then the others' stays
-- only at its places (within_km 0: an index on the places) or within the distance of them, paired in the same order as
-- before ((a_type, a_id) < (b_type, b_id)). Without an entry: the query of 091 unchanged.
CREATE OR REPLACE FUNCTION encounters(win daterange DEFAULT NULL::daterange, within_km numeric DEFAULT 0, etype entity_type DEFAULT NULL::entity_type, eid bigint DEFAULT NULL::bigint)
 RETURNS TABLE(a_type entity_type, a_id bigint, b_type entity_type, b_id bigint, a_place bigint, b_place bigint, venue_type entity_type, venue_id bigint, overlap daterange, km integer, approximate boolean, a_relationship text, b_relationship text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF etype IS NULL THEN
    RETURN QUERY
    WITH stays AS MATERIALIZED (
      SELECT e.subject_type AS t, e.subject_id AS id, e.relationship_type AS rel, e.object_type AS vt, e.object_id AS vid,
             g.place_id, coalesce(g.marker, pg.marker) AS marker,
             e.period * daterange(NULL, current_date + 1) * coalesce(win, '(,)') AS period,
             coalesce(e.period_label, '') ~* '^\s*(c\.\s*)?-?\d{1,4}(\s*[–-]\s*-?\d{1,4})?\s*$|c\.|century|circa|ca\.' AS coarse
      FROM graph_links e
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
    JOIN stays y ON (x.t, x.id) < (y.t, y.id)
                AND x.period && y.period
                AND (x.place_id = y.place_id OR (within_km > 0 AND ST_DWithin(x.marker, y.marker, within_km * 1000)))
    WHERE NOT isempty(x.period * y.period)
      AND NOT (x.t = 'artwork' AND y.t = 'artwork')
      AND NOT (x.t = 'artist' AND y.t = 'artwork' AND (
            EXISTS (SELECT 1 FROM artworks w WHERE w.id = y.id AND w.creator_id = x.id)
            OR EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id, r.relationship_type, r.object_type, r.object_id)
                                                         = ('artwork', y.id, 'co_creator', 'artist', x.id))));
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS MATERIALIZED (
    -- the entry's own dated stays
    SELECT e.subject_type AS t, e.subject_id AS id, e.relationship_type AS rel, e.object_type AS vt, e.object_id AS vid,
           g.place_id, coalesce(g.marker, pg.marker) AS marker,
           e.period * daterange(NULL, current_date + 1) * coalesce(win, '(,)') AS period,
           coalesce(e.period_label, '') ~* '^\s*(c\.\s*)?-?\d{1,4}(\s*[–-]\s*-?\d{1,4})?\s*$|c\.|century|circa|ca\.' AS coarse
    FROM graph_links e
    JOIN relationship_types rt ON rt.code = e.relationship_type AND rt.is_physical_presence
    JOIN site_geo g ON (g.type, g.id) = (e.object_type, e.object_id)
    LEFT JOIN site_geo pg ON (pg.type, pg.id) = ('place', g.place_id)
    WHERE e.subject_type = etype AND e.subject_id = eid
      AND e.period IS NOT NULL AND NOT lower_inf(e.period) AND e.subject_type IN ('artist', 'person', 'artwork')
      AND (win IS NULL OR e.period && win) AND g.place_id IS NOT NULL),
  at AS MATERIALIZED (SELECT DISTINCT m.place_id, m.marker FROM mine m),
  -- the sites at the entry's places, or within the distance of them: whose stays can meet the entry's
  sites AS MATERIALIZED (
    SELECT g.type, g.id, g.place_id, coalesce(g.marker, pg.marker) AS marker
    FROM site_geo g LEFT JOIN site_geo pg ON (pg.type, pg.id) = ('place', g.place_id)
    WHERE g.place_id IN (SELECT a.place_id FROM at a)
    UNION
    SELECT g.type, g.id, g.place_id, coalesce(g.marker, pg.marker)
    FROM site_geo g LEFT JOIN site_geo pg ON (pg.type, pg.id) = ('place', g.place_id)
    WHERE within_km > 0 AND g.place_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM at a WHERE ST_DWithin(coalesce(g.marker, pg.marker), a.marker, within_km * 1000))),
  others AS MATERIALIZED (
    SELECT e.subject_type AS t, e.subject_id AS id, e.relationship_type AS rel, e.object_type AS vt, e.object_id AS vid,
           s.place_id, s.marker,
           e.period * daterange(NULL, current_date + 1) * coalesce(win, '(,)') AS period,
           coalesce(e.period_label, '') ~* '^\s*(c\.\s*)?-?\d{1,4}(\s*[–-]\s*-?\d{1,4})?\s*$|c\.|century|circa|ca\.' AS coarse
    FROM sites s
    JOIN graph_links e ON (e.object_type, e.object_id) = (s.type, s.id)
    JOIN relationship_types rt ON rt.code = e.relationship_type AND rt.is_physical_presence
    WHERE e.period IS NOT NULL AND NOT lower_inf(e.period) AND e.subject_type IN ('artist', 'person', 'artwork')
      AND (win IS NULL OR e.period && win)),
  -- each meeting with the lower (type, id) as x, as the query without an entry orders them
  pairs AS (
    SELECT m.t AS xt, m.id AS xid, m.rel AS xrel, m.vt AS xvt, m.vid AS xvid, m.place_id AS xplace, m.marker AS xmarker, m.period AS xperiod, m.coarse AS xcoarse,
           o.t AS yt, o.id AS yid, o.rel AS yrel, o.vt AS yvt, o.vid AS yvid, o.place_id AS yplace, o.marker AS ymarker, o.period AS yperiod, o.coarse AS ycoarse
    FROM mine m JOIN others o ON (m.t, m.id) < (o.t, o.id)
    UNION ALL
    SELECT o.t, o.id, o.rel, o.vt, o.vid, o.place_id, o.marker, o.period, o.coarse,
           m.t, m.id, m.rel, m.vt, m.vid, m.place_id, m.marker, m.period, m.coarse
    FROM mine m JOIN others o ON (o.t, o.id) < (m.t, m.id))
  SELECT DISTINCT p.xt, p.xid, p.yt, p.yid, p.xplace, p.yplace,
         CASE WHEN p.xvt <> 'place' AND (p.xvt, p.xvid) = (p.yvt, p.yvid) THEN p.xvt END,
         CASE WHEN p.xvt <> 'place' AND (p.xvt, p.xvid) = (p.yvt, p.yvid) THEN p.xvid END,
         p.xperiod * p.yperiod,
         CASE WHEN p.xplace = p.yplace THEN 0 ELSE round(ST_Distance(p.xmarker, p.ymarker) / 1000)::integer END,
         p.xcoarse OR p.ycoarse, p.xrel, p.yrel
  FROM pairs p
  WHERE p.xperiod && p.yperiod
    AND (p.xplace = p.yplace OR (within_km > 0 AND ST_DWithin(p.xmarker, p.ymarker, within_km * 1000)))
    AND NOT isempty(p.xperiod * p.yperiod)
    AND NOT (p.xt = 'artwork' AND p.yt = 'artwork')
    AND NOT (p.xt = 'artist' AND p.yt = 'artwork' AND (
          EXISTS (SELECT 1 FROM artworks w WHERE w.id = p.yid AND w.creator_id = p.xid)
          OR EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id, r.relationship_type, r.object_type, r.object_id)
                                                       = ('artwork', p.yid, 'co_creator', 'artist', p.xid))));
END
$function$;
