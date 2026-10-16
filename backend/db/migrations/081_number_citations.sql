-- 081 — Sources for further numbers. A citation (049) points at a field of an entry, a relationship or a provenance
-- step; now also at one further number of an artwork (048: a former inventory number, the owner's number when it is
-- on loan, a catalogue raisonné number) — "Lugt 1234" needs its source as much as a date does. One marker per number,
-- like a provenance step. Deleting the number deletes its citations (the foreign key cascades); merging two artworks
-- moves the numbers by id (merge_entries), so their citations go with them.
ALTER TABLE citations
  ADD COLUMN number_id bigint REFERENCES artwork_numbers ON DELETE CASCADE,
  DROP CONSTRAINT citations_check1,
  ADD CONSTRAINT citations_one_target
    CHECK ((entity_id IS NOT NULL)::int + (relationship_id IS NOT NULL)::int + (provenance_id IS NOT NULL)::int
           + (number_id IS NOT NULL)::int = 1);
CREATE INDEX citations_number_idx ON citations (number_id) WHERE number_id IS NOT NULL;

-- citation_status (050) with the new target; a view can only grow at its end (CREATE OR REPLACE keeps the columns)
CREATE OR REPLACE VIEW citation_status AS
SELECT c.id, c.entity_type, c.entity_id, c.field, c.relationship_id, c.provenance_id, c.source_id, c.wikidata_item,
       c.wikidata_property, c.locator, c.note, c.accessed, c.cited_value, c.pending, c.created_by, c.created_at, c.updated_at,
       CASE WHEN c.wikidata_item IS NOT NULL THEN 'database'::source_reliability
            WHEN c.source_id IS NOT NULL THEN source_reliability(b) END AS reliability,
       CASE WHEN c.wikidata_item IS NOT NULL
            THEN concat_ws(', ', 'Wikidata ' || c.wikidata_item, c.wikidata_property)
            WHEN c.source_id IS NOT NULL THEN concat_ws(', ', coalesce(b.siglum, b.name), c.locator)
            ELSE c.text END AS source_text,
       b.slug AS source_slug,
       (c.entity_id IS NOT NULL AND c.pending IS NULL AND c.cited_value IS DISTINCT FROM field_value(er.r, f.cols)) AS outdated,
       c.text, c.url, c.number_id
FROM citations c
LEFT JOIN bibliography b ON b.id = c.source_id
LEFT JOIN citable_fields f ON (f.entity_type, f.field) = (c.entity_type, c.field)
LEFT JOIN entity_rows er ON (er.type, er.id) = (c.entity_type, c.entity_id);

-- a number's citations in YAML shape (content/, like citation_docs for relationships and provenance steps)
CREATE FUNCTION number_citation_docs(num bigint) RETURNS jsonb LANGUAGE sql STABLE
RETURN (SELECT jsonb_agg(citation_doc(c) ORDER BY c.id) FROM citations c WHERE c.number_id = num);
