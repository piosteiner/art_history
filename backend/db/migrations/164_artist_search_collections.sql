-- 164 — Artists found through a museum (roadmap, owner 2026-10-24: "Wenn man bei Artists nach Borghese sucht, dann
-- sollten alle Künstler angezeigt werden, welche heute oder früher in diesem Museum Werke hatten"). Two search fields
-- per artist, as the museums have "Works by" (110): the collections holding their works now and those that held them,
-- each a tier — matched only through it, an artist comes after the others under "With works now in a matching
-- collection" / "… formerly in …". artwork_holders (098) says now / before; artwork_artists covers co-creators.
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('entry_search_fields'::regclass), E'; \n');
  anchor text := E'        UNION ALL\n         SELECT ''artwork''::entity_type AS entity_type,';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'entry_search_fields: anchor not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW entry_search_fields AS ' || replace(def, anchor, $add$        UNION ALL
         SELECT 'artist'::entity_type AS entity_type, a.id, x."position", x.label, x.text, NULL::text AS match, x.tier_rank, x.tier_heading
           FROM artists a
             CROSS JOIN LATERAL ( VALUES
               (5, 'Works now in'::text, ( SELECT string_agg(DISTINCT i.name, ', '::text) FROM artwork_holders h
                   JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id JOIN institutions i ON i.id = h.institution_id
                  WHERE aa.artist_id = a.id AND h.now), 1, 'With works now in a matching collection'::text),
               (6, 'Works formerly in'::text, ( SELECT string_agg(DISTINCT i.name, ', '::text) FROM artwork_holders h
                   JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id JOIN institutions i ON i.id = h.institution_id
                  WHERE aa.artist_id = a.id AND NOT h.now), 2, 'With works formerly in a matching collection'::text)
             ) x("position", label, text, tier_rank, tier_heading)
$add$ || anchor);
END $$;
DELETE FROM entry_search_fields_stored WHERE type = 'artist';
INSERT INTO entry_search_fields_stored SELECT * FROM entry_search_fields WHERE type = 'artist';
