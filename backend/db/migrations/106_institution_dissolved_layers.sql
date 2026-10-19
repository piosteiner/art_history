-- 106 — Museums and events get their own pickers on the start map (owner, 2026-10-19: "they deserve their own picker
-- like artists or artworks … all museums automatically selected which existed within the timeframe").
--
--  * institutions.dissolved (+ _label): when it closed, was dissolved or merged — fuzzy like every date, citable like
--    "founded" (Wikidata P576). NULL = it still exists, or nobody recorded the end. With "founded" it says when an
--    institution existed: the start map shows a museum in a time window only then.
--  * start views (069) and short links (072) may set the two new pickers: institutions=… and events=… take slugs, all,
--    none or auto (the default: museums linked to what the map shows, events in the time window or the selection's
--    span). Their slugs follow renamed entries like the others'.

ALTER TABLE institutions
  ADD COLUMN dissolved daterange CHECK (NOT isempty(dissolved)),
  ADD COLUMN dissolved_label text;
COMMENT ON COLUMN institutions.dissolved IS 'when it closed / was dissolved (106); NULL = still exists or not recorded';

INSERT INTO citable_fields (entity_type, field, cols, wikidata_property, position)
SELECT 'institution', 'dissolved', '{dissolved,dissolved_label}', 'P576', (SELECT max(position) FROM citable_fields WHERE entity_type = 'institution') + 1;

CREATE OR REPLACE FUNCTION featured_key_type(key text) RETURNS entity_type LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE key WHEN 'artists' THEN 'artist' WHEN 'artworks' THEN 'artwork' WHEN 'movements' THEN 'movement'
                  WHEN 'polities' THEN 'polity' WHEN 'people' THEN 'person'
                  WHEN 'institutions' THEN 'institution' WHEN 'events' THEN 'event' END::entity_type
$$;

CREATE OR REPLACE FUNCTION featured_query_refs(query text)
RETURNS TABLE (part_no bigint, key text, entity_type entity_type, slug text, slug_no bigint)
LANGUAGE sql IMMUTABLE AS $$
  SELECT p.n, split_part(p.part, '=', 1), featured_key_type(split_part(p.part, '=', 1)), s.slug, s.n
  FROM regexp_split_to_table(query, '&') WITH ORDINALITY AS p(part, n),
       unnest(string_to_array(split_part(p.part, '=', 2), ',')) WITH ORDINALITY AS s(slug, n)
  WHERE featured_key_type(split_part(p.part, '=', 1)) IS NOT NULL AND s.slug NOT IN ('', 'none', 'all', 'by-artists', 'auto')
$$;

CREATE OR REPLACE VIEW featured_view_problems AS
SELECT f.id, f.slug AS view_slug, f.title, x.problem
FROM (SELECT id, slug, title, current_featured_query(query) AS query FROM featured_views) f  -- merges: slug_history
CROSS JOIN LATERAL (
  SELECT format('unknown key “%s”', split_part(part, '=', 1)) AS problem
  FROM regexp_split_to_table(f.query, '&') AS part
  WHERE split_part(part, '=', 1) NOT IN ('artists', 'artworks', 'movements', 'polities', 'people', 'institutions', 'events', 'from', 'to')
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
  WHERE (split_part(part, '=', 2) = 'by-artists' AND split_part(part, '=', 1) <> 'artworks')
     OR (split_part(part, '=', 2) = 'auto' AND split_part(part, '=', 1) NOT IN ('institutions', 'events'))
  UNION ALL
  SELECT format('no %s “%s”', r.entity_type, r.slug)
  FROM featured_query_refs(f.query) r
  WHERE NOT EXISTS (SELECT 1 FROM entity_index e WHERE e.type = r.entity_type AND e.slug = r.slug)
) x;
