-- 144 — The works of one group are never duplicates of each other (owner, 2026-10-27: the Saint Matthew cycle in the
-- Contarelli Chapel — "Das sollte von dem Serien/Versionen Feature berücksichtigt werden"). A whole and its parts share
-- words and the creator, versions are named alike on purpose, the parts of a series often too ("Sunflowers") — the
-- duplicate check flagged them all. Two artworks belong to one group when one is an ancestor of the other or they share
-- an ancestor, at any depth (a version in a versions group inside a cycle).
--   artworks_in_one_group(a, b)   both artworks' ancestors by a recursive CTE (parent_id upwards, the start included)
--   possible_duplicate            in quality_issues_live: such pairs left out

CREATE FUNCTION artworks_in_one_group(a bigint, b bigint) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH RECURSIVE up(start, id, depth) AS (
    SELECT s, s, 0 FROM unnest(ARRAY[a, b]) AS s
    UNION ALL
    SELECT up.start, w.parent_id, up.depth + 1 FROM up JOIN artworks w ON w.id = up.id
    WHERE w.parent_id IS NOT NULL AND up.depth < 20
  )
  SELECT EXISTS (SELECT 1 FROM up x JOIN up y ON x.id = y.id WHERE x.start = a AND y.start = b)
$$;
COMMENT ON FUNCTION artworks_in_one_group(bigint, bigint) IS 'one is part of the other, or both are parts of one group, at any depth (144)';

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  patched text;
BEGIN
  patched := regexp_replace(def, $p$(format\('probably the same as %s \(%s\) — %s \(score %s\)'::text, p\.b_name, p\.b_slug, array_to_string\(p\.reasons, ', '::text\), p\.score\) AS detail\s+FROM dup_pairs p)$p$,
    $r$\1
  WHERE NOT (p.type = 'artwork'::entity_type AND artworks_in_one_group(p.a_id, p.b_id))$r$);
  IF patched = def THEN RAISE EXCEPTION 'quality_issues_live: the possible_duplicate check was not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || patched;
END $$;
