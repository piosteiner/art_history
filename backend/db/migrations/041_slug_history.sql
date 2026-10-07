-- 041 — Old slugs keep working: when an entry's slug changes, the old one is remembered, and the API and the admin
-- answer it with a redirect to the new address (bookmarks and links from elsewhere don't break).
-- One trigger function for every entity table; its type comes as the trigger's argument (like delete_entity_relationships).
CREATE TABLE slug_history (
  entity_type entity_type NOT NULL,
  old_slug    text NOT NULL,
  entity_id   bigint NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, old_slug)
);

CREATE FUNCTION record_slug_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE etype entity_type := TG_ARGV[0]::entity_type;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- the old address now leads here (also if another entry had it before and was renamed or deleted)
    INSERT INTO slug_history (entity_type, old_slug, entity_id) VALUES (etype, OLD.slug, OLD.id)
    ON CONFLICT (entity_type, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, changed_at = now();
    -- a slug in use is no longer an old address of anything
    DELETE FROM slug_history WHERE entity_type = etype AND old_slug = NEW.slug;
  END IF;
  RETURN NEW;
END $$;

-- A new entry taking a slug that used to redirect: the slug is its own now.
CREATE FUNCTION release_old_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM slug_history WHERE entity_type = TG_ARGV[0]::entity_type AND old_slug = NEW.slug;
  RETURN NEW;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('artists', 'artist'), ('artworks', 'artwork'), ('institutions', 'institution'),
    ('people', 'person'), ('movements', 'movement'), ('places', 'place'), ('polities', 'polity'), ('glossary', 'term'),
    ('bibliography', 'source')) AS v(tbl, etype)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OF slug ON %I FOR EACH ROW EXECUTE FUNCTION record_slug_change(%L)',
                   r.tbl || '_slug_history', r.tbl, r.etype);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION release_old_slug(%L)',
                   r.tbl || '_slug_release', r.tbl, r.etype);
  END LOOP;
END $$;

-- Entries deleted: their old slugs lead nowhere (the generic delete trigger of 001/021 gets one more statement).
CREATE OR REPLACE FUNCTION delete_entity_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  etype entity_type := TG_ARGV[0]::entity_type;
BEGIN
  DELETE FROM relationships
   WHERE (subject_type = etype AND subject_id = OLD.id)
      OR (object_type  = etype AND object_id  = OLD.id);
  DELETE FROM auto_created WHERE entity_type = etype AND entity_id = OLD.id;
  DELETE FROM slug_history WHERE entity_type = etype AND entity_id = OLD.id;
  RETURN OLD;
END $$;
