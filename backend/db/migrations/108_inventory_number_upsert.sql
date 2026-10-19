-- 108 — The YAML import couldn't take back an artwork with an inventory number (found 2026-10-19 importing the
-- Vienna provenances: "number GG_1838: Kunsthistorisches Museum already uses it for “Jäger im Schnee”" — for the same
-- work). The import writes each entry as INSERT … ON CONFLICT (slug) DO UPDATE, and Postgres runs BEFORE INSERT triggers
-- before it looks for the conflict: NEW.id is then a fresh id from the sequence, not the existing row's, and
-- institution_number_free() (048) found the work's own number on "another" artwork.
-- Now the check asks for the row this insert will become: the existing artwork with that slug, if there is one.
CREATE OR REPLACE FUNCTION check_inventory_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM institution_number_free(NEW.current_institution_id, NEW.inventory_number,
    CASE WHEN TG_OP = 'INSERT' THEN coalesce((SELECT id FROM artworks WHERE slug = NEW.slug), NEW.id) ELSE NEW.id END);
  RETURN NEW;
END $$;
