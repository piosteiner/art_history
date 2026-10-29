-- 163 — A place's polities only while it existed (owner, 2026-10-29: "wie kann Tokyo City, which existed only from 1889,
-- have been part of the Kamakura shogunate?"). polity_timeline() (161) inherited every link from the places above
-- without asking when the place itself existed (159): a unit dissolved or founded within a country's history got the
-- country's whole chain. Now the time outside places.existed counts as covered from the start — a datemultirange
-- complement, '{(,)}' minus the existence — so no level's link reaches into it. Places without `existed` are unchanged.
CREATE OR REPLACE FUNCTION polity_timeline(pid bigint)
 RETURNS TABLE(polity_id bigint, period daterange, via_place_id bigint, relationship_id bigint, depth integer)
 LANGUAGE plpgsql STABLE
AS $$
DECLARE
  covered datemultirange := coalesce((SELECT '{(,)}'::datemultirange - datemultirange(p.existed) FROM places p WHERE p.id = pid AND p.existed IS NOT NULL), '{}');
  level_cover datemultirange;
  lvl record; r record; piece daterange;
BEGIN
  FOR lvl IN
    WITH RECURSIVE up(id, parent_id, d) AS (
      SELECT id, parent_id, 0 FROM places WHERE id = pid
      UNION ALL
      SELECT p.id, p.parent_id, up.d + 1 FROM up JOIN places p ON p.id = up.parent_id WHERE up.d < 20)
    SELECT id, d FROM up ORDER BY d
  LOOP
    level_cover := '{}';
    FOR r IN SELECT x.id, x.object_id, coalesce(x.period, '(,)'::daterange) AS period FROM relationships x
              WHERE x.subject_type = 'place' AND x.subject_id = lvl.id AND x.relationship_type = 'in_polity' AND x.object_type = 'polity'
              ORDER BY lower(x.period) NULLS FIRST LOOP
      FOR piece IN SELECT unnest(datemultirange(r.period) - covered) LOOP
        polity_id := r.object_id; period := piece; via_place_id := lvl.id; relationship_id := r.id; depth := lvl.d;
        RETURN NEXT;
      END LOOP;
      level_cover := level_cover + datemultirange(r.period);
    END LOOP;
    covered := covered + level_cover;   -- a level's own links don't hide each other, only the levels above
  END LOOP;
END $$;
