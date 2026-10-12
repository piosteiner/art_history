-- 060: KulturNav (the authority file of Norwegian, Swedish and Finnish museums) and the National Library of Korea as
-- reference records — and sources to cite, compared like the GND (src/admin/kulturnav.js, nlk.js):
--   kulturnav  P1248, a UUID — persons with birth and death (day, place) and their numbers in VIAF, ULAN, LC
--   nlk        P5034, "KAC…" — Korean persons: years of birth and death, the Korean name and other names (hanja)
INSERT INTO authorities (code, name, url_template, pattern, wikidata_property, entity_types, position) VALUES
  ('kulturnav', 'KulturNav', 'https://kulturnav.org/{id}', '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'P1248', '{artist,person,institution}', 12),
  ('nlk', 'National Library of Korea', 'https://lod.nl.go.kr/page/{id}', '^KAC[0-9]{9}$', 'P5034', '{artist,person}', 13);

INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container) VALUES
  ('kulturnav', 'web', 'KulturNav', 'KulturNav', 'https://kulturnav.org/', 'institution', 'Kulturnav / Arts Council Norway'),
  ('nlk', 'web', 'National Library of Korea Linked Open Data', 'NLK', 'https://lod.nl.go.kr/', 'institution', 'National Library of Korea')
ON CONFLICT (slug) DO NOTHING;
