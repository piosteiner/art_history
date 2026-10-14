-- 069 — Curated start views (frontend/README.md → "Curated start views"): the home page shows a few views of the
-- start map chosen by the owner instead of everything. A view is the start map's own URL query, as the site writes it
-- (artists=vincent-van-gogh,paul-gauguin&movements=none&from=1886&to=1890), with a title and an intro.
--
-- The query stays text — it is what the site reads and what the owner pastes — but the database understands it:
--   featured_query_refs(query)    the entries it names, one row each (key, type, slug, position)
--   current_featured_query(query) the same query with renamed entries' old slugs replaced (slug_history, 041)
--   featured_view_problems        a view: unknown keys, bad years, slugs that name nothing
-- and keeps it current like [[links]] (042): corrected on the way in (BEFORE trigger) and rewritten when an entry is
-- renamed or merged (record_slug_change / merge_entries go through markdown_columns, which now lists the intro too;
-- the query gets its own step in record_slug_change).

CREATE TABLE featured_views (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title      text NOT NULL CHECK (btrim(title) <> ''),
  intro_md   text,
  query      text NOT NULL CHECK (query <> '' AND query !~ '[?#\s]'),  -- the part after "?", nothing else
  sort_order integer NOT NULL DEFAULT 0,
  published  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER featured_views_updated_at BEFORE UPDATE ON featured_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER featured_views_audit AFTER INSERT OR UPDATE OR DELETE ON featured_views FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT ON featured_views TO arthistory_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON featured_views TO arthistory_admin;

-- The query's keys that name entries, and their types (the site's selection.ts: GROUPS / PLURAL).
CREATE FUNCTION featured_key_type(key text) RETURNS entity_type LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE key WHEN 'artists' THEN 'artist' WHEN 'artworks' THEN 'artwork' WHEN 'movements' THEN 'movement'
                  WHEN 'polities' THEN 'polity' WHEN 'people' THEN 'person' END::entity_type
$$;

-- Every slug the query names. A query is "k=v&k=v"; each value a comma-separated list — or none / all / by-artists,
-- which name nothing. Set-returning functions in FROM run once per row of what stands before them (implicitly
-- LATERAL); WITH ORDINALITY numbers the parts and the slugs, so the query can be put back together in order.
CREATE FUNCTION featured_query_refs(query text)
RETURNS TABLE (part_no bigint, key text, entity_type entity_type, slug text, slug_no bigint)
LANGUAGE sql IMMUTABLE AS $$
  SELECT p.n, split_part(p.part, '=', 1), featured_key_type(split_part(p.part, '=', 1)), s.slug, s.n
  FROM regexp_split_to_table(query, '&') WITH ORDINALITY AS p(part, n),
       unnest(string_to_array(split_part(p.part, '=', 2), ',')) WITH ORDINALITY AS s(slug, n)
  WHERE featured_key_type(split_part(p.part, '=', 1)) IS NOT NULL AND s.slug NOT IN ('', 'none', 'all', 'by-artists')
$$;

-- The query with every old slug (slug_history) replaced by the entry's current one; other parts as they are.
CREATE FUNCTION current_featured_query(query text) RETURNS text LANGUAGE sql STABLE AS $$
  WITH parts AS (
    SELECT p.n, p.part, split_part(p.part, '=', 1) AS key, split_part(p.part, '=', 2) AS val
    FROM regexp_split_to_table(query, '&') WITH ORDINALITY AS p(part, n)
  )
  SELECT string_agg(CASE WHEN featured_key_type(parts.key) IS NULL THEN parts.part
    ELSE parts.key || '=' || (
      SELECT string_agg(coalesce(e.slug, s.slug), ',' ORDER BY s.n)
      FROM unnest(string_to_array(parts.val, ',')) WITH ORDINALITY AS s(slug, n)
      LEFT JOIN public.slug_history h ON h.entity_type = featured_key_type(parts.key) AND h.old_slug = s.slug
      LEFT JOIN public.entity_index e ON (e.type, e.id) = (h.entity_type, h.entity_id))
    END, '&' ORDER BY parts.n)
  FROM parts
$$;

-- On the way in: a pasted or saved query with old slugs names the current ones.
CREATE FUNCTION correct_featured_query() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.query := public.current_featured_query(NEW.query);
  RETURN NEW;
END $$;
CREATE TRIGGER featured_views_current BEFORE INSERT OR UPDATE OF query ON featured_views
  FOR EACH ROW EXECUTE FUNCTION correct_featured_query();

-- The intro's [[links]] like every other text (042): corrected on the way in, rewritten on renames and merges.
CREATE OR REPLACE VIEW markdown_columns AS
SELECT * FROM (VALUES ('artists', 'biography_md'), ('artworks', 'description_md'), ('institutions', 'description_md'),
  ('people', 'description_md'), ('movements', 'description_md'), ('places', 'description_md'),
  ('polities', 'description_md'), ('glossary', 'description_md'), ('bibliography', 'description_md'),
  ('relationships', 'notes_md'), ('provenance', 'notes_md'), ('events', 'description_md'),
  ('featured_views', 'intro_md')) AS v(tbl, col);
CREATE TRIGGER featured_views_old_links BEFORE INSERT OR UPDATE OF intro_md ON featured_views
  FOR EACH ROW EXECUTE FUNCTION correct_old_links('intro_md');

-- On a rename (042's function, one more step): the views naming the old slug follow it.
CREATE OR REPLACE FUNCTION record_slug_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  etype entity_type := TG_ARGV[0]::entity_type;
  prev_source text;
  t record;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- the old address now leads here (also if another entry had it before and was renamed or deleted)
    INSERT INTO slug_history (entity_type, old_slug, entity_id) VALUES (etype, OLD.slug, OLD.id)
    ON CONFLICT (entity_type, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, changed_at = now();
    -- a slug in use is no longer an old address of anything
    DELETE FROM slug_history WHERE entity_type = etype AND old_slug = NEW.slug;

    prev_source := current_setting('arthistory.source', true);
    PERFORM set_config('arthistory.source', 'slug rename', true);
    FOR t IN SELECT * FROM public.markdown_columns LOOP
      EXECUTE format('UPDATE %I SET %I = public.current_links(%2$I) WHERE %2$I LIKE %L', t.tbl, t.col,
                     '%[[%' || OLD.slug || '%');
    END LOOP;
    -- curated start views naming it (069): the BEFORE trigger rewrites the query
    UPDATE public.featured_views f SET query = f.query
     WHERE EXISTS (SELECT 1 FROM public.featured_query_refs(f.query) r WHERE r.entity_type = etype AND r.slug = OLD.slug);
    PERFORM set_config('arthistory.source', coalesce(prev_source, ''), true);
  END IF;
  RETURN NEW;
END $$;

-- What is wrong with a view: one row per problem. The keys the site knows; from/to whole years, from ≤ to; every
-- slug an entry of its type (renamed and merged ones are followed — what is left was deleted or never existed).
CREATE VIEW featured_view_problems AS
SELECT f.id, f.slug AS view_slug, f.title, x.problem
FROM (SELECT id, slug, title, current_featured_query(query) AS query FROM featured_views) f  -- merges: slug_history
CROSS JOIN LATERAL (
  SELECT format('unknown key “%s”', split_part(part, '=', 1)) AS problem
  FROM regexp_split_to_table(f.query, '&') AS part
  WHERE split_part(part, '=', 1) NOT IN ('artists', 'artworks', 'movements', 'polities', 'people', 'from', 'to')
  UNION ALL
  SELECT format('“%s” is not a year', part)
  FROM regexp_split_to_table(f.query, '&') AS part
  WHERE split_part(part, '=', 1) IN ('from', 'to') AND split_part(part, '=', 2) !~ '^-?[0-9]{1,4}$'
  UNION ALL
  SELECT 'from and to: both or neither'
  WHERE (f.query ~ '(^|&)from=') <> (f.query ~ '(^|&)to=')
  UNION ALL
  SELECT 'from is after to'
  WHERE substring(f.query FROM '(?:^|&)from=(-?[0-9]{1,4})(?:&|$)')::int > substring(f.query FROM '(?:^|&)to=(-?[0-9]{1,4})(?:&|$)')::int
  UNION ALL
  SELECT format('“%s” is not a value for %s', split_part(part, '=', 2), split_part(part, '=', 1))
  FROM regexp_split_to_table(f.query, '&') AS part
  WHERE split_part(part, '=', 2) = 'by-artists' AND split_part(part, '=', 1) <> 'artworks'
  UNION ALL
  SELECT format('no %s “%s”', r.entity_type, r.slug)
  FROM featured_query_refs(f.query) r
  WHERE NOT EXISTS (SELECT 1 FROM entity_index e WHERE e.type = r.entity_type AND e.slug = r.slug)
) x;
GRANT SELECT ON featured_view_problems TO arthistory_admin;
