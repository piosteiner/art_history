-- 166 — Heritage designations ("Schutzstatus", owner 2026-10-29). Not a column but a relationship to a glossary term:
--   artwork | institution | place —designated_as→ term (category 'heritage designation')
-- so a work can hold several (UNESCO and national), each with its date (the period: since when, until it was
-- lifted), a note (the register number) and its own sources — as every relationship (049); the term carries the
-- names in every language (国宝, Nationalschatz …) and its country in its name, its broader term the kind
-- (146: "National Treasure (Japan)" › "heritage designation"). A check reports a designation pointing at a term
-- of another category.
INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, description, sort_order)
VALUES ('designated_as', 'designated', 'designation of', 'heritage', '{artwork,institution,place}', '{term}',
        'A heritage designation: National Treasure (Japan), World Heritage Site … — the period says since when', 900);

INSERT INTO glossary (slug, name, category, definition, wikidata_id, names) VALUES
  ('heritage-designation', 'heritage designation', 'heritage designation',
   'Protection a state or an international body gives a work, a building or a place — it is registered, may not be exported or altered without leave.',
   'Q2065736', '[{"text": "Schutzstatus", "lang": "de", "role": "translation"}, {"text": "protection patrimoniale", "lang": "fr", "role": "translation"}, {"text": "{文化財|ぶんかざい}", "lang": "ja", "role": "translation"}]'),
  ('national-treasure-japan', 'National Treasure (Japan)', 'heritage designation',
   'The highest designation of Japan’s Agency for Cultural Affairs for tangible cultural property: Important Cultural Properties of outstanding value (kokuhō).',
   'Q1139795', '[{"text": "{国宝|こくほう}", "lang": "ja", "role": "translation"}, {"text": "Nationalschatz Japans", "lang": "de", "role": "translation"}, {"text": "trésor national du Japon", "lang": "fr", "role": "translation"}]'),
  ('important-cultural-property-japan', 'Important Cultural Property (Japan)', 'heritage designation',
   'A tangible cultural property of particular importance, designated by Japan’s Agency for Cultural Affairs (jūyō bunkazai).',
   'Q1188622', '[{"text": "{重要文化財|じゅうようぶんかざい}", "lang": "ja", "role": "translation"}, {"text": "Wichtiges Kulturgut Japans", "lang": "de", "role": "translation"}, {"text": "bien culturel important du Japon", "lang": "fr", "role": "translation"}]'),
  ('important-art-object-japan', 'Important Art Object (Japan)', 'heritage designation',
   'The pre-war designation of 1933–1950 (jūyō bijutsuhin) for works not to leave Japan; kept for objects not designated since.',
   'Q11644862', '[{"text": "{重要美術品|じゅうようびじゅつひん}", "lang": "ja", "role": "translation"}, {"text": "Wichtiges Kunstobjekt (Japan)", "lang": "de", "role": "translation"}]'),
  ('world-heritage-site', 'World Heritage Site', 'heritage designation',
   'A place inscribed on UNESCO’s World Heritage List for its outstanding universal value.',
   'Q9259', '[{"text": "UNESCO-Welterbe", "lang": "de", "role": "translation"}, {"text": "patrimoine mondial", "lang": "fr", "role": "translation"}, {"text": "{世界遺産|せかいいさん}", "lang": "ja", "role": "translation"}]'),
  ('cultural-property-of-national-significance-switzerland', 'Cultural property of national significance (Switzerland)', 'heritage designation',
   'An A object of the Swiss Inventory of Cultural Property of National and Regional Significance (KGS inventory).',
   'Q869941', '[{"text": "Kulturgut von nationaler Bedeutung", "lang": "de", "role": "translation"}, {"text": "bien culturel d’importance nationale", "lang": "fr", "role": "translation"}]'),
  ('monument-historique-france', 'Monument historique (France)', 'heritage designation',
   'A building, object or site protected by the French state, "classé" or "inscrit".',
   'Q916475', '[{"text": "Monument historique", "lang": "de", "role": "translation"}, {"text": "monument historique", "lang": "fr", "role": "translation"}]')
ON CONFLICT (slug) DO NOTHING;
UPDATE glossary SET parent_id = (SELECT id FROM glossary WHERE slug = 'heritage-designation')
 WHERE category = 'heritage designation' AND slug <> 'heritage-designation' AND parent_id IS NULL;

-- the check: a designation must be one (a term of the category)
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('designation_not_heritage' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'designation_not_heritage'::text AS check_id,
    'warning'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    'designation:'::text || r.id AS issue_key,
    format('"designated" %s — a glossary term of the category %s, not a heritage designation', g.name, g.category) AS detail
   FROM relationships r JOIN glossary g ON g.id = r.object_id
  WHERE r.relationship_type = 'designated_as' AND r.object_type = 'term' AND g.category <> 'heritage designation'$b$;
END $$;
