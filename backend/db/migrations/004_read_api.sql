-- 004 — Helpers for the public read API: accent-insensitive search, one view over all entities,
-- and a JSON shape for fuzzy date ranges.

------------------------------------------------------------------------------
-- Accent-insensitive search
------------------------------------------------------------------------------
-- unaccent() is only STABLE (its dictionary could change), so it can't be used in an index expression.
-- The usual idiom: an IMMUTABLE wrapper that names the dictionary explicitly. We promise not to change it.
CREATE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN public.unaccent('public.unaccent'::regdictionary, $1);

-- Trigram GIN indexes: serve ILIKE '%dur%' and the word-similarity operator (<%) — "Durer" finds "Albrecht Dürer".
CREATE INDEX artists_name_trgm      ON artists      USING gin (f_unaccent(name)  gin_trgm_ops);
CREATE INDEX artworks_title_trgm    ON artworks     USING gin (f_unaccent(title) gin_trgm_ops);
CREATE INDEX institutions_name_trgm ON institutions USING gin (f_unaccent(name)  gin_trgm_ops);
CREATE INDEX patrons_name_trgm      ON patrons      USING gin (f_unaccent(name)  gin_trgm_ops);
CREATE INDEX movements_name_trgm    ON movements    USING gin (f_unaccent(name)  gin_trgm_ops);
CREATE INDEX places_name_trgm       ON places       USING gin (f_unaccent(name)  gin_trgm_ops);

------------------------------------------------------------------------------
-- Fuzzy date → JSON
------------------------------------------------------------------------------
-- '[1886-03-01,1888-02-20)' + '1886–1888' →
--   {"label": "1886–1888", "from": "1886-03-01", "to": "1888-02-19", "from_year": 1886, "to_year": 1888}
-- "to" is inclusive (upper bound − 1 day). Years are negative for BCE (same convention as year_range()).
-- Open ends (unknown / still alive) come out as null.
CREATE FUNCTION iso_date(d date) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
RETURN CASE WHEN extract(year FROM d) < 0 THEN '-' ELSE '' END || to_char(d, 'YYYY-MM-DD');

CREATE FUNCTION range_json(r daterange, label text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN CASE WHEN r IS NULL AND label IS NULL THEN NULL ELSE jsonb_build_object(
  'label',     label,
  'from',      iso_date(lower(r)),
  'to',        iso_date(upper(r) - 1),
  'from_year', extract(year FROM lower(r))::int,
  'to_year',   extract(year FROM upper(r) - 1)::int
) END;

------------------------------------------------------------------------------
-- One row per entity, whatever its table: search, graph nodes, relationship endpoints.
------------------------------------------------------------------------------
-- A plain UNION ALL view: Postgres pushes WHERE type = … AND id = … down into each branch, so a lookup
-- still hits a single table's primary key.
CREATE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind FROM institutions
  UNION ALL
  SELECT 'patron', id, slug, name, active, active_label, kind FROM patrons
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text FROM places;
