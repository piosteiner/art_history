-- 161 — Which polity a place belonged to, and when (owner, 2026-10-29, places plan step E). Places are today's
-- geography; polities (019) the states over time. A dated relationship place —in_polity→ polity says it; it is
-- inherited down the hierarchy: "France belonged to the Second French Empire 1852–1870" holds for every French place,
-- and a link further down wins where there is one ("Bas-Rhin belonged to the German Empire 1871–1918").
--   polities_at(place, span)   the polities of the nearest place up the parents that has links overlapping the span —
--                              a recursive CTE over parent_id; several rows when the span crosses a change
--   succeeded_by               polity → polity, place → place, institution → institution: the Weimar Republic by Nazi
--                              Germany, Tokyo City by Tokyo (dated: when)
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, description, sort_order)
VALUES
  ('in_polity', 'belonged to', 'territory included', 'polity', false, false, '{place}', '{polity}',
   'A place''s state at a time (with its period): inherited by the places under it, a link further down wins (161).', 70),
  ('succeeded_by', 'succeeded by', 'successor of', 'association', false, false, '{polity,place,institution}', '{polity,place,institution}',
   'The entry that took its place — a state, a merged city, a renamed firm (161); dated: when.', 71);

-- the whole timeline: from the place up, each level's links count only for the time no level below covers — range
-- arithmetic on datemultirange: what a link says minus what is already said (Strasbourg: the German Empire 1871–1918
-- from Bas-Rhin, France's regimes before and after). Rows: the polity, one piece of time, the place that says it.
CREATE FUNCTION polity_timeline(pid bigint)
RETURNS TABLE (polity_id bigint, period daterange, via_place_id bigint, relationship_id bigint, depth int)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  covered datemultirange := '{}';
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
COMMENT ON FUNCTION polity_timeline(bigint) IS 'the polities a place belonged to over time, inherited down the parents, the nearest link winning (161)';

-- the polities during a span (a relationship's dates): the timeline's pieces that overlap it
CREATE FUNCTION polities_at(pid bigint, during daterange)
RETURNS TABLE (polity_id bigint, period daterange, via_place_id bigint, relationship_id bigint)
LANGUAGE sql STABLE AS $$
  SELECT t.polity_id, t.period, t.via_place_id, t.relationship_id FROM polity_timeline(pid) t
  WHERE during IS NULL OR t.period && during ORDER BY lower(t.period) NULLS FIRST;
$$;
COMMENT ON FUNCTION polities_at(bigint, daterange) IS 'the polities a place belonged to during a span (161)';
