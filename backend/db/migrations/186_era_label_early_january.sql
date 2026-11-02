-- 186: two corrections to the era dates of 185.
-- 1. era_label() read every range starting on 1 January as a whole year and moved its start to the lunar new year —
--    "January 1181" (the burning of Nara, before that new year) got a start after its end and failed. Only a range of
--    about a year or more (≥ 330 days) is read as the lunar year now; a month like "January 1181" spans "Jishō 4–5".
--    And the end of a range takes only an era whose year 1 has begun by then: an era Wikidata dates to a month only
--    starts on its 1st, perhaps still in the old lunar year ("Heiji 1 / Eiryaku 0" for January 1160 → "Heiji 1").
-- 2. lunar_new_years: in 13 of the years 640–1912 a leap month fell between the 11th month and the new year, which
--    then came a month later (1852: 20 February, not 21 January). Computed again with the leap-month rule (a lunar
--    month without a major solar term — the sun's longitude a multiple of 30° — is the leap month); checked against 37
--    known Chinese new years 1831–2033 (35 the same day, two a day apart: Beijing time against Japan time). No era or
--    reign begins in those weeks.
CREATE OR REPLACE FUNCTION era_label(cal text, d daterange) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT lower(d) AS f0, upper(d) - 1 AS t
    WHERE cal IS NOT NULL AND NOT isempty(d) AND lower(d) IS NOT NULL AND upper(d) IS NOT NULL
  ),
  b AS (
    -- a range from a 1 January before the solar calendar starts with that year's lunar new year
    -- (a whole year or more: "January 1181" keeps its 1 January)
    SELECT CASE WHEN extract(doy FROM r.f0) = 1 AND r.f0 < solar_since(cal) AND r.t - r.f0 >= 330
                THEN least(coalesce((SELECT n.day FROM lunar_new_years n WHERE n.year = extract(year FROM r.f0)::int), r.f0), r.t) ELSE r.f0 END AS f,
           r.t, r.f0
    FROM r
  ),
  y AS (SELECT b.*, daterange(b.f, b.t, '[]') AS span FROM b),
  -- per line the first and the last era in effect within the range; each end's year kept within its era (the whole
  -- year 1910 in Korea is Yunghui 4: the empire ended in August)
  ends AS (
    SELECT l.line, s0.s, e0.e,
           greatest(lunar_year(cal, greatest(y.f, (s0.s).starts)), (s0.s).year_one) AS sy,
           lunar_year(cal, least(y.t, coalesce((e0.e).ends - 1, y.t))) AS ey
    FROM y
    CROSS JOIN LATERAL (SELECT DISTINCT x.line FROM calendar_eras x WHERE x.calendar = cal AND x.period && y.span) l
    CROSS JOIN LATERAL (SELECT x AS s FROM calendar_eras x WHERE x.calendar = cal AND x.line = l.line AND x.period && y.span ORDER BY x.starts LIMIT 1) s0
    CROSS JOIN LATERAL (SELECT x AS e FROM calendar_eras x WHERE x.calendar = cal AND x.line = l.line AND x.period && y.span
                          AND x.year_one <= lunar_year(cal, least(y.t, coalesce(x.ends - 1, y.t)))   -- its year 1 has begun
                        ORDER BY x.starts DESC LIMIT 1) e0
    WHERE lunar_year(cal, y.t) - lunar_year(cal, y.f) <= 60
  ),
  per_line AS (
    SELECT n.line,
           CASE WHEN (n.s).id = (n.e).id AND n.sy = n.ey THEN era_year_text(n.s, n.sy, 'name')
                WHEN (n.s).id = (n.e).id THEN era_year_text(n.s, n.sy, 'name') || '–' || (n.ey - (n.e).year_one + 1)
                ELSE era_year_text(n.s, n.sy, 'name') || CASE WHEN n.sy = n.ey THEN ' / ' ELSE ' – ' END || era_year_text(n.e, n.ey, 'name') END AS label,
           CASE WHEN (n.s).id = (n.e).id AND n.sy = n.ey THEN era_year_text(n.s, n.sy, 'native')
                WHEN (n.s).id = (n.e).id THEN era_year_text(n.s, n.sy, 'native') || '–' || (n.ey - (n.e).year_one + 1) || '年'
                ELSE era_year_text(n.s, n.sy, 'native') || CASE WHEN n.sy = n.ey THEN ' / ' ELSE '–' END || era_year_text(n.e, n.ey, 'native') END AS native,
           CASE WHEN (n.s).hangul IS NULL OR (n.e).hangul IS NULL THEN NULL
                WHEN (n.s).id = (n.e).id AND n.sy = n.ey THEN era_year_text(n.s, n.sy, 'hangul')
                WHEN (n.s).id = (n.e).id THEN era_year_text(n.s, n.sy, 'hangul') || '–' || (n.ey - (n.e).year_one + 1) || '년'
                ELSE era_year_text(n.s, n.sy, 'hangul') || CASE WHEN n.sy = n.ey THEN ' / ' ELSE ' – ' END || era_year_text(n.e, n.ey, 'hangul') END AS hangul,
           n.sy, n.ey
    FROM ends n
    WHERE n.sy <= n.ey
  )
  SELECT jsonb_build_object(
           'calendar', cal,
           'parts', jsonb_agg(jsonb_strip_nulls(jsonb_build_object('line', nullif(p.line, ''), 'label', p.label, 'native', p.native, 'hangul', p.hangul))
                              ORDER BY p.line <> '', p.line),
           'sexagenary', CASE WHEN min(p.sy) = max(p.ey) THEN sexagenary_year(min(p.sy)) END,
           -- a given day within two days of a computed new year, before the solar calendar
           'approx', bool_or(y.t < solar_since(cal) AND y.t - y.f0 < 360 AND EXISTS (SELECT 1 FROM lunar_new_years n
                       WHERE abs(n.day - y.f0) <= 2 OR abs(n.day - y.t) <= 2)))
  FROM per_line p CROSS JOIN y
  HAVING count(*) > 0
$$;


UPDATE lunar_new_years SET day = '0641-02-19' WHERE year = 641;
UPDATE lunar_new_years SET day = '0660-02-19' WHERE year = 660;
UPDATE lunar_new_years SET day = '0679-02-19' WHERE year = 679;
UPDATE lunar_new_years SET day = '0918-02-19' WHERE year = 918;
UPDATE lunar_new_years SET day = '0937-02-19' WHERE year = 937;
UPDATE lunar_new_years SET day = '1032-02-20' WHERE year = 1032;
UPDATE lunar_new_years SET day = '1127-02-20' WHERE year = 1127;
UPDATE lunar_new_years SET day = '1309-02-19' WHERE year = 1309;
UPDATE lunar_new_years SET day = '1404-02-20' WHERE year = 1404;
UPDATE lunar_new_years SET day = '1757-02-18' WHERE year = 1757;
UPDATE lunar_new_years SET day = '1776-02-19' WHERE year = 1776;
UPDATE lunar_new_years SET day = '1852-02-20' WHERE year = 1852;
UPDATE lunar_new_years SET day = '1890-02-19' WHERE year = 1890;
