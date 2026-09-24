-- 003 — Look up an entity id by (type, slug). Used by the import script, admin panel and tests.
--   SELECT entity_id('artist', 'vincent-van-gogh');
CREATE FUNCTION entity_id(etype entity_type, eslug text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'patron'      THEN (SELECT id FROM patrons      WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
  END
$$;
