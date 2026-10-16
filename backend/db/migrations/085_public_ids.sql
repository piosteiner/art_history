-- 085 — A public number for every entry, the same across all types: addresses like /artworks/100586/la-petite-irene
-- (owner: "it shows that we are aware of the challenge and are aiming for a big database … many museums and
-- collections"). As museums do (Kunsthaus: /collection/item/586963/): the number identifies the entry and never
-- changes — not with a new title, a reattribution, a translation, a change of type; the name in the address is for
-- reading, and an outdated one leads to the right page.
--   * one sequence for all ten entry tables, from 100001 (six digits for the first 900,000 entries); the entries we
--     have are numbered in the order they were created;
--   * convert_entry (055) copies the columns both tables share — the number goes with the entry to its new type;
--   * a deleted entry's number is remembered with its last slug (public_id_history): after a merge (044) slug_history
--     leads that slug to the kept entry — so the old number does too (entry_by_public_id()).
-- Unique per table (an index) and across the tables (a trigger: the sequence gives each number once; a number set by
-- hand or by an import is checked).

CREATE SEQUENCE entity_public_id_seq START 100001;
-- the import (as the admin role) keeps the numbers of the files and moves the sequence past them: setval needs UPDATE
GRANT UPDATE ON SEQUENCE entity_public_id_seq TO arthistory_admin;
ALTER TABLE artists ADD COLUMN public_id bigint;
ALTER TABLE artworks ADD COLUMN public_id bigint;
ALTER TABLE institutions ADD COLUMN public_id bigint;
ALTER TABLE people ADD COLUMN public_id bigint;
ALTER TABLE movements ADD COLUMN public_id bigint;
ALTER TABLE places ADD COLUMN public_id bigint;
ALTER TABLE polities ADD COLUMN public_id bigint;
ALTER TABLE glossary ADD COLUMN public_id bigint;
ALTER TABLE bibliography ADD COLUMN public_id bigint;
ALTER TABLE events ADD COLUMN public_id bigint;

-- the entries in the order they were created, numbered
SELECT set_config('arthistory.source', 'migration', true);   -- the history shows the numbering as the migration's
CREATE TEMP TABLE numbered ON COMMIT DROP AS
SELECT type, id, nextval('entity_public_id_seq') AS public_id FROM (
  SELECT 'artist'::entity_type AS type, id, created_at FROM artists
  UNION ALL SELECT 'artwork'::entity_type AS type, id, created_at FROM artworks
  UNION ALL SELECT 'institution'::entity_type AS type, id, created_at FROM institutions
  UNION ALL SELECT 'person'::entity_type AS type, id, created_at FROM people
  UNION ALL SELECT 'movement'::entity_type AS type, id, created_at FROM movements
  UNION ALL SELECT 'place'::entity_type AS type, id, created_at FROM places
  UNION ALL SELECT 'polity'::entity_type AS type, id, created_at FROM polities
  UNION ALL SELECT 'term'::entity_type AS type, id, created_at FROM glossary
  UNION ALL SELECT 'source'::entity_type AS type, id, created_at FROM bibliography
  UNION ALL SELECT 'event'::entity_type AS type, id, created_at FROM events
) e ORDER BY created_at, type, id;
-- (nextval in the select list runs in the ORDER BY's order: the subquery sorts, the outer select numbers)
UPDATE artists x SET public_id = n.public_id FROM numbered n WHERE n.type = 'artist' AND n.id = x.id;
UPDATE artworks x SET public_id = n.public_id FROM numbered n WHERE n.type = 'artwork' AND n.id = x.id;
UPDATE institutions x SET public_id = n.public_id FROM numbered n WHERE n.type = 'institution' AND n.id = x.id;
UPDATE people x SET public_id = n.public_id FROM numbered n WHERE n.type = 'person' AND n.id = x.id;
UPDATE movements x SET public_id = n.public_id FROM numbered n WHERE n.type = 'movement' AND n.id = x.id;
UPDATE places x SET public_id = n.public_id FROM numbered n WHERE n.type = 'place' AND n.id = x.id;
UPDATE polities x SET public_id = n.public_id FROM numbered n WHERE n.type = 'polity' AND n.id = x.id;
UPDATE glossary x SET public_id = n.public_id FROM numbered n WHERE n.type = 'term' AND n.id = x.id;
UPDATE bibliography x SET public_id = n.public_id FROM numbered n WHERE n.type = 'source' AND n.id = x.id;
UPDATE events x SET public_id = n.public_id FROM numbered n WHERE n.type = 'event' AND n.id = x.id;

-- the deferred triggers of those updates (quality refresh) run now: a table with pending trigger events can't be altered
SET CONSTRAINTS ALL IMMEDIATE;

-- checked at the end of the transaction (a deferred constraint trigger): convert_entry inserts the entry's new row
-- before it deletes the old one — for that moment the number is there twice, both rows the same entry
CREATE FUNCTION public_id_unique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- checked late: the row may be gone meanwhile (an entry converted to another type) — then there is nothing to check
  IF NOT EXISTS (SELECT 1 FROM public.entity_index e WHERE (e.type, e.id) = (TG_ARGV[0]::entity_type, NEW.id) AND e.public_id = NEW.public_id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.entity_index e WHERE e.public_id = NEW.public_id AND (e.type, e.id) IS DISTINCT FROM (TG_ARGV[0]::entity_type, NEW.id)) THEN
    RAISE EXCEPTION 'public number % belongs to another entry', NEW.public_id USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NULL;
END $$;

-- a deleted entry's number, with its last address
CREATE TABLE public_id_history (
  public_id   bigint PRIMARY KEY,
  entity_type entity_type NOT NULL,
  slug        text NOT NULL,
  removed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION remember_public_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.public_id_history (public_id, entity_type, slug) VALUES (OLD.public_id, TG_ARGV[0]::entity_type, OLD.slug)
  ON CONFLICT (public_id) DO UPDATE SET entity_type = EXCLUDED.entity_type, slug = EXCLUDED.slug, removed_at = now();
  RETURN OLD;
END $$;

ALTER TABLE artists ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT artists_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER artists_public_id_unique AFTER INSERT OR UPDATE OF public_id ON artists DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('artist');
CREATE TRIGGER artists_public_id_history AFTER DELETE ON artists FOR EACH ROW EXECUTE FUNCTION remember_public_id('artist');
ALTER TABLE artworks ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT artworks_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER artworks_public_id_unique AFTER INSERT OR UPDATE OF public_id ON artworks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('artwork');
CREATE TRIGGER artworks_public_id_history AFTER DELETE ON artworks FOR EACH ROW EXECUTE FUNCTION remember_public_id('artwork');
ALTER TABLE institutions ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT institutions_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER institutions_public_id_unique AFTER INSERT OR UPDATE OF public_id ON institutions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('institution');
CREATE TRIGGER institutions_public_id_history AFTER DELETE ON institutions FOR EACH ROW EXECUTE FUNCTION remember_public_id('institution');
ALTER TABLE people ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT people_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER people_public_id_unique AFTER INSERT OR UPDATE OF public_id ON people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('person');
CREATE TRIGGER people_public_id_history AFTER DELETE ON people FOR EACH ROW EXECUTE FUNCTION remember_public_id('person');
ALTER TABLE movements ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT movements_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER movements_public_id_unique AFTER INSERT OR UPDATE OF public_id ON movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('movement');
CREATE TRIGGER movements_public_id_history AFTER DELETE ON movements FOR EACH ROW EXECUTE FUNCTION remember_public_id('movement');
ALTER TABLE places ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT places_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER places_public_id_unique AFTER INSERT OR UPDATE OF public_id ON places DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('place');
CREATE TRIGGER places_public_id_history AFTER DELETE ON places FOR EACH ROW EXECUTE FUNCTION remember_public_id('place');
ALTER TABLE polities ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT polities_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER polities_public_id_unique AFTER INSERT OR UPDATE OF public_id ON polities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('polity');
CREATE TRIGGER polities_public_id_history AFTER DELETE ON polities FOR EACH ROW EXECUTE FUNCTION remember_public_id('polity');
ALTER TABLE glossary ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT glossary_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER glossary_public_id_unique AFTER INSERT OR UPDATE OF public_id ON glossary DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('term');
CREATE TRIGGER glossary_public_id_history AFTER DELETE ON glossary FOR EACH ROW EXECUTE FUNCTION remember_public_id('term');
ALTER TABLE bibliography ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT bibliography_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER bibliography_public_id_unique AFTER INSERT OR UPDATE OF public_id ON bibliography DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('source');
CREATE TRIGGER bibliography_public_id_history AFTER DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION remember_public_id('source');
ALTER TABLE events ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN public_id SET DEFAULT nextval('entity_public_id_seq'),
  ADD CONSTRAINT events_public_id_key UNIQUE (public_id);
CREATE CONSTRAINT TRIGGER events_public_id_unique AFTER INSERT OR UPDATE OF public_id ON events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public_id_unique('event');
CREATE TRIGGER events_public_id_history AFTER DELETE ON events FOR EACH ROW EXECUTE FUNCTION remember_public_id('event');

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
    name_alt_text(artists.name_ruby, artists.names) AS alt_text,
    artists.public_id
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
    name_alt_text(artworks.title_ruby, artworks.names) AS alt_text,
    artworks.public_id
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
    name_alt_text(institutions.name_ruby, institutions.names) AS alt_text,
    institutions.public_id
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
    name_alt_text(people.name_ruby, people.names) AS alt_text,
    people.public_id
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
    name_alt_text(movements.name_ruby, movements.names) AS alt_text,
    movements.public_id
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
    name_alt_text(places.name_ruby, places.names) AS alt_text,
    places.public_id
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
    name_alt_text(polities.name_ruby, polities.names) AS alt_text,
    polities.public_id
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
    name_alt_text(glossary.name_ruby, glossary.names) AS alt_text,
    glossary.public_id
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
    name_alt_text(bibliography.name_ruby, bibliography.names) AS alt_text,
    bibliography.public_id
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
    name_alt_text(events.name_ruby, events.names) AS alt_text,
    events.public_id
   FROM events;

-- A number → the entry it names now: itself (whatever its type now); a deleted one → its last slug → where that slug
-- leads (a merge); NULL when the entry is gone for good.
CREATE FUNCTION entry_by_public_id(pid bigint, OUT type entity_type, OUT id bigint, OUT slug text, OUT public_id bigint, OUT moved boolean)
LANGUAGE sql STABLE AS $$
  SELECT e.type, e.id, e.slug, e.public_id, false FROM public.entity_index e WHERE e.public_id = pid
  UNION ALL
  SELECT e.type, e.id, e.slug, e.public_id, true FROM public.public_id_history h
    JOIN public.slug_history s ON s.entity_type = h.entity_type AND s.old_slug = h.slug
    JOIN public.entity_index e ON e.type = s.entity_type AND e.id = s.entity_id
   WHERE h.public_id = pid AND NOT EXISTS (SELECT 1 FROM public.entity_index x WHERE x.public_id = pid)
  LIMIT 1
$$;
