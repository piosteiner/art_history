-- 061: sorting — leading articles ignored in titles, and a natural, language-aware order.
--
-- 1. Articles: "The Starry Night" sorts under S, "Le Phare de Honfleur" under P, "Die Brücke" under B — as library
--    catalogues file titles. Only for titles (artworks, institutions, movements, events, sources, glossary terms):
--    people and places keep them ("Le Corbusier", "La Paz", "Los Angeles" are filed under L).
--    The title's language (`<name>_lang`) picks the articles; without one, only those that are articles in every
--    language they occur in — not English "I" ("I and the Village"), Italian "I" needs `it`; not "de"/"des"
--    (French/Spanish prepositions), Dutch "de" needs `nl`.
-- 2. Order: the database collation is C.UTF-8 — byte order: "Zürich" before "abbey", "Édouard" after "Zurbarán",
--    "No. 10" before "No. 2". The ICU collation sort_natural (root locale, numeric ordering: und-u-kn) sorts like a
--    person would. Queries sort with `sort_key COLLATE sort_natural`; the view's column keeps the database collation
--    (CREATE OR REPLACE VIEW can't change a column's collation, and entity_index has many dependent views).

CREATE COLLATION sort_natural (provider = icu, locale = 'und-u-kn');

-- the key without a leading article (and leading quotation marks); never empty — "The" alone stays "The".
-- Elided forms too: L'Absinthe, un'Opera, Dutch 't Hooft.
CREATE OR REPLACE FUNCTION strip_article(k text, lang text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE WHEN btrim(r) <> '' THEN r ELSE k END
  FROM (SELECT regexp_replace(regexp_replace(k, $re$^[\s"„“”«»‹›¡¿]+$re$, ''),
    '^(?:(?:' || CASE split_part(lower(coalesce(lang, '')), '-', 1)
      WHEN 'en' THEN 'the|a|an'
      WHEN 'de' THEN 'der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines'
      WHEN 'fr' THEN 'le|la|les|un|une'
      WHEN 'it' THEN 'il|lo|la|i|gli|le|un|uno|una'
      WHEN 'es' THEN 'el|la|los|las|un|una|unos|unas'
      WHEN 'pt' THEN 'o|a|os|as|um|uma'
      WHEN 'nl' THEN 'de|het|een'
      WHEN '' THEN 'the|a|an|der|die|das|le|la|les|il|lo|gli|el|los|las|het|een|un|une|ein|eine'
      ELSE 'x^'  -- another language (Japanese, Korean …): none
    END || $re$)\s+|(?:l|un)['’]\s*|['’]t\s+)$re$, '', 'i') AS r) x
$f$;

-- an entry's sort key: the name's (romanized when written in another script, 022) — for titles without the article
CREATE FUNCTION entry_sort_key(etype entity_type, name text, ruby text, names jsonb, lang text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE WHEN etype IN ('artwork', 'institution', 'movement', 'event', 'source', 'term')
    THEN strip_article(name_sort_key(name, ruby, names), lang) ELSE name_sort_key(name, ruby, names) END
$f$;

CREATE OR REPLACE VIEW entity_index AS
SELECT 'artist'::entity_type AS type,
    artists.id,
    artists.slug,
    artists.name,
    artists.lifespan AS period,
    NULLIF(concat_ws('–'::text, artists.birth_label, artists.death_label), ''::text) AS period_label,
    NULL::text AS kind,
    artists.names,
    entry_sort_key('artist'::entity_type, artists.name, artists.name_ruby, artists.names, artists.name_lang) AS sort_key,
    name_alt_text(artists.name_ruby, artists.names) AS alt_text
   FROM artists
UNION ALL
 SELECT 'artwork'::entity_type AS type,
    artworks.id,
    artworks.slug,
    artworks.title AS name,
    artworks.created AS period,
    artworks.created_label AS period_label,
    artworks.kind,
    artworks.names,
    entry_sort_key('artwork'::entity_type, artworks.title, artworks.title_ruby, artworks.names, artworks.title_lang) AS sort_key,
    name_alt_text(artworks.title_ruby, artworks.names) AS alt_text
   FROM artworks
UNION ALL
 SELECT 'institution'::entity_type AS type,
    institutions.id,
    institutions.slug,
    institutions.name,
    institutions.founded AS period,
    institutions.founded_label AS period_label,
    institutions.kind,
    institutions.names,
    entry_sort_key('institution'::entity_type, institutions.name, institutions.name_ruby, institutions.names, institutions.name_lang) AS sort_key,
    name_alt_text(institutions.name_ruby, institutions.names) AS alt_text
   FROM institutions
UNION ALL
 SELECT 'person'::entity_type AS type,
    people.id,
    people.slug,
    people.name,
    COALESCE(people.lifespan, people.active) AS period,
    COALESCE(NULLIF(concat_ws('–'::text, people.birth_label, people.death_label), ''::text), people.active_label) AS period_label,
    people.kind,
    people.names,
    entry_sort_key('person'::entity_type, people.name, people.name_ruby, people.names, people.name_lang) AS sort_key,
    name_alt_text(people.name_ruby, people.names) AS alt_text
   FROM people
UNION ALL
 SELECT 'movement'::entity_type AS type,
    movements.id,
    movements.slug,
    movements.name,
    movements.period,
    movements.period_label,
    (movements.kind)::text AS kind,
    movements.names,
    entry_sort_key('movement'::entity_type, movements.name, movements.name_ruby, movements.names, movements.name_lang) AS sort_key,
    name_alt_text(movements.name_ruby, movements.names) AS alt_text
   FROM movements
UNION ALL
 SELECT 'place'::entity_type AS type,
    places.id,
    places.slug,
    places.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (places.kind)::text AS kind,
    places.names,
    entry_sort_key('place'::entity_type, places.name, places.name_ruby, places.names, places.name_lang) AS sort_key,
    name_alt_text(places.name_ruby, places.names) AS alt_text
   FROM places
UNION ALL
 SELECT 'polity'::entity_type AS type,
    polities.id,
    polities.slug,
    polities.name,
    polities.period,
    polities.period_label,
    polities.kind,
    polities.names,
    entry_sort_key('polity'::entity_type, polities.name, polities.name_ruby, polities.names, polities.name_lang) AS sort_key,
    name_alt_text(polities.name_ruby, polities.names) AS alt_text
   FROM polities
UNION ALL
 SELECT 'term'::entity_type AS type,
    glossary.id,
    glossary.slug,
    glossary.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (glossary.category)::text AS kind,
    glossary.names,
    entry_sort_key('term'::entity_type, glossary.name, glossary.name_ruby, glossary.names, glossary.name_lang) AS sort_key,
    name_alt_text(glossary.name_ruby, glossary.names) AS alt_text
   FROM glossary
UNION ALL
 SELECT 'source'::entity_type AS type,
    bibliography.id,
    bibliography.slug,
    bibliography.name,
    NULL::daterange AS period,
    NULL::text AS period_label,
    (bibliography.kind)::text AS kind,
    bibliography.names,
    entry_sort_key('source'::entity_type, bibliography.name, bibliography.name_ruby, bibliography.names, bibliography.name_lang) AS sort_key,
    name_alt_text(bibliography.name_ruby, bibliography.names) AS alt_text
   FROM bibliography
UNION ALL
 SELECT 'event'::entity_type AS type,
    events.id,
    events.slug,
    events.name,
    events.period,
    events.period_label,
    events.kind,
    events.names,
    entry_sort_key('event'::entity_type, events.name, events.name_ruby, events.names, events.name_lang) AS sort_key,
    name_alt_text(events.name_ruby, events.names) AS alt_text
   FROM events;
