-- 187: the era names as glossary entries, the emperors and kings they are named after as people (owner 2026-11-02:
-- "create a glossary entry for all alternative date names like 'showa' … for the times named after the emperor
-- create the person of the emperor and link everything with each other").
-- A glossary category of its own for them; each era's entry (term_id) and, where the era is named after a
-- ruler — Japan's eras since 1868 (one reign, one era: the emperor is called by it after his death), the reign years
-- of the kings of Joseon — to the person (person_id). era_label()'s parts name their eras with the entries' slugs, so
-- the site links "Tenpō 2" to Tenpō. The entries and people themselves are data (made after this migration).
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'calendar';
-- The links in a table of their own: calendar_eras stays reference data that points at no entry (a reset of the
-- entries — TRUNCATE glossary, people … CASCADE in the tests — leaves it whole).
CREATE TABLE calendar_era_links (
  era_id bigint PRIMARY KEY REFERENCES calendar_eras(id) ON DELETE CASCADE,
  term_id bigint REFERENCES glossary(id) ON DELETE SET NULL,
  person_id bigint REFERENCES people(id) ON DELETE SET NULL
);
CREATE INDEX calendar_era_links_term_idx ON calendar_era_links (term_id);
CREATE INDEX calendar_era_links_person_idx ON calendar_era_links (person_id);
GRANT SELECT ON calendar_era_links TO arthistory_api, arthistory_admin;

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
           n.sy, n.ey,
           -- the era names in the label with their glossary entries (187), for links
           jsonb_strip_nulls(jsonb_build_array(jsonb_build_object('name', (n.s).name, 'term', (SELECT g.slug FROM calendar_era_links l JOIN glossary g ON g.id = l.term_id WHERE l.era_id = (n.s).id)))
             || CASE WHEN (n.s).id <> (n.e).id THEN jsonb_build_array(jsonb_build_object('name', (n.e).name, 'term', (SELECT g.slug FROM calendar_era_links l JOIN glossary g ON g.id = l.term_id WHERE l.era_id = (n.e).id))) ELSE '[]' END) AS eras
    FROM ends n
    WHERE n.sy <= n.ey
  )
  SELECT jsonb_build_object(
           'calendar', cal,
           'parts', jsonb_agg(jsonb_strip_nulls(jsonb_build_object('line', nullif(p.line, ''), 'label', p.label, 'native', p.native, 'hangul', p.hangul, 'eras', p.eras))
                              ORDER BY p.line <> '', p.line),
           'sexagenary', CASE WHEN min(p.sy) = max(p.ey) THEN sexagenary_year(min(p.sy)) END,
           -- a given day within two days of a computed new year, before the solar calendar
           'approx', bool_or(y.t < solar_since(cal) AND y.t - y.f0 < 360 AND EXISTS (SELECT 1 FROM lunar_new_years n
                       WHERE abs(n.day - y.f0) <= 2 OR abs(n.day - y.t) <= 2)))
  FROM per_line p CROSS JOIN y
  HAVING count(*) > 0
$$;
