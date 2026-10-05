-- 024 — Patrons become People: everyone relevant who isn't an artist (poets, rulers, monks, scholars, sitters …)
-- and groups (families, dynasties, religious orders, guilds). Being a patron is a role, expressed by the
-- relationships "commissioned" / "patron of" — as it already was. New: birth/death, occupations, and depictions
-- (artwork —depicts→ person or artist). Rule: whoever made art is an artist; everyone else is a person.
--
-- RENAME VALUE renames the enum label in place: every stored value (relationships, vocabulary, drafts, flags …)
-- is the enum's internal number, so all of them now read 'person' with nothing rewritten. What is stored as TEXT
-- has to be updated by hand: function bodies, trigger arguments, and the JSON copies in audit_log.
ALTER TYPE entity_type RENAME VALUE 'patron' TO 'person';
ALTER TABLE patrons RENAME TO people;

-- Tidy names: constraints (renaming a unique/primary key constraint renames its index), other indexes, triggers.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'people'::regclass AND conname LIKE 'patrons\_%' LOOP
    EXECUTE format('ALTER TABLE people RENAME CONSTRAINT %I TO %I', r.conname, 'people_' || substr(r.conname, 9));
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE tablename = 'people' AND indexname LIKE 'patrons\_%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'people_' || substr(r.indexname, 9));
  END LOOP;
END $$;
ALTER TRIGGER patrons_audit ON people RENAME TO people_audit;
ALTER TRIGGER patrons_updated_at ON people RENAME TO people_updated_at;
-- the delete trigger gets its type as a text argument: re-created with the new name
DROP TRIGGER patrons_delete_relationships ON people;
CREATE TRIGGER people_delete_relationships AFTER DELETE ON people FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships('person');

-- What people have that patrons lacked: life dates (like artists, with the same generated lifespan), occupations.
ALTER TABLE people RENAME COLUMN notes_md TO description_md;
ALTER TABLE people
  ADD COLUMN birth       daterange CHECK (NOT isempty(birth)),
  ADD COLUMN birth_label text,
  ADD COLUMN death       daterange CHECK (NOT isempty(death)),
  ADD COLUMN death_label text,
  ADD COLUMN lifespan    daterange GENERATED ALWAYS AS (daterange(lower(birth), upper(death))) STORED,
  ADD COLUMN occupations text[] NOT NULL DEFAULT '{}',   -- poet, monk, emperor … (several possible)
  ADD CONSTRAINT people_death_after_birth CHECK (lower(death) >= lower(birth));
CREATE INDEX people_occupations_gin ON people USING gin (occupations);   -- WHERE occupations @> '{poet}'
CREATE INDEX people_lifespan_gist ON people USING gist (lifespan);

-- Functions whose SQL text names the type or the table.
CREATE OR REPLACE FUNCTION entity_exists(etype entity_type, eid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'person'      THEN EXISTS (SELECT 1 FROM people       WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
    WHEN 'polity'      THEN EXISTS (SELECT 1 FROM polities     WHERE id = eid)
  END
$$;
CREATE OR REPLACE FUNCTION entity_id(etype entity_type, eslug text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'person'      THEN (SELECT id FROM people       WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
    WHEN 'polity'      THEN (SELECT id FROM polities     WHERE slug = eslug)
  END
$$;
CREATE OR REPLACE FUNCTION entity_table(etype entity_type) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE etype WHEN 'polity' THEN 'polities' WHEN 'person' THEN 'people' ELSE etype::text || 's' END
$$;
CREATE OR REPLACE FUNCTION entity_home_place(etype entity_type, eid bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN etype = 'institution' THEN (SELECT place_id FROM institutions WHERE id = eid)
    WHEN etype IN ('artist', 'person', 'artwork') THEN (
      SELECT r.object_id FROM relationships r
      WHERE r.subject_type = etype AND r.subject_id = eid AND r.object_type = 'place'
        AND r.relationship_type = CASE etype WHEN 'artwork' THEN 'created_in' ELSE 'born_in' END
      ORDER BY lower(r.period) NULLS LAST, r.id LIMIT 1)
  END
$$;

CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind,
         names, name_sort_key(name, name_ruby, names) AS sort_key, name_alt_text(name_ruby, names) AS alt_text
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind,
         names, name_sort_key(title, title_ruby, names), name_alt_text(title_ruby, names)
    FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM institutions
  UNION ALL
  -- a person's span is the lifespan when known, else the active period (families, orders: only that)
  SELECT 'person', id, slug, name, coalesce(lifespan, active),
         coalesce(nullif(concat_ws('–', birth_label, death_label), ''), active_label), kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM people
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM polities;

-- History: the copies in audit_log are JSON text — rename there too, so old changes stay revertible and named.
UPDATE audit_log SET table_name = 'people' WHERE table_name = 'patrons';
UPDATE audit_log SET
  old_row = CASE WHEN old_row IS NULL THEN NULL ELSE old_row
    || CASE WHEN old_row->>'subject_type' = 'patron' THEN '{"subject_type": "person"}'::jsonb ELSE '{}' END
    || CASE WHEN old_row->>'object_type'  = 'patron' THEN '{"object_type": "person"}'::jsonb ELSE '{}' END END,
  new_row = CASE WHEN new_row IS NULL THEN NULL ELSE new_row
    || CASE WHEN new_row->>'subject_type' = 'patron' THEN '{"subject_type": "person"}'::jsonb ELSE '{}' END
    || CASE WHEN new_row->>'object_type'  = 'patron' THEN '{"object_type": "person"}'::jsonb ELSE '{}' END END
WHERE table_name = 'relationships' AND 'patron' IN (old_row->>'subject_type', old_row->>'object_type', new_row->>'subject_type', new_row->>'object_type');
UPDATE audit_log SET
  old_row = CASE WHEN old_row ? 'notes_md' THEN (old_row - 'notes_md') || jsonb_build_object('description_md', old_row->'notes_md') ELSE old_row END,
  new_row = CASE WHEN new_row ? 'notes_md' THEN (new_row - 'notes_md') || jsonb_build_object('description_md', new_row->'notes_md') ELSE new_row END
WHERE table_name = 'people';
-- acknowledged quality findings are keyed by text like 'patron:12'
UPDATE quality_acks SET issue_key = replace(issue_key, 'patron:', 'person:') WHERE issue_key LIKE '%patron:%';

-- Vocabulary: depictions, and the relationships people now take part in besides artists.
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order) VALUES
  ('depicts_person', 'depicts', 'depicted in', 'depiction', false, false, '{artwork}', '{person,artist}',
   'A person shown in the artwork — portrait, self-portrait, a ruler or monk in a scene. The label can say how ("portrait", "as Amida").', 23);
UPDATE relationship_types SET subject_types = '{artist,artwork,movement,person}', object_types = '{artist,artwork,movement,person}'
 WHERE code = 'influenced_by';                                                   -- a poet influenced by / influencing an artist
UPDATE relationship_types SET subject_types = '{artist,person}', object_types = '{artist,person}'
 WHERE code = 'collaborated_with';                                               -- e.g. a poet and a printmaker on a book
UPDATE relationship_types SET subject_types = '{artist,artwork,institution,person}' WHERE code = 'associated_with';
UPDATE relationship_types SET object_types = '{artist,person}' WHERE code = 'student_of';  -- an artist taught by a monk, a scholar
