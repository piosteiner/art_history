-- 173 — A lost work's provenance ends with its loss too (owner, 2026-10-30: "we end it; if and when they reappear they
-- can be changed"). 170 let `lost` run on until today because its existence is not in doubt, only its whereabouts —
-- but the record of holders ends at the loss, and a gap from then until today says nothing a reader can use. Now
-- `destroyed` and `lost` both end at the fate's date (without one, at the last dated holding); `partly_destroyed`
-- still runs on (its parts are held). When a lost work turns up again, its fate is cleared and the provenance continues.
-- Same signature and result as before: CREATE OR REPLACE keeps provenance_completeness depending on it.
CREATE OR REPLACE FUNCTION provenance_coverage(aid bigint)
 RETURNS TABLE(kind text, period daterange, in_1933_1945 boolean, before_name text, after_name text, candidates text[], before_position integer, after_position integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH s AS (SELECT * FROM provenance_spans WHERE artwork_id = aid),
  -- documented custody shows where it was too: a deposit, a loan (dates on both sides), the current loan
  cust AS (
    SELECT CASE WHEN upper(p.acquired) - 1 < lower(p.ended) THEN daterange(upper(p.acquired) - 1, lower(p.ended)) END AS r,
           CASE WHEN lower(p.acquired) < upper(p.ended) THEN daterange(lower(p.acquired), upper(p.ended)) END AS presumed
    FROM provenance_periods p
     WHERE p.artwork_id = aid AND NOT p.in_chain AND p.role <> 'event' AND p.acquired IS NOT NULL AND p.ended IS NOT NULL
    UNION ALL
    SELECT daterange(lower(w.on_loan_since), current_date + 1), daterange(lower(w.on_loan_since), current_date + 1) FROM artworks w
     WHERE w.id = aid AND w.on_loan AND lower(w.on_loan_since) < current_date + 1),
  -- the start: the creation, or the earliest dated holding — the range only when that start is before the end
  life_start AS (
    SELECT least(lower(w.created), (SELECT min(lower(coalesce(s.presumed, s.documented))) FROM s)) AS lo
    FROM artworks w WHERE w.id = aid),
  -- the end: today — or, for a destroyed or lost work, its destruction or loss (else its last dated holding), never after today (170, 173)
  life_end AS (
    SELECT least(current_date + 1, CASE WHEN w.fate IN ('destroyed', 'lost') THEN coalesce(
             upper(w.fate_date), (SELECT max(upper(coalesce(s.documented, s.presumed))) FROM s)) END) AS hi
    FROM artworks w WHERE w.id = aid),
  life AS (SELECT CASE WHEN lo < hi THEN daterange(lo, hi) END AS r FROM life_start, life_end),
  -- without a start (no date, no dated provenance — or one only in the future) there is nothing to measure
  life_ok AS (SELECT r FROM life WHERE r IS NOT NULL AND lower(r) IS NOT NULL AND lower(r) < upper(r)),
  dm AS (SELECT coalesce(range_agg(x.r), '{}'::datemultirange) * datemultirange(life.r) AS m
         FROM life_ok life, (SELECT documented AS r FROM s WHERE documented IS NOT NULL UNION ALL SELECT r FROM cust WHERE r IS NOT NULL) x GROUP BY life.r),
  pm AS (SELECT (coalesce(range_agg(x.r), '{}'::datemultirange) * datemultirange(life.r)) - coalesce(dm.m, '{}') AS m
         FROM life_ok life LEFT JOIN dm ON true
         LEFT JOIN (SELECT presumed AS r FROM s WHERE presumed IS NOT NULL UNION ALL SELECT presumed FROM cust WHERE presumed IS NOT NULL) x ON true
         GROUP BY life.r, dm.m),
  gm AS (SELECT datemultirange(life.r) - coalesce(dm.m, '{}') - coalesce(pm.m, '{}') AS m FROM life_ok life LEFT JOIN dm ON true LEFT JOIN pm ON true)
  SELECT 'documented', x, x && daterange('1933-01-30', '1945-05-09'), NULL, NULL, NULL::text[], NULL::integer, NULL::integer FROM dm, unnest(dm.m) x
  UNION ALL
  SELECT 'presumed', x, x && daterange('1933-01-30', '1945-05-09'), NULL, NULL, NULL, NULL, NULL FROM pm, unnest(pm.m) x
  UNION ALL
  -- a gap: who held it before and after, and the holders known only without dates who may have held it then
  SELECT 'gap', x, x && daterange('1933-01-30', '1945-05-09'), b.owner_name, a.owner_name,
         (SELECT array_agg(c.owner_name ORDER BY c.position) FROM s c
           WHERE c.presumed IS NULL AND c.documented IS NULL
             AND c.position > coalesce(b.position, -2147483648) AND c.position < coalesce(a.position, 2147483647)),
         b.position, a.position
  FROM gm, unnest(gm.m) x
  LEFT JOIN LATERAL (SELECT * FROM s WHERE upper(coalesce(s.presumed, s.documented)) <= lower(x) ORDER BY s.position DESC LIMIT 1) b ON true
  LEFT JOIN LATERAL (SELECT * FROM s WHERE lower(coalesce(s.presumed, s.documented)) >= upper(x) ORDER BY s.position LIMIT 1) a ON true
  ORDER BY 2
$function$;

-- the stored figures (129) of the lost works follow on the worker's next pass
INSERT INTO derived_queue (type, id, reason) SELECT 'artwork', id, 'full' FROM artworks WHERE fate = 'lost';
