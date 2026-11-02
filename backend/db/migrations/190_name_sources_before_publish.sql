-- 190: a source for a name not published yet (owner 2026-11-02: "when adding multiple names in the edit page not every
-- name can be given a source"). A name's sources hang on its row of entry_names (152), which a name added in the edit
-- form only gets on Publish. Until then the source waits on the entry with the name's text (name_text — no field: it
-- is no field's source) and pending = {"__name": text}; when the name's row is made, or a row is renamed to that text,
-- a trigger moves the source to the row. A name removed before Publishing takes its source along (settle()).
ALTER TABLE citations ADD COLUMN name_text text CHECK (name_text IS NULL OR (entity_id IS NOT NULL AND field IS NULL AND btrim(name_text) <> ''));
ALTER TABLE citations DROP CONSTRAINT citations_check2;   -- entity and field together — except a name's waiting source
ALTER TABLE citations ADD CONSTRAINT citations_entity_field CHECK ((entity_id IS NULL) = (entity_type IS NULL)
  AND ((entity_id IS NULL) = (field IS NULL) OR name_text IS NOT NULL));
-- one citation per source and target: the name a source waits for is part of the target
DROP INDEX citations_one_per_source;
CREATE UNIQUE INDEX citations_one_per_source ON citations (entity_type, entity_id, field, name_text, relationship_id, provenance_id, number_id, name_id, source_id)
  NULLS NOT DISTINCT WHERE source_id IS NOT NULL;

CREATE FUNCTION citations_to_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- a source that cites the row already: its waiting twin goes
  DELETE FROM citations w WHERE w.entity_type = NEW.entity_type AND w.entity_id = NEW.entity_id AND w.name_text = NEW.text
    AND w.source_id IS NOT NULL AND EXISTS (SELECT 1 FROM citations o WHERE o.name_id = NEW.id AND o.source_id = w.source_id);
  UPDATE citations SET name_id = NEW.id, entity_type = NULL, entity_id = NULL, name_text = NULL, pending = NULL
   WHERE entity_type = NEW.entity_type AND entity_id = NEW.entity_id AND name_text = NEW.text;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_names_take_sources AFTER INSERT OR UPDATE OF text ON entry_names
  FOR EACH ROW EXECUTE FUNCTION citations_to_name();
