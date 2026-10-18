-- 099: DoME — the Database of Modern Exhibitions. European Paintings and Drawings 1905–1915 (Universität Wien,
-- Institut für Kunstgeschichte): who exhibited where, with the catalogue entries. Its artist number as a reference
-- record (Wikidata P7944, "https://exhibitions.univie.ac.at/person/$1"), so the Wikidata comparison suggests it and the
-- entry links to the artist's exhibitions there. The exhibitions themselves are not imported: the site gives no
-- licence for reuse and blocks automated access (2026-10-18); Wikidata has 35 of its ~1,300 exhibitions (P8185).
INSERT INTO authorities (code, name, url_template, pattern, wikidata_property, entity_types, position) VALUES
  ('dome', 'DoME (Database of Modern Exhibitions 1905–1915)', 'https://exhibitions.univie.ac.at/person/{id}', '^[1-9][0-9]{0,6}$', 'P7944', '{artist,person}', 15);

INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container) VALUES
  ('dome', 'web', 'Database of Modern Exhibitions (DoME). European Paintings and Drawings 1905–1915', 'DoME', 'https://exhibitions.univie.ac.at/', 'institution', 'Universität Wien, Institut für Kunstgeschichte')
ON CONFLICT (slug) DO NOTHING;
