-- 049 — Sources for facts: which source supports which value. Names need none; dates, dimensions, the institution, a
-- place, a relationship ("depicts Saint-Rémy") are claims someone made — Wikidata, the museum, a catalogue raisonné.
-- A citation records it, with the value as it was when cited, so a later change shows the citation as outdated.
-- Reliability ranks the kinds of source (an enum compares in declaration order, so max() picks the best):
--   database (Wikidata, aggregated) < institution (museum website, collection database) < scholarly (catalogue
--   raisonné, literature) < primary (archival sources, letters).
CREATE TYPE source_reliability AS ENUM ('database', 'institution', 'scholarly', 'primary');

-- A source's reliability: chosen, else from its kind (a website is an institution's until said otherwise).
ALTER TABLE bibliography ADD COLUMN reliability source_reliability;
CREATE FUNCTION source_reliability(b bibliography) RETURNS source_reliability LANGUAGE sql STABLE AS $$
  SELECT coalesce(b.reliability, CASE WHEN b.primary_source OR b.kind = 'archival' THEN 'primary'
                                      WHEN b.kind IN ('web', 'video', 'other') THEN 'institution'
                                      ELSE 'scholarly' END::source_reliability)
$$;

-- Which fields of each type are claims that want a source, the columns that hold them, and the Wikidata property they
-- come from. A table, not code: the quality check and the admin read the same list.
CREATE TABLE citable_fields (
  entity_type entity_type NOT NULL,
  field       text NOT NULL,          -- the doc key (content.js): created, dimensions, institution …
  cols        text[] NOT NULL,        -- its columns (a date and its label, all dimensions)
  wikidata_property text CHECK (wikidata_property ~ '^P[0-9]+$'),
  position    int NOT NULL,
  PRIMARY KEY (entity_type, field)
);
INSERT INTO citable_fields VALUES
  ('artwork', 'creator', '{creator_id}', 'P170', 1), ('artwork', 'attribution_label', '{attribution_label}', NULL, 2),
  ('artwork', 'created', '{created,created_label}', 'P571', 3), ('artwork', 'kind', '{kind}', 'P31', 4),
  ('artwork', 'medium', '{medium}', 'P186', 5), ('artwork', 'materials', '{materials}', 'P186', 6),
  ('artwork', 'dimensions', '{height_cm,width_cm,depth_cm}', 'P2048', 7), ('artwork', 'other_dimensions', '{other_dimensions}', NULL, 8),
  ('artwork', 'parent', '{parent_id,part_number}', 'P179', 9), ('artwork', 'institution', '{current_institution_id}', 'P195', 10),
  ('artwork', 'inventory_number', '{inventory_number}', 'P217', 11), ('artwork', 'on_loan', '{on_loan,on_loan_since}', NULL, 12),
  ('artwork', 'location', '{location}', 'P625', 13), ('artwork', 'area', '{area}', NULL, 14),
  ('artist', 'birth', '{birth,birth_label}', 'P569', 1), ('artist', 'death', '{death,death_label}', 'P570', 2),
  ('person', 'kind', '{kind}', 'P31', 1), ('person', 'occupations', '{occupations}', 'P106', 2),
  ('person', 'birth', '{birth,birth_label}', 'P569', 3), ('person', 'death', '{death,death_label}', 'P570', 4),
  ('person', 'active', '{active,active_label}', 'P571', 5),
  ('institution', 'kind', '{kind}', 'P31', 1), ('institution', 'founded', '{founded,founded_label}', 'P571', 2),
  ('institution', 'place', '{place_id}', 'P131', 3), ('institution', 'location', '{location}', 'P625', 4),
  ('institution', 'address', '{address}', 'P6375', 5),
  ('place', 'kind', '{kind}', 'P31', 1), ('place', 'parent', '{parent_id}', 'P131', 2), ('place', 'location', '{location}', 'P625', 3),
  ('movement', 'kind', '{kind}', 'P31', 1), ('movement', 'period', '{period,period_label}', 'P580', 2), ('movement', 'parent', '{parent_id}', 'P361', 3),
  ('polity', 'kind', '{kind}', 'P31', 1), ('polity', 'period', '{period,period_label}', 'P571', 2), ('polity', 'parent', '{parent_id}', 'P361', 3),
  ('polity', 'country_codes', '{country_codes}', 'P297', 4),
  ('event', 'kind', '{kind}', 'P31', 1), ('event', 'period', '{period,period_label}', 'P585', 2), ('event', 'place', '{place_id}', 'P276', 3),
  ('event', 'location', '{location}', 'P625', 4), ('event', 'area', '{area}', NULL, 5), ('event', 'parent', '{parent_id}', 'P361', 6),
  ('term', 'definition', '{definition}', NULL, 1);

-- Every entry as one JSON row (to_jsonb of its table row), to read any field generically.
CREATE VIEW entity_rows AS
  SELECT 'artist'::entity_type AS type, t.id, to_jsonb(t) AS r FROM artists t
  UNION ALL SELECT 'artwork', t.id, to_jsonb(t) FROM artworks t
  UNION ALL SELECT 'institution', t.id, to_jsonb(t) FROM institutions t
  UNION ALL SELECT 'person', t.id, to_jsonb(t) FROM people t
  UNION ALL SELECT 'movement', t.id, to_jsonb(t) FROM movements t
  UNION ALL SELECT 'place', t.id, to_jsonb(t) FROM places t
  UNION ALL SELECT 'polity', t.id, to_jsonb(t) FROM polities t
  UNION ALL SELECT 'event', t.id, to_jsonb(t) FROM events t
  UNION ALL SELECT 'term', t.id, to_jsonb(t) FROM glossary t;

-- A field's value: its columns as one JSON object; NULL when there is nothing (empty text, list, false).
CREATE FUNCTION field_value(r jsonb, cols text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(jsonb_strip_nulls(jsonb_object_agg(c, CASE WHEN r -> c IN ('[]', '""', 'false', '{}') THEN NULL ELSE r -> c END)), '{}')
  FROM unnest(cols) c
$$;

-- A citation: this value of this entry (a field, or a whole relationship / provenance step) is supported by this
-- source — an entry of the bibliography, or a Wikidata item (no bibliography entry needed). target_type extends the
-- entity types with relationship and provenance; no foreign key can point at "one of nine tables", so a trigger
-- checks the target and deleting it deletes its citations (like relationships, 001).
CREATE TABLE citations (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type  entity_type,                     -- a field of an entry …
  entity_id    bigint,
  field        text,
  relationship_id bigint REFERENCES relationships ON DELETE CASCADE,   -- … or a relationship …
  provenance_id   bigint REFERENCES provenance ON DELETE CASCADE,      -- … or a provenance step
  source_id    bigint REFERENCES bibliography ON DELETE RESTRICT,
  wikidata_item     text CHECK (wikidata_item ~ '^Q[0-9]+$'),
  wikidata_property text CHECK (wikidata_property ~ '^P[0-9]+$'),
  locator      text,                            -- page, figure, catalogue number: "S. 45", "Kat.-Nr. 12"
  note         text,
  accessed     date,                            -- when the source was consulted (websites, Wikidata)
  cited_value  jsonb,                           -- the field's value when cited (field_value); NULL for relationships
  pending      jsonb,                           -- applied to a working copy, not published yet: the form values expected
  created_by   bigint REFERENCES admin_users ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(source_id, wikidata_item) = 1),                  -- one source
  CHECK ((entity_id IS NOT NULL)::int + (relationship_id IS NOT NULL)::int + (provenance_id IS NOT NULL)::int = 1),
  CHECK ((entity_id IS NULL) = (entity_type IS NULL) AND (entity_id IS NULL) = (field IS NULL)),
  FOREIGN KEY (entity_type, field) REFERENCES citable_fields
);
CREATE INDEX citations_entity_idx ON citations (entity_type, entity_id, field);
CREATE INDEX citations_relationship_idx ON citations (relationship_id) WHERE relationship_id IS NOT NULL;
CREATE INDEX citations_provenance_idx ON citations (provenance_id) WHERE provenance_id IS NOT NULL;
CREATE INDEX citations_source_idx ON citations (source_id) WHERE source_id IS NOT NULL;
CREATE TRIGGER citations_updated_at BEFORE UPDATE ON citations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER citations_audit AFTER INSERT OR UPDATE OR DELETE ON citations FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE FUNCTION citation_target_exists() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL AND NOT entity_exists(NEW.entity_type, NEW.entity_id) THEN
    RAISE EXCEPTION 'citation: % #% does not exist', NEW.entity_type, NEW.entity_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER citations_target BEFORE INSERT OR UPDATE OF entity_type, entity_id ON citations
  FOR EACH ROW EXECUTE FUNCTION citation_target_exists();

-- Deleting an entry deletes the citations of its fields and its Wikidata decisions (the generic delete trigger of
-- 001/021/041; the decisions were left behind before).
CREATE OR REPLACE FUNCTION delete_entity_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  etype entity_type := TG_ARGV[0]::entity_type;
BEGIN
  DELETE FROM relationships
   WHERE (subject_type = etype AND subject_id = OLD.id)
      OR (object_type  = etype AND object_id  = OLD.id);
  DELETE FROM auto_created WHERE entity_type = etype AND entity_id = OLD.id;
  DELETE FROM slug_history WHERE entity_type = etype AND entity_id = OLD.id;
  DELETE FROM citations WHERE entity_type = etype AND entity_id = OLD.id;
  DELETE FROM wikidata_reviews WHERE entity_type = etype AND entity_id = OLD.id;   -- its Wikidata decisions too
  RETURN OLD;
END $$;

-- Each citation with its source in words, its reliability, and whether the value changed since (outdated).
CREATE VIEW citation_status AS
SELECT c.*,
       CASE WHEN c.wikidata_item IS NOT NULL THEN 'database'::source_reliability ELSE source_reliability(b) END AS reliability,
       CASE WHEN c.wikidata_item IS NOT NULL
            THEN concat_ws(', ', 'Wikidata ' || c.wikidata_item, c.wikidata_property)
            ELSE concat_ws(', ', coalesce(b.siglum, b.name), c.locator) END AS source_text,
       b.slug AS source_slug,
       (c.entity_id IS NOT NULL AND c.pending IS NULL AND c.cited_value IS DISTINCT FROM field_value(er.r, f.cols)) AS outdated
FROM citations c
LEFT JOIN bibliography b ON b.id = c.source_id
LEFT JOIN citable_fields f ON (f.entity_type, f.field) = (c.entity_type, c.field)
LEFT JOIN entity_rows er ON (er.type, er.id) = (c.entity_type, c.entity_id);

-- Every field that has a value, with the best reliability among the citations that still match it (NULL = none).
CREATE VIEW field_sourcing AS
SELECT er.type AS entity_type, er.id AS entity_id, f.field, f.position, v.value,
       (SELECT max(cs.reliability) FROM citation_status cs
         WHERE (cs.entity_type, cs.entity_id, cs.field) = (er.type, er.id, f.field) AND cs.pending IS NULL AND NOT cs.outdated) AS best
FROM entity_rows er
JOIN citable_fields f ON f.entity_type = er.type
CROSS JOIN LATERAL (SELECT field_value(er.r, f.cols) AS value) v
WHERE v.value IS NOT NULL;

-- decisions of entries deleted before
DELETE FROM wikidata_reviews w WHERE NOT entity_exists(w.entity_type, w.entity_id);

-- ── Backfill: what demonstrably came from Wikidata ─────────────────────────────────────────────────────────────
-- (a) relationships created by the Wikidata comparison carry the note "Wikidata Q… (retrieved YYYY-MM-DD)"
INSERT INTO citations (relationship_id, wikidata_item, wikidata_property, accessed)
SELECT r.id, m[1], p.prop, m[2]::date
FROM relationships r
CROSS JOIN LATERAL regexp_match(r.metadata::text, 'Wikidata (Q[0-9]+) \(retrieved ([0-9]{4}-[0-9]{2}-[0-9]{2})\)') m
LEFT JOIN (VALUES ('born_in', 'P19'), ('died_in', 'P20'), ('lived_in', 'P551'), ('worked_in', 'P937'), ('student_of', 'P1066'),
  ('associated_with', 'P135'), ('member_of', 'P463'), ('studied_at', 'P69'), ('influenced_by', 'P737'), ('nationality', 'P27'),
  ('created_in', 'P1071'), ('depicts', 'P180'), ('depicts_person', 'P180'), ('commissioned', 'P88'), ('created_in_polity', 'P495'),
  ('active_in', 'P495'), ('participated_in', 'P710'), ('concerns', 'P921'), ('co_creator', 'P170')) p(code, prop) ON p.code = r.relationship_type
WHERE m IS NOT NULL;
-- (b) entries created from Wikidata (missing targets, cities) carry the same note: their fields came from there
INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, cited_value)
SELECT er.type, er.id, f.field, m[1], f.wikidata_property, m[2]::date, field_value(er.r, f.cols)
FROM entity_rows er
CROSS JOIN LATERAL regexp_match((er.r -> 'metadata')::text, 'Wikidata (Q[0-9]+) \(retrieved ([0-9]{4}-[0-9]{2}-[0-9]{2})\)') m
JOIN citable_fields f ON f.entity_type = er.type
WHERE m IS NOT NULL AND field_value(er.r, f.cols) IS NOT NULL;
-- (c) values taken in a Wikidata comparison (wikidata_reviews, 012) — the entry's own item
INSERT INTO citations (entity_type, entity_id, field, wikidata_item, wikidata_property, accessed, cited_value)
SELECT w.entity_type, w.entity_id, f.field, er.r ->> 'wikidata_id', f.wikidata_property, w.decided_at::date, field_value(er.r, f.cols)
FROM wikidata_reviews w
JOIN citable_fields f ON (f.entity_type, f.field) = (w.entity_type, CASE w.item WHEN 'dimensions' THEN 'dimensions' ELSE w.item END)
JOIN entity_rows er ON (er.type, er.id) = (w.entity_type, w.entity_id)
WHERE w.decision = 'accepted' AND er.r ->> 'wikidata_id' IS NOT NULL AND field_value(er.r, f.cols) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM citations c WHERE (c.entity_type, c.entity_id, c.field) = (w.entity_type, w.entity_id, f.field)
                                             AND c.wikidata_item IS NOT NULL);

-- Merge (044/048): citations move to the kept entry.
CREATE OR REPLACE FUNCTION merge_entries(etype entity_type, keep_id bigint, dup_id bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  tbl text := public.entity_table(etype);
  name_col text := CASE etype WHEN 'artwork' THEN 'title' ELSE 'name' END;
  keep_row jsonb; dup_row jsonb;
  merged jsonb := '{}'; moved jsonb := '{}'; filled text[] := '{}'; differing text[] := '{}';
  new_names jsonb; added int := 0; texts bigint := 0; n bigint; m bigint;
  prev_source text := current_setting('arthistory.source', true);
  r record; g record; e jsonb;
BEGIN
  IF keep_id = dup_id THEN RAISE EXCEPTION 'An entry can''t be merged into itself.'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 FOR UPDATE', tbl) INTO keep_row USING keep_id;
  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 FOR UPDATE', tbl) INTO dup_row USING dup_id;
  IF keep_row IS NULL OR dup_row IS NULL THEN RAISE EXCEPTION 'Entry not found.'; END IF;
  PERFORM set_config('arthistory.source', 'merge', true);

  -- relationships: those between the two would point at itself, those the kept entry has already would be doubled
  DELETE FROM relationships WHERE (subject_type = etype AND subject_id = dup_id AND object_type = etype AND object_id = keep_id)
                               OR (subject_type = etype AND subject_id = keep_id AND object_type = etype AND object_id = dup_id);
  DELETE FROM relationships d WHERE d.subject_type = etype AND d.subject_id = dup_id AND EXISTS (
    SELECT 1 FROM relationships k WHERE k.subject_type = etype AND k.subject_id = keep_id AND k.relationship_type = d.relationship_type
      AND k.object_type = d.object_type AND k.object_id = d.object_id AND k.period IS NOT DISTINCT FROM d.period);
  DELETE FROM relationships d WHERE d.object_type = etype AND d.object_id = dup_id AND EXISTS (
    SELECT 1 FROM relationships k WHERE k.object_type = etype AND k.object_id = keep_id AND k.relationship_type = d.relationship_type
      AND k.subject_type = d.subject_type AND k.subject_id = d.subject_id AND k.period IS NOT DISTINCT FROM d.period);
  UPDATE relationships SET subject_id = keep_id WHERE subject_type = etype AND subject_id = dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE relationships SET object_id = keep_id WHERE object_type = etype AND object_id = dup_id;
  GET DIAGNOSTICS m = ROW_COUNT;
  IF n + m > 0 THEN moved := moved || jsonb_build_object('relationships', n + m); END IF;

  -- the kept entry's parent was the duplicate: now the duplicate's parent
  IF (keep_row ->> 'parent_id')::bigint = dup_id THEN
    EXECUTE format('UPDATE %I SET parent_id = $1 WHERE id = $2', tbl) USING nullif((dup_row ->> 'parent_id')::bigint, keep_id), keep_id;
    keep_row := keep_row || jsonb_build_object('parent_id', nullif((dup_row ->> 'parent_id')::bigint, keep_id));
  END IF;
  -- an artwork's provenance steps and any entry's images: the duplicate's after the kept one's (an image both have: once)
  IF etype = 'artwork' THEN
    UPDATE provenance SET position = position + (SELECT coalesce(max(position), -1) + 1 FROM provenance WHERE artwork_id = keep_id)
     WHERE artwork_id = dup_id;
  END IF;
  FOR r IN SELECT a.attname AS col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.conrelid = 'images'::regclass AND c.confrelid = tbl::regclass LOOP
    EXECUTE format('DELETE FROM images d WHERE d.%1$I = $1 AND EXISTS (SELECT 1 FROM images k WHERE k.%1$I = $2 AND k.url = d.url)', r.col)
      USING dup_id, keep_id;
    EXECUTE format('UPDATE images SET position = position + (SELECT coalesce(max(position), -1) + 1 FROM images WHERE %1$I = $2) WHERE %1$I = $1', r.col)
      USING dup_id, keep_id;
  END LOOP;

  -- an artwork's further numbers (048) the kept one has already: once is enough (moving them would collide)
  IF etype = 'artwork' THEN
    DELETE FROM artwork_numbers d WHERE d.artwork_id = dup_id
       AND (CASE WHEN d.institution_id IS NOT NULL THEN 'i:' || d.institution_id ELSE 's:' || d.source_id END)
           || ':' || lower(btrim(d.number)) = ANY (public.artwork_number_keys(keep_id));
  END IF;

  -- every foreign key that points at this table: creator, institution, place, parent, provenance owner, images …
  FOR r IN SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.confrelid = tbl::regclass AND cardinality(c.conkey) = 1 LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.child, r.col, r.col) USING keep_id, dup_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN moved := moved || jsonb_build_object(r.child || '.' || r.col, n); END IF;
  END LOOP;

  -- bookkeeping by (type, id)
  UPDATE auto_created SET created_from_id = keep_id WHERE created_from_type = etype AND created_from_id = dup_id;
  UPDATE wikidata_reviews d SET entity_id = keep_id WHERE d.entity_type = etype AND d.entity_id = dup_id
     AND NOT EXISTS (SELECT 1 FROM wikidata_reviews k WHERE k.entity_type = etype AND k.entity_id = keep_id AND k.item = d.item);
  DELETE FROM wikidata_reviews WHERE entity_type = etype AND entity_id = dup_id;
  DELETE FROM live_docs WHERE entity_type = etype AND entity_id = dup_id;
  DELETE FROM admin_drafts WHERE entity_type = etype AND entity_id = dup_id;
  UPDATE slug_history SET entity_id = keep_id WHERE entity_type = etype AND entity_id = dup_id;

  -- its citations (049) now speak for the kept entry; where the kept value differs, they show as outdated
  UPDATE citations SET entity_id = keep_id WHERE entity_type = etype AND entity_id = dup_id;

  -- the duplicate goes; its address now leads to the kept entry
  EXECUTE format('DELETE FROM %I WHERE id = $1', tbl) USING dup_id;
  INSERT INTO slug_history (entity_type, old_slug, entity_id) VALUES (etype, dup_row ->> 'slug', keep_id)
  ON CONFLICT (entity_type, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, changed_at = now();

  -- fill what the kept entry lacks, group by group (after the delete: the Wikidata id is unique)
  FOR g IN
    SELECT grp, array_agg(attname::text) AS cols FROM (
      SELECT attname, CASE WHEN attname IN ('height_cm', 'width_cm', 'depth_cm', 'dimensions_note', 'other_dimensions') THEN 'dimensions'
                           WHEN attname IN ('current_institution_id', 'inventory_number') THEN 'collection'
                           WHEN attname IN ('parent_id', 'part_number') THEN 'series'
                           WHEN attname IN ('location', 'area', 'boundary_code') THEN 'geometry'
                           WHEN attname IN ('web_url', 'web_url_accessed') THEN 'web'
                           ELSE regexp_replace(attname, '_label$', '') END AS grp
      FROM pg_attribute WHERE attrelid = tbl::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
        AND attname NOT IN ('id', 'slug', 'created_at', 'updated_at', 'sort_name', 'names', 'metadata',
                            name_col, name_col || '_lang', name_col || '_ruby')) c
    GROUP BY grp
  LOOP
    IF NOT EXISTS (SELECT 1 FROM unnest(g.cols) c WHERE NOT public.json_empty(dup_row -> c)) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(g.cols) c WHERE NOT public.json_empty(keep_row -> c))
       AND (dup_row ->> 'parent_id') IS DISTINCT FROM keep_id::text THEN
      merged := merged || (SELECT jsonb_object_agg(c, dup_row -> c) FROM unnest(g.cols) c);
      filled := filled || ARRAY(SELECT c FROM unnest(g.cols) c WHERE NOT public.json_empty(dup_row -> c));
    ELSE
      differing := differing || ARRAY(SELECT c FROM unnest(g.cols) c
                                      WHERE NOT public.json_empty(dup_row -> c) AND (keep_row -> c) IS DISTINCT FROM (dup_row -> c));
    END IF;
  END LOOP;
  -- names: the duplicate's name and other names become the kept entry's other names (one "original" at most)
  IF keep_row ? 'names' THEN
    new_names := coalesce(keep_row -> 'names', '[]');
    FOR e IN SELECT value FROM jsonb_array_elements(coalesce(dup_row -> 'names', '[]')
                                                     || jsonb_build_array(jsonb_build_object('text', dup_row ->> name_col, 'role', 'alternative'))) LOOP
      IF lower(e ->> 'text') <> lower(keep_row ->> name_col)
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(new_names) x WHERE lower(x ->> 'text') = lower(e ->> 'text')) THEN
        IF e ->> 'role' = 'original' AND EXISTS (SELECT 1 FROM jsonb_array_elements(new_names) x WHERE x ->> 'role' = 'original') THEN
          e := e || '{"role": "alternative"}';
        END IF;
        new_names := new_names || jsonb_build_array(e);
        added := added + 1;
      END IF;
    END LOOP;
    IF added > 0 THEN merged := merged || jsonb_build_object('names', new_names); END IF;
  END IF;
  IF NOT public.json_empty(dup_row -> 'metadata') THEN
    merged := merged || jsonb_build_object('metadata', (dup_row -> 'metadata') || coalesce(keep_row -> 'metadata', '{}'));
  END IF;
  IF merged <> '{}' THEN
    EXECUTE format('UPDATE %I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r) WHERE id = $2', tbl,
                   (SELECT string_agg(format('%I', k), ', ') FROM jsonb_object_keys(merged) k),
                   (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(merged) k), tbl)
      USING merged, keep_id;
  END IF;

  -- the duplicate's main inventory number, if the kept entry doesn't have it (now): one of its further numbers
  IF etype = 'artwork' AND dup_row ->> 'inventory_number' IS NOT NULL AND dup_row ->> 'current_institution_id' IS NOT NULL
     AND NOT ('i:' || (dup_row ->> 'current_institution_id') || ':' || lower(btrim(dup_row ->> 'inventory_number')))
             = ANY (public.artwork_number_keys(keep_id)) THEN
    INSERT INTO artwork_numbers (artwork_id, number, institution_id, label, position)
    VALUES (keep_id, dup_row ->> 'inventory_number', (dup_row ->> 'current_institution_id')::bigint, 'from a merged entry', 1000);
    moved := moved || jsonb_build_object('artwork_numbers.artwork_id', coalesce((moved ->> 'artwork_numbers.artwork_id')::int, 0) + 1);
  END IF;

  -- [[links]] to the duplicate now name the kept entry
  FOR r IN SELECT * FROM public.markdown_columns LOOP
    EXECUTE format('UPDATE %I SET %I = public.current_links(%2$I) WHERE %2$I LIKE %L', r.tbl, r.col, '%[[%' || (dup_row ->> 'slug') || '%');
    GET DIAGNOSTICS n = ROW_COUNT;
    texts := texts + n;
  END LOOP;

  PERFORM set_config('arthistory.source', coalesce(prev_source, ''), true);
  RETURN jsonb_build_object('kept', keep_row ->> 'slug', 'removed', dup_row ->> 'slug', 'moved', moved,
                            'filled', to_jsonb(filled), 'differing', to_jsonb(differing), 'names_added', added, 'texts', texts);
END $$;

-- Quality (048's view): citation_outdated, weakly_sourced.
CREATE OR REPLACE VIEW quality_issues AS
WITH rel AS (
  SELECT r.*, rt.label AS type_label, rt.is_physical_presence,
         o.name AS object_name, coalesce(r.period_label, (range_json(r.period))->>'from_year') AS when_text
  FROM relationships r
  JOIN relationship_types rt ON rt.code = r.relationship_type
  JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
)
-- ── errors: contradictions ─────────────────────────────────────────────────────────────────────────────────────
-- Physically somewhere while not alive (the lifespan is open-ended while the death is unknown)
SELECT 'presence_outside_lifespan' AS check_id, 'error' AS severity, 'artist'::entity_type AS entity_type, a.id AS entity_id,
       'rel:' || r.id AS issue_key,
       format('%s %s (%s) lies outside the lifespan', r.type_label, r.object_name, r.when_text) AS detail
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.is_physical_presence AND r.period IS NOT NULL AND a.birth IS NOT NULL AND NOT (r.period && a.lifespan)
UNION ALL
-- "born in" / "died in" dated differently from the birth / death date
SELECT 'birth_death_mismatch', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s is dated %s, the %s %s', r.type_label, r.object_name, r.when_text,
              CASE r.relationship_type WHEN 'born_in' THEN 'birth' ELSE 'death' END,
              CASE r.relationship_type WHEN 'born_in' THEN a.birth_label ELSE a.death_label END)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.period IS NOT NULL AND ((r.relationship_type = 'born_in' AND a.birth IS NOT NULL AND NOT (r.period && a.birth))
                             OR (r.relationship_type = 'died_in' AND a.death IS NOT NULL AND NOT (r.period && a.death)))
UNION ALL
-- Created after the artist's death / before their birth (>> and <<: no overlap at all, so fuzzy dates don't trigger it)
SELECT 'artwork_outside_creator_life', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('created %s, but %s %s %s', w.created_label, a.name,
              CASE WHEN w.created >> a.death THEN 'died' ELSE 'was born' END,
              CASE WHEN w.created >> a.death THEN a.death_label ELSE a.birth_label END)
FROM artworks w JOIN artists a ON a.id = w.creator_id
WHERE w.created IS NOT NULL AND ((a.death IS NOT NULL AND w.created >> a.death) OR (a.birth IS NOT NULL AND w.created << a.birth))
UNION ALL
-- Teacher and student (or collaborators, "contemporaries") who were never alive at the same time
SELECT 'never_alive_together', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s, but their lifespans do not overlap', r.type_label, r.object_name)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
JOIN artists b ON r.object_type = 'artist' AND b.id = r.object_id
WHERE r.relationship_type IN ('student_of', 'collaborated_with', 'contemporary_of')
  AND a.birth IS NOT NULL AND b.birth IS NOT NULL AND NOT (a.lifespan && b.lifespan)
UNION ALL
-- An inventory number without the institution whose collection numbered it (enforced for changes by
-- artworks_inventory_needs_institution, migration 016 — this finds rows that existed before)
SELECT 'inventory_without_institution', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('inventory number %s, but no institution', w.inventory_number)
FROM artworks w WHERE w.inventory_number IS NOT NULL AND w.current_institution_id IS NULL
UNION ALL
-- A dated link to a polity outside the polity's existence (nationality USSR in 1900)
SELECT 'outside_polity_period', 'error', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s (%s) lies outside the existence of %s (%s)', r.type_label, r.object_name, r.when_text, r.object_name,
              coalesce(p.period_label, concat_ws('–', (range_json(p.period))->>'from_year', (range_json(p.period))->>'to_year')))
FROM rel r JOIN polities p ON r.object_type = 'polity' AND p.id = r.object_id
WHERE r.period IS NOT NULL AND p.period IS NOT NULL AND NOT (r.period && p.period)
UNION ALL
-- ── warnings: probably a problem ───────────────────────────────────────────────────────────────────────────────
-- A [[link]] in a text to a glossary term that doesn't exist (yet)
SELECT 'broken_glossary_link', 'warning', l.entity_type, l.entity_id, 'gl:' || l.entity_type || ':' || l.entity_id || ':' || l.term_slug,
       format('links to the glossary term "%s", which doesn''t exist', l.term_slug)
FROM glossary_links l WHERE NOT EXISTS (SELECT 1 FROM glossary g WHERE g.slug = l.term_slug)
UNION ALL
-- Provenance (031): an undocumented change of owner whose gap lies in or across 1933–1945 — the standard red flag
-- of Nazi-era provenance research. The gap runs from the previous owner's last documented holding (their recorded
-- end, else their acquisition) to this acquisition; && is the range overlap operator.
SELECT 'provenance_gap_1933_1945', 'warning', 'artwork', p.artwork_id, 'prov-gap:' || p.id,
       format('%s: the change of owner (%s) is not documented as direct, and the gap lies in 1933–1945',
              p.owner_name, coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.position > p.first_position AND NOT p.direct AND p.acquired IS NOT NULL AND p.prev_holding IS NOT NULL
  AND lower(p.prev_holding) < upper(p.acquired)
  AND daterange(lower(p.prev_holding), upper(p.acquired)) && daterange('1933-01-30', '1945-05-09')
UNION ALL
-- Confiscated or sold under duress: check whether it was restituted (a later step "restitution")
SELECT 'provenance_forced_transfer', 'warning', 'artwork', p.artwork_id, 'prov-forced:' || p.id,
       format('%s: %s (%s) — no later restitution recorded', p.owner_name, replace(p.method::text, '_', ' '), coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.method IN ('confiscation', 'forced_sale')
  AND NOT EXISTS (SELECT 1 FROM provenance r WHERE r.artwork_id = p.artwork_id AND r.position > p.position AND r.method = 'restitution')
UNION ALL
-- The last owner in the provenance is not the institution that holds the work now
SELECT 'provenance_last_owner', 'warning', 'artwork', w.id, 'prov-last:' || w.id,
       format('the provenance ends with %s, but the work is at %s', p.owner_name, i.name)
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
JOIN provenance_periods p ON p.artwork_id = w.id AND p.is_last
WHERE p.owner_institution_id IS DISTINCT FROM w.current_institution_id
  AND NOT w.on_loan                                      -- a loan: the owner is someone else on purpose (048)
UNION ALL
-- On loan, but the provenance says the borrower owns it — or names no owner at all
SELECT 'loan_owner', 'warning', 'artwork', w.id, 'loan:' || w.id,
       CASE WHEN p.artwork_id IS NULL THEN format('on loan at %s — but the provenance names no owner (the lender)', i.name)
            ELSE format('on loan at %s — but the provenance ends with %s itself', i.name, i.name) END
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
LEFT JOIN provenance_periods p ON p.artwork_id = w.id AND p.is_last
WHERE w.on_loan AND (p.artwork_id IS NULL OR p.owner_institution_id = w.current_institution_id)
UNION ALL
-- A [[type/slug]] link to an entry that doesn't exist (030) — a typo, a renamed slug, a deleted entry, an unknown type
SELECT 'broken_link', 'warning', l.entity_type, l.entity_id, 'link:' || l.entity_type || ':' || l.entity_id || ':' || l.target_type || '/' || l.target_slug,
       format('links to %s/%s, which doesn''t exist', l.target_type, l.target_slug)
FROM content_links l
WHERE l.target_type <> 'term'
  AND NOT EXISTS (SELECT 1 FROM entity_index e WHERE e.type::text = l.target_type AND e.slug = l.target_slug)
UNION ALL
-- Living in two places at the same time (can be right: a summer house). r1.period * r2.period is the intersection of
-- the two ranges; fuzzy boundaries overlap a little ("Paris until February 1888", "Arles from 20 February 1888"; moving
-- on 8 May gives both periods that day), so only a substantial overlap counts: more than a month, and either more than
-- a year, or one period containing the other, or more than half of the shorter one.
SELECT 'overlapping_residences', 'warning', r1.subject_type, r1.subject_id, 'rel:' || r1.id || ':' || r2.id,
       format('lived in %s (%s) and %s (%s) at the same time', r1.object_name, r1.when_text, r2.object_name, r2.when_text)
FROM rel r1 JOIN rel r2 ON r2.subject_type = r1.subject_type AND r2.subject_id = r1.subject_id AND r2.id > r1.id
CROSS JOIN LATERAL (SELECT r1.period * r2.period AS i) x
CROSS JOIN LATERAL (SELECT coalesce(upper(x.i), lower(x.i) + 36500) - lower(x.i) AS days,
                           least(coalesce(upper(r1.period), lower(r1.period) + 36500) - lower(r1.period),
                                 coalesce(upper(r2.period), lower(r2.period) + 36500) - lower(r2.period)) AS shorter) d
WHERE r1.relationship_type = 'lived_in' AND r2.relationship_type = 'lived_in' AND r1.object_id <> r2.object_id
  AND r1.period && r2.period
  AND d.days > 31 AND (d.days > 366 OR r1.period @> r2.period OR r2.period @> r1.period OR d.days * 2 > d.shorter)
UNION ALL
-- Held by an institution before it was founded
SELECT 'held_before_founded', 'warning', 'artwork', r.subject_id, 'rel:' || r.id,
       format('housed at %s (%s), founded %s', r.object_name, r.when_text, i.founded_label)
FROM rel r JOIN institutions i ON r.object_type = 'institution' AND i.id = r.object_id
WHERE r.relationship_type = 'housed_at' AND r.period IS NOT NULL AND i.founded IS NOT NULL AND r.period << i.founded
UNION ALL
-- A place outside the outline of its parent region (PostGIS: ST_Covers on geography)
SELECT 'outside_parent_area', 'warning', 'place', c.id, 'place:' || c.id,
       format('its point lies outside the outline of %s (%s km away)', p.name,
              round((ST_Distance(pg.outline, cg.marker) / 1000)::numeric))
FROM places c JOIN places p ON p.id = c.parent_id
JOIN place_geo cg ON cg.id = c.id JOIN place_geo pg ON pg.id = p.id
WHERE pg.outline IS NOT NULL AND c.location IS NOT NULL AND NOT ST_DWithin(pg.outline, cg.marker, 5000)
UNION ALL
-- Probable duplicates: weighed by dup_score (names and evidence), 044
SELECT 'possible_duplicate', 'warning', a.type, a.id, 'dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id),
       format('probably the same as %s (%s) — %s (score %s)', b.name, b.slug, array_to_string(s.reasons, ', '), s.score)
FROM dup_facts a JOIN dup_facts b ON b.type = a.type AND b.id <> a.id
CROSS JOIN LATERAL dup_score(a, b) s
WHERE dup_maybe(a, b) AND s.score >= 50
UNION ALL
SELECT 'artwork_without_creator', 'warning', 'artwork', w.id, 'artwork:' || w.id, 'no creator and no attribution'
FROM artworks w WHERE w.creator_id IS NULL AND w.attribution_label IS NULL
UNION ALL
SELECT 'image_without_license', 'warning',
       i.entity_type, i.entity_id, 'image:' || i.id,
       concat_ws(' and ', CASE WHEN i.license IS NULL THEN 'no license' END, CASE WHEN i.credit IS NULL THEN 'no credit' END)
       || ' for image ' || i.position + 1 || coalesce(' (' || i.caption || ')', '')
FROM images i WHERE i.license IS NULL OR i.credit IS NULL
UNION ALL
SELECT 'no_relationships', 'warning', e.type, e.id, e.type || ':' || e.id, 'not connected to anything'
FROM entity_index e
WHERE NOT EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id) = (e.type, e.id) OR (r.object_type, r.object_id) = (e.type, e.id))
  AND NOT (e.type = 'artwork' AND EXISTS (SELECT 1 FROM artworks w WHERE w.id = e.id AND (w.creator_id IS NOT NULL OR w.current_institution_id IS NOT NULL)))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM institutions i WHERE i.place_id = e.id))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM places c WHERE c.parent_id = e.id))        -- contains other places
  AND NOT (e.type = 'movement' AND EXISTS (SELECT 1 FROM movements c WHERE c.parent_id = e.id))  -- has sub-movements
  AND NOT (e.type = 'polity' AND EXISTS (SELECT 1 FROM polities c WHERE c.parent_id = e.id))     -- has parts
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM events v WHERE v.place_id = e.id))        -- where something happened
  AND NOT (e.type = 'event' AND EXISTS (SELECT 1 FROM events v WHERE (v.id = e.id AND (v.place_id IS NOT NULL OR v.parent_id IS NOT NULL))
                                                                    OR v.parent_id = e.id))     -- has a place, a whole or parts
  AND e.type NOT IN ('term', 'source')                                                             -- linked from texts                                                                             -- linked from texts
  AND NOT (e.type = 'institution' AND EXISTS (SELECT 1 FROM artworks w WHERE w.current_institution_id = e.id))
  AND NOT (e.type = 'artist' AND EXISTS (SELECT 1 FROM artworks w WHERE w.creator_id = e.id))
UNION ALL
SELECT 'artist_missing_dates', 'warning', 'artist', a.id, 'artist:' || a.id,
       concat_ws(' and ', CASE WHEN a.birth IS NULL THEN 'no birth date' END, CASE WHEN a.death IS NULL THEN 'no death date' END)
FROM artists a WHERE a.birth IS NULL OR a.death IS NULL
UNION ALL
-- Created automatically (as an artwork's creator / institution, or by the Wikidata comparison) and not edited since
SELECT 'auto_created', 'warning', ac.entity_type, ac.entity_id, 'auto:' || ac.entity_type || ':' || ac.entity_id,
       'created automatically' || coalesce(' while adding ' || f.name, '') || ' — fill in the details'
FROM auto_created ac
LEFT JOIN entity_index f ON f.type = ac.created_from_type AND f.id = ac.created_from_id
UNION ALL
-- ── info: incomplete ───────────────────────────────────────────────────────────────────────────────────────────
-- A part of a series / album / triptych without creator or date, while the whole has one
SELECT 'part_missing_data', 'info', 'artwork', a.id, 'artwork:' || a.id,
       format('no %s — its whole, %s, has %s', concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'creator' END,
                                                             CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN 'date' END),
              w.title, concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'one' END,
                                          CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN coalesce(w.created_label, 'one') END))
FROM artworks a JOIN artworks w ON w.id = a.parent_id
WHERE (a.creator_id IS NULL AND w.creator_id IS NOT NULL) OR (a.created IS NULL AND w.created IS NOT NULL)
UNION ALL
-- An institution without its city (place): with a point of its own, the nearest settlement within 25 km is suggested
SELECT 'institution_without_place', 'info', 'institution', i.id, 'institution:' || i.id,
       CASE WHEN s.slug IS NOT NULL THEN format('no place (city) — it lies %s km from %s (%s)', s.km, s.name, s.slug)
            ELSE 'no place (city) set — the map can''t show it unless it has its own point' END
FROM institutions i
LEFT JOIN LATERAL (SELECT p.slug, p.name, round((ST_Distance(g.marker, i.location) / 1000)::numeric, 1) AS km
                   FROM places p JOIN place_geo g ON g.id = p.id
                   WHERE i.location IS NOT NULL AND p.kind = 'settlement' AND ST_DWithin(g.marker, i.location, 25000)
                   ORDER BY g.marker <-> i.location LIMIT 1) s ON true
WHERE i.place_id IS NULL
UNION ALL
-- A place without parent whose point lies inside another place's outline: the smallest such place is suggested
SELECT 'parent_suggestion', 'info', 'place', c.id, 'place:' || c.id || ':' || s.id,
       format('lies inside %s (%s) — set it as parent', s.name, s.slug)
FROM places c JOIN place_geo cg ON cg.id = c.id
CROSS JOIN LATERAL (SELECT p.id, p.name, p.slug FROM places p JOIN place_geo pg ON pg.id = p.id
                    WHERE p.id <> c.id AND pg.outline IS NOT NULL AND ST_Covers(pg.outline, cg.marker)
                    ORDER BY ST_Area(pg.outline) LIMIT 1) s
WHERE c.parent_id IS NULL AND c.kind <> 'country'
UNION ALL
-- A country or region without an outline, while Natural Earth has one with that code / that name in that country
SELECT 'boundary_available', 'info', 'place', p.id, 'place:' || p.id || ':' || b.code,
       format('an outline is available: %s (%s) — set the boundary code', b.name, b.code)
FROM places p
CROSS JOIN LATERAL (SELECT code, name FROM boundaries b
                    WHERE (p.kind = 'country' AND b.level = 0 AND b.code = p.country_code)
                       OR (p.kind = 'region' AND b.level = 1 AND b.country_code = place_country(p.id)->>'code'
                           AND lower(f_unaccent(b.name)) = lower(f_unaccent(p.name)))
                    LIMIT 1) b
WHERE p.kind IN ('country', 'region') AND p.area IS NULL AND p.boundary_code IS NULL
UNION ALL
-- A name without any Latin letter (kanji, Cyrillic, Arabic …) and no romanization: hard to find and to sort
SELECT 'missing_romanization', 'info', e.type, e.id, e.type || ':' || e.id, format('"%s" has no romanization', e.name)
FROM entity_index e
WHERE e.name !~ '[A-Za-zÀ-ɏ]' AND NOT jsonb_path_exists(e.names, '$[*] ? (@.role == "romanization")')
UNION ALL
-- Without a period a presence can't be placed on the timeline or the travel route
SELECT 'presence_without_period', 'info', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s has no date — not on the timeline or route', r.type_label, r.object_name)
FROM rel r WHERE r.is_physical_presence AND r.period IS NULL
UNION ALL
SELECT 'place_without_parent', 'info', 'place', p.id, 'place:' || p.id, 'not inside any other place (no parent)'
FROM places p WHERE p.parent_id IS NULL AND p.kind <> 'country'
UNION ALL
SELECT 'missing_description', 'info', t.type, t.id, t.type || ':' || t.id, 'no description / biography'
FROM (SELECT 'artist'::entity_type AS type, id, biography_md AS md FROM artists
      UNION ALL SELECT 'artwork', id, description_md FROM artworks
      UNION ALL SELECT 'place', id, description_md FROM places
      UNION ALL SELECT 'movement', id, description_md FROM movements
      UNION ALL SELECT 'institution', id, description_md FROM institutions
      UNION ALL SELECT 'person', id, description_md FROM people
      UNION ALL SELECT 'polity', id, description_md FROM polities
      UNION ALL SELECT 'event', id, description_md FROM events
      UNION ALL SELECT 'term', id, description_md FROM glossary WHERE definition IS NULL) t
WHERE t.md IS NULL
UNION ALL
SELECT 'no_wikidata_id', 'info', t.type, t.id, t.type || ':' || t.id, 'no Wikidata id (compare with Wikidata to add it)'
FROM (SELECT 'artist'::entity_type AS type, id, wikidata_id FROM artists
      UNION ALL SELECT 'artwork', id, wikidata_id FROM artworks
      UNION ALL SELECT 'place', id, wikidata_id FROM places
      UNION ALL SELECT 'movement', id, wikidata_id FROM movements
      UNION ALL SELECT 'institution', id, wikidata_id FROM institutions
      UNION ALL SELECT 'person', id, wikidata_id FROM people
      UNION ALL SELECT 'polity', id, wikidata_id FROM polities
      UNION ALL SELECT 'event', id, wikidata_id FROM events) t
WHERE t.wikidata_id IS NULL
UNION ALL
-- An event without any place: it can't appear on the map
SELECT 'event_without_place', 'info', 'event', v.id, 'event:' || v.id, 'no place, point or area'
FROM events v WHERE v.place_id IS NULL AND v.location IS NULL AND v.area IS NULL
UNION ALL
-- A field whose value changed after a source was cited for it (049): does the source still support it?
SELECT 'citation_outdated', 'warning', c.entity_type, c.entity_id, 'cite:' || c.id,
       format('%s changed since it was cited (%s)', c.field, c.source_text)
FROM citation_status c WHERE c.outdated
UNION ALL
-- Fields without a source better than an aggregated database (049): one row per entry, the weakest first — the list
-- to revisit (Wikidata now, the museum or the literature later)
SELECT 'weakly_sourced', 'info', w.entity_type, w.entity_id, 'sourced:' || w.entity_type || ':' || w.entity_id,
       concat_ws(' · ', 'no source: ' || string_agg(w.field, ', ' ORDER BY w.position) FILTER (WHERE w.best IS NULL),
                        'only Wikidata / databases: ' || string_agg(w.field, ', ' ORDER BY w.position) FILTER (WHERE w.best = 'database'))
FROM field_sourcing w WHERE w.best IS NULL OR w.best = 'database'
GROUP BY w.entity_type, w.entity_id;
