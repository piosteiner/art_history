-- 179 — The dash of a date range spaced when an end names a month or a season (owner, 2026-10-31): "1868–11 February
-- 1889" read as "1868–11"; now "1868 – 11 February 1889". Between plain years it stays closed: "1840–1926", "13th–14th
-- century", "c. 1503–1518". The same rule in src/fuzzy-date.js (joinRange, the labels of new dates) and on the site
-- (frontend/src/html.ts joinRange). Here: the rule as range_label() for the views that join two labels (lifespans,
-- a provenance step's period), and the labels stored so far rewritten once — every date label column, the names'
-- period labels, and the labels quoted in citations (else they would read "changed since it was cited").

-- the rule once (IMMUTABLE: usable in views and indexes); NULL or empty ends leave the other, as concat_ws does
CREATE FUNCTION range_label(a text, b text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN coalesce(a, '') = '' THEN nullif(b, '')
    WHEN coalesce(b, '') = '' THEN a
    WHEN (a || ' ' || b) ~* '\m(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter)\M'
      THEN a || ' – ' || b
    ELSE a || '–' || b
  END
$$;

-- a stored label written the old way → the new way (only labels naming a month or a season; the dash between two
-- non-spaces is the range's — a label never has a dash of another kind there)
CREATE FUNCTION pg_temp.respace(l text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN l ~ '\S–\S'
    AND l ~* '\m(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter)\M'
    THEN regexp_replace(l, '(\S)–(\S)', '\1 – \2', 'g') ELSE l END
$$;

-- names: their period labels (entry_names follows by its triggers, 152)
CREATE FUNCTION pg_temp.respace_names(n jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(e) = 'object' AND e ? 'period_label'
                              THEN jsonb_set(e, '{period_label}', to_jsonb(pg_temp.respace(e ->> 'period_label'))) ELSE e END
                            ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(n) WITH ORDINALITY x(e, i)
$$;

DO $$
DECLARE
  c record;
  n bigint;
  total bigint := 0;
BEGIN
  PERFORM set_config('arthistory.source', 'migration 179', true);
  -- every "<x>_label" beside a daterange "<x>" (graph_links is derived: the worker rewrites it)
  FOR c IN
    SELECT l.table_name AS t, l.column_name AS col FROM information_schema.columns l
    JOIN information_schema.columns d ON d.table_schema = l.table_schema AND d.table_name = l.table_name
      AND d.column_name = regexp_replace(l.column_name, '_label$', '') AND d.udt_name = 'daterange'
    JOIN information_schema.tables tb ON tb.table_schema = l.table_schema AND tb.table_name = l.table_name AND tb.table_type = 'BASE TABLE'
    WHERE l.table_schema = 'public' AND l.column_name LIKE '%\_label' AND l.table_name NOT IN ('graph_links', 'entry_names')
  LOOP
    EXECUTE format('UPDATE %I SET %I = pg_temp.respace(%I) WHERE %I IS DISTINCT FROM pg_temp.respace(%I)', c.t, c.col, c.col, c.col, c.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  -- the names of every type that has them
  FOR c IN SELECT table_name AS t FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'names' AND udt_name = 'jsonb'
             AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
  LOOP
    EXECUTE format('UPDATE %I SET names = pg_temp.respace_names(names) WHERE names::text ~ ''period_label'' AND names IS DISTINCT FROM pg_temp.respace_names(names)', c.t);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  -- what citations quoted: the "_label" values and the names' period labels
  UPDATE citations ci SET cited_value = (
      SELECT jsonb_object_agg(k, CASE
        WHEN k LIKE '%\_label' AND jsonb_typeof(v) = 'string' THEN to_jsonb(pg_temp.respace(v #>> '{}'))
        WHEN k = 'names' AND jsonb_typeof(v) = 'array' THEN pg_temp.respace_names(v)
        ELSE v END)
      FROM jsonb_each(ci.cited_value) x(k, v))
  WHERE ci.cited_value IS NOT NULL AND jsonb_typeof(ci.cited_value) = 'object' AND ci.cited_value::text ~ '–';
  RAISE NOTICE 'migration 179: % labels respaced', total;
END $$;

-- the views that join two labels themselves: lifespans (previews, the entry index, search fields) and a provenance
-- step's period — patched as they stand; each expression must be found
DO $$
DECLARE
  v text;
  def text;
  months text := '\m(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|autumn|fall|winter)\M';
BEGIN
  FOREACH v IN ARRAY ARRAY['entry_previews', 'entity_index', 'entry_search_fields'] LOOP
    def := rtrim(pg_get_viewdef(v::regclass), E'; \n');
    IF position('concat_ws(''–''::text, ' IN def) = 0 THEN RAISE EXCEPTION '%: no lifespan join found', v; END IF;
    EXECUTE format('CREATE OR REPLACE VIEW %I AS ', v) || replace(def, 'concat_ws(''–''::text, ', 'range_label(');
  END LOOP;
  FOREACH v IN ARRAY ARRAY['provenance_periods', 'provenance_chain'] LOOP
    def := rtrim(pg_get_viewdef(v::regclass), E'; \n');
    IF position('~ ''[–-]''::text)' IN def) = 0 THEN RAISE EXCEPTION '%: no dash rule found', v; END IF;
    EXECUTE format('CREATE OR REPLACE VIEW %I AS ', v)
      || replace(def, '~ ''[–-]''::text)', '~* ''[–-]|' || months || '''::text)');
  END LOOP;
END $$;
