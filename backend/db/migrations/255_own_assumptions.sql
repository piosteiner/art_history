-- 255 — Own assumptions (owner 2026-11-17, after five works were said to be "created in Tokyo" by an import: "it must
-- be transparent that it is an educated guess that an object is made in a certain location if we don't have the source
-- to prove it. Also it must be clear that it is my guess and not the guess of another person or scientific journal").
--
-- An assumption is a fourth kind of citation, beside a source of the bibliography, Wikidata and a note in words: no
-- source says it — an editor concludes it, and says why. `assumed_by` = the account whose conclusion it is, `note` = the
-- reasoning (required). Like a note in words it has no reliability: for the Quality page the value stays without a
-- source. The site shows it as "Assumption by <public name>" with the reasoning — never as a source.
-- Any citable target can carry one (a field, a relationship, a provenance step, a further number, a name).

ALTER TABLE citations ADD COLUMN assumed_by bigint REFERENCES admin_users (id) ON DELETE RESTRICT;

ALTER TABLE citations DROP CONSTRAINT citations_one_source,
  ADD CONSTRAINT citations_one_source CHECK (num_nonnulls(source_id, wikidata_item, text, assumed_by) = 1),
  ADD CONSTRAINT citations_assumption_reason CHECK (assumed_by IS NULL OR btrim(coalesce(note, '')) <> '');

-- one assumption per account and target (like one citation per source, 143)
CREATE UNIQUE INDEX citations_one_assumption ON citations
  (entity_type, entity_id, field, name_text, relationship_id, provenance_id, number_id, name_id, assumed_by) NULLS NOT DISTINCT
  WHERE assumed_by IS NOT NULL;

-- citation_status (049/050) with the assumption: no reliability, its author's public name (never the login name)
CREATE OR REPLACE VIEW citation_status AS
 SELECT c.id, c.entity_type, c.entity_id, c.field, c.relationship_id, c.provenance_id, c.source_id, c.wikidata_item,
    c.wikidata_property, c.locator, c.note, c.accessed, c.cited_value, c.pending, c.created_by, c.created_at, c.updated_at,
    CASE
      WHEN c.wikidata_item IS NOT NULL THEN 'database'::source_reliability
      WHEN c.source_id IS NOT NULL THEN source_reliability(b.*)
      ELSE NULL::source_reliability
    END AS reliability,
    CASE
      WHEN c.wikidata_item IS NOT NULL THEN concat_ws(', ', 'Wikidata ' || c.wikidata_item, c.wikidata_property)
      WHEN c.source_id IS NOT NULL THEN concat_ws(', ', coalesce(b.siglum, b.name), c.locator)
      WHEN c.assumed_by IS NOT NULL THEN 'Assumption by ' || coalesce(u.public_name, 'an editor of this site')
      ELSE c.text
    END AS source_text,
    b.slug AS source_slug,
    c.entity_id IS NOT NULL AND c.pending IS NULL AND c.cited_value IS DISTINCT FROM field_value(er.r, f.cols) AS outdated,
    c.text, c.url, c.number_id, c.name_id,
    c.assumed_by,
    CASE WHEN c.assumed_by IS NOT NULL THEN coalesce(u.public_name, 'an editor of this site') END AS assumed_by_name
   FROM citations c
     LEFT JOIN bibliography b ON b.id = c.source_id
     LEFT JOIN admin_users u ON u.id = c.assumed_by
     LEFT JOIN citable_fields f ON f.entity_type = c.entity_type AND f.field = c.field
     LEFT JOIN entity_rows er ON er.type = c.entity_type AND er.id = c.entity_id;

-- the YAML snapshot (content/README.md): { assumption: <reasoning>, by: <account id> }
CREATE OR REPLACE FUNCTION citation_doc(c citations) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.text IS NOT NULL THEN to_jsonb(c.text)
              WHEN c.assumed_by IS NOT NULL THEN jsonb_build_object('assumption', c.note, 'by', c.assumed_by)
              WHEN c.wikidata_item IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('wikidata', c.wikidata_item,
                     'property', c.wikidata_property, 'accessed', c.accessed::text, 'note', c.note))
              ELSE jsonb_strip_nulls(jsonb_build_object('source', (SELECT slug FROM bibliography WHERE id = c.source_id),
                     'locator', c.locator, 'url', c.url, 'accessed', c.accessed::text, 'note', c.note)) END
$$;
