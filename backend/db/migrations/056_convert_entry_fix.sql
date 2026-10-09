-- 056 — convert_entry (055) failed for artists (biography_md) and into places and movements (kind):
-- `cols || 'description_md'` — text[] || an untyped literal — makes Postgres read the literal as an array
-- ("malformed array literal"). array_append(cols, 'x') says what is meant. The function as in 055 otherwise.
CREATE OR REPLACE FUNCTION convert_entry(etype entity_type, eid bigint, new_type entity_type) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  old_tbl text := public.entity_table(etype);
  new_tbl text := public.entity_table(new_type);
  movable entity_type[] := '{artist,person,institution,movement,place,polity,event,term}';
  old_row jsonb; row_json jsonb := '{}'; cols text[]; lost text[] := '{}';
  -- nid: the new row's id (new_id is also a column of entry_moves)
  nid bigint; new_slug text; n bigint; r record; target_col text;
  dropped_rels text[] := '{}'; dropped jsonb := '{}'; texts bigint := 0;
  prev_source text := current_setting('arthistory.source', true);
BEGIN
  IF etype = new_type THEN RAISE EXCEPTION 'It is a % already.', etype; END IF;
  IF NOT etype = ANY (movable) OR NOT new_type = ANY (movable) THEN
    RAISE EXCEPTION 'An % can''t change its type (only artists, people, institutions, movements, places, polities, events and glossary terms can).',
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
END $$;
