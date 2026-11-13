-- Editions (owner 2026-11-13): the impressions of one print — or the casts of one model — are separate objects in
-- separate collections, each with its own holder, number, size, provenance and museum page. The work becomes a group
-- of works (132) of the kind "edition"; each impression is a part of it (site: "Impression 2 of 3 in New Man").
-- Japanese woodblock prints, Dürer's engravings, Rodin's bronzes are the typical cases.
INSERT INTO glossary (slug, name, category, definition, names) VALUES
  ('edition', 'edition', 'group of works',
   'The impressions of one print, or the casts of one model, taken from the same block, plate, stone or mould — each impression an object of its own, often in another collection.',
   '[{"text": "Auflage", "lang": "de", "role": "translation"}, {"text": "tirage", "lang": "fr", "role": "translation"}, {"text": "impressions", "lang": "en", "role": "alternative"}]')
ON CONFLICT (slug) DO UPDATE SET category = 'group of works';

-- works already named "edition" as their kind now point at the term (the trigger sets kind_term_id on write)
UPDATE artworks SET kind = kind WHERE lower(kind) IN ('edition', 'impressions', 'auflage');
