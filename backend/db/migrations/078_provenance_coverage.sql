-- 078 — Where the provenance is silent (owner: highlight missing links and time periods). For every artwork, its time
-- since the creation split into
--   documented — someone demonstrably held it: from a holder's latest possible acquisition to the earliest possible
--                end (a recorded end, or the next acquisition when that handover is documented as direct; today for the
--                current holder); documented custody (a deposit, a loan) counts too: we know where it was;
--   presumed   — a holder is known but the edges are not: from the earliest possible acquisition to a recorded end,
--                else the next acquisition;
--   gap        — no holder known at all. A gap names the holders before and after it and the ones known only without
--                dates ("candidates") who may have held it then; in_1933_1945 when it touches 30 January 1933 – 8 May 1945.
-- Multirange arithmetic (PostgreSQL 14+): range_agg() merges periods into one datemultirange, "-" subtracts one from
-- another (life − documented − presumed = the gaps), "*" intersects (the share in 1933–1945), unnest() gives the
-- pieces back as ranges.

-- per holding of the ownership chain (the creator included): documented and presumed time
CREATE VIEW provenance_spans AS
SELECT c.artwork_id, c.position, c.id AS step_id, c.kind, c.owner_name, c.role,
       CASE WHEN d.lo < d.hi THEN daterange(d.lo, d.hi) END AS documented,
       CASE WHEN pr.lo < pr.hi THEN daterange(pr.lo, pr.hi) END AS presumed,
       (c.acquired IS NULL AND c.ended IS NULL) AS undated
FROM provenance_chain c
-- the next holder of the chain (a settlement goes on with the same owner): when they acquired it, and whether the
-- handover to them is documented as direct
LEFT JOIN LATERAL (SELECT n.acquired, n.direct FROM provenance_chain n
                   WHERE n.artwork_id = c.artwork_id AND n.position > c.position AND n.in_chain AND n.method <> 'settlement'
                   ORDER BY n.position LIMIT 1) nx ON true
CROSS JOIN LATERAL (SELECT
    -- documented: from the latest possible acquisition to the earliest possible end
    upper(c.acquired) - 1 AS lo,
    coalesce(CASE WHEN c.ended IS NOT NULL THEN lower(c.ended) END,
             CASE WHEN nx.direct THEN lower(nx.acquired) END,
             CASE WHEN c.end_basis = 'ongoing' THEN current_date + 1 END) AS hi) d
CROSS JOIN LATERAL (SELECT
    -- presumed: from the earliest possible acquisition to a recorded end, else the next acquisition, else today for
    -- the current holder, else the end of the acquisition's own window
    coalesce(lower(c.acquired), upper(c.acquired) - 1, lower(c.ended), upper(c.ended) - 1) AS lo,
    coalesce(upper(c.ended), CASE WHEN c.ended IS NOT NULL THEN lower(c.ended) + 1 END, lower(nx.acquired),
             CASE WHEN c.end_basis = 'ongoing' THEN current_date + 1 END, upper(c.acquired)) AS hi) pr
WHERE c.in_chain;

-- An artwork's time since its creation, in order: documented / presumed / gap (multirange arithmetic).
CREATE FUNCTION provenance_coverage(aid bigint)
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
  life AS (
    SELECT daterange(least(lower(w.created), (SELECT min(lower(coalesce(s.presumed, s.documented))) FROM s)), current_date + 1) AS r
    FROM artworks w WHERE w.id = aid),
  -- without a start (no date, no dated provenance) there is nothing to measure
  life_ok AS (SELECT r FROM life WHERE lower(r) IS NOT NULL AND lower(r) < upper(r)),
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

-- In figures, per artwork: for lists, filters, a research ranking
CREATE VIEW provenance_completeness AS
SELECT w.id AS artwork_id, EXISTS (SELECT 1 FROM provenance p WHERE p.artwork_id = w.id) AS has_provenance, c.life_days, c.documented_days, c.presumed_days, c.gap_days, c.gap_1933_1945_days,
       CASE WHEN c.life_days > 0 THEN round(100.0 * c.documented_days / c.life_days)::int END AS documented_percent
FROM artworks w
CROSS JOIN LATERAL (
  SELECT sum(upper(period) - lower(period)) AS life_days,
         coalesce(sum(upper(period) - lower(period)) FILTER (WHERE kind = 'documented'), 0) AS documented_days,
         coalesce(sum(upper(period) - lower(period)) FILTER (WHERE kind = 'presumed'), 0) AS presumed_days,
         coalesce(sum(upper(period) - lower(period)) FILTER (WHERE kind = 'gap'), 0) AS gap_days,
         coalesce(sum(upper(period * daterange('1933-01-30', '1945-05-09')) - lower(period * daterange('1933-01-30', '1945-05-09')))
                  FILTER (WHERE kind = 'gap' AND in_1933_1945), 0) AS gap_1933_1945_days
  FROM provenance_coverage(w.id)) c;
