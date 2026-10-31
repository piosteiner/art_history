-- 180 — no_relationships: a reference anywhere counts as a connection (owner 2026-10-31: "each entry should have at
-- least 1 connection"). Of 42 entries "not connected to anything", 11 were referenced in ways graph_links doesn't show:
-- an owner in a provenance event step (transfer, claim — no edge), a co-owner, a place of a provenance record or a
-- step's further places, people of a building phase other than artists and patrons, a group with its parts, and
-- entries named only by [[links]] in texts. These count now, besides what 177 counts:
--   artist/person/institution — provenance owner (any role), co-owner, building-phase person
--   place — provenance owner or location, a step's further places, a provenance record's place
--   event — named by a provenance step; artwork — part of a group, a group with parts, given in exchange
--   any type — the target of a [[link]] in another entry's text (content_links)
-- The worker re-checks the referenced entries already (derived_touch on those tables, phase_people_touch); for the
-- texts a trigger queues the targets of the links added or removed (text_links_touch). The view is patched as it stands.

-- the further places of a step, looked up by place (provenance_records has its index since 104)
CREATE INDEX provenance_places_place_idx ON provenance_places (place_id);

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  old text := 'AND (e.type <> ALL (ARRAY[''term''::entity_type, ''source''::entity_type]))';
  extra text := $x$
    AND NOT (e.type = 'artist' AND (EXISTS (SELECT 1 FROM provenance p WHERE p.owner_artist_id = e.id)
                                 OR EXISTS (SELECT 1 FROM provenance_co_owners c WHERE c.owner_artist_id = e.id)
                                 OR EXISTS (SELECT 1 FROM artwork_phase_people pp WHERE pp.artist_id = e.id)))
    AND NOT (e.type = 'person' AND (EXISTS (SELECT 1 FROM provenance p WHERE p.owner_person_id = e.id)
                                 OR EXISTS (SELECT 1 FROM provenance_co_owners c WHERE c.owner_person_id = e.id)
                                 OR EXISTS (SELECT 1 FROM artwork_phase_people pp WHERE pp.person_id = e.id)))
    AND NOT (e.type = 'institution' AND (EXISTS (SELECT 1 FROM provenance p WHERE p.owner_institution_id = e.id)
                                      OR EXISTS (SELECT 1 FROM provenance_co_owners c WHERE c.owner_institution_id = e.id)
                                      OR EXISTS (SELECT 1 FROM artwork_phase_people pp WHERE pp.institution_id = e.id)))
    AND NOT (e.type = 'place' AND (EXISTS (SELECT 1 FROM provenance p WHERE p.owner_place_id = e.id)
                                OR EXISTS (SELECT 1 FROM provenance p WHERE p.location_id = e.id)
                                OR EXISTS (SELECT 1 FROM provenance_places pl WHERE pl.place_id = e.id)
                                OR EXISTS (SELECT 1 FROM provenance_records pr WHERE pr.place_id = e.id)))
    AND NOT (e.type = 'event' AND EXISTS (SELECT 1 FROM provenance p WHERE p.event_id = e.id))
    AND NOT (e.type = 'artwork' AND (EXISTS (SELECT 1 FROM artworks w WHERE w.id = e.id AND w.parent_id IS NOT NULL)
                                  OR EXISTS (SELECT 1 FROM artworks w WHERE w.parent_id = e.id)
                                  OR EXISTS (SELECT 1 FROM provenance p WHERE p.exchanged_for_artwork_id = e.id)))
    AND NOT EXISTS (SELECT 1 FROM content_links cl
                    WHERE cl.target_type = e.type::text AND cl.target_slug = e.slug
                      AND (cl.entity_type, cl.entity_id) IS DISTINCT FROM (e.type, e.id))
    $x$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: "%" not found exactly once', old;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old, extra || old);
END $$;

-- a text's [[links]] added or removed: their targets are queued (connected or not any more). Every "*_md" column of
-- the row, old and new; only when a text changed. Links as content_links reads them: [[type/slug]], [[slug]] = term.
CREATE FUNCTION text_links_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  INSERT INTO derived_queue (type, id)
    SELECT DISTINCT e.type, e.id
    FROM (SELECT o AS j UNION ALL SELECT n) r
    CROSS JOIN LATERAL jsonb_each_text(r.j) k(col, md)
    CROSS JOIN LATERAL regexp_matches(k.md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]', 'g') m(m)
    JOIN entity_index e ON e.type::text = coalesce(m.m[1], 'term') AND e.slug = m.m[2]
    WHERE r.j IS NOT NULL AND k.col LIKE '%\_md' AND k.md LIKE '%[[%'
      AND (o -> k.col) IS DISTINCT FROM (n -> k.col);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION text_links_touch() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['artists', 'artworks', 'institutions', 'people', 'movements', 'places', 'polities', 'glossary',
                           'bibliography', 'relationships', 'provenance', 'events'] LOOP
    EXECUTE format('CREATE TRIGGER text_links_touch AFTER INSERT OR DELETE OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION text_links_touch()', t);
  END LOOP;
END $$;
