-- 258 — A provenance map that ends where the work no longer is (owner 2026-11-23: the Mona Lisa's map ended in Rome,
-- although the work is in the Louvre). Custodians, agents and possessors stand beside the chain (073/083); when the
-- last step is such a step and it ended by a recorded end (the Wiesbaden Central Collecting Point 1945–1953, a museum keeping a work
-- until 1973), the map stopped there, because nothing took the work back.
--   1. provenance_stops(): such a last step gets one more place, as a step's further places do (077): the open owner
--      step's place (its recorded place, else the institution's seat), else the current holder's — basis 'returned',
--      label "returned to <owner>, <end>". The segment to it is a move within the step; the travel distance counts it.
--      The same when the last step still runs and its last record with a place is an exhibition elsewhere (the
--      Tretyakov's Gerasimov shown in New York 2005–2006): 'back at <holder> after the exhibition'.
--   2. Quality check provenance_map_end (warning): the map's last stop lies more than 50 km from the current
--      institution (works on loan left out — they are where the lender sent them — and works whose map has only the
--      place of creation: no provenance entered is not a wrong end). Catches a missing step that the
--      rule above cannot know, e.g. a restitution never entered.
-- Everything else in provenance_stops() is as in 210.
CREATE OR REPLACE FUNCTION provenance_stops(aid bigint)
 RETURNS TABLE(step bigint, steps bigint, provenance_id bigint, chain_kind text, part integer, part_label text, place_id bigint, place_basis text, marker geography)
 LANGUAGE sql
 STABLE
AS $function$
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
    UNION ALL
    -- 258: the last step is a custody, agency or possession that ended — the work went back to its owner: one more
    -- place in the step, the open owner step's (else the current holder's), unless it is where the step already was
    SELECT b.place_id, 'returned', 200, b.label FROM (
      SELECT r.place_id, format('returned to %s%s', r.name, coalesce(', ' || ch.ended_label, '')) AS label FROM (
        (SELECT coalesce(o.location_id, oi.place_id) AS place_id, o.owner_name AS name, 1 AS pref
         FROM provenance_chain o LEFT JOIN institutions oi ON o.owner_type = 'institution' AND oi.id = o.owner_id
         WHERE o.artwork_id = aid AND o.kind = 'step' AND o.role = 'owner' AND upper_inf(o.period) AND o.position < ch.position
         ORDER BY o.position DESC LIMIT 1)
        UNION ALL
        (SELECT ci.place_id, ci.name, 2 FROM artworks cw JOIN institutions ci ON ci.id = cw.current_institution_id WHERE cw.id = aid)
      ) r WHERE r.place_id IS NOT NULL ORDER BY r.pref LIMIT 1
    ) b
    WHERE ch.step = ch.steps AND ch.kind = 'step' AND ch.role IN ('custodian', 'agent', 'possessor')
      AND ch.end_basis = 'recorded'   -- an end the source gives, not one worked out
      AND b.place_id IS DISTINCT FROM coalesce(ch.location_id,
            (SELECT ci.place_id FROM institutions ci WHERE ch.owner_type = 'institution' AND ci.id = ch.owner_id))
    UNION ALL
    -- 258: the last step still runs and its last record with a place is an exhibition elsewhere — back home after it
    SELECT h.place_id, 'returned', 201, format('back at %s after the exhibition', ch.owner_name) FROM (
      SELECT coalesce(ch.location_id, (SELECT ci.place_id FROM institutions ci WHERE ch.owner_type = 'institution' AND ci.id = ch.owner_id)) AS place_id,
             (SELECT x.kind || ':' || x.place_id FROM provenance_records x WHERE x.provenance_id = ch.id AND x.place_id IS NOT NULL
              ORDER BY lower(x.date) DESC NULLS FIRST, x.position DESC LIMIT 1) AS last_record
    ) h
    WHERE ch.step = ch.steps AND ch.kind = 'step' AND ch.end_basis = 'ongoing' AND h.place_id IS NOT NULL
      AND h.last_record LIKE 'exhibition:%' AND h.last_record <> 'exhibition:' || h.place_id
  ) pl
  LEFT JOIN site_geo g ON (g.type, g.id) = ('place', pl.place_id)
$function$;

DO $$
DECLARE
  def text := rtrim(rtrim(pg_get_viewdef('quality_issues_live'::regclass)), ';');
BEGIN
  IF position('provenance_map_end' IN def) > 0 THEN RETURN; END IF;   -- applied
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $v$
UNION ALL
 SELECT 'provenance_map_end'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('prov-map-end:'::text || w.id) AS issue_key,
    format('the provenance map ends in %s, %s km from %s — a step missing?', pl.name,
      round((ST_Distance(last.marker, gi.marker) / 1000)::numeric), i.name) AS detail
   FROM artworks w
     JOIN institutions i ON i.id = w.current_institution_id
     JOIN site_geo gi ON gi.type = 'institution'::entity_type AND gi.id = i.id
     CROSS JOIN LATERAL (SELECT s.place_id, s.marker, s.chain_kind FROM provenance_stops(w.id) s WHERE s.marker IS NOT NULL
                         ORDER BY s.step DESC, s.part DESC LIMIT 1) last
     JOIN places pl ON pl.id = last.place_id
  WHERE NOT w.on_loan AND last.chain_kind <> 'creation' AND ST_Distance(last.marker, gi.marker) > 50000$v$;
END $$;
