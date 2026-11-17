-- 254 — The national museums of Japan in three databases (owner 2026-11-17, the Katawaguruma tebako: the TNM's own
-- collection, ColBase, e-Museum — "how do we best deal with such objects?"). All three are run by the National
-- Institutes for Cultural Heritage (NICH), the TNM's parent body. Decided: the button "View at …" leads to ColBase — the
-- shared collection database of the four national museums, the most information, in English too; the other two are
-- reference records, linked in the folded "Reference records" box of the entry, like the WPI's catalogue numbers (181).
--   colbase  museum code / inventory number, "tnm/H-4445" (Wikidata P14394)
--   emuseum  e-Museum's content_base_id, "100198" (Wikidata P4257: the national treasures and important cultural
--            properties of the national museums)
--   tnm      the TNM collection's own record: the inventory number without its hyphen, "H4445" (no Wikidata property)
-- With a Wikidata property the Wikidata comparison offers the number by itself.
INSERT INTO authorities (code, name, url_template, pattern, wikidata_property, entity_types, position) VALUES
  ('colbase', 'ColBase (National Museums of Japan)', 'https://colbase.nich.go.jp/collection_items/{id}?locale=en', '^(tnm|kyohaku|narahaku|kyuhaku)/\S+$', 'P14394', '{artwork}', 17),
  ('emuseum', 'e-Museum (National Treasures and Important Cultural Properties)', 'https://emuseum.nich.go.jp/detail?content_base_id={id}&langId=en', '^[1-9][0-9]*$', 'P4257', '{artwork}', 18),
  ('tnm', 'Tokyo National Museum, collection', 'https://www.tnm.jp/modules/r_collection/index.php?controller=dtl&colid={id}', '^[A-Z]+[0-9A-Za-z-]*$', NULL, '{artwork}', 19);
