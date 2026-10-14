-- 066: given and family names of artists and people — and sorting them by family name, as catalogues do.
--
--   given_name, family_name  "Vincent" / "van Gogh", "Henri" / "de Toulouse-Lautrec"; Japanese: "Hiroshige" /
--                            "Utagawa" (set by hand — the order of our Latin spellings varies)
--   sort_name                "Filed as" — an override for what no rule gets: an art name ("Hokusai"), a single
--                            name, a Spanish double surname ("Goya y Lucientes, Francisco José de"). Artists had
--                            it since 001; people get it too.
-- The sort key (person_sort_key): the override, else "family, given" with leading lowercase particles left aside
-- ("van Gogh" → "Gogh, Vincent", "de la Narde" → "Narde, Antoine …"; a capital one stays: "La Tour", "Le Nain"),
-- else the name as before (romanized when in another script, 022).
-- split_person_name(): the rule for filling the two fields — for the existing entries now, for new ones on INSERT
-- (a trigger, only when both are empty); it leaves alone what it can't split safely (one word, titles, "of",
-- Spanish "y", digits, "&", East Asian names). Edited fields are never overwritten.

ALTER TABLE artists ADD COLUMN given_name text CHECK (btrim(given_name) <> ''), ADD COLUMN family_name text CHECK (btrim(family_name) <> '');
ALTER TABLE people ADD COLUMN given_name text CHECK (btrim(given_name) <> ''), ADD COLUMN family_name text CHECK (btrim(family_name) <> ''),
  ADD COLUMN sort_name text CHECK (btrim(sort_name) <> '');

-- name → (given, family) | (NULL, NULL). A suffix stays with the given name: "Jan Brueghel the Elder" → "Jan, the Elder"
-- / "Brueghel", "Clendenin James Ryan, Jr." → "Clendenin James, Jr." / "Ryan". East Asian names are left alone: the
-- order in our Latin spelling varies ("Itō Jakuchū" family first, "Eikō Hosoe" given first) — to be set by hand.
CREATE OR REPLACE FUNCTION split_person_name(name text, east_asian boolean DEFAULT false, OUT given text, OUT family text)
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE m text[]; suffix text;
BEGIN
  name := btrim(regexp_replace(name, '\s+', ' ', 'g'));
  m := regexp_match(name, '^(.+?),? (the Elder|the Younger|Jr\.?|Sr\.?|[IVX]{1,4})$');
  IF m IS NOT NULL THEN name := m[1]; suffix := m[2]; END IF;
  IF east_asian OR name !~ ' ' OR name ~ '[0-9&,]' OR name ~ '[ōūīāēŌŪĀ]'
     OR name ~* '^(baron|baroness|count|countess|sir|lady|lord|viscount|viscountess|prince|princess|duke|duchess|graf|gräfin|freiherr|dr\.?|prof\.?|saint|st\.) '
     OR name ~ ' (of|y|e|and|und|et) '
     OR name ~* ' (family|familie|famille|brothers|sisters|dynasty|order|workshop|studio)$'
     -- a pseudonym with an article: "Le Corbusier", "El Greco", "Il Sodoma" — filed as written
     OR name ~ '^(Le|La|Les|El|Il|Lo|Los|Las|The) \S+$' OR name ~ '[　-鿿가-힯]' THEN
    RETURN;
  END IF;
  -- the last word, with the lowercase particles before it: "van Gogh", "de la Narde", "von Humboldt"
  -- (a capitalised one right before it belongs to the family name too: "de La Tour", "Van Dyck", "De Chirico")
  m := regexp_match(name, '^(.+?) ((?:(?:van|von|de|der|den|di|da|du|del|della|des|la|le|ten|ter|zu|vom|zur|dos|das|do) )*(?:(?:La|Le|Les|Du|Des|De|Di|Da|Del|Della|Van|Von|Ten|Ter) )?\S+)$');
  given := m[1] || coalesce(', ' || suffix, ''); family := m[2];
END $f$;

CREATE FUNCTION person_sort_key(name text, ruby text, names jsonb, sort_name text, family text, given text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT coalesce(nullif(btrim(sort_name), ''),
    CASE WHEN family IS NOT NULL THEN
      regexp_replace(family, '^(?:(?:van|von|de|der|den|di|da|du|del|della|des|la|le|ten|ter|zu|vom|zur|dos|das|do) )+', '') || coalesce(', ' || given, '')
    END,
    name_sort_key(name, ruby, names))
$f$;

-- is the name East Asian? one of its other names is in Japanese, Chinese or Korean (by language or by script)
CREATE FUNCTION names_east_asian(names jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(names) n
    WHERE split_part(n ->> 'lang', '-', 1) IN ('ja', 'zh', 'ko') OR (n ->> 'text') ~ '[\u3000-\u9fff\uac00-\ud7af]')
$f$;

-- new entries (and a changed name): filled from the name when neither field is set
CREATE FUNCTION fill_person_names() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.given_name IS NULL AND NEW.family_name IS NULL THEN
    SELECT s.given, s.family INTO NEW.given_name, NEW.family_name
    FROM split_person_name(NEW.name, NEW.name_lang IN ('ja', 'zh', 'ko') OR names_east_asian(NEW.names)) s;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER artists_fill_names BEFORE INSERT OR UPDATE OF name ON artists FOR EACH ROW EXECUTE FUNCTION fill_person_names();
CREATE TRIGGER people_fill_names BEFORE INSERT OR UPDATE OF name ON people FOR EACH ROW EXECUTE FUNCTION fill_person_names();

-- the existing entries (in the history like any change: source "migration")
SELECT set_config('arthistory.source', 'migration', true);
UPDATE artists a SET given_name = s.given, family_name = s.family
FROM artists x CROSS JOIN LATERAL split_person_name(x.name, x.name_lang IN ('ja', 'zh', 'ko') OR names_east_asian(x.names)) s
WHERE x.id = a.id AND s.family IS NOT NULL AND a.given_name IS NULL AND a.family_name IS NULL;
UPDATE people a SET given_name = s.given, family_name = s.family
FROM people x CROSS JOIN LATERAL split_person_name(x.name, x.name_lang IN ('ja', 'zh', 'ko') OR names_east_asian(x.names)) s
WHERE x.id = a.id AND s.family IS NOT NULL AND a.given_name IS NULL AND a.family_name IS NULL;

CREATE OR REPLACE VIEW entity_index AS
SELECT 'artist'::entity_type AS type,
    artists.id,
    artists.slug,
    artists.name,
    artists.lifespan AS period,
    NULLIF(concat_ws('–'::text, artists.birth_label, artists.death_label), ''::text) AS period_label,
    NULL::text AS kind,
    artists.names,
    person_sort_key(artists.name, artists.name_ruby, artists.names, artists.sort_name, artists.family_name, artists.given_name) AS sort_key,
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
    person_sort_key(people.name, people.name_ruby, people.names, people.sort_name, people.family_name, people.given_name) AS sort_key,
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
