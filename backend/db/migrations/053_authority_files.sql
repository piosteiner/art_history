-- 053 — Authority files: the numbers under which libraries and research institutes record a person, an institution,
-- a work — Getty ULAN, the GND of the Deutsche Nationalbibliothek, VIAF, SIKART, RKD, the Library of Congress. They say
-- exactly who is meant (two "Paul Klee"s can't share a GND number), they link to curated records, and the GND's open
-- data (lobid.org, CC0) can be compared with ours like Wikidata (src/admin/gnd.js).
CREATE TABLE authorities (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z]+$'),
  name       text NOT NULL,
  url_template text NOT NULL CHECK (url_template LIKE '%{id}%'),   -- the record's page: {id} is the number
  pattern    text NOT NULL,                                        -- what a number looks like (a regular expression)
  wikidata_property text CHECK (wikidata_property ~ '^P[0-9]+$'),  -- where Wikidata keeps it
  entity_types entity_type[] NOT NULL,                             -- what it records
  position   int NOT NULL
);
INSERT INTO authorities VALUES
  ('ulan',   'Getty ULAN', 'https://www.getty.edu/vow/ULANFullDisplay?find=&role=&nation=&subjectid={id}', '^500[0-9]{6}$', 'P245', '{artist,person,institution}', 1),
  ('gnd',    'GND (Deutsche Nationalbibliothek)', 'https://d-nb.info/gnd/{id}', '^[0-9X-]{6,12}$', 'P227', '{artist,person,institution,place,movement,event,artwork,term}', 2),
  ('viaf',   'VIAF', 'https://viaf.org/viaf/{id}', '^[0-9]{2,22}$', 'P214', '{artist,person,institution,artwork}', 3),
  ('sikart', 'SIKART', 'https://www.sikart.ch/KuenstlerInnen.aspx?id={id}', '^[0-9]{4,10}$', 'P781', '{artist,person}', 4),
  ('rkd',    'RKDartists', 'https://rkd.nl/explore/artists/{id}', '^[0-9]{1,7}$', 'P650', '{artist,person}', 5),
  ('lc',     'Library of Congress', 'https://id.loc.gov/authorities/names/{id}', '^n[a-z]?[0-9]+$', 'P244', '{artist,person,institution}', 6);

-- An entry's numbers: one per authority. A number names one thing: UNIQUE (authority, value) — the same GND number on
-- two entries is the same person entered twice (the hard rule of 044, here for every authority).
CREATE TABLE entry_identifiers (
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  authority   text NOT NULL REFERENCES authorities ON UPDATE CASCADE,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, authority),
  CONSTRAINT entry_identifiers_unique UNIQUE (authority, value)
);
-- The number must look like one of that authority and the authority must record this kind of entry; and the entry
-- must exist (no foreign key reaches "one of nine tables", as for relationships and citations).
CREATE FUNCTION check_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a authorities;
BEGIN
  SELECT * INTO a FROM authorities WHERE code = NEW.authority;
  NEW.value := btrim(NEW.value);
  IF NEW.value !~ a.pattern THEN
    RAISE EXCEPTION '% is not a % number', NEW.value, a.name USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_identifiers_pattern';
  END IF;
  IF NOT NEW.entity_type = ANY (a.entity_types) THEN
    RAISE EXCEPTION '% does not record a %', a.name, NEW.entity_type USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_identifiers_type';
  END IF;
  IF NOT entity_exists(NEW.entity_type, NEW.entity_id) THEN
    RAISE EXCEPTION '% #% does not exist', NEW.entity_type, NEW.entity_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_identifiers_check BEFORE INSERT OR UPDATE ON entry_identifiers FOR EACH ROW EXECUTE FUNCTION check_identifier();
CREATE TRIGGER entry_identifiers_audit AFTER INSERT OR UPDATE OR DELETE ON entry_identifiers FOR EACH ROW EXECUTE FUNCTION audit_row();
-- audit_row reads the row id from "id": a key of its own for the history
ALTER TABLE entry_identifiers ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY UNIQUE;

-- The GND as a source of the bibliography: values taken from a GND record are cited with it (and the record's page).
-- A library's authority file, curated: reliability "institution" — above Wikidata.
INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
VALUES ('gnd', 'web', 'Gemeinsame Normdatei (GND)', 'GND', 'https://d-nb.info/gnd/', 'institution', 'Deutsche Nationalbibliothek')
ON CONFLICT (slug) DO NOTHING;

-- Deleting an entry deletes its numbers (the generic delete trigger, one more line).
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
  DELETE FROM entry_identifiers WHERE entity_type = etype AND entity_id = OLD.id;  -- its authority numbers (053)
  RETURN OLD;
END $$;

-- Merge (044/048/049): the duplicate's numbers move to the kept entry where it has none of that authority.
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
  -- its authority numbers (053): those the kept entry has no number of that authority for; the rest go with it
  UPDATE entry_identifiers d SET entity_id = keep_id WHERE d.entity_type = etype AND d.entity_id = dup_id
     AND NOT EXISTS (SELECT 1 FROM entry_identifiers k WHERE k.entity_type = etype AND k.entity_id = keep_id AND k.authority = d.authority);
  DELETE FROM entry_identifiers WHERE entity_type = etype AND entity_id = dup_id;

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
