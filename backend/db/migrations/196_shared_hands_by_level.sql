-- 196 — "Through the same hands" level by level (2026-11-03). shared_hands() (088) paired every two works of every
-- holder in the whole database before following any of them — n² per holder, on each request. With the Bührle
-- collection (Bührle 209 works, his foundation 204) that took 9 s for one work and the API gave up after 5 (the
-- site's section stayed empty, its Pages build failed). Now it starts from the one work and goes out a level at a time:
-- the holders of the works reached so far, their other works not yet seen — only the pairs that lead somewhere new.
-- Same answer, same columns: for each work reached, the nearest level, the work of the level before it came through
-- (the one with most holders in common, held together first) and the holders they share.
--
-- PL/pgSQL rather than one recursive CTE: a recursive query can't keep "seen in an earlier level" — UNION only drops
-- rows equal in every column — so each level would grow again from everything reached before. Arrays of ids carry the
-- frontier and the works seen from one level to the next; a level's rows are gathered into arrays, returned from them,
-- and its works become the next frontier.
CREATE OR REPLACE FUNCTION shared_hands(start bigint, max_depth integer DEFAULT 2, with_current boolean DEFAULT false)
RETURNS TABLE (artwork_id bigint, depth integer, via_artwork_id bigint, holders jsonb, together boolean)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  frontier bigint[] := ARRAY[start];
  seen bigint[] := ARRAY[start];
  d integer := 0;
  bs bigint[]; vias bigint[]; hs jsonb[]; togs boolean[];
BEGIN
  WHILE d < least(max_depth, 4) AND cardinality(frontier) > 0 LOOP
    d := d + 1;
    WITH hold_from AS (
        -- who held the works of this level, when (owners and custodians); not the artist who made it
        SELECT l.subject_id AS a, l.object_type AS t, l.object_id AS id, l.period, coalesce(upper_inf(l.period), false) AS ongoing
        FROM graph_links l JOIN artworks w ON w.id = l.subject_id
        WHERE l.subject_type = 'artwork' AND l.subject_id = ANY (frontier) AND l.relationship_type IN ('owned_by', 'held_by')
          AND NOT (l.object_type = 'artist' AND l.object_id IS NOT DISTINCT FROM w.creator_id)),
      pairs AS (
        -- their other works not seen yet, per holder; together: held at the same time
        SELECT h.a, l.subject_id AS b, h.t, h.id, bool_or(coalesce(h.period && l.period, false)) AS together
        FROM hold_from h
        JOIN graph_links l ON (l.object_type, l.object_id) = (h.t, h.id) AND l.subject_type = 'artwork'
             AND l.relationship_type IN ('owned_by', 'held_by')
        JOIN artworks w ON w.id = l.subject_id
        WHERE NOT l.subject_id = ANY (seen)
          AND NOT (l.object_type = 'artist' AND l.object_id IS NOT DISTINCT FROM w.creator_id)
          AND (with_current OR NOT (h.ongoing AND coalesce(upper_inf(l.period), false)))
        GROUP BY h.a, l.subject_id, h.t, h.id),
      ways AS (
        SELECT p.a, p.b, count(*) AS n, bool_or(p.together) AS together,
               jsonb_agg(jsonb_build_object('type', p.t, 'id', p.id, 'together', p.together) ORDER BY p.together DESC, p.t, p.id) AS holders
        FROM pairs p GROUP BY p.a, p.b)
      -- the way from the level before: the one with most holders in common, held together first
      SELECT array_agg(s.b), array_agg(s.a), array_agg(s.holders), array_agg(s.together) INTO bs, vias, hs, togs
      FROM (SELECT DISTINCT ON (x.b) x.b, x.a, x.holders, x.together FROM ways x ORDER BY x.b, x.n DESC, x.together DESC, x.a) s;
    RETURN QUERY SELECT u.b, d, u.a, u.h, u.t FROM unnest(bs, vias, hs, togs) AS u(b, a, h, t);
    -- the works this level reached are the next frontier
    frontier := coalesce(bs, '{}');
    seen := seen || frontier;
  END LOOP;
END $$;
COMMENT ON FUNCTION shared_hands(bigint, integer, boolean) IS
  'Works that went through the same hands as one work, level by level (088; 196: from the one work out, not all pairs first).';
