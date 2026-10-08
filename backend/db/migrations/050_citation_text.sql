-- 050 — Sources, step 2: free-text sources become citations too, so there is one place for "where does this come
-- from". The "Sources" lines of relationships and provenance steps lived in metadata.sources; now they are
-- citations of a third kind, `text` (unverified, no reliability). A citation may also name the exact page of a
-- website source (url): the source is "Kunsthaus Zürich, Sammlung online", the url the object's page.
ALTER TABLE citations
  ADD COLUMN text text CHECK (btrim(text) <> ''),
  ADD COLUMN url  text CHECK (url ~ '^https?://\S+$'),
  DROP CONSTRAINT citations_check,
  ADD CONSTRAINT citations_one_source CHECK (num_nonnulls(source_id, wikidata_item, text) = 1);

-- citation_status (049) with the new kind: no reliability for free text (it counts as no source on the quality page)
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
       c.text, c.url
FROM citations c
LEFT JOIN bibliography b ON b.id = c.source_id
LEFT JOIN citable_fields f ON (f.entity_type, f.field) = (c.entity_type, c.field)
LEFT JOIN entity_rows er ON (er.type, er.id) = (c.entity_type, c.entity_id);

-- ── Converting the free-text lines ─────────────────────────────────────────────────────────────────────────────
-- The Kunsthaus's online collection, cited for provenance steps by its object pages: one source, the page per citation.
INSERT INTO bibliography (slug, kind, name, siglum, url, reliability)
SELECT 'kunsthaus-zurich-sammlung-online', 'web', 'Sammlung online', 'Kunsthaus Zürich, Sammlung online',
       'https://collection.kunsthaus.ch/', 'institution'
WHERE EXISTS (SELECT 1 FROM provenance WHERE metadata::text LIKE '%collection.kunsthaus.ch%')
  AND NOT EXISTS (SELECT 1 FROM bibliography WHERE slug = 'kunsthaus-zurich-sammlung-online');
UPDATE bibliography SET container = 'Kunsthaus Zürich' WHERE slug = 'kunsthaus-zurich-sammlung-online' AND container IS NULL;

-- Every line, with what it is: a Wikidata note, a Kunsthaus object page (with "abgerufen dd.mm.yyyy"), or free text.
WITH lines AS (
  SELECT r.id AS rel_id, NULL::bigint AS prov_id, l.line FROM relationships r CROSS JOIN jsonb_array_elements_text(r.metadata -> 'sources') l(line)
   WHERE jsonb_typeof(r.metadata -> 'sources') = 'array'
  UNION ALL
  SELECT NULL, p.id, l.line FROM provenance p CROSS JOIN jsonb_array_elements_text(p.metadata -> 'sources') l(line)
   WHERE jsonb_typeof(p.metadata -> 'sources') = 'array'
), parsed AS (
  SELECT rel_id, prov_id, btrim(line) AS line,
         regexp_match(line, '^Wikidata (Q[0-9]+) \(retrieved ([0-9]{4}-[0-9]{2}-[0-9]{2})\)$') AS wd,
         substring(line FROM '(https://collection\.kunsthaus\.ch/\S*[^\s).,])') AS kh_url,
         regexp_match(line, 'abgerufen ([0-9]{2})\.([0-9]{2})\.([0-9]{4})') AS kh_date
  FROM lines WHERE btrim(line) <> ''
)
INSERT INTO citations (relationship_id, provenance_id, wikidata_item, accessed, source_id, url, text)
SELECT p.rel_id, p.prov_id,
       p.wd[1], CASE WHEN p.wd IS NOT NULL THEN p.wd[2]::date
                     WHEN p.kh_date IS NOT NULL THEN make_date(p.kh_date[3]::int, p.kh_date[2]::int, p.kh_date[1]::int) END,
       CASE WHEN p.wd IS NULL AND p.kh_url IS NOT NULL THEN (SELECT id FROM bibliography WHERE slug = 'kunsthaus-zurich-sammlung-online') END,
       CASE WHEN p.wd IS NULL THEN p.kh_url END,
       CASE WHEN p.wd IS NULL AND p.kh_url IS NULL THEN p.line END
FROM parsed p
-- 049 already cited the Wikidata notes of relationships
WHERE NOT (p.wd IS NOT NULL AND EXISTS (SELECT 1 FROM citations c WHERE c.relationship_id IS NOT DISTINCT FROM p.rel_id
                                          AND c.provenance_id IS NOT DISTINCT FROM p.prov_id AND c.wikidata_item = p.wd[1]));

-- the lines live in citations now
UPDATE relationships SET metadata = metadata - 'sources' WHERE metadata ? 'sources';
UPDATE provenance SET metadata = metadata - 'sources' WHERE metadata ? 'sources';

-- One line per citation of a relationship or provenance step, as the "Sources" box of their forms shows them.
CREATE FUNCTION text_sources(rel bigint, prov bigint) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(c.text ORDER BY c.id), '{}') FROM citations c
  WHERE c.text IS NOT NULL AND (c.relationship_id = rel OR c.provenance_id = prov)
$$;

-- Citations in the shape of the YAML snapshot (content/README.md): free text as a plain line, the others as
-- {source, locator, url, accessed, note} or {wikidata, property, accessed}. jsonb_strip_nulls leaves out what is empty.
CREATE FUNCTION citation_doc(c citations) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.text IS NOT NULL THEN to_jsonb(c.text)
              WHEN c.wikidata_item IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('wikidata', c.wikidata_item,
                     'property', c.wikidata_property, 'accessed', c.accessed::text, 'note', c.note))
              ELSE jsonb_strip_nulls(jsonb_build_object('source', (SELECT slug FROM bibliography WHERE id = c.source_id),
                     'locator', c.locator, 'url', c.url, 'accessed', c.accessed::text, 'note', c.note)) END
$$;
-- of a relationship / provenance step: a list; of an entry: {field: [ … ]} (pending ones are not facts yet)
CREATE FUNCTION citation_docs(rel bigint, prov bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_agg(citation_doc(c) ORDER BY c.id) FROM citations c WHERE c.relationship_id = rel OR c.provenance_id = prov
$$;
CREATE FUNCTION field_citation_docs(etype entity_type, eid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_object_agg(field, docs) FROM (
    SELECT c.field, jsonb_agg(citation_doc(c) ORDER BY c.id) AS docs FROM citations c
    WHERE c.entity_type = etype AND c.entity_id = eid AND c.pending IS NULL GROUP BY c.field) x
$$;
