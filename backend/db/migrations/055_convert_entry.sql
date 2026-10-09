-- 055 — An entry of the wrong type (Henry Clay Frick entered as an institution): noticed, and moved.
--
-- 1. type_doubt(type, name): a cheap guess from the name — an institution with a person's name and no word of an
--    institution, or a person / artist whose name has one. Shown while typing a new entry and on the quality page
--    (type_doubtful). The Wikidata class (human, museum …) is checked by the admin when an item is known.
-- 2. convert_entry(type, id, new_type): the entry moves to another table — a new row there with everything both
--    types have (name and other names, description, Wikidata id, dates where both have them …); relationships the
--    new type allows, images, provenance roles, sources of fields both have, reference records the new type takes;
--    then the old row goes. What can't come along is listed (the admin previews it, run in a transaction that is
--    rolled back). Old addresses and [[links]] lead to the new entry (entry_moves).

CREATE FUNCTION type_doubt(etype entity_type, name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH n AS (SELECT lower(public.f_unaccent(coalesce(name, ''))) AS l),
  inst AS (SELECT (SELECT l FROM n) ~ ('(^|[^a-z])(museum|musee|museo|gallery|galerie|galleria|collection|sammlung|foundation|stiftung|fondation'
       || '|fondazione|academy|akademie|academie|accademia|university|universitat|universite|institute|institut|library|bibliothek|bibliotheque'
       || '|archive|archiv|archives|society|gesellschaft|verein|kunsthaus|kunsthalle|kunstmuseum|school|schule|church|kirche|temple|shrine'
       || '|abbey|monastery|kloster|company|gmbh|inc|ltd|trust|center|centre|biennale|salon|club|association|council|ministry|office)($|[^a-z])') AS yes)
  SELECT CASE
    WHEN etype = 'institution' AND NOT (SELECT yes FROM inst)
         AND name ~ '^[[:upper:]][[:alpha:]''.-]+( ([[:upper:]][[:alpha:]''.-]*|von|van|de|der|den|del|della|di|da|du|la|le|ten|ter|y|zu)){1,3}$'
      THEN 'the name looks like a person''s — a person or an artist rather than an institution?'
    WHEN etype IN ('artist', 'person') AND (SELECT yes FROM inst)
      THEN 'the name looks like an institution''s — an institution rather than a ' || etype || '?'
  END
$$;

-- where an entry went when it moved to another type (old addresses and links)
CREATE TABLE entry_moves (
  old_type entity_type NOT NULL,
  old_slug text NOT NULL,
  new_type entity_type NOT NULL,
  new_id   bigint NOT NULL,
  moved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (old_type, old_slug)
);

CREATE FUNCTION convert_entry(etype entity_type, eid bigint, new_type entity_type) RETURNS jsonb LANGUAGE plpgsql AS $$
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
  IF old_row ? 'biography_md' AND new_type <> 'artist' THEN row_json := row_json || jsonb_build_object('description_md', old_row -> 'biography_md'); cols := cols || 'description_md'; END IF;
  IF old_row ? 'description_md' AND new_type = 'artist' THEN row_json := row_json || jsonb_build_object('biography_md', old_row -> 'description_md'); cols := cols || 'biography_md'; END IF;
  -- a slug free in the new table
  new_slug := old_row ->> 'slug';
  EXECUTE format('SELECT 1 FROM %I WHERE slug = $1', new_tbl) INTO n USING new_slug;
  IF n IS NOT NULL THEN new_slug := new_slug || '-' || etype; END IF;
  row_json := row_json || jsonb_build_object('slug', new_slug);
  IF NOT 'slug' = ANY (cols) THEN cols := cols || 'slug'; END IF;
  -- required by the new table
  IF new_type = 'place' THEN row_json := row_json || '{"kind": "site"}'; cols := cols || 'kind'; END IF;
  IF new_type = 'movement' THEN row_json := row_json || '{"kind": "movement"}'; cols := cols || 'kind'; END IF;
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

-- Quality (052's view): type_doubtful.
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
FROM field_sourcing w WHERE (w.best IS NULL OR w.best = 'database')
  -- a title's standing and the other names want a source only where they claim to be official (052)
  AND NOT (w.field = 'title_status' AND w.value ->> 'title_status' IS DISTINCT FROM 'official')
  AND NOT (w.field = 'names' AND NOT (w.value -> 'names') @> '[{"status": "official"}]')
GROUP BY w.entity_type, w.entity_id
UNION ALL
-- The title is a translation that isn't official, while an institution holds the work: it may well have an official
-- title in that language (its online collection) — worth checking (052)
SELECT 'title_translation', 'info', 'artwork', w.id, 'title-translation:' || w.id,
       format('the title “%s” is %s translation — does %s use an official one?', w.title,
              CASE w.title_status WHEN 'own' THEN 'your own' ELSE 'a common' END, i.name)
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
WHERE w.title_status IN ('own', 'common')
UNION ALL
-- The name doesn't fit the type (055): an institution named like a person, a person or artist named like an
-- institution — perhaps created as the wrong kind of entry ("Change type…" on its page)
SELECT 'type_doubtful', 'info', e.type, e.id, 'type:' || e.type || ':' || e.id, type_doubt(e.type, e.name)
FROM entity_index e WHERE type_doubt(e.type, e.name) IS NOT NULL;
