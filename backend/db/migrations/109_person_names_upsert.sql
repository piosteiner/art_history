-- 109 — Like 108 for the name parts: fill_person_names() (066) splits the name into given / family name when both are
-- empty — on a new entry. The YAML import writes every entry as INSERT … ON CONFLICT (slug) DO UPDATE, so the
-- BEFORE INSERT trigger also filled them for an existing artist or person whose parts were deliberately left empty
-- (sort by the whole name), and the import changed what it had just exported. On an insert that will update an
-- existing entry (its slug is taken) the parts stay as the file has them — the file is the whole truth, as for every
-- other field.
CREATE OR REPLACE FUNCTION fill_person_names() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM entity_index e WHERE e.type = TG_ARGV[0]::entity_type AND e.slug = NEW.slug) THEN
    RETURN NEW;
  END IF;
  IF NEW.given_name IS NULL AND NEW.family_name IS NULL THEN
    SELECT s.given, s.family INTO NEW.given_name, NEW.family_name
    FROM split_person_name(NEW.name, NEW.name_lang IN ('ja', 'zh', 'ko') OR names_east_asian(NEW.names)) s;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER artists_fill_names ON artists;
DROP TRIGGER people_fill_names ON people;
CREATE TRIGGER artists_fill_names BEFORE INSERT OR UPDATE OF name ON artists FOR EACH ROW EXECUTE FUNCTION fill_person_names('artist');
CREATE TRIGGER people_fill_names BEFORE INSERT OR UPDATE OF name ON people FOR EACH ROW EXECUTE FUNCTION fill_person_names('person');
