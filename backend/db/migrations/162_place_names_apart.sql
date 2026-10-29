-- 162 — Places of the same name told apart (places plan step F, owner 2026-10-29). Two Cambridges, two Limburgs, a
-- city and the province named after it: the name alone doesn't say which is meant — in a picker, a list or a link.
--
--   place_qualifier()   the words that set a place apart from the others of its name, shown in brackets after it:
--                       the place it lies in where that differs for each ("Cambridge (Massachusetts)" / "Cambridge
--                       (Cambridgeshire)"), else its designation ("city of Portugal" / "district of Portugal"), its kind,
--                       its country — null when the name is the only one
--   search fields       a place's "Kind" is its designation where it has one, "In" the place it lies in (the region,
--                       not the country again), "Country" the derived one (155) — the pickers show them
--   dup_score()         evidence that two places of one name are two: one lies within the other (Ancona in the
--                       Province of Ancona), different countries (Limburg in Belgium and in the Netherlands), different
--                       numbers in the names (the 2nd and the 6th arrondissement)

-- the places a place lies in, its parent upwards (a recursive CTE; parent cycles are prevented on save, the depth is a guard)
CREATE FUNCTION place_ancestors(pid bigint) RETURNS SETOF bigint LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id, d) AS (
    SELECT parent_id, 1 FROM places WHERE id = pid AND parent_id IS NOT NULL
    UNION ALL
    SELECT p.parent_id, up.d + 1 FROM up JOIN places p ON p.id = up.id WHERE p.parent_id IS NOT NULL AND up.d < 20)
  SELECT id FROM up
$$;

CREATE INDEX places_name_key_idx ON places (f_unaccent(lower(name)));

CREATE FUNCTION place_qualifier(pid bigint) RETURNS text LANGUAGE sql STABLE AS $$
  WITH me AS (SELECT f_unaccent(lower(name)) AS k FROM places WHERE id = pid),
  grp AS (
    SELECT p.id, p.kind::text AS kind, lower(p.designation) AS des, p.designation,
           pp.name AS parent, f_unaccent(lower(pp.name)) AS parent_key, place_country(p.id) ->> 'name' AS country
    FROM me JOIN places p ON f_unaccent(lower(p.name)) = me.k LEFT JOIN places pp ON pp.id = p.parent_id),
  rule AS (
    SELECT count(*) AS n,
           -- the parent: each has one, none of the same name (Antwerp in the Province of Antwerp), all different
           bool_and(parent IS NOT NULL AND parent_key <> (SELECT k FROM me)) AND count(DISTINCT parent_key) = count(*) AS by_parent,
           bool_and(des IS NOT NULL) AND count(DISTINCT des) = count(*) AS by_designation,
           count(DISTINCT kind) = count(*) AS by_kind,
           bool_and(country IS NOT NULL) AND count(DISTINCT country) = count(*) AS by_country
    FROM grp)
  SELECT CASE WHEN r.n < 2 THEN NULL
              WHEN r.by_parent THEN g.parent
              WHEN r.by_designation THEN g.designation
              WHEN r.by_kind THEN g.kind
              WHEN r.by_country THEN g.country END
  FROM rule r JOIN grp g ON g.id = pid
$$;
COMMENT ON FUNCTION place_qualifier(bigint) IS 'what sets a place apart from the others of its name — null when there are none (162)';

-- the search fields (110): Kind = the designation, In = the region it lies in, Country derived
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('entry_search_fields'::regclass), E'; \n');
  pat text := $p$\(1,'Kind'::text,\(pl\.kind\)::text\), \(2,'Country'::text,\( SELECT b\.name\s+FROM boundaries b\s+WHERE \(\(b\.code = \(pl\.country_code\)::text\) AND \(b\.level = 0\)\)\s+LIMIT 1\)\)$p$;
  shown text := $s$(((type)::text = 'place'::text) AND (label = 'Country'::text))$s$;
BEGIN
  IF (SELECT count(*) FROM regexp_matches(def, pat, 'g')) <> 1 THEN RAISE EXCEPTION 'entry_search_fields: the place fields not found'; END IF;
  IF (length(def) - length(replace(def, shown, ''))) / length(shown) <> 1 THEN RAISE EXCEPTION 'entry_search_fields: shown not found'; END IF;
  def := regexp_replace(def, pat, $r$(1,'Kind'::text,COALESCE(pl.designation, (pl.kind)::text)), (2,'In'::text,( SELECT pp.name FROM places pp WHERE pp.id = pl.parent_id AND pp.kind NOT IN ('country', 'continent'))), (3,'Country'::text,(place_country(pl.id) ->> 'name'::text))$r$);
  def := replace(def, shown, shown || $s$ OR (((type)::text = 'place'::text) AND (label = 'In'::text))$s$);
  EXECUTE 'CREATE OR REPLACE VIEW entry_search_fields AS ' || def;
END $$;
DELETE FROM entry_search_fields_stored WHERE type = 'place';
INSERT INTO entry_search_fields_stored SELECT * FROM entry_search_fields WHERE type = 'place';

-- the duplicate check (044): evidence that two places are two, patched in before the kinds
DO $$
DECLARE
  def text := pg_get_functiondef('dup_score(dup_facts, dup_facts)'::regprocedure);
  anchor text := '  -- a city and a region of the same name (Oslo, Kyoto) are two things';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'dup_score: anchor not found'; END IF;
  EXECUTE replace(def, anchor, $add$  -- places (162): a place can't lie within itself (Ancona in the Province of Ancona); one name in two countries
  -- (Limburg) is two places; the 2nd and the 6th arrondissement differ by their numbers
  IF a.type = 'place' THEN
    IF a.id IN (SELECT place_ancestors(b.id)) OR b.id IN (SELECT place_ancestors(a.id)) THEN
      score := score - 100; reasons := reasons || 'one lies within the other'::text;
    ELSIF (place_country(a.id) ->> 'code') <> (place_country(b.id) ->> 'code') THEN
      score := score - 60; reasons := reasons || format('different countries (%s / %s)', place_country(a.id) ->> 'code', place_country(b.id) ->> 'code');
    END IF;
    IF a.name ~ '\d' AND b.name ~ '\d'
       AND ARRAY(SELECT m[1] FROM regexp_matches(a.name, '(\d+)', 'g') m ORDER BY 1) <> ARRAY(SELECT m[1] FROM regexp_matches(b.name, '(\d+)', 'g') m ORDER BY 1) THEN
      score := score - 60; reasons := reasons || 'different numbers in the names'::text;
    END IF;
  END IF;

$add$ || anchor);
END $$;

-- the stored duplicate pairs follow: every place through the worker (125)
INSERT INTO derived_queue (type, id, reason) SELECT 'place', id, 'full' FROM places;
