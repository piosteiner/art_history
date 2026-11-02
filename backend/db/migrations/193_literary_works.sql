-- 193 — Literary works (192: the type). What a story is, written when and by whom, its chapters, a summary — and the
-- works of art that illustrate it or took it up. Shaped like events (047): names in several languages with furigana,
-- a kind (free text with suggestions: tale, novel, poem, poetry anthology, play, sutra, myth, epic …), parts (chapters,
-- acts, poems of an anthology) as children with a number, like a series (037).
CREATE TABLE literary_works (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  name_lang text CHECK (lang_tag_ok(name_lang)),
  name_ruby text,
  names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names)),
  kind text,
  parent_id bigint REFERENCES literary_works ON DELETE RESTRICT,
  part_number text,                       -- "5", "38", "Act 2"
  part_sort numeric GENERATED ALWAYS AS (CASE WHEN part_number ~ '^[0-9]+(\.[0-9]+)?$' THEN part_number::numeric END) STORED,
  written daterange,                      -- when it was written (a fuzzy date as everywhere: "early 11th century")
  written_label text,
  description_md text,                    -- the summary
  wikidata_id text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  public_id bigint NOT NULL UNIQUE DEFAULT nextval('entity_public_id_seq'),
  CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  CHECK (parent_id <> id)
);
CREATE INDEX literary_works_parent_idx ON literary_works (parent_id);
CREATE INDEX literary_works_written_gist ON literary_works USING gist (written);
CREATE INDEX literary_works_name_trgm ON literary_works USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX literary_works_alt_trgm ON literary_works USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
CREATE INDEX literary_works_search_idx ON literary_works USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text));
CREATE TRIGGER derived_touch AFTER INSERT OR DELETE OR UPDATE ON literary_works FOR EACH ROW EXECUTE FUNCTION derived_touch('literature.id+', 'literature.parent_id');
CREATE TRIGGER entry_names_sync AFTER INSERT OR DELETE OR UPDATE OF names ON literary_works FOR EACH ROW EXECUTE FUNCTION entry_names_sync('literature');
CREATE TRIGGER literary_works_audit AFTER INSERT OR DELETE OR UPDATE ON literary_works FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER literary_works_delete_relationships AFTER DELETE ON literary_works FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships('literature');
CREATE TRIGGER literary_works_no_parent_cycle BEFORE INSERT OR UPDATE OF parent_id ON literary_works FOR EACH ROW EXECUTE FUNCTION no_parent_cycle();
CREATE TRIGGER literary_works_old_links BEFORE INSERT OR UPDATE OF description_md ON literary_works FOR EACH ROW EXECUTE FUNCTION correct_old_links('description_md');
CREATE TRIGGER literary_works_public_id_history AFTER DELETE ON literary_works FOR EACH ROW EXECUTE FUNCTION remember_public_id('literature');
CREATE CONSTRAINT TRIGGER literary_works_public_id_unique AFTER INSERT OR UPDATE OF public_id ON literary_works DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('literature');
CREATE TRIGGER literary_works_slug_history AFTER UPDATE OF slug ON literary_works FOR EACH ROW EXECUTE FUNCTION record_slug_change('literature');
CREATE TRIGGER literary_works_slug_release AFTER INSERT ON literary_works FOR EACH ROW EXECUTE FUNCTION release_old_slug('literature');
CREATE TRIGGER literary_works_updated_at BEFORE UPDATE ON literary_works FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER text_links_touch AFTER INSERT OR DELETE OR UPDATE ON literary_works FOR EACH ROW EXECUTE FUNCTION text_links_touch();

-- a source of the bibliography that is an edition or translation of a literary work (Tyler 2001 → The Tale of Genji):
-- the work's page lists it under "Editions and translations"
ALTER TABLE bibliography ADD COLUMN edition_of bigint REFERENCES literary_works ON DELETE SET NULL;
CREATE INDEX bibliography_edition_of_idx ON bibliography (edition_of) WHERE edition_of IS NOT NULL;

-- the intersection of art and literature: who wrote it, which works of art illustrate it or took it up, what it is
-- based on — one category "literature" (its own colour in the graph)
INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, description, sort_order) VALUES
  ('written_by', 'written by', 'wrote', 'literature', '{literature}', '{person,artist}',
   'Its author — several for a work written together; the label can say which part ("chapters 42–54", "the poems"). An anonymous work has none.', 95),
  ('illustrates', 'illustrates', 'illustrated by', 'literature', '{artwork}', '{literature}',
   'A work of art that shows scenes of a literary work: a handscroll of the Tale of Genji, a print of a Noh play. Link the chapter when it is known (a chapter is a part of the work).', 96),
  ('inspired_by', 'inspired by', 'inspired', 'literature', '{artwork,artist,movement,literature}', '{literature}',
   'Took its subject, mood or idea from a literary work without illustrating a scene of it — a series after a poem, a painter steeped in a novel.', 97),
  ('based_on', 'based on', 'adapted as', 'literature', '{literature}', '{literature}',
   'An adaptation or retelling: the Noh play Aoi no Ue is based on the chapter "Aoi" of the Tale of Genji.', 98);

-- every list of types names the new one (generated from the definitions as of 191; each adds a literature line or branch)
CREATE OR REPLACE FUNCTION public.entity_table(etype entity_type)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE etype WHEN 'polity' THEN 'polities' WHEN 'person' THEN 'people' WHEN 'term' THEN 'glossary'
                    WHEN 'source' THEN 'bibliography' WHEN 'literature' THEN 'literary_works' ELSE etype::text || 's' END
$function$;

CREATE OR REPLACE FUNCTION public.entity_exists(etype entity_type, eid bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'person'      THEN EXISTS (SELECT 1 FROM people       WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
    WHEN 'polity'      THEN EXISTS (SELECT 1 FROM polities     WHERE id = eid)
    WHEN 'term'        THEN EXISTS (SELECT 1 FROM glossary     WHERE id = eid)
    WHEN 'source'      THEN EXISTS (SELECT 1 FROM bibliography WHERE id = eid)
    WHEN 'event'       THEN EXISTS (SELECT 1 FROM events       WHERE id = eid)
    WHEN 'literature'  THEN EXISTS (SELECT 1 FROM literary_works WHERE id = eid)
  END
$function$;

CREATE OR REPLACE FUNCTION public.entity_id(etype entity_type, eslug text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'person'      THEN (SELECT id FROM people       WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
    WHEN 'polity'      THEN (SELECT id FROM polities     WHERE slug = eslug)
    WHEN 'term'        THEN (SELECT id FROM glossary     WHERE slug = eslug)
    WHEN 'source'      THEN (SELECT id FROM bibliography WHERE slug = eslug)
    WHEN 'event'       THEN (SELECT id FROM events       WHERE slug = eslug)
    WHEN 'literature'  THEN (SELECT id FROM literary_works WHERE slug = eslug)
  END
$function$;

CREATE OR REPLACE FUNCTION public.entry_log(etype entity_type, eid bigint)
 RETURNS TABLE(id bigint, changed_at timestamp with time zone, txid xid8, table_name text, row_id bigint, action audit_action, old_row jsonb, new_row jsonb, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH own AS (SELECT CASE etype WHEN 'artist' THEN 'artists' WHEN 'artwork' THEN 'artworks' WHEN 'institution' THEN 'institutions'
                 WHEN 'person' THEN 'people' WHEN 'movement' THEN 'movements' WHEN 'place' THEN 'places' WHEN 'polity' THEN 'polities'
                 WHEN 'term' THEN 'glossary' WHEN 'source' THEN 'bibliography' WHEN 'event' THEN 'events' WHEN 'literature' THEN 'literary_works' END AS tbl),
  ends AS (SELECT jsonb_build_object('subject_type', etype, 'subject_id', eid) AS s, jsonb_build_object('object_type', etype, 'object_id', eid) AS o,
                  jsonb_build_object('entity_type', etype, 'entity_id', eid) AS e, jsonb_build_object('artwork_id', eid) AS w)
  SELECT a.id, a.changed_at, a.txid, a.table_name, a.row_id, a.action, public_row(a.old_row), public_row(a.new_row), a.source
  FROM audit_log a, own, ends
  WHERE (a.table_name = own.tbl AND a.row_id = eid)
     OR (a.table_name = 'relationships' AND (a.new_row @> ends.s OR a.old_row @> ends.s OR a.new_row @> ends.o OR a.old_row @> ends.o))
     OR (a.table_name IN ('citations', 'images') AND (a.new_row @> ends.e OR a.old_row @> ends.e))
     OR (etype = 'artwork' AND a.table_name IN ('provenance', 'artwork_numbers') AND (a.new_row @> ends.w OR a.old_row @> ends.w))
$function$;

CREATE OR REPLACE FUNCTION public.site_stats_counts()
 RETURNS TABLE(metric text, value bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'entries.artworks', count(*) FROM artworks
  UNION ALL SELECT 'entries.artists', count(*) FROM artists
  UNION ALL SELECT 'entries.people', count(*) FROM people
  UNION ALL SELECT 'entries.institutions', count(*) FROM institutions
  UNION ALL SELECT 'entries.places', count(*) FROM places
  UNION ALL SELECT 'entries.movements', count(*) FROM movements
  UNION ALL SELECT 'entries.events', count(*) FROM events
  UNION ALL SELECT 'entries.literary_works', count(*) FROM literary_works
  UNION ALL SELECT 'entries.polities', count(*) FROM polities
  UNION ALL SELECT 'entries.glossary', count(*) FROM glossary
  UNION ALL SELECT 'entries.bibliography', count(*) FROM bibliography
  UNION ALL SELECT 'content.provenance', count(*) FROM provenance
  UNION ALL SELECT 'content.relationships', count(*) FROM relationships
  UNION ALL SELECT 'content.citations', count(*) FROM citations
  UNION ALL SELECT 'content.images', count(*) FROM images
  UNION ALL SELECT 'project.relationship_types', count(*) FROM relationship_types
  UNION ALL SELECT 'project.migrations', count(*) FROM schema_migrations
$function$;

CREATE OR REPLACE FUNCTION public.convert_entry(etype entity_type, eid bigint, new_type entity_type)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  old_tbl text := public.entity_table(etype);
  new_tbl text := public.entity_table(new_type);
  movable entity_type[] := '{artist,person,institution,movement,place,polity,event,term,literature}';
  old_row jsonb; row_json jsonb := '{}'; cols text[]; lost text[] := '{}';
  -- nid: the new row's id (new_id is also a column of entry_moves)
  nid bigint; new_slug text; n bigint; r record; target_col text;
  dropped_rels text[] := '{}'; dropped jsonb := '{}'; texts bigint := 0;
  prev_source text := current_setting('arthistory.source', true);
BEGIN
  IF etype = new_type THEN RAISE EXCEPTION 'It is a % already.', etype; END IF;
  IF NOT etype = ANY (movable) OR NOT new_type = ANY (movable) THEN
    RAISE EXCEPTION 'An % can''t change its type (only artists, people, institutions, movements, places, polities, events, glossary terms and literary works can).',
      CASE WHEN NOT etype = ANY (movable) THEN etype ELSE new_type END;
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 FOR UPDATE', old_tbl) INTO old_row USING eid;
  IF old_row IS NULL THEN RAISE EXCEPTION 'Entry not found.'; END IF;
  PERFORM set_config('arthistory.source', 'convert', true);

  -- what points at the old row and has no counterpart for the new type: refused, with what it is
  FOR r IN SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.confrelid = old_tbl::regclass AND cardinality(c.conkey) = 1 LOOP
    CONTINUE WHEN r.child = 'images' OR (r.child = 'provenance' AND r.col LIKE 'owner\_%');
    IF r.child = old_tbl AND r.col = 'parent_id' THEN
      EXECUTE format('SELECT count(*) FROM %I WHERE parent_id = $1', old_tbl) INTO n USING eid;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', r.child, r.col) INTO n USING eid;
    END IF;
    IF n > 0 THEN
      RAISE EXCEPTION 'Still used by % % (%.%) — change those first; a % can''t take that place.', n, r.child, r.child, r.col, new_type;
    END IF;
  END LOOP;

  -- the new row: the columns both tables have (the description is biography_md for artists); not the kind (a
  -- museum's kind is no person's), not the parent (another table's), not technical ones
  SELECT array_agg(a.attname::text) INTO cols
  FROM pg_attribute a JOIN pg_attribute b ON b.attrelid = new_tbl::regclass AND b.attname = a.attname AND NOT b.attisdropped AND b.attgenerated = ''
  WHERE a.attrelid = old_tbl::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND a.attname NOT IN ('id', 'created_at', 'updated_at', 'kind', 'category', 'parent_id');
  SELECT jsonb_object_agg(k, old_row -> k) INTO row_json FROM unnest(cols) k;
  IF old_row ? 'biography_md' AND new_type <> 'artist' THEN row_json := row_json || jsonb_build_object('description_md', old_row -> 'biography_md'); cols := array_append(cols, 'description_md'); END IF;
  IF old_row ? 'description_md' AND new_type = 'artist' THEN row_json := row_json || jsonb_build_object('biography_md', old_row -> 'description_md'); cols := array_append(cols, 'biography_md'); END IF;
  -- a slug free in the new table
  new_slug := old_row ->> 'slug';
  EXECUTE format('SELECT 1 FROM %I WHERE slug = $1', new_tbl) INTO n USING new_slug;
  IF n IS NOT NULL THEN new_slug := new_slug || '-' || etype; END IF;
  row_json := row_json || jsonb_build_object('slug', new_slug);
  IF NOT 'slug' = ANY (cols) THEN cols := array_append(cols, 'slug'); END IF;
  -- required by the new table
  IF new_type = 'place' THEN row_json := row_json || '{"kind": "site"}'; cols := array_append(cols, 'kind'); END IF;
  IF new_type = 'movement' THEN row_json := row_json || '{"kind": "movement"}'; cols := array_append(cols, 'kind'); END IF;
  -- the wikidata id is unique per table — free it first (the old row goes anyway)
  EXECUTE format('UPDATE %I SET wikidata_id = NULL WHERE id = $1', old_tbl) USING eid;
  EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r RETURNING id', new_tbl,
                 (SELECT string_agg(format('%I', c), ', ') FROM unnest(cols) c),
                 (SELECT string_agg(format('r.%I', c), ', ') FROM unnest(cols) c), new_tbl)
    INTO nid USING row_json;
  -- what doesn't come along (with a value)
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO lost FROM jsonb_object_keys(old_row) k
  WHERE NOT k = ANY (cols) AND k NOT IN ('id', 'created_at', 'updated_at', 'biography_md', 'description_md', 'lifespan')
    AND NOT public.json_empty(old_row -> k) AND (old_row -> k) <> 'false';

  -- images and provenance roles: the arm of the old type → the arm of the new one (one statement: the exclusive arc
  -- holds at every moment); images of a type without images are deleted
  FOR r IN SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.confrelid = old_tbl::regclass AND (c.conrelid::regclass::text = 'images'
             OR (c.conrelid::regclass::text = 'provenance' AND a.attname LIKE 'owner\_%')) LOOP
    SELECT a.attname INTO target_col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.conrelid = r.child::regclass AND c.confrelid = new_tbl::regclass
       AND (r.child = 'images' OR a.attname LIKE 'owner\_%') LIMIT 1;
    IF target_col IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET %I = NULL, %I = $2 WHERE %I = $1', r.child, r.col, target_col, r.col) USING eid, nid;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', r.child, r.col) INTO n USING eid;
      IF n > 0 AND r.child = 'images' THEN
        EXECUTE format('DELETE FROM images WHERE %I = $1', r.col) USING eid;
        dropped := dropped || jsonb_build_object('images', n);
      ELSIF n > 0 THEN
        RAISE EXCEPTION 'Still owner in % provenance step(s) — a % can''t own an artwork; change those first.', n, new_type;
      END IF;
    END IF;
    target_col := NULL;
  END LOOP;

  -- relationships: those the new type may have move, the others go (listed)
  SELECT coalesce(array_agg(format('%s %s', rt.label, o.name)), '{}') INTO dropped_rels
  FROM relationships x JOIN relationship_types rt ON rt.code = x.relationship_type
  JOIN entity_index o ON (o.type, o.id) = CASE WHEN (x.subject_type, x.subject_id) = (etype, eid) THEN (x.object_type, x.object_id) ELSE (x.subject_type, x.subject_id) END
  WHERE ((x.subject_type, x.subject_id) = (etype, eid) AND NOT new_type = ANY (rt.subject_types))
     OR ((x.object_type, x.object_id) = (etype, eid) AND NOT new_type = ANY (rt.object_types));
  DELETE FROM relationships x USING relationship_types rt WHERE rt.code = x.relationship_type
    AND (((x.subject_type, x.subject_id) = (etype, eid) AND NOT new_type = ANY (rt.subject_types))
      OR ((x.object_type, x.object_id) = (etype, eid) AND NOT new_type = ANY (rt.object_types)));
  UPDATE relationships SET subject_type = new_type, subject_id = nid WHERE (subject_type, subject_id) = (etype, eid);
  UPDATE relationships SET object_type = new_type, object_id = nid WHERE (object_type, object_id) = (etype, eid);

  -- sources of fields the new type has too; reference records of authorities that record it
  UPDATE citations c SET entity_type = new_type, entity_id = nid WHERE (c.entity_type, c.entity_id) = (etype, eid)
     AND EXISTS (SELECT 1 FROM citable_fields f WHERE (f.entity_type, f.field) = (new_type, c.field));
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM citations WHERE (entity_type, entity_id) = (etype, eid);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN dropped := dropped || jsonb_build_object('sources', n); END IF;
  UPDATE entry_identifiers i SET entity_type = new_type, entity_id = nid WHERE (i.entity_type, i.entity_id) = (etype, eid)
     AND EXISTS (SELECT 1 FROM authorities a WHERE a.code = i.authority AND new_type = ANY (a.entity_types));
  DELETE FROM entry_identifiers WHERE (entity_type, entity_id) = (etype, eid);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN dropped := dropped || jsonb_build_object('reference records', n); END IF;

  -- old addresses: the slug and its earlier slugs lead to the new entry
  INSERT INTO entry_moves (old_type, old_slug, new_type, new_id)
  SELECT etype, s, new_type, nid FROM (SELECT old_row ->> 'slug' AS s UNION SELECT old_slug FROM slug_history WHERE (entity_type, entity_id) = (etype, eid)) x
  ON CONFLICT (old_type, old_slug) DO UPDATE SET new_type = EXCLUDED.new_type, new_id = EXCLUDED.new_id, moved_at = now();
  -- entries moved here earlier now lead to the newest place
  UPDATE entry_moves m SET new_type = convert_entry.new_type, new_id = nid
   WHERE (m.new_type, m.new_id) = (etype, eid);

  -- the old row goes (its delete trigger takes what is left: Wikidata decisions, flags, history of slugs …)
  DELETE FROM live_docs WHERE (entity_type, entity_id) = (etype, eid);
  DELETE FROM admin_drafts WHERE (entity_type, entity_id) = (etype, eid);
  PERFORM public.move_name_citations(etype, eid, new_type, nid);
  EXECUTE format('DELETE FROM %I WHERE id = $1', old_tbl) USING eid;

  -- [[links]] to it name the new type (a glossary term may be linked without type: [[slug]])
  FOR r IN SELECT * FROM public.markdown_columns LOOP
    -- numbered placeholders throughout: after %2$I an unnumbered %L would take argument 3 again
    EXECUTE format('UPDATE %1$I SET %2$I = regexp_replace(%2$I, %3$L, %4$L, ''g'') WHERE %2$I LIKE %5$L', r.tbl, r.col,
      CASE WHEN etype = 'term' THEN '\[\[(term/)?' || (old_row ->> 'slug') || '(?=\||\]\])' ELSE '\[\[' || etype || '/' || (old_row ->> 'slug') || '(?=\||\]\])' END,
      '[[' || new_type || '/' || new_slug, '%[[%' || (old_row ->> 'slug') || '%');
    GET DIAGNOSTICS n = ROW_COUNT;
    texts := texts + n;
  END LOOP;

  PERFORM set_config('arthistory.source', coalesce(prev_source, ''), true);
  RETURN jsonb_build_object('from', etype, 'to', new_type, 'slug', new_slug, 'id', nid, 'kept', to_jsonb(cols),
    'lost', to_jsonb(lost), 'dropped_relationships', to_jsonb(dropped_rels), 'dropped', dropped, 'texts', texts);
END $function$;

CREATE OR REPLACE FUNCTION public.derived_neighbours(t entity_type, i bigint)
 RETURNS TABLE(type entity_type, id bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH RECURSIVE tree(id) AS (
    SELECT i WHERE t = 'place'
    UNION SELECT x.id FROM places x JOIN tree ON x.parent_id = tree.id)
  SELECT g.object_type, g.object_id FROM graph_links g WHERE g.subject_type = t AND g.subject_id = i
  UNION SELECT g.subject_type, g.subject_id FROM graph_links g WHERE g.object_type = t AND g.object_id = i
  UNION SELECT r.object_type, r.object_id FROM relationships r WHERE r.subject_type = t AND r.subject_id = i
  UNION SELECT r.subject_type, r.subject_id FROM relationships r WHERE r.object_type = t AND r.object_id = i
  UNION SELECT 'place', tree.id FROM tree WHERE tree.id <> i
  UNION SELECT g.subject_type, g.subject_id FROM tree JOIN graph_links g ON g.object_type = 'place' AND g.object_id = tree.id
  UNION SELECT g.object_type, g.object_id FROM tree JOIN graph_links g ON g.subject_type = 'place' AND g.subject_id = tree.id
  UNION SELECT r.subject_type, r.subject_id FROM tree JOIN relationships r ON r.object_type = 'place' AND r.object_id = tree.id
  UNION SELECT r.object_type, r.object_id FROM tree JOIN relationships r ON r.subject_type = 'place' AND r.subject_id = tree.id
  UNION SELECT 'institution', x.id FROM tree JOIN institutions x ON x.place_id = tree.id
  UNION SELECT 'event', x.id FROM tree JOIN events x ON x.place_id = tree.id
  UNION SELECT 'artwork', p.artwork_id FROM tree JOIN provenance p ON p.owner_place_id = tree.id OR p.location_id = tree.id
  UNION SELECT 'artwork', p.artwork_id FROM tree JOIN provenance_places pp ON pp.place_id = tree.id JOIN provenance p ON p.id = pp.provenance_id
  UNION SELECT 'artwork', p.artwork_id FROM tree JOIN provenance_records pr ON pr.place_id = tree.id JOIN provenance p ON p.id = pr.provenance_id
  UNION SELECT 'event', x.id FROM events x WHERE t = 'event' AND x.parent_id = i
  UNION SELECT 'literature', x.id FROM literary_works x WHERE t = 'literature' AND x.parent_id = i
  UNION SELECT 'literature', x.parent_id FROM literary_works x WHERE t = 'literature' AND x.id = i AND x.parent_id IS NOT NULL  -- a chapter's change: its whole's counts
  UNION SELECT 'polity', x.id FROM polities x WHERE t = 'polity' AND x.parent_id = i
  UNION SELECT 'movement', x.id FROM movements x WHERE t = 'movement' AND x.parent_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'artwork' AND w.parent_id = i
  UNION SELECT 'artwork', w.parent_id FROM artworks w WHERE t = 'artwork' AND w.id = i AND w.parent_id IS NOT NULL
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'artist' AND w.creator_id = i
  UNION SELECT 'institution', h.institution_id FROM artwork_artists aa JOIN artwork_holders h ON h.artwork_id = aa.artwork_id
    WHERE t = 'artist' AND aa.artist_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'institution' AND w.current_institution_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'term' AND w.kind_term_id = i
  UNION SELECT 'artwork', m.artwork_id FROM artwork_materials m WHERE t = 'term' AND m.term_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'artist' AND p.owner_artist_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'person' AND p.owner_person_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'institution' AND p.owner_institution_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'event' AND p.event_id = i
  UNION SELECT c.entity_type, c.entity_id FROM citations c WHERE t = 'source' AND c.source_id = i AND c.entity_id IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.entry_eras(etype entity_type, eid bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  cal text := entry_calendar(etype, eid);
  out jsonb;
BEGIN
  IF cal IS NULL THEN RETURN NULL; END IF;
  out := CASE etype
    WHEN 'artwork' THEN (SELECT jsonb_build_object('created', era_label(cal, created)) FROM artworks WHERE id = eid)
    WHEN 'artist' THEN (SELECT jsonb_build_object('birth', era_label(cal, birth), 'death', era_label(cal, death)) FROM artists WHERE id = eid)
    WHEN 'person' THEN (SELECT jsonb_build_object('birth', era_label(cal, birth), 'death', era_label(cal, death)) FROM people WHERE id = eid)
    WHEN 'event' THEN (SELECT jsonb_build_object('period', era_label(cal, period)) FROM events WHERE id = eid)
    WHEN 'literature' THEN (SELECT jsonb_build_object('written', era_label(cal, written)) FROM literary_works WHERE id = eid)
  END;
  out := jsonb_strip_nulls(out);
  RETURN CASE WHEN out IS NULL OR out = '{}' THEN NULL ELSE out END;
END $function$;

CREATE OR REPLACE FUNCTION public.entry_calendar(etype entity_type, eid bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  WITH codes AS (
    SELECT 1 AS rank, entity_country(etype, eid)->>'code' AS code
    UNION ALL
    SELECT 2, entity_country('artist', w.creator_id)->>'code' FROM artworks w WHERE etype = 'artwork' AND w.id = eid AND w.creator_id IS NOT NULL
    UNION ALL
    SELECT 2, entity_country(r.object_type, r.object_id)->>'code' FROM relationships r
     WHERE etype = 'literature' AND r.subject_type = 'literature' AND r.relationship_type = 'written_by'
       AND r.subject_id IN (SELECT eid UNION SELECT parent_id FROM literary_works WHERE id = eid)
    UNION ALL
    SELECT 3, (SELECT place_country(r.object_id)->>'code'
                 FROM relationships r
                WHERE r.subject_type = 'movement' AND r.relationship_type = 'active_in' AND r.object_type = 'place'
                  AND r.subject_id IN (SELECT movement_id FROM movement_works WHERE etype = 'artwork' AND artwork_id = eid
                                       UNION SELECT movement_id FROM movement_artists WHERE etype IN ('artist', 'person') AND artist_id = eid)
                  AND place_country(r.object_id)->>'code' IN ('JP', 'KR', 'CN')
                ORDER BY r.id LIMIT 1)
  )
  SELECT CASE code WHEN 'JP' THEN 'jp' WHEN 'KR' THEN 'kr' WHEN 'CN' THEN 'cn' END
  FROM codes WHERE code IS NOT NULL ORDER BY rank LIMIT 1
$function$;

CREATE OR REPLACE VIEW entity_index AS
 SELECT 'artist'::entity_type AS type,
    artists.id,
    artists.slug,
    artists.name,
    artists.lifespan AS period,
    NULLIF(range_label(artists.birth_label, artists.death_label), ''::text) AS period_label,
    NULL::text AS kind,
    artists.names,
    person_sort_key(artists.name, artists.name_ruby, artists.names, artists.sort_name, artists.family_name, artists.given_name) AS sort_key,
    name_alt_text(artists.name_ruby, artists.names) AS alt_text,
    artists.public_id
   FROM artists
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    artworks.id,
    artworks.slug,
    artworks.title AS name,
    artworks.created AS period,
    artworks.created_label AS period_label,
    artworks.kind,
    artworks.names,
    entry_sort_key('artwork'::entity_type, artworks.title, artworks.title_ruby, artworks.names, artworks.title_lang) AS sort_key,
    name_alt_text(artworks.title_ruby, artworks.names) AS alt_text,
    artworks.public_id
   FROM artworks
UNION ALL
 SELECT 'institution'::entity_type AS type,
    institutions.id,
    institutions.slug,
    institutions.name,
    institutions.founded AS period,
    institutions.founded_label AS period_label,
    institutions.kind,
    institutions.names,
    entry_sort_key('institution'::entity_type, institutions.name, institutions.name_ruby, institutions.names, institutions.name_lang) AS sort_key,
    name_alt_text(institutions.name_ruby, institutions.names) AS alt_text,
    institutions.public_id
   FROM institutions
UNION ALL
 SELECT 'person'::entity_type AS type,
    people.id,
    people.slug,
    people.name,
    COALESCE(people.lifespan, people.active) AS period,
    COALESCE(NULLIF(range_label(people.birth_label, people.death_label), ''::text), people.active_label) AS period_label,
    people.kind,
    people.names,
    person_sort_key(people.name, people.name_ruby, people.names, people.sort_name, people.family_name, people.given_name) AS sort_key,
    name_alt_text(people.name_ruby, people.names) AS alt_text,
    people.public_id
   FROM people
UNION ALL
 SELECT 'movement'::entity_type AS type,
    movements.id,
    movements.slug,
    movements.name,
    movements.period,
    movements.period_label,
    (movements.kind)::text AS kind,
    movements.names,
    entry_sort_key('movement'::entity_type, movements.name, movements.name_ruby, movements.names, movements.name_lang) AS sort_key,
    name_alt_text(movements.name_ruby, movements.names) AS alt_text,
    movements.public_id
   FROM movements
UNION ALL
 SELECT 'place'::entity_type AS type,
    places.id,
    places.slug,
    places.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (places.kind)::text AS kind,
    places.names,
    entry_sort_key('place'::entity_type, places.name, places.name_ruby, places.names, places.name_lang) AS sort_key,
    name_alt_text(places.name_ruby, places.names) AS alt_text,
    places.public_id
   FROM places
UNION ALL
 SELECT 'polity'::entity_type AS type,
    polities.id,
    polities.slug,
    polities.name,
    polities.period,
    polities.period_label,
    polities.kind,
    polities.names,
    entry_sort_key('polity'::entity_type, polities.name, polities.name_ruby, polities.names, polities.name_lang) AS sort_key,
    name_alt_text(polities.name_ruby, polities.names) AS alt_text,
    polities.public_id
   FROM polities
UNION ALL
 SELECT 'term'::entity_type AS type,
    glossary.id,
    glossary.slug,
    glossary.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (glossary.category)::text AS kind,
    glossary.names,
    entry_sort_key('term'::entity_type, glossary.name, glossary.name_ruby, glossary.names, glossary.name_lang) AS sort_key,
    name_alt_text(glossary.name_ruby, glossary.names) AS alt_text,
    glossary.public_id
   FROM glossary
UNION ALL
 SELECT 'source'::entity_type AS type,
    bibliography.id,
    bibliography.slug,
    bibliography.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (bibliography.kind)::text AS kind,
    bibliography.names,
    entry_sort_key('source'::entity_type, bibliography.name, bibliography.name_ruby, bibliography.names, bibliography.name_lang) AS sort_key,
    name_alt_text(bibliography.name_ruby, bibliography.names) AS alt_text,
    bibliography.public_id
   FROM bibliography
UNION ALL
 SELECT 'event'::entity_type AS type,
    events.id,
    events.slug,
    events.name,
    events.period,
    events.period_label,
    events.kind,
    events.names,
    entry_sort_key('event'::entity_type, events.name, events.name_ruby, events.names, events.name_lang) AS sort_key,
    name_alt_text(events.name_ruby, events.names) AS alt_text,
    events.public_id
   FROM events
UNION ALL
 SELECT 'literature'::entity_type AS type,
    literary_works.id,
    literary_works.slug,
    literary_works.name,
    literary_works.written AS period,
    literary_works.written_label AS period_label,
    literary_works.kind,
    literary_works.names,
    entry_sort_key('literature'::entity_type, literary_works.name, literary_works.name_ruby, literary_works.names, literary_works.name_lang) AS sort_key,
    name_alt_text(literary_works.name_ruby, literary_works.names) AS alt_text,
    literary_works.public_id
   FROM literary_works;

CREATE OR REPLACE VIEW entity_rows AS
 SELECT 'artist'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM artists t
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM artworks t
UNION ALL
 SELECT 'institution'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM institutions t
UNION ALL
 SELECT 'person'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM people t
UNION ALL
 SELECT 'movement'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM movements t
UNION ALL
 SELECT 'place'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM places t
UNION ALL
 SELECT 'polity'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM polities t
UNION ALL
 SELECT 'event'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM events t
UNION ALL
 SELECT 'literature'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM literary_works t
UNION ALL
 SELECT 'term'::entity_type AS type,
    t.id,
    to_jsonb(t.*) AS r
   FROM glossary t;

CREATE OR REPLACE VIEW content_links AS
 SELECT DISTINCT x.entity_type,
    x.entity_id,
    COALESCE(m.m[1], 'term'::text) AS target_type,
    m.m[2] AS target_slug
   FROM (( SELECT 'artist'::entity_type AS entity_type,
            artists.id AS entity_id,
            artists.biography_md AS md
           FROM artists
        UNION ALL
         SELECT 'artwork'::entity_type,
            artworks.id,
            artworks.description_md
           FROM artworks
        UNION ALL
         SELECT 'institution'::entity_type,
            institutions.id,
            institutions.description_md
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type,
            people.id,
            people.description_md
           FROM people
        UNION ALL
         SELECT 'movement'::entity_type,
            movements.id,
            movements.description_md
           FROM movements
        UNION ALL
         SELECT 'place'::entity_type,
            places.id,
            places.description_md
           FROM places
        UNION ALL
         SELECT 'polity'::entity_type,
            polities.id,
            polities.description_md
           FROM polities
        UNION ALL
         SELECT 'term'::entity_type,
            glossary.id,
            glossary.description_md
           FROM glossary
        UNION ALL
         SELECT 'source'::entity_type,
            bibliography.id,
            bibliography.description_md
           FROM bibliography
        UNION ALL
         SELECT relationships.subject_type,
            relationships.subject_id,
            relationships.notes_md
           FROM relationships
        UNION ALL
         SELECT 'artwork'::entity_type,
            provenance.artwork_id,
            provenance.notes_md
           FROM provenance
        UNION ALL
         SELECT 'event'::entity_type,
            events.id,
            events.description_md
           FROM events
        UNION ALL
         SELECT 'literature'::entity_type,
            literary_works.id,
            literary_works.description_md
           FROM literary_works) x
     CROSS JOIN LATERAL regexp_matches(x.md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]'::text, 'g'::text) m(m))
  WHERE (x.md ~~ '%[[%'::text);

CREATE OR REPLACE VIEW entry_previews AS
 SELECT 'artist'::entity_type AS type,
    a.slug,
    a.name,
    NULLIF(range_label(a.birth_label, a.death_label), ''::text) AS subtitle,
    img.url AS image_url,
    a.biography_md AS text_md
   FROM (artists a
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.artist_id = a.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    w.slug,
    w.title AS name,
    NULLIF(concat_ws(' · '::text, NULLIF(concat_ws(', '::text, c.name, w.created_label), ''::text), w.kind), ''::text) AS subtitle,
    img.url AS image_url,
    w.description_md AS text_md
   FROM ((artworks w
     LEFT JOIN artists c ON ((c.id = w.creator_id)))
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.artwork_id = w.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'institution'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, t.kind, p.name, ('founded '::text || t.founded_label)), ''::text) AS subtitle,
    img.url AS image_url,
    t.description_md AS text_md
   FROM ((institutions t
     LEFT JOIN places p ON ((p.id = t.place_id)))
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.institution_id = t.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'person'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, NULLIF(array_to_string(t.occupations[1:3], ', '::text), ''::text), COALESCE(NULLIF(range_label(t.birth_label, t.death_label), ''::text), t.active_label)), ''::text) AS subtitle,
    img.url AS image_url,
    t.description_md AS text_md
   FROM (people t
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.person_id = t.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'movement'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, (t.kind)::text, t.period_label), ''::text) AS subtitle,
    NULL::text AS image_url,
    t.description_md AS text_md
   FROM movements t
UNION ALL
 SELECT 'place'::entity_type AS type,
    t.slug,
    t.name,
    concat_ws(' · '::text, (t.kind)::text, p.name) AS subtitle,
    NULL::text AS image_url,
    t.description_md AS text_md
   FROM (places t
     LEFT JOIN places p ON ((p.id = t.parent_id)))
UNION ALL
 SELECT 'polity'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, t.kind, t.period_label), ''::text) AS subtitle,
    NULL::text AS image_url,
    t.description_md AS text_md
   FROM polities t
UNION ALL
 SELECT 'term'::entity_type AS type,
    t.slug,
    t.name,
    (t.category)::text AS subtitle,
    img.url AS image_url,
    COALESCE(t.definition, t.description_md) AS text_md
   FROM (glossary t
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.glossary_id = t.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'source'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, replace((t.kind)::text, '_'::text, ' '::text), t.year), ''::text) AS subtitle,
    NULL::text AS image_url,
    t.description_md AS text_md
   FROM bibliography t
UNION ALL
 SELECT 'event'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, t.kind, p.name, t.period_label), ''::text) AS subtitle,
    img.url AS image_url,
    t.description_md AS text_md
   FROM ((events t
     LEFT JOIN places p ON ((p.id = t.place_id)))
     LEFT JOIN LATERAL ( SELECT i.url
           FROM images i
          WHERE (i.event_id = t.id)
          ORDER BY i."position", i.id
         LIMIT 1) img ON (true))
UNION ALL
 SELECT 'literature'::entity_type AS type,
    t.slug,
    t.name,
    NULLIF(concat_ws(' · '::text, t.kind, (SELECT string_agg(COALESCE(pe.name, ar.name), ', ' ORDER BY r.id) FROM relationships r
        LEFT JOIN people pe ON r.object_type = 'person' AND pe.id = r.object_id LEFT JOIN artists ar ON r.object_type = 'artist' AND ar.id = r.object_id
       WHERE r.subject_type = 'literature' AND r.subject_id = t.id AND r.relationship_type = 'written_by'), t.written_label), ''::text) AS subtitle,
    NULL::text AS image_url,
    t.description_md AS text_md
   FROM literary_works t;

CREATE OR REPLACE VIEW search_documents AS
 SELECT 'artist'::entity_type AS type,
    artists.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(artists.name, name_alt_text(artists.name_ruby, artists.names), md_plain(artists.biography_md), artists.provenance_flag) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(artists.name_ruby, artists.names), md_plain(artists.biography_md), artists.provenance_flag), ''::text) AS body
   FROM artists
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    artworks.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(artworks.title, name_alt_text(artworks.title_ruby, artworks.names), search_join(ARRAY[md_plain(artworks.description_md), artworks.kind, artworks.medium, search_join(artworks.materials)]), search_join(ARRAY[artworks.inventory_number, artworks.provenance_status_note])) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(artworks.title_ruby, artworks.names), search_join(ARRAY[md_plain(artworks.description_md), artworks.kind, artworks.medium, search_join(artworks.materials)]), search_join(ARRAY[artworks.inventory_number, artworks.provenance_status_note])), ''::text) AS body
   FROM artworks
UNION ALL
 SELECT 'institution'::entity_type AS type,
    institutions.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(institutions.name, name_alt_text(institutions.name_ruby, institutions.names), search_join(ARRAY[md_plain(institutions.description_md), institutions.kind]), search_join(ARRAY[institutions.address, institutions.provenance_flag])) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(institutions.name_ruby, institutions.names), search_join(ARRAY[md_plain(institutions.description_md), institutions.kind]), search_join(ARRAY[institutions.address, institutions.provenance_flag])), ''::text) AS body
   FROM institutions
UNION ALL
 SELECT 'person'::entity_type AS type,
    people.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(people.name, name_alt_text(people.name_ruby, people.names), search_join(ARRAY[md_plain(people.description_md), people.kind, search_join(people.occupations)]), people.provenance_flag) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(people.name_ruby, people.names), search_join(ARRAY[md_plain(people.description_md), people.kind, search_join(people.occupations)]), people.provenance_flag), ''::text) AS body
   FROM people
UNION ALL
 SELECT 'movement'::entity_type AS type,
    movements.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(movements.name, name_alt_text(movements.name_ruby, movements.names), md_plain(movements.description_md), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(movements.name_ruby, movements.names), md_plain(movements.description_md), NULL::text), ''::text) AS body
   FROM movements
UNION ALL
 SELECT 'place'::entity_type AS type,
    places.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(places.name, name_alt_text(places.name_ruby, places.names), md_plain(places.description_md), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(places.name_ruby, places.names), md_plain(places.description_md), NULL::text), ''::text) AS body
   FROM places
UNION ALL
 SELECT 'polity'::entity_type AS type,
    polities.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(polities.name, name_alt_text(polities.name_ruby, polities.names), search_join(ARRAY[md_plain(polities.description_md), polities.kind]), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(polities.name_ruby, polities.names), search_join(ARRAY[md_plain(polities.description_md), polities.kind]), NULL::text), ''::text) AS body
   FROM polities
UNION ALL
 SELECT 'term'::entity_type AS type,
    glossary.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(glossary.name, name_alt_text(glossary.name_ruby, glossary.names), search_join(ARRAY[glossary.definition, md_plain(glossary.description_md)]), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(glossary.name_ruby, glossary.names), search_join(ARRAY[glossary.definition, md_plain(glossary.description_md)]), NULL::text), ''::text) AS body
   FROM glossary
UNION ALL
 SELECT 'source'::entity_type AS type,
    bibliography.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(search_join(ARRAY[bibliography.name, bibliography.subtitle]), search_join(ARRAY[name_alt_text(bibliography.name_ruby, bibliography.names), search_join(bibliography.authors), search_join(bibliography.editors)]), search_join(ARRAY[bibliography.container, bibliography.series, bibliography.exhibition, bibliography.publisher, bibliography.place, search_join(bibliography.container_editors), search_join(bibliography.compilers)]), search_join(ARRAY[bibliography.year, bibliography.catalogue_number])) AS doc,
    NULLIF(concat_ws(' · '::text, search_join(ARRAY[name_alt_text(bibliography.name_ruby, bibliography.names), search_join(bibliography.authors), search_join(bibliography.editors)]), search_join(ARRAY[bibliography.container, bibliography.series, bibliography.exhibition, bibliography.publisher, bibliography.place, search_join(bibliography.container_editors), search_join(bibliography.compilers)]), search_join(ARRAY[bibliography.year, bibliography.catalogue_number])), ''::text) AS body
   FROM bibliography
UNION ALL
 SELECT 'event'::entity_type AS type,
    events.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(events.name, name_alt_text(events.name_ruby, events.names), search_join(ARRAY[md_plain(events.description_md), events.kind]), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(events.name_ruby, events.names), search_join(ARRAY[md_plain(events.description_md), events.kind]), NULL::text), ''::text) AS body
   FROM events
UNION ALL
 SELECT 'literature'::entity_type AS type,
    literary_works.id,
    'entry'::text AS part,
    NULL::bigint AS provenance_id,
    search_vector(literary_works.name, name_alt_text(literary_works.name_ruby, literary_works.names), search_join(ARRAY[md_plain(literary_works.description_md), literary_works.kind]), NULL::text) AS doc,
    NULLIF(concat_ws(' · '::text, name_alt_text(literary_works.name_ruby, literary_works.names), search_join(ARRAY[md_plain(literary_works.description_md), literary_works.kind]), NULL::text), ''::text) AS body
   FROM literary_works
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    provenance.artwork_id AS id,
    'provenance'::text AS part,
    provenance.id AS provenance_id,
    search_vector(NULL::text, NULL::text, search_join(ARRAY[provenance.owner_label, provenance.label, provenance.exchanged_for_text, md_plain(provenance.notes_md)]), search_join(ARRAY[search_method(provenance.method), provenance.price_note])) AS doc,
    NULLIF(concat_ws(' · '::text, search_join(ARRAY[provenance.owner_label, provenance.label, provenance.exchanged_for_text, md_plain(provenance.notes_md)]), search_join(ARRAY[search_method(provenance.method), provenance.price_note])), ''::text) AS body
   FROM provenance
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    p.artwork_id AS id,
    'provenance'::text AS part,
    r.provenance_id,
    search_vector(NULL::text, NULL::text, search_join(ARRAY[r.room, r.document, r.note, r.date_label]), r.number) AS doc,
    NULLIF(concat_ws(' · '::text, search_join(ARRAY[r.room, r.document, r.note, r.date_label]), r.number), ''::text) AS body
   FROM (provenance_records r
     JOIN provenance p ON ((p.id = r.provenance_id)));

CREATE OR REPLACE VIEW markdown_columns AS
 SELECT tbl,
    col
   FROM ( VALUES ('artists'::text,'biography_md'::text), ('artworks'::text,'description_md'::text), ('institutions'::text,'description_md'::text), ('people'::text,'description_md'::text), ('movements'::text,'description_md'::text), ('places'::text,'description_md'::text), ('polities'::text,'description_md'::text), ('glossary'::text,'description_md'::text), ('bibliography'::text,'description_md'::text), ('relationships'::text,'notes_md'::text), ('provenance'::text,'notes_md'::text), ('events'::text,'description_md'::text), ('literary_works'::text,'description_md'::text), ('featured_views'::text,'intro_md'::text)) v(tbl, col);

CREATE OR REPLACE VIEW entry_search_fields AS
 WITH f(type, id, "position", label, text, match, tier_rank, tier_heading) AS (
         SELECT 'artist'::entity_type AS entity_type,
            a.id,
            x."position",
            x.label,
            x.text,
            x.match,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (artists a
             CROSS JOIN LATERAL ( VALUES (1,'Filed as'::text,( SELECT e.sort_key
                           FROM entity_index e
                          WHERE ((e.type = 'artist'::entity_type) AND (e.id = a.id) AND (e.sort_key <> a.name))),NULL::text), (2,'Lived'::text,NULLIF(range_label(a.birth_label, a.death_label), ''::text),NULL::text), (3,'Born in'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE (pl.id = entity_home_place('artist'::entity_type, a.id))), entity_country('artist'::entity_type, a.id)),NULL::text), (4,'Nationality'::text,polity_words('artist'::entity_type, a.id, 'nationality'::text),NULL::text)) x("position", label, text, match))
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            a.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS match,
            x.tier_rank,
            x.tier_heading
           FROM (artists a
             CROSS JOIN LATERAL ( VALUES (5,'Works now in'::text,( SELECT string_agg(DISTINCT i.name, ', '::text) AS string_agg
                           FROM ((artwork_holders h
                             JOIN artwork_artists aa ON ((aa.artwork_id = h.artwork_id)))
                             JOIN institutions i ON ((i.id = h.institution_id)))
                          WHERE ((aa.artist_id = a.id) AND h.now)),1,'With works now in a matching collection'::text), (6,'Works formerly in'::text,( SELECT string_agg(DISTINCT i.name, ', '::text) AS string_agg
                           FROM ((artwork_holders h
                             JOIN artwork_artists aa ON ((aa.artwork_id = h.artwork_id)))
                             JOIN institutions i ON ((i.id = h.institution_id)))
                          WHERE ((aa.artist_id = a.id) AND (NOT h.now))),2,'With works formerly in a matching collection'::text)) x("position", label, text, tier_rank, tier_heading))
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            w.id,
            x."position",
            x.label,
            x.text,
            x.match,
            x.tier_rank,
            x.tier_heading
           FROM ((artworks w
             CROSS JOIN LATERAL ( SELECT artwork_term_names(w.id) AS terms,
                    entity_country('artwork'::entity_type, w.id) AS country) t)
             CROSS JOIN LATERAL ( VALUES (1,'Artist'::text,( SELECT string_agg((c.value ->> 'name'::text), ', '::text) AS string_agg
                           FROM jsonb_array_elements(artwork_creators(w.id)) c(value)),NULL::text,NULL::integer,NULL::text), (2,'Date'::text,w.created_label,NULL::text,NULL::integer,NULL::text), (3,'Type'::text,w.kind,NULLIF(concat_ws(' '::text, w.kind, array_to_string(t.terms, ' '::text)), ''::text),NULL::integer,NULL::text), (4,'Materials'::text,NULLIF(array_to_string(w.materials, ', '::text), ''::text),NULLIF(concat_ws(' '::text, array_to_string(w.materials, ' '::text), array_to_string(t.terms, ' '::text)), ''::text),NULL::integer,NULL::text), (5,'Medium'::text,w.medium,NULL::text,NULL::integer,NULL::text), (6,'Made in'::text,place_and_country(((t.country -> 'place'::text) ->> 'name'::text), t.country),NULL::text,NULL::integer,NULL::text), (7,'State'::text,polity_words('artwork'::entity_type, w.id, 'created_in_polity'::text),NULL::text,NULL::integer,NULL::text), (8,'Series'::text,( SELECT (p.title || COALESCE(((' (no. '::text || w.part_number) || ')'::text), ''::text))
                           FROM artworks p
                          WHERE (p.id = w.parent_id)),NULL::text,NULL::integer,NULL::text), (9,'Now in'::text,( SELECT string_agg(i.name, ', '::text ORDER BY i.name) AS string_agg
                           FROM (artwork_holders h
                             JOIN institutions i ON ((i.id = h.institution_id)))
                          WHERE ((h.artwork_id = w.id) AND h.now)),NULL::text,1,'Now in the collection'::text), (10,'Formerly in'::text,( SELECT string_agg(i.name, ', '::text ORDER BY i.name) AS string_agg
                           FROM (artwork_holders h
                             JOIN institutions i ON ((i.id = h.institution_id)))
                          WHERE ((h.artwork_id = w.id) AND (NOT h.now))),NULL::text,2,'Formerly in the collection'::text)) x("position", label, text, match, tier_rank, tier_heading))
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            m.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (movements m
             CROSS JOIN LATERAL ( VALUES (1,'Date'::text,m.period_label), (2,'Kind'::text,(m.kind)::text)) x("position", label, text))
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            p.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (people p
             CROSS JOIN LATERAL ( VALUES (1,'Filed as'::text,( SELECT e.sort_key
                           FROM entity_index e
                          WHERE ((e.type = 'person'::entity_type) AND (e.id = p.id) AND (e.sort_key <> p.name)))), (2,'Lived'::text,COALESCE(NULLIF(range_label(p.birth_label, p.death_label), ''::text), ('active '::text || p.active_label))), (3,'Kind'::text,p.kind), (4,'Occupations'::text,NULLIF(array_to_string(p.occupations, ', '::text), ''::text)), (5,'Roles'::text,( SELECT string_agg(
                                CASE r.r
                                    WHEN 'owner'::text THEN 'owner of artworks'::text
                                    WHEN 'depicted'::text THEN 'depicted in artworks'::text
                                    ELSE r.r
                                END, ', '::text) AS string_agg
                           FROM unnest(person_roles(p.id)) r(r))), (6,'Born in'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE (pl.id = entity_home_place('person'::entity_type, p.id))), entity_country('person'::entity_type, p.id))), (7,'Nationality'::text,polity_words('person'::entity_type, p.id, 'nationality'::text))) x("position", label, text))
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            pl.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (places pl
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,COALESCE(pl.designation, (pl.kind)::text)), (2,'In'::text,( SELECT pp.name
                           FROM places pp
                          WHERE ((pp.id = pl.parent_id) AND (pp.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind]))))), (3,'Country'::text,(place_country(pl.id) ->> 'name'::text))) x("position", label, text))
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            i.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            x.tier_rank,
            x.tier_heading
           FROM (institutions i
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,i.kind,NULL::integer,NULL::text), (2,'Dates'::text,NULLIF(concat_ws(' · '::text, ('founded '::text || i.founded_label), ('closed '::text || i.dissolved_label)), ''::text),NULL::integer,NULL::text), (3,'Location'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE (pl.id = i.place_id)), entity_country('institution'::entity_type, i.id)),NULL::integer,NULL::text), (4,'Historically in'::text,polity_words('institution'::entity_type, i.id, 'located_in_polity'::text),NULL::integer,NULL::text), (5,'Works by'::text,( SELECT string_agg(DISTINCT a.name, ', '::text) AS string_agg
                           FROM ((artwork_holders h
                             JOIN artwork_artists aa ON ((aa.artwork_id = h.artwork_id)))
                             JOIN artists a ON ((a.id = aa.artist_id)))
                          WHERE (h.institution_id = i.id)),1,'With works by a matching artist'::text)) x("position", label, text, tier_rank, tier_heading))
        UNION ALL
         SELECT 'source'::entity_type AS entity_type,
            b.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (bibliography b
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,(b.kind)::text), (2,'Authors'::text,NULLIF(array_to_string(((b.authors || b.editors) || b.compilers), ', '::text), ''::text)), (3,'Title'::text,NULLIF(concat_ws(': '::text, b.name, b.subtitle), ''::text)), (4,'In'::text,NULLIF(concat_ws(', '::text, b.container, b.exhibition, b.series), ''::text)), (5,'Published'::text,NULLIF(concat_ws(', '::text, b.place, b.publisher, b.year), ''::text))) x("position", label, text))
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            e.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (events e
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,e.kind), (2,'Date'::text,e.period_label), (3,'Where'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE (pl.id = e.place_id)), entity_country('event'::entity_type, e.id))), (4,'Part of'::text,( SELECT p.name
                           FROM events p
                          WHERE (p.id = e.parent_id)))) x("position", label, text))
        UNION ALL
         SELECT 'literature'::entity_type AS entity_type,
            l.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (literary_works l
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,l.kind), (2,'Author'::text,( SELECT string_agg(COALESCE(pe.name, ar.name), ', '::text ORDER BY r.id) AS string_agg
                           FROM ((relationships r
                             LEFT JOIN people pe ON (((r.object_type = 'person'::entity_type) AND (pe.id = r.object_id))))
                             LEFT JOIN artists ar ON (((r.object_type = 'artist'::entity_type) AND (ar.id = r.object_id))))
                          WHERE ((r.subject_type = 'literature'::entity_type) AND (r.subject_id = ANY (ARRAY[l.id, l.parent_id])) AND (r.relationship_type = 'written_by'::text)))), (3,'Written'::text,l.written_label), (4,'Part of'::text,( SELECT p.name
                           FROM literary_works p
                          WHERE (p.id = l.parent_id)))) x("position", label, text))
        UNION ALL
         SELECT 'term'::entity_type AS entity_type,
            g.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (glossary g
             CROSS JOIN LATERAL ( VALUES (1,'Category'::text,(g.category)::text), (2,'Definition'::text,g.definition)) x("position", label, text))
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            p.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM (polities p
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,p.kind), (2,'Date'::text,p.period_label), (3,'Territory today'::text,( SELECT string_agg(b.name, ', '::text) AS string_agg
                           FROM (unnest(p.country_codes) c(c)
                             JOIN boundaries b ON (((b.code = c.c) AND (b.level = 0))))))) x("position", label, text))
        )
 SELECT type,
    id,
    "position",
    label,
    text,
    match,
    tier_rank,
    tier_heading,
    ((((type)::text = 'artwork'::text) AND (label = 'Artist'::text)) OR (((type)::text = 'artwork'::text) AND (label = 'Date'::text)) OR (((type)::text = 'artist'::text) AND (label = 'Lived'::text)) OR (((type)::text = 'person'::text) AND (label = 'Lived'::text)) OR (((type)::text = 'place'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'place'::text) AND (label = 'Country'::text)) OR (((type)::text = 'place'::text) AND (label = 'In'::text)) OR (((type)::text = 'institution'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'institution'::text) AND (label = 'Dates'::text)) OR (((type)::text = 'source'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'event'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'literature'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'literature'::text) AND (label = 'Author'::text)) OR (((type)::text = 'literature'::text) AND (label = 'Written'::text)) OR (((type)::text = 'event'::text) AND (label = 'Date'::text)) OR (((type)::text = 'event'::text) AND (label = 'Where'::text)) OR (((type)::text = 'term'::text) AND (label = 'Category'::text)) OR (((type)::text = 'polity'::text) AND (label = 'Kind'::text)) OR (((type)::text = 'polity'::text) AND (label = 'Date'::text)) OR (((type)::text = 'movement'::text) AND (label = 'Date'::text))) AS shown
   FROM f
  WHERE ((text IS NOT NULL) AND (btrim(text) <> ''::text));

CREATE OR REPLACE VIEW dup_facts AS
 SELECT type,
    id,
    slug,
    name,
    names,
    kind,
    period,
    birth,
    death,
    creator_id,
    institution_id,
    inventory_number,
    height_cm,
    width_cm,
    point,
    place_id,
    parent_id,
    part_number,
    web_host,
    year,
    authors,
    isbn,
    doi,
        CASE
            WHEN (type = 'artwork'::entity_type) THEN artwork_number_keys(id)
            ELSE NULL::text[]
        END AS numbers
   FROM ( SELECT 'artwork'::entity_type AS type,
            w.id,
            w.slug,
            w.title AS name,
            dup_names(w.title, w.names) AS names,
            w.kind,
            w.created AS period,
            NULL::daterange AS birth,
            NULL::daterange AS death,
            w.creator_id,
            w.current_institution_id AS institution_id,
            w.inventory_number,
            w.height_cm,
            w.width_cm,
            COALESCE(w.location, (st_pointonsurface((w.area)::geometry))::geography) AS point,
            NULL::bigint AS place_id,
            w.parent_id,
            w.part_number,
            NULL::text AS web_host,
            NULL::text AS year,
            NULL::text[] AS authors,
            NULL::text AS isbn,
            NULL::text AS doi
           FROM artworks w
        UNION ALL
         SELECT 'artist'::entity_type,
            a.id,
            a.slug,
            a.name,
            dup_names(a.name, a.names) AS dup_names,
            NULL::text,
            NULL::daterange,
            a.birth,
            a.death,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM artists a
        UNION ALL
         SELECT 'person'::entity_type,
            p.id,
            p.slug,
            p.name,
            dup_names(p.name, p.names) AS dup_names,
            p.kind,
            NULL::daterange,
            p.birth,
            p.death,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM people p
        UNION ALL
         SELECT 'place'::entity_type,
            p.id,
            p.slug,
            p.name,
            dup_names(p.name, p.names) AS dup_names,
            (p.kind)::text AS kind,
            NULL::daterange,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            g.marker,
            NULL::bigint,
            p.parent_id,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM (places p
             LEFT JOIN place_geo g ON ((g.id = p.id)))
        UNION ALL
         SELECT 'institution'::entity_type,
            i.id,
            i.slug,
            i.name,
            dup_names(i.name, i.names) AS dup_names,
            i.kind,
            i.founded,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            i.location,
            i.place_id,
            NULL::bigint,
            NULL::text,
            lower("substring"(i.website_url, '^https?://(?:www\.)?([^/:?#]+)'::text)) AS lower,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM institutions i
        UNION ALL
         SELECT 'movement'::entity_type,
            m.id,
            m.slug,
            m.name,
            dup_names(m.name, m.names) AS dup_names,
            (m.kind)::text AS kind,
            m.period,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            m.parent_id,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM movements m
        UNION ALL
         SELECT 'polity'::entity_type,
            p.id,
            p.slug,
            p.name,
            dup_names(p.name, p.names) AS dup_names,
            p.kind,
            p.period,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            p.parent_id,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM polities p
        UNION ALL
         SELECT 'term'::entity_type,
            g.id,
            g.slug,
            g.name,
            dup_names(g.name, g.names) AS dup_names,
            (g.category)::text AS category,
            NULL::daterange,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM glossary g
        UNION ALL
         SELECT 'source'::entity_type,
            b.id,
            b.slug,
            b.name,
            dup_names(b.name, b.names) AS dup_names,
            (b.kind)::text AS kind,
            NULL::daterange,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::text,
            NULLIF(btrim(b.year), ''::text) AS "nullif",
            ( SELECT array_agg(lower(f_unaccent(x.x))) AS array_agg
                   FROM unnest(b.authors) x(x)) AS array_agg,
            NULLIF(regexp_replace(upper(COALESCE(b.isbn, ''::text)), '[^0-9X]'::text, ''::text, 'g'::text), ''::text) AS "nullif",
            NULLIF(lower(btrim(b.doi)), ''::text) AS "nullif"
           FROM bibliography b
        UNION ALL
         SELECT 'event'::entity_type,
            v.id,
            v.slug,
            v.name,
            dup_names(v.name, v.names) AS dup_names,
            v.kind,
            v.period,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            COALESCE(v.location, (st_pointonsurface((v.area)::geometry))::geography) AS "coalesce",
            v.place_id,
            v.parent_id,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM events v
        UNION ALL
         SELECT 'literature'::entity_type,
            v.id,
            v.slug,
            v.name,
            dup_names(v.name, v.names) AS dup_names,
            v.kind,
            v.written,
            NULL::daterange,
            NULL::daterange,
            NULL::bigint,
            NULL::bigint,
            NULL::text,
            NULL::numeric,
            NULL::numeric,
            NULL::geography,
            NULL::bigint,
            v.parent_id,
            NULL::text,
            NULL::text,
            NULL::text,
            NULL::text[],
            NULL::text,
            NULL::text
           FROM literary_works v) f;

CREATE OR REPLACE VIEW quality_issues_live AS
 WITH rel AS (
         SELECT r.id,
            r.subject_type,
            r.subject_id,
            r.relationship_type,
            r.object_type,
            r.object_id,
            r.period,
            r.period_label,
            r.label,
            r.certainty,
            r.notes_md,
            r.metadata,
            r.created_at,
            r.updated_at,
            rt.label AS type_label,
            rt.is_physical_presence,
            o.name AS object_name,
            COALESCE(r.period_label, (range_json(r.period) ->> 'from_year'::text)) AS when_text
           FROM ((relationships r
             JOIN relationship_types rt ON ((rt.code = r.relationship_type)))
             JOIN entity_index o ON (((o.type = r.object_type) AND (o.id = r.object_id))))
        )
 SELECT 'presence_outside_lifespan'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s (%s) lies outside the lifespan'::text, r.type_label, r.object_name, r.when_text) AS detail
   FROM (rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
  WHERE (r.is_physical_presence AND (r.period IS NOT NULL) AND (a.birth IS NOT NULL) AND (NOT (r.period && a.lifespan)))
UNION ALL
 SELECT 'birth_death_mismatch'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s is dated %s, the %s %s'::text, r.type_label, r.object_name, r.when_text,
        CASE r.relationship_type
            WHEN 'born_in'::text THEN 'birth'::text
            ELSE 'death'::text
        END,
        CASE r.relationship_type
            WHEN 'born_in'::text THEN a.birth_label
            ELSE a.death_label
        END) AS detail
   FROM (rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
  WHERE ((r.period IS NOT NULL) AND (((r.relationship_type = 'born_in'::text) AND (a.birth IS NOT NULL) AND (NOT (r.period && a.birth))) OR ((r.relationship_type = 'died_in'::text) AND (a.death IS NOT NULL) AND (NOT (r.period && a.death)))))
UNION ALL
 SELECT 'artwork_outside_creator_life'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    format('%s %s, but %s %s %s'::text,
        CASE
            WHEN (w.conceived IS NOT NULL) THEN 'designed'::text
            ELSE 'created'::text
        END, COALESCE(w.conceived_label, w.created_label), a.name,
        CASE
            WHEN (COALESCE(w.conceived, w.created) >> a.death) THEN 'died'::text
            ELSE 'was born'::text
        END,
        CASE
            WHEN (COALESCE(w.conceived, w.created) >> a.death) THEN a.death_label
            ELSE a.birth_label
        END) AS detail
   FROM (artworks w
     JOIN artists a ON ((a.id = w.creator_id)))
  WHERE ((COALESCE(w.conceived, w.created) IS NOT NULL) AND (((a.death IS NOT NULL) AND (COALESCE(w.conceived, w.created) >> a.death)) OR ((a.birth IS NOT NULL) AND (COALESCE(w.conceived, w.created) << a.birth))))
UNION ALL
 SELECT 'never_alive_together'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s, but their lifespans do not overlap'::text, r.type_label, r.object_name) AS detail
   FROM ((rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
     JOIN artists b ON (((r.object_type = 'artist'::entity_type) AND (b.id = r.object_id))))
  WHERE ((r.relationship_type = ANY (ARRAY['student_of'::text, 'collaborated_with'::text, 'contemporary_of'::text])) AND (a.birth IS NOT NULL) AND (b.birth IS NOT NULL) AND (NOT (a.lifespan && b.lifespan)))
UNION ALL
 SELECT 'inventory_without_institution'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    format('inventory number %s, but no institution'::text, w.inventory_number) AS detail
   FROM artworks w
  WHERE ((w.inventory_number IS NOT NULL) AND (w.current_institution_id IS NULL))
UNION ALL
 SELECT 'outside_polity_period'::text AS check_id,
    'error'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s (%s) lies outside the existence of %s (%s)'::text, r.type_label, r.object_name, r.when_text, r.object_name, COALESCE(p.period_label, concat_ws('–'::text, (range_json(p.period) ->> 'from_year'::text), (range_json(p.period) ->> 'to_year'::text)))) AS detail
   FROM (rel r
     JOIN polities p ON (((r.object_type = 'polity'::entity_type) AND (p.id = r.object_id))))
  WHERE ((r.period IS NOT NULL) AND (p.period IS NOT NULL) AND (NOT (r.period && p.period)))
UNION ALL
 SELECT 'broken_glossary_link'::text AS check_id,
    'warning'::text AS severity,
    l.entity_type,
    l.entity_id,
    ((((('gl:'::text || l.entity_type) || ':'::text) || l.entity_id) || ':'::text) || l.term_slug) AS issue_key,
    format('links to the glossary term "%s", which doesn''t exist'::text, l.term_slug) AS detail
   FROM glossary_links l
  WHERE (NOT (EXISTS ( SELECT 1
           FROM glossary g
          WHERE (g.slug = l.term_slug))))
UNION ALL
 SELECT 'provenance_gap_1933_1945'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    g.artwork_id AS entity_id,
    ('prov-gap:'::text || g.id) AS issue_key,
    format(
        CASE
            WHEN (g.n = 1) THEN '%1$s: the change of owner (%2$s) is not documented as direct — it may have happened %3$s'::text
            ELSE 'the changes of owner to %1$s are undated or not documented as direct — who held it %3$s?'::text
        END, g.names,
        CASE
            WHEN (g.n = 1) THEN COALESCE(g.acquired_label, 'undated'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN ((g.gap_from IS NULL) AND (g.gap_to IS NULL)) THEN 'at any time'::text
            WHEN (g.gap_from IS NULL) THEN ('before '::text || EXTRACT(year FROM (g.gap_to - 1)))
            WHEN (g.gap_to IS NULL) THEN ('after '::text || EXTRACT(year FROM g.gap_from))
            WHEN (EXTRACT(year FROM g.gap_from) = EXTRACT(year FROM (g.gap_to - 1))) THEN ('in '::text || EXTRACT(year FROM g.gap_from))
            ELSE ((('between '::text || EXTRACT(year FROM g.gap_from)) || ' and '::text) || EXTRACT(year FROM (g.gap_to - 1)))
        END) AS detail
   FROM ( SELECT provenance_gaps.artwork_id,
            provenance_gaps.gap_from,
            provenance_gaps.gap_to,
            min(provenance_gaps.id) AS id,
            count(*) AS n,
            string_agg(provenance_gaps.owner_name, ', '::text ORDER BY provenance_gaps."position") AS names,
            min(provenance_gaps.acquired_label) AS acquired_label
           FROM provenance_gaps
          WHERE (NOT provenance_gaps.direct)
          GROUP BY provenance_gaps.artwork_id, provenance_gaps.gap_from, provenance_gaps.gap_to) g
  WHERE
        CASE
            WHEN ((g.gap_from IS NULL) OR (g.gap_to IS NULL) OR (g.gap_from < g.gap_to)) THEN (daterange(g.gap_from, g.gap_to) && daterange('1933-01-30'::date, '1945-05-09'::date))
            ELSE false
        END
UNION ALL
 SELECT 'provenance_forced_transfer'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-forced:'::text || p.id) AS issue_key,
    format('%s: %s (%s) — no later restitution recorded'::text, p.owner_name, replace((p.method)::text, '_'::text, ' '::text), COALESCE(p.acquired_label, 'undated'::text)) AS detail
   FROM provenance_periods p
  WHERE ((p.method = ANY (ARRAY['confiscation'::acquisition_method, 'forced_sale'::acquisition_method])) AND (NOT (EXISTS ( SELECT 1
           FROM provenance r
          WHERE ((r.artwork_id = p.artwork_id) AND (r."position" > p."position") AND (r.alternative_to IS NULL) AND (r.method = ANY (ARRAY['restitution'::acquisition_method, 'settlement'::acquisition_method])))))))
UNION ALL
 SELECT 'provenance_last_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('prov-last:'::text || w.id) AS issue_key,
    format('the provenance ends with %s, but the work is at %s'::text, p.owner_name, i.name) AS detail
   FROM ((artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
     JOIN provenance_periods p ON (((p.artwork_id = w.id) AND p.is_last)))
  WHERE ((NOT institution_holds(p.owner_institution_id, w.current_institution_id)) AND (NOT w.on_loan))
UNION ALL
 SELECT 'loan_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('loan:'::text || w.id) AS issue_key,
        CASE
            WHEN (p.artwork_id IS NULL) THEN format('on loan at %s — but the provenance names no owner (the lender)'::text, i.name)
            ELSE format('on loan at %s — but the provenance ends with %s itself'::text, i.name, i.name)
        END AS detail
   FROM ((artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
     LEFT JOIN provenance_periods p ON (((p.artwork_id = w.id) AND p.is_last)))
  WHERE (w.on_loan AND ((p.artwork_id IS NULL) OR (p.owner_institution_id = w.current_institution_id)))
UNION ALL
 SELECT 'broken_link'::text AS check_id,
    'warning'::text AS severity,
    l.entity_type,
    l.entity_id,
    ((((((('link:'::text || l.entity_type) || ':'::text) || l.entity_id) || ':'::text) || l.target_type) || '/'::text) || l.target_slug) AS issue_key,
    format('links to %s/%s, which doesn''t exist'::text, l.target_type, l.target_slug) AS detail
   FROM content_links l
  WHERE ((l.target_type <> 'term'::text) AND (NOT (EXISTS ( SELECT 1
           FROM entity_index e
          WHERE (((e.type)::text = l.target_type) AND (e.slug = l.target_slug))))))
UNION ALL
 SELECT 'overlapping_residences'::text AS check_id,
    'warning'::text AS severity,
    r1.subject_type AS entity_type,
    r1.subject_id AS entity_id,
    ((('rel:'::text || r1.id) || ':'::text) || r2.id) AS issue_key,
    format('lived in %s (%s) and %s (%s) at the same time'::text, r1.object_name, r1.when_text, r2.object_name, r2.when_text) AS detail
   FROM (((rel r1
     JOIN rel r2 ON (((r2.subject_type = r1.subject_type) AND (r2.subject_id = r1.subject_id) AND (r2.id > r1.id))))
     CROSS JOIN LATERAL ( SELECT (r1.period * r2.period) AS i) x)
     CROSS JOIN LATERAL ( SELECT (COALESCE(upper(x.i), (lower(x.i) + 36500)) - lower(x.i)) AS days,
            LEAST((COALESCE(upper(r1.period), (lower(r1.period) + 36500)) - lower(r1.period)), (COALESCE(upper(r2.period), (lower(r2.period) + 36500)) - lower(r2.period))) AS shorter) d)
  WHERE ((r1.relationship_type = 'lived_in'::text) AND (r2.relationship_type = 'lived_in'::text) AND (r1.object_id <> r2.object_id) AND (r1.period && r2.period) AND (d.days > 31) AND ((d.days > 366) OR (r1.period @> r2.period) OR (r2.period @> r1.period) OR ((d.days * 2) > d.shorter)))
UNION ALL
 SELECT 'held_before_founded'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('housed at %s (%s), founded %s'::text, r.object_name, r.when_text, i.founded_label) AS detail
   FROM (rel r
     JOIN institutions i ON (((r.object_type = 'institution'::entity_type) AND (i.id = r.object_id))))
  WHERE ((r.relationship_type = 'housed_at'::text) AND (r.period IS NOT NULL) AND (i.founded IS NOT NULL) AND (r.period << i.founded))
UNION ALL
 SELECT 'outside_parent_area'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    c.id AS entity_id,
    ('place:'::text || c.id) AS issue_key,
    format('its point lies outside the outline of %s (%s km away)'::text, p.name, round(((st_distance(pg.outline, cg.marker) / (1000)::double precision))::numeric)) AS detail
   FROM (((places c
     JOIN places p ON ((p.id = c.parent_id)))
     JOIN place_geo cg ON ((cg.id = c.id)))
     JOIN place_geo pg ON ((pg.id = p.id)))
  WHERE ((pg.outline IS NOT NULL) AND (c.location IS NOT NULL) AND (NOT st_dwithin(pg.outline, cg.marker, (5000)::double precision)))
UNION ALL
 SELECT 'possible_duplicate'::text AS check_id,
    'warning'::text AS severity,
    p.type AS entity_type,
    p.a_id AS entity_id,
    ((('dup:'::text || LEAST(p.a_id, p.b_id)) || ':'::text) || GREATEST(p.a_id, p.b_id)) AS issue_key,
    format('probably the same as %s (%s) — %s (score %s)'::text, p.b_name, p.b_slug, array_to_string(p.reasons, ', '::text), p.score) AS detail
   FROM dup_pairs p
  WHERE (NOT ((p.type = 'artwork'::entity_type) AND artworks_in_one_group(p.a_id, p.b_id)))
UNION ALL
 SELECT 'artwork_without_creator'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    'no creator and no attribution'::text AS detail
   FROM artworks w
  WHERE ((w.creator_id IS NULL) AND (w.attribution_label IS NULL))
UNION ALL
 SELECT 'image_without_license'::text AS check_id,
    'warning'::text AS severity,
    i.entity_type,
    i.entity_id,
    ('image:'::text || i.id) AS issue_key,
    (((concat_ws(' and '::text,
        CASE
            WHEN (i.license IS NULL) THEN 'no license'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (i.credit IS NULL) THEN 'no credit'::text
            ELSE NULL::text
        END) || ' for image '::text) || (i."position" + 1)) || COALESCE(((' ('::text || i.caption) || ')'::text), ''::text)) AS detail
   FROM images i
  WHERE ((i.license IS NULL) OR (i.credit IS NULL))
UNION ALL
 SELECT 'no_relationships'::text AS check_id,
    'warning'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((e.type || ':'::text) || e.id) AS issue_key,
    'not connected to anything'::text AS detail
   FROM entity_index e
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM graph_links r
          WHERE (((r.subject_type = e.type) AND (r.subject_id = e.id)) OR ((r.object_type = e.type) AND (r.object_id = e.id)))))) AND (NOT ((e.type = 'artwork'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE ((w.id = e.id) AND ((w.creator_id IS NOT NULL) OR (w.current_institution_id IS NOT NULL))))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM institutions i
          WHERE (i.place_id = e.id))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM places c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'movement'::entity_type) AND (EXISTS ( SELECT 1
           FROM movements c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'polity'::entity_type) AND (EXISTS ( SELECT 1
           FROM polities c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM events v
          WHERE (v.place_id = e.id))))) AND (NOT ((e.type = 'event'::entity_type) AND (EXISTS ( SELECT 1
           FROM events v
          WHERE (((v.id = e.id) AND ((v.place_id IS NOT NULL) OR (v.parent_id IS NOT NULL))) OR (v.parent_id = e.id)))))) AND (NOT ((e.type = 'artist'::entity_type) AND ((EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.owner_artist_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance_co_owners c
          WHERE (c.owner_artist_id = e.id))) OR (EXISTS ( SELECT 1
           FROM artwork_phase_people pp
          WHERE (pp.artist_id = e.id)))))) AND (NOT ((e.type = 'person'::entity_type) AND ((EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.owner_person_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance_co_owners c
          WHERE (c.owner_person_id = e.id))) OR (EXISTS ( SELECT 1
           FROM artwork_phase_people pp
          WHERE (pp.person_id = e.id)))))) AND (NOT ((e.type = 'institution'::entity_type) AND ((EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.owner_institution_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance_co_owners c
          WHERE (c.owner_institution_id = e.id))) OR (EXISTS ( SELECT 1
           FROM artwork_phase_people pp
          WHERE (pp.institution_id = e.id)))))) AND (NOT ((e.type = 'place'::entity_type) AND ((EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.owner_place_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.location_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance_places pl
          WHERE (pl.place_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance_records pr
          WHERE (pr.place_id = e.id)))))) AND (NOT ((e.type = 'event'::entity_type) AND (EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.event_id = e.id))))) AND (NOT ((e.type = 'artwork'::entity_type) AND ((EXISTS ( SELECT 1
           FROM artworks w
          WHERE ((w.id = e.id) AND (w.parent_id IS NOT NULL)))) OR (EXISTS ( SELECT 1
           FROM artworks w
          WHERE (w.parent_id = e.id))) OR (EXISTS ( SELECT 1
           FROM provenance p
          WHERE (p.exchanged_for_artwork_id = e.id)))))) AND (NOT (EXISTS ( SELECT 1
           FROM content_links cl
          WHERE ((cl.target_type = (e.type)::text) AND (cl.target_slug = e.slug) AND ((cl.entity_type IS DISTINCT FROM e.type) OR (cl.entity_id IS DISTINCT FROM e.id)))))) AND (e.type <> ALL (ARRAY['term'::entity_type, 'source'::entity_type])) AND (NOT ((e.type = 'institution'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE (w.current_institution_id = e.id))))) AND (NOT ((e.type = 'artist'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE (w.creator_id = e.id))))))
UNION ALL
 SELECT 'artist_missing_dates'::text AS check_id,
    'warning'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('artist:'::text || a.id) AS issue_key,
    concat_ws(' and '::text,
        CASE
            WHEN (a.birth IS NULL) THEN 'no birth date'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (a.death IS NULL) THEN 'no death date'::text
            ELSE NULL::text
        END) AS detail
   FROM artists a
  WHERE (((a.birth IS NULL) OR (a.death IS NULL)) AND (a.active IS NULL))
UNION ALL
 SELECT 'auto_created'::text AS check_id,
        CASE
            WHEN (ac.via = ANY (ARRAY['provenance'::text, 'relationship'::text])) THEN 'error'::text
            ELSE 'warning'::text
        END AS severity,
    ac.entity_type,
    ac.entity_id,
    ((('auto:'::text || ac.entity_type) || ':'::text) || ac.entity_id) AS issue_key,
    (('created automatically'::text || COALESCE((' while adding '::text || f.name), ''::text)) || ' — fill in the details'::text) AS detail
   FROM (auto_created ac
     LEFT JOIN entity_index f ON (((f.type = ac.created_from_type) AND (f.id = ac.created_from_id))))
UNION ALL
 SELECT 'part_missing_data'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    ('artwork:'::text || a.id) AS issue_key,
    format('no %s — its whole, %s, has %s'::text, concat_ws(' and '::text,
        CASE
            WHEN ((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) THEN 'creator'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.created IS NULL) AND (w.created IS NOT NULL)) THEN 'date'::text
            ELSE NULL::text
        END), w.title, concat_ws(' and '::text,
        CASE
            WHEN ((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) THEN 'one'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.created IS NULL) AND (w.created IS NOT NULL)) THEN COALESCE(w.created_label, 'one'::text)
            ELSE NULL::text
        END)) AS detail
   FROM (artworks a
     JOIN artworks w ON ((w.id = a.parent_id)))
  WHERE (((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) OR ((a.created IS NULL) AND (w.created IS NOT NULL)))
UNION ALL
 SELECT 'institution_without_place'::text AS check_id,
    'info'::text AS severity,
    'institution'::entity_type AS entity_type,
    i.id AS entity_id,
    ('institution:'::text || i.id) AS issue_key,
        CASE
            WHEN (s.slug IS NOT NULL) THEN format('no place (city) — it lies %s km from %s (%s)'::text, s.km, s.name, s.slug)
            ELSE 'no place (city) set — the map can''t show it unless it has its own point'::text
        END AS detail
   FROM (institutions i
     LEFT JOIN LATERAL ( SELECT p.slug,
            p.name,
            round(((st_distance(g.marker, i.location) / (1000)::double precision))::numeric, 1) AS km
           FROM (places p
             JOIN place_geo g ON ((g.id = p.id)))
          WHERE ((i.location IS NOT NULL) AND (p.kind = 'settlement'::place_kind) AND st_dwithin(g.marker, i.location, (25000)::double precision))
          ORDER BY (g.marker <-> i.location)
         LIMIT 1) s ON (true))
  WHERE (i.place_id IS NULL)
UNION ALL
 SELECT 'parent_suggestion'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    c.id AS entity_id,
    ((('place:'::text || c.id) || ':'::text) || s.id) AS issue_key,
    format('lies inside %s (%s) — set it as parent'::text, s.name, s.slug) AS detail
   FROM ((places c
     JOIN place_geo cg ON ((cg.id = c.id)))
     CROSS JOIN LATERAL ( SELECT p.id,
            p.name,
            p.slug
           FROM (places p
             JOIN place_geo pg ON ((pg.id = p.id)))
          WHERE ((p.id <> c.id) AND (pg.outline IS NOT NULL) AND st_covers(pg.outline, cg.marker))
          ORDER BY (st_area(pg.outline))
         LIMIT 1) s)
  WHERE ((c.parent_id IS NULL) AND (c.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind])))
UNION ALL
 SELECT 'boundary_available'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ((('place:'::text || p.id) || ':'::text) || b.code) AS issue_key,
    format('an outline is available: %s (%s) — set the boundary code'::text, b.name, b.code) AS detail
   FROM (places p
     CROSS JOIN LATERAL ( SELECT b_1.code,
            b_1.name
           FROM boundaries b_1
          WHERE (((p.kind = 'country'::place_kind) AND (b_1.level = 0) AND (b_1.code = (p.country_code)::text)) OR ((p.kind = 'region'::place_kind) AND (b_1.level = 1) AND ((b_1.country_code)::text = (place_country(p.id) ->> 'code'::text)) AND (lower(f_unaccent(b_1.name)) = lower(f_unaccent(p.name)))))
         LIMIT 1) b)
  WHERE ((p.kind = ANY (ARRAY['country'::place_kind, 'region'::place_kind])) AND (p.area IS NULL) AND (p.boundary_code IS NULL))
UNION ALL
 SELECT 'missing_romanization'::text AS check_id,
    'info'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((e.type || ':'::text) || e.id) AS issue_key,
    format('"%s" has no romanization'::text, e.name) AS detail
   FROM entity_index e
  WHERE ((e.name !~ '[A-Za-zÀ-ɏ]'::text) AND (NOT jsonb_path_exists(e.names, '$[*]?(@."role" == "romanization")'::jsonpath)))
UNION ALL
 SELECT 'presence_without_period'::text AS check_id,
    'info'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s has no date — not on the timeline or route'::text, r.type_label, r.object_name) AS detail
   FROM rel r
  WHERE (r.is_physical_presence AND (r.period IS NULL))
UNION ALL
 SELECT 'place_without_parent'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ('place:'::text || p.id) AS issue_key,
    'not inside any other place (no parent)'::text AS detail
   FROM places p
  WHERE ((p.parent_id IS NULL) AND (p.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind])))
UNION ALL
 SELECT 'missing_description'::text AS check_id,
    'info'::text AS severity,
    t.type AS entity_type,
    t.id AS entity_id,
    ((t.type || ':'::text) || t.id) AS issue_key,
    'no description / biography'::text AS detail
   FROM ( SELECT 'artist'::entity_type AS type,
            artists.id,
            artists.biography_md AS md
           FROM artists
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            artworks.id,
            artworks.description_md
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            places.id,
            places.description_md
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            movements.id,
            movements.description_md
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            institutions.id,
            institutions.description_md
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            people.id,
            people.description_md
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            polities.id,
            polities.description_md
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            events.id,
            events.description_md
           FROM events
        UNION ALL
         SELECT 'literature'::entity_type AS entity_type,
            literary_works.id,
            literary_works.description_md
           FROM literary_works
          WHERE (literary_works.parent_id IS NULL)
        UNION ALL
         SELECT 'term'::entity_type AS entity_type,
            glossary.id,
            glossary.description_md
           FROM glossary
          WHERE ((glossary.definition IS NULL) AND (glossary.category <> ALL (ARRAY['material'::term_category, 'object type'::term_category])))) t
  WHERE (t.md IS NULL)
UNION ALL
 SELECT 'no_wikidata_id'::text AS check_id,
    'info'::text AS severity,
    t.type AS entity_type,
    t.id AS entity_id,
    ((t.type || ':'::text) || t.id) AS issue_key,
    'no Wikidata id (compare with Wikidata to add it)'::text AS detail
   FROM ( SELECT 'artist'::entity_type AS type,
            artists.id,
            artists.wikidata_id
           FROM artists
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            artworks.id,
            artworks.wikidata_id
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            places.id,
            places.wikidata_id
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            movements.id,
            movements.wikidata_id
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            institutions.id,
            institutions.wikidata_id
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            people.id,
            people.wikidata_id
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            polities.id,
            polities.wikidata_id
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            events.id,
            events.wikidata_id
           FROM events
        UNION ALL
         SELECT 'literature'::entity_type AS entity_type,
            literary_works.id,
            literary_works.wikidata_id
           FROM literary_works
          WHERE (literary_works.parent_id IS NULL)) t
  WHERE (t.wikidata_id IS NULL)
UNION ALL
 SELECT 'event_without_place'::text AS check_id,
    'info'::text AS severity,
    'event'::entity_type AS entity_type,
    v.id AS entity_id,
    ('event:'::text || v.id) AS issue_key,
    'no place, point or area'::text AS detail
   FROM events v
  WHERE ((v.place_id IS NULL) AND (v.location IS NULL) AND (v.area IS NULL))
UNION ALL
 SELECT 'citation_outdated'::text AS check_id,
    'warning'::text AS severity,
    c.entity_type,
    c.entity_id,
    ('cite:'::text || c.id) AS issue_key,
    format('%s changed since it was cited (%s)'::text, c.field, c.source_text) AS detail
   FROM citation_status c
  WHERE c.outdated
UNION ALL
 SELECT 'weakly_sourced'::text AS check_id,
    'info'::text AS severity,
    w.entity_type,
    w.entity_id,
    ((('sourced:'::text || w.entity_type) || ':'::text) || w.entity_id) AS issue_key,
    concat_ws(' · '::text, ('no source: '::text || string_agg(w.field, ', '::text ORDER BY w."position") FILTER (WHERE (w.best IS NULL))), ('only Wikidata / databases: '::text || string_agg(w.field, ', '::text ORDER BY w."position") FILTER (WHERE (w.best = 'database'::source_reliability)))) AS detail
   FROM field_sourcing w
  WHERE (((w.best IS NULL) OR (w.best = 'database'::source_reliability)) AND (NOT ((w.field = 'title_status'::text) AND ((w.value ->> 'title_status'::text) IS DISTINCT FROM 'official'::text))) AND (NOT ((w.field = 'names'::text) AND (NOT ((w.value -> 'names'::text) @> '[{"status": "official"}]'::jsonb)))))
  GROUP BY w.entity_type, w.entity_id
UNION ALL
 SELECT 'title_translation'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('title-translation:'::text || w.id) AS issue_key,
    format('the title “%s” is %s translation — does %s use an official one?'::text, w.title,
        CASE w.title_status
            WHEN 'own'::translation_status THEN 'your own'::text
            ELSE 'a common'::text
        END, i.name) AS detail
   FROM (artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
  WHERE (w.title_status = ANY (ARRAY['own'::translation_status, 'common'::translation_status]))
UNION ALL
 SELECT 'type_doubtful'::text AS check_id,
    'info'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((('type:'::text || e.type) || ':'::text) || e.id) AS issue_key,
    type_doubt(e.type, e.name) AS detail
   FROM entity_index e
  WHERE (type_doubt(e.type, e.name) IS NOT NULL)
UNION ALL
 SELECT 'flagged_holder'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-flag:'::text || p.id) AS issue_key,
    format('%s (%s): %s'::text, p.owner_name, COALESCE(p.period_label, 'undated'::text), holder_flag(p.owner_type, p.owner_id)) AS detail
   FROM provenance_periods p
  WHERE (holder_flag(p.owner_type, p.owner_id) IS NOT NULL)
UNION ALL
 SELECT 'flagged_holder'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ((((('prov-flag-co:'::text || c.provenance_id) || ':'::text) || c.owner_type) || ':'::text) || c.owner_id) AS issue_key,
    format('%s, joint owner (%s): %s'::text, e.name, COALESCE(p.period_label, 'undated'::text), holder_flag(c.owner_type, c.owner_id)) AS detail
   FROM ((provenance_co_owners_x c
     JOIN provenance_periods p ON ((p.id = c.provenance_id)))
     JOIN entity_index e ON (((e.type = c.owner_type) AND (e.id = c.owner_id))))
  WHERE (holder_flag(c.owner_type, c.owner_id) IS NOT NULL)
UNION ALL
 SELECT 'unlinked_term'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ((((('term:'::text || w.id) || ':'::text) || u.what) || ':'::text) || u.value) AS issue_key,
    format('%s "%s" is not a glossary term'::text, u.what, u.value) AS detail
   FROM (artworks w
     CROSS JOIN LATERAL ( SELECT 'type'::text AS what,
            w.kind AS value
          WHERE ((w.kind IS NOT NULL) AND (w.kind_term_id IS NULL))
        UNION ALL
         SELECT 'material'::text AS text,
            m.m
           FROM unnest(w.materials) m(m)
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM (artwork_materials am
                     JOIN glossary g ON ((g.id = am.term_id)))
                  WHERE ((am.artwork_id = w.id) AND (g.name = m.m)))))) u)
UNION ALL
 SELECT 'provenance_stolen'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-stolen:'::text || p.id) AS issue_key,
    format('stolen%s — not recovered (no end recorded): report it to the Art Loss Register, Interpol, Lost Art'::text, COALESCE((' '::text || p.acquired_label), ''::text)) AS detail
   FROM provenance p
  WHERE ((p.method = 'theft'::acquisition_method) AND (p.ended IS NULL) AND (p.alternative_to IS NULL))
UNION ALL
 SELECT 'provenance_seizure_as_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-seized-owner:'::text || p.id) AS issue_key,
    format('%s: %s (%s), recorded as %s — a seizure or theft gives possession, not title: role possessor?'::text, p.owner_name, replace((p.method)::text, '_'::text, ' '::text), COALESCE(p.acquired_label, 'undated'::text), (p.role)::text) AS detail
   FROM provenance_periods p
  WHERE ((p.method = ANY (ARRAY['confiscation'::acquisition_method, 'theft'::acquisition_method])) AND p.in_chain)
UNION ALL
 SELECT 'holder_after_death'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-after-death:'::text || s.id) AS issue_key,
    format('%s acquired it %s — after their death (%s)'::text, s.owner_name, s.acquired_label, l.death_label) AS detail
   FROM (provenance_chain s
     JOIN ( SELECT 'person'::entity_type AS t,
            people.id,
            people.death,
            people.death_label
           FROM people
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            artists.id,
            artists.death,
            artists.death_label
           FROM artists) l ON (((l.t = s.owner_type) AND (l.id = s.owner_id))))
  WHERE ((s.kind = 'step'::text) AND (s.role <> ALL (ARRAY['estate'::holder_role, 'event'::holder_role])) AND (lower(s.acquired) >= upper(l.death)))
UNION ALL
 SELECT 'holder_before_birth'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-before-birth:'::text || s.id) AS issue_key,
    format('%s acquired it %s — before their birth (%s)'::text, s.owner_name, s.acquired_label, l.birth_label) AS detail
   FROM (provenance_chain s
     JOIN ( SELECT 'person'::entity_type AS t,
            people.id,
            people.birth,
            people.birth_label
           FROM people
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            artists.id,
            artists.birth,
            artists.birth_label
           FROM artists) l ON (((l.t = s.owner_type) AND (l.id = s.owner_id))))
  WHERE ((s.kind = 'step'::text) AND (upper(s.acquired) <= lower(l.birth)))
UNION ALL
 SELECT 'acquired_before_creation'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-before-made:'::text || s.id) AS issue_key,
    format('%s acquired it %s — before it was made (%s)'::text, s.owner_name, s.acquired_label, w.created_label) AS detail
   FROM (provenance_chain s
     JOIN artworks w ON ((w.id = s.artwork_id)))
  WHERE ((s.kind = 'step'::text) AND (s.method <> ALL (ARRAY['commission'::acquisition_method, 'creation'::acquisition_method])) AND (upper(s.acquired) <= lower(w.created)))
UNION ALL
 SELECT 'created_where_artist_was_not'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    x.artwork_id AS entity_id,
    ('made-elsewhere:'::text || x.artwork_id) AS issue_key,
    format('made in %s (%s), but %s was in %s then'::text, x.made_in, x.created_label, x.artist, x.places) AS detail
   FROM ( SELECT w.id AS artwork_id,
            w.created_label,
            mp.name AS made_in,
            a.name AS artist,
            string_agg(DISTINCT o.name, ' and '::text) AS places
           FROM ((((((((artworks w
             JOIN artists a ON ((a.id = w.creator_id)))
             JOIN relationships r ON (((r.subject_type = 'artwork'::entity_type) AND (r.subject_id = w.id) AND (r.relationship_type = 'created_in'::text) AND (r.object_type = 'place'::entity_type))))
             JOIN places mp ON ((mp.id = r.object_id)))
             JOIN site_geo mg ON (((mg.type = 'place'::entity_type) AND (mg.id = mp.id))))
             JOIN edges e ON (((e.subject_type = 'artist'::entity_type) AND (e.subject_id = a.id) AND (e.period && w.created))))
             JOIN relationship_types rt ON (((rt.code = e.relationship_type) AND rt.is_physical_presence)))
             JOIN site_geo s ON (((s.type = e.object_type) AND (s.id = e.object_id))))
             JOIN entity_index o ON (((o.type = e.object_type) AND (o.id = e.object_id))))
          WHERE ((w.created IS NOT NULL) AND (mg.marker IS NOT NULL) AND (s.marker IS NOT NULL))
          GROUP BY w.id, w.created, w.created_label, mp.name, a.name
         HAVING (bool_and((st_distance(s.marker, mg.marker) > (100000)::double precision)) AND (range_agg(e.period) @> w.created))) x
UNION ALL
 SELECT 'provenance_date_narrowable'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    i.artwork_id AS entity_id,
    ('prov-narrow:'::text || i.provenance_id) AS issue_key,
    format('%s acquired it %s; %s'::text, p.owner_name, COALESCE(p.acquired_label, 'undated'::text), i.detail) AS detail
   FROM (provenance_inferences i
     JOIN provenance_chain p ON ((p.id = i.provenance_id)))
  WHERE (i.kind = 'narrowed'::text)
UNION ALL
 SELECT 'provenance_record_outside'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    pp.artwork_id AS entity_id,
    ('prov-record:'::text || r.id) AS issue_key,
    format('%s: %s record %s is outside the period %s'::text, pp.owner_name, r.kind, COALESCE(r.date_label, ''::text), COALESCE(pp.period_label, ''::text)) AS detail
   FROM (provenance_records r
     JOIN provenance_periods pp ON ((pp.id = r.provenance_id)))
  WHERE ((r.date IS NOT NULL) AND (pp.period IS NOT NULL) AND (NOT (r.date && pp.period)) AND ((pp.end_basis IS DISTINCT FROM 'unknown'::text) OR (r.date << pp.period) OR (EXISTS ( SELECT 1
           FROM people x
          WHERE ((pp.owner_type = 'person'::entity_type) AND (x.id = pp.owner_id) AND (x.death << r.date)))) OR (EXISTS ( SELECT 1
           FROM artists x
          WHERE ((pp.owner_type = 'artist'::entity_type) AND (x.id = pp.owner_id) AND (x.death << r.date))))))
UNION ALL
 SELECT 'artwork_without_web_page'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    ('web_page:'::text || a.id) AS issue_key,
    'no web page — its page at the museum or collection that holds it'::text AS detail
   FROM artworks a
  WHERE ((a.web_url IS NULL) AND (NOT artwork_is_group(a.kind_term_id)))
UNION ALL
 SELECT 'group_parts_missing'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('group_parts:'::text || w.id) AS issue_key,
    format('%s of %s parts entered'::text, p.n, w.parts_count) AS detail
   FROM (artworks w
     CROSS JOIN LATERAL ( SELECT (count(*))::integer AS n
           FROM artworks c
          WHERE (c.parent_id = w.id)) p)
  WHERE ((w.parts_count IS NOT NULL) AND (p.n < w.parts_count))
UNION ALL
 SELECT 'creation_span_unstated'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    ('created_span:'::text || a.id) AS issue_key,
    (a.created_label || ': worked on over this time, or made at some point in it?'::text) AS detail
   FROM artworks a
  WHERE ((a.created_span IS NULL) AND ((upper(a.created) - lower(a.created)) > 366))
UNION ALL
 SELECT 'place_without_country'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ('country:'::text || p.id) AS issue_key,
    'no country — neither a point inside a country, nor a country code, nor a parent that has one'::text AS detail
   FROM places p
  WHERE (place_country(p.id) IS NULL)
UNION ALL
 SELECT 'place_outside_country'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ((('outside:'::text || p.id) || ':'::text) || (b.country_code)::text) AS issue_key,
    format('country %s by hand, but the point lies in %s (%s)'::text, p.country_code, b.country_code, b.name) AS detail
   FROM (places p
     JOIN boundaries b ON ((b.code = p.within_code)))
  WHERE ((p.country_code IS NOT NULL) AND (p.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind])) AND (b.country_code <> p.country_code))
UNION ALL
 SELECT 'place_used_outside_existence'::text AS check_id,
    'info'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('existed:'::text || r.id) AS issue_key,
    format('%s %s (%s), but %s existed %s'::text, rt.label, p.name, COALESCE(r.period_label, (r.period)::text), p.name, COALESCE(p.existed_label, (p.existed)::text)) AS detail
   FROM ((relationships r
     JOIN places p ON (((r.object_type = 'place'::entity_type) AND (p.id = r.object_id))))
     JOIN relationship_types rt ON ((rt.code = r.relationship_type)))
  WHERE ((p.existed IS NOT NULL) AND (r.period IS NOT NULL) AND (NOT (r.period && p.existed)))
UNION ALL
 SELECT 'designation_not_heritage'::text AS check_id,
    'warning'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('designation:'::text || r.id) AS issue_key,
    format('"designated" %s — a glossary term of the category %s, not a heritage designation'::text, g.name, g.category) AS detail
   FROM (relationships r
     JOIN glossary g ON ((g.id = r.object_id)))
  WHERE ((r.relationship_type = 'designated_as'::text) AND (r.object_type = 'term'::entity_type) AND (g.category <> 'heritage designation'::term_category))
UNION ALL
 SELECT 'source_name_order'::text AS check_id,
    'warning'::text AS severity,
    'source'::entity_type AS entity_type,
    b.id AS entity_id,
    ((('name_order:'::text || n.role) || ':'::text) || n.name) AS issue_key,
    format('%s “%s” has no comma — cited as “%s”; write “Surname, Given names”'::text, n.role, n.name, n.name) AS detail
   FROM (bibliography b
     CROSS JOIN LATERAL ( SELECT 'author'::text AS role,
            x.name
           FROM unnest(b.authors) x(name)
        UNION ALL
         SELECT 'editor'::text AS text,
            x.name
           FROM unnest(b.editors) x(name)
        UNION ALL
         SELECT 'compiler'::text AS text,
            x.name
           FROM unnest(b.compilers) x(name)
        UNION ALL
         SELECT 'editor of the volume'::text AS text,
            x.name
           FROM unnest(b.container_editors) x(name)) n)
  WHERE source_name_unordered(n.name);
