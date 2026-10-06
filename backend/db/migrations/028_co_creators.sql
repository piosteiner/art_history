-- 028 — Several creators for one artwork (rare: Rubens painted the figures, Jan Brueghel the landscape).
-- artworks.creator_id stays the main creator. Further creators are ordinary relationships artwork → artist, so the
-- admin form, history, import/export and the graph handle them without new code; the relationship's label holds the
-- part they did ("landscape", "figures") and certainty how sure the attribution is.
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order) VALUES
  ('co_creator', 'co-creator', 'co-creator of', 'collaboration', false, false, '{artwork}', '{artist}',
   'A further creator besides the main one (artworks.creator_id) — collaborations, a second hand. The label can say which part ("landscape", "figures").', 52);

-- All creators of an artwork in order: the main one first, then the co-creators by name.
-- role = the relationship's label (NULL for the main creator), certainty: attested / probable / possible / disputed.
CREATE FUNCTION artwork_creators(p_artwork bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'main', c.main,
                                               'role', c.role, 'certainty', c.certainty)
                            ORDER BY c.main DESC, c.name), '[]'::jsonb)
  FROM (SELECT a.slug, a.name, true AS main, NULL::text AS role, 'attested' AS certainty
          FROM artworks w JOIN artists a ON a.id = w.creator_id WHERE w.id = p_artwork
        UNION ALL
        SELECT a.slug, a.name, false, r.label, r.certainty::text
          FROM relationships r JOIN artists a ON a.id = r.object_id
         WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.subject_id = p_artwork) c
$$;
