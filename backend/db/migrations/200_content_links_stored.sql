-- 200 — Links between texts stored (perf, 2026-11-03). The backlinks of an entry ("Linked from" in the CMS, the API's
-- backlinks) read the view content_links (030), which finds every [[link]] in every text of the database on each call:
-- ~600 ms on the perf data (10× today), most of an artist's or museum's page (budget 300 ms). Now the links are kept in
-- content_links_stored, refreshed per entry by triggers whenever a text that holds links changes — an entry's own
-- text, a relationship's notes (its subject's), a provenance step's notes (the work's). The view stays the definition:
-- the refresh asks it for the one entry (a filter Postgres pushes into its branches: 1–12 ms).
CREATE TABLE content_links_stored (
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  target_type text NOT NULL,
  target_slug text NOT NULL,
  PRIMARY KEY (entity_type, entity_id, target_type, target_slug)
);
COMMENT ON TABLE content_links_stored IS 'The view content_links stored (200): kept per entry by triggers (content_links_touch).';
CREATE INDEX content_links_stored_target ON content_links_stored (target_type, target_slug);
INSERT INTO content_links_stored SELECT entity_type, entity_id, target_type, target_slug FROM content_links;
GRANT SELECT ON content_links_stored TO arthistory_api, arthistory_admin;

-- one entry's links again from the view
CREATE FUNCTION content_links_refresh(t entity_type, eid bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM content_links_stored WHERE entity_type = t AND entity_id = eid;
  INSERT INTO content_links_stored (entity_type, entity_id, target_type, target_slug)
    SELECT entity_type, entity_id, target_type, target_slug FROM content_links WHERE entity_type = t AND entity_id = eid
    ON CONFLICT DO NOTHING;
$$;

-- the trigger: TG_ARGV = (type — a literal, or '@column' for a column holding it; the id column; the text column).
-- An update refreshes only when the text, the entry it belongs to or its type changed.
CREATE FUNCTION content_links_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  typ text := TG_ARGV[0];
  idc text := TG_ARGV[1];
  mdc text := TG_ARGV[2];
  r jsonb;
  t text;
BEGIN
  IF TG_OP = 'UPDATE' AND (o -> mdc) IS NOT DISTINCT FROM (n -> mdc) AND (o -> idc) IS NOT DISTINCT FROM (n -> idc)
     AND (left(typ, 1) <> '@' OR (o -> substr(typ, 2)) IS NOT DISTINCT FROM (n -> substr(typ, 2))) THEN
    RETURN NULL;
  END IF;
  FOREACH r IN ARRAY array_remove(ARRAY[o, n], NULL) LOOP
    t := CASE WHEN left(typ, 1) = '@' THEN r ->> substr(typ, 2) ELSE typ END;
    IF t IS NOT NULL AND r ->> idc IS NOT NULL THEN
      PERFORM content_links_refresh(t::entity_type, (r ->> idc)::bigint);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON artists FOR EACH ROW EXECUTE FUNCTION content_links_touch('artist', 'id', 'biography_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON artworks FOR EACH ROW EXECUTE FUNCTION content_links_touch('artwork', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON institutions FOR EACH ROW EXECUTE FUNCTION content_links_touch('institution', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON people FOR EACH ROW EXECUTE FUNCTION content_links_touch('person', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION content_links_touch('movement', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON places FOR EACH ROW EXECUTE FUNCTION content_links_touch('place', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON polities FOR EACH ROW EXECUTE FUNCTION content_links_touch('polity', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON glossary FOR EACH ROW EXECUTE FUNCTION content_links_touch('term', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION content_links_touch('source', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION content_links_touch('event', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON literary_works FOR EACH ROW EXECUTE FUNCTION content_links_touch('literature', 'id', 'description_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON relationships FOR EACH ROW EXECUTE FUNCTION content_links_touch('@subject_type', 'subject_id', 'notes_md');
CREATE TRIGGER content_links_touch AFTER INSERT OR UPDATE OR DELETE ON provenance FOR EACH ROW EXECUTE FUNCTION content_links_touch('artwork', 'artwork_id', 'notes_md');
