-- 201 — The CMS search over stored documents (perf, 2026-11-03). /search built a document for every entry — name,
-- other names, identifiers, text (docsSql() in src/admin/search.js) — folded and full-text indexed them, on every
-- search: 5.3 s on the perf data (10× today; budget 2 s). Now each entry's document is stored here, folded once
-- (f_unaccent) with its full-text vector, kept by the derived-data worker (refreshDocs(), with the list rows: every
-- changed entry passes there) and searched through indexes: candidates by trigram (name, without spaces, other names,
-- identifiers) or full text, then scored by the same rules as before.
CREATE TABLE admin_search_docs (
  type     entity_type NOT NULL,
  id       bigint NOT NULL,
  slug     text NOT NULL,
  name     text NOT NULL,
  alt      text,
  other    text,
  body     text,
  fname    text NOT NULL,
  falt     text NOT NULL,
  fother   text NOT NULL,
  body_tsv tsvector NOT NULL,
  PRIMARY KEY (type, id)
);
COMMENT ON TABLE admin_search_docs IS 'The CMS search documents (201): docsSql() stored, folded, with the text vector; kept by refreshDocs().';
CREATE INDEX admin_search_docs_fname ON admin_search_docs USING gin (fname gin_trgm_ops);
CREATE INDEX admin_search_docs_fname_nospace ON admin_search_docs USING gin (replace(fname, ' ', '') gin_trgm_ops);
CREATE INDEX admin_search_docs_falt ON admin_search_docs USING gin (falt gin_trgm_ops);
CREATE INDEX admin_search_docs_fother ON admin_search_docs USING gin (fother gin_trgm_ops);
CREATE INDEX admin_search_docs_body ON admin_search_docs USING gin (body_tsv);
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_search_docs TO arthistory_admin;

-- filled now from the definition of today (the worker keeps it from the code's own definition afterwards)
INSERT INTO admin_search_docs (type, id, slug, name, alt, other, body, fname, falt, fother, body_tsv)
SELECT d.type, d.id, d.slug, d.name, d.alt, d.other, d.body, f_unaccent(d.name), f_unaccent(coalesce(d.alt, '')),
       f_unaccent(d.slug || ' · ' || coalesce(d.other, '')), to_tsvector('english', f_unaccent(coalesce(d.body, '')))
FROM (
  SELECT 'place'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.designation, t.country_code, t.boundary_code, t.wikidata_id, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM places t
  UNION ALL
  SELECT 'movement'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.region, t.wikidata_id, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM movements t
  UNION ALL
  SELECT 'polity'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.wikidata_id, array_to_string(t.country_codes, ' · '), nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM polities t
  UNION ALL
  SELECT 'artist'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names), t.sort_name), '') AS alt,
         concat_ws(' · ', t.given_name, t.family_name, t.region, t.wikidata_id, t.provenance_flag, nullif(t.metadata, '{}')::text) AS other,
         t.biography_md AS body
    FROM artists t
  UNION ALL
  SELECT 'person'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names), t.sort_name), '') AS alt,
         concat_ws(' · ', t.given_name, t.family_name, t.kind, t.wikidata_id, t.provenance_flag, array_to_string(t.occupations, ' · '), nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM people t
  UNION ALL
  SELECT 'institution'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.address, t.website_url, t.wikidata_id, t.provenance_flag, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM institutions t
  UNION ALL
  SELECT 'event'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.wikidata_id, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM events t
  UNION ALL
  SELECT 'term'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.category, t.definition, t.wikidata_id, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM glossary t
  UNION ALL
  SELECT 'literature'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.kind, t.part_number, t.wikidata_id, nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM literary_works t
  UNION ALL
  SELECT 'source'::entity_type AS type, t.id, t.slug, t.name AS name, nullif(concat_ws(' · ', name_alt_text(t.name_ruby, t.names), concat_ws(' ', t.siglum, (SELECT string_agg(split_part(x, ',', 1), ' ')
      FROM unnest(coalesce(nullif(t.authors, '{}'), t.editors)) x), t.year)), '') AS alt,
         concat_ws(' · ', t.kind, t.subtitle, t.container, t.volume, t.issue, t.issue_date, t.volumes_total, t.edition, t.original_year, t.series, t.thesis, t.place, t.publisher, t.year, t.pages, t.catalogue_number, t.exhibition, t.url, t.uploader, t.date_text, t.archive, t.shelfmark, t.isbn, t.doi, t.siglum, t.reliability, t.reading_status, t.wikidata_id, array_to_string(t.authors, ' · '), array_to_string(t.editors, ' · '), array_to_string(t.compilers, ' · '), array_to_string(t.container_editors, ' · '), nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM bibliography t
  UNION ALL
  SELECT 'artwork'::entity_type AS type, t.id, t.slug, t.title AS name, nullif(concat_ws(' · ', name_alt_text(t.title_ruby, t.names)), '') AS alt,
         concat_ws(' · ', t.title_status, t.part_number, t.parts_count, t.attribution_label, t.created_span, t.completion, t.completion_note, t.authenticity, t.authenticity_note, t.kind, t.medium, t.dimensions_note, t.inventory_number, t.web_url, t.provenance_status, t.provenance_status_note, t.fate, t.fate_note, t.region, t.wikidata_id, array_to_string(t.materials, ' · '), nullif(t.metadata, '{}')::text) AS other,
         t.description_md AS body
    FROM artworks t
) d;
