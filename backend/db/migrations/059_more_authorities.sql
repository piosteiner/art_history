-- 059: more reference records (authority files) and sources for the comparisons.
--
-- New authorities — Metagrid (the concordance of Swiss and international databases, src/admin/metagrid.js) brings
-- their numbers; Wikidata knows most of them too (wikidata_property: the Wikidata comparison offers them by itself):
--   hls     Historisches Lexikon der Schweiz (P902) — articles are copyrighted texts: linked, never copied
--   dodis   Diplomatic Documents of Switzerland (P701; persons "P…", organisations "R…")
--   idref   IdRef / Sudoc, the French universities' authority file (P269)
--   bnf     Bibliothèque nationale de France (P268) — compared like the GND (src/admin/bnf.js)
--   fotoch  fotoCH, Swiss photographers (no Wikidata property we rely on)
-- The Library of Congress (lc) and RKD (rkd) were there (053); they are now compared too (src/admin/lc.js, rkd.js) —
-- and need sources in the bibliography to cite: like the GND, as an institution's records; RKD as scholarly.
INSERT INTO authorities (code, name, url_template, pattern, wikidata_property, entity_types, position) VALUES
  ('bnf', 'BnF (Bibliothèque nationale de France)', 'https://catalogue.bnf.fr/ark:/12148/cb{id}', '^[0-9]{8}[0-9bcdfghjkmnpqrstvwxz]$', 'P268', '{artist,person,institution}', 7),
  ('idref', 'IdRef (Sudoc)', 'https://www.idref.fr/{id}', '^[0-9]{8}[0-9X]$', 'P269', '{artist,person,institution}', 8),
  ('hls', 'HLS (Historisches Lexikon der Schweiz)', 'https://hls-dhs-dss.ch/de/articles/{id}/', '^[0-9]{6}$', 'P902', '{artist,person,institution,place,event,movement}', 9),
  ('dodis', 'Dodis (Diplomatic Documents of Switzerland)', 'https://dodis.ch/{id}', '^[PRG][0-9]{1,7}$', 'P701', '{artist,person,institution}', 10),
  ('fotoch', 'fotoCH', 'https://foto-ch.ch/persons/detail/{id}', '^[0-9]{1,7}$', NULL, '{artist,person}', 11);

-- RKD's record pages moved (rkd.nl/en/explore/artists/…)
UPDATE authorities SET url_template = 'https://rkd.nl/en/explore/artists/{id}' WHERE code = 'rkd';

INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container) VALUES
  ('lc', 'web', 'Library of Congress Name Authority File', 'LCNAF', 'https://id.loc.gov/authorities/names.html', 'institution', 'Library of Congress'),
  ('bnf', 'web', 'data.bnf.fr', 'BnF', 'https://data.bnf.fr/', 'institution', 'Bibliothèque nationale de France'),
  ('rkd', 'web', 'RKDartists', 'RKD', 'https://rkd.nl/', 'scholarly', 'RKD – Nederlands Instituut voor Kunstgeschiedenis')
ON CONFLICT (slug) DO NOTHING;
