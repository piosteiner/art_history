-- 095 — A provenance date in the future no longer breaks the artwork lists. provenance_coverage (078) measured an
-- artwork's "life" as daterange(earliest known date, today + 1) and only then dropped empty ones — with a start after
-- today (a step dated in the future, e.g. a typo in the year) daterange() itself raised "range lower bound must be less
-- than or equal to range upper bound", and with it provenance_completeness and every list that reads it
-- (/v1/artworks, the admin's artwork pages). Now the range is only built when its start lies before tomorrow; a life
-- that would start later has nothing to measure yet (no coverage rows, as for an undated provenance).
-- Same signature and result as before: CREATE OR REPLACE keeps provenance_completeness depending on it.
CREATE OR REPLACE FUNCTION provenance_coverage(aid bigint)
RETURNS TABLE (kind text, period daterange, in_1933_1945 boolean, before_name text, after_name text, candidates text[],
               before_position integer, after_position integer)
LANGUAGE sql STABLE AS $$
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
  -- the start: the creation, or the earliest dated holding — the range only when that start is not after today
  life_start AS (
    SELECT least(lower(w.created), (SELECT min(lower(coalesce(s.presumed, s.documented))) FROM s)) AS lo
    FROM artworks w WHERE w.id = aid),
  life AS (SELECT CASE WHEN lo < current_date + 1 THEN daterange(lo, current_date + 1) END AS r FROM life_start),
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
$$;
