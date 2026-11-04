-- 210 — Where a work was made, when nobody recorded it (091/104: the map's first stop, "probably"): the artist's stay
-- that covers most of the creation span, not only an unambiguous one.
--
-- Until now the rule was: the one stay overlapping the creation dates, else the artist's one undated workplace. An
-- artist with two overlapping stays got nothing from the first rule and fell to the second — Velázquez's "Surrender
-- of Breda" (1630–1635) overlaps his Madrid years 1622–1660 and his Naples winter 1630–31, so the map started it in
-- Venice, his only undated workplace. Now every overlapping stay is measured (the days of its intersection with the
-- creation span — `period * created` is the intersection of two ranges, upper − lower its length) and the longest
-- wins; only a tie between the longest two still gives nothing. Window functions do the choosing in one pass: the
-- rows with the greatest length are kept, and `count(*) OVER ()` says whether that is one row or several.
-- Everything else in provenance_stops() is as in 104.
CREATE OR REPLACE FUNCTION provenance_stops(aid bigint)
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
      -- the stay covering most of the creation span (several stays at one place add up); a tie = no answer
      (SELECT place_id, 'artist_residence', 2 FROM (
         SELECT s.place_id, s.days, max(s.days) OVER () AS best, count(*) OVER (PARTITION BY s.days) AS as_long FROM (
           SELECT x.object_id AS place_id,
                  sum(coalesce(upper(x.period * w.created) - lower(x.period * w.created), 0)) AS days
           FROM artworks w
           JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                       AND x.period && w.created
           JOIN relationship_types rt ON rt.code = x.relationship_type AND rt.is_physical_presence
           WHERE w.id = ch.artwork_id GROUP BY x.object_id) s
       ) t WHERE t.days = t.best AND t.as_long = 1)
      UNION ALL
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
    UNION ALL
    -- 104: the records' places where they change
    SELECT r.place_id, 'recorded', 100 + r.n, r.date_label FROM (
      SELECT x.place_id, x.date_label, row_number() OVER w AS n, lag(x.place_id) OVER w AS prev
      FROM provenance_records x WHERE x.provenance_id = ch.id AND x.place_id IS NOT NULL AND ch.kind = 'step'
      WINDOW w AS (ORDER BY lower(x.date) NULLS LAST, x.position)) r
    WHERE r.place_id IS DISTINCT FROM coalesce(r.prev, ch.location_id)
  ) pl
  LEFT JOIN site_geo g ON (g.type, g.id) = ('place', pl.place_id)
$$;
