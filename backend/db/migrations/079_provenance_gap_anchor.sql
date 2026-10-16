-- 079 — Where a gap goes in the provenance table. A gap lies between two owners (provenance_coverage: before / after,
-- chain positions), but steps beside the ownership — an agent at an auction where the work wasn't sold, a deposit —
-- can stand between them and split it (the sale day is "presumed": someone consigned it). Shown after the owner before
-- it, the second half came above the auction it follows. Now: after the last step between the two owners whose dated
-- start is on or before the gap's first day; the owner before it if none.
CREATE FUNCTION provenance_gap_anchor(aid bigint, before_pos int, after_pos int, gap daterange) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT max(c.position) FROM provenance_chain c
    WHERE c.artwork_id = aid AND c.kind = 'step'
      AND c.position > before_pos AND (after_pos IS NULL OR c.position < after_pos)
      AND c.acquired IS NOT NULL AND NOT lower_inf(c.acquired) AND lower(c.acquired) <= lower(gap)), before_pos)
$$;
