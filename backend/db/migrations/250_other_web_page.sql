-- 250 — An artwork's "other web page" (owner 2026-11-13): "View at …" (web_url, 038) always leads to the museum or
-- collection that holds the work — where it is and where its best information is; it is not filled with "lesser" links.
-- When the holder has no page for it, a good page elsewhere (the Web Gallery of Art, a catalogue raisonné, another
-- impression in another museum) goes here; the site shows it below the text with the note that no online page of the
-- holder could be found ("Another impression at …" when the note says what the page shows).
ALTER TABLE artworks
  ADD COLUMN other_web_url text CONSTRAINT artworks_other_web_url_check CHECK (other_web_url ~ '^https?://[^\s]+$'),
  ADD COLUMN other_web_name text CONSTRAINT artworks_other_web_name_check CHECK (other_web_name IS NULL OR length(btrim(other_web_name)) BETWEEN 1 AND 120),
  ADD COLUMN other_web_note text CONSTRAINT artworks_other_web_note_check CHECK (other_web_note IS NULL OR length(btrim(other_web_note)) BETWEEN 1 AND 120),
  ADD COLUMN other_web_accessed date,
  -- a name or note means nothing without the address
  ADD CONSTRAINT artworks_other_web_needs_url CHECK (other_web_url IS NOT NULL OR (other_web_name IS NULL AND other_web_note IS NULL));
COMMENT ON COLUMN artworks.other_web_url IS 'A page about the work that is not its holder''s (250): shown below the text, not as "View at …".';
COMMENT ON COLUMN artworks.other_web_name IS 'The site of other_web_url as shown: "Web Gallery of Art" (250); empty = its host name.';
COMMENT ON COLUMN artworks.other_web_note IS 'What other_web_url shows when it is not this object (250): "Another impression", "The preparatory drawing".';
COMMENT ON COLUMN artworks.other_web_accessed IS 'The day other_web_url was added or changed (trigger, like web_url_accessed 039).';

-- the same rule as web_url_accessed (039): the day the address was set or changed; empty with it
CREATE FUNCTION set_other_web_accessed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.other_web_url IS NULL THEN
    NEW.other_web_accessed := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.other_web_url IS DISTINCT FROM OLD.other_web_url THEN
    NEW.other_web_accessed := current_date;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artworks_other_web_accessed BEFORE INSERT OR UPDATE OF other_web_url ON artworks
  FOR EACH ROW EXECUTE FUNCTION set_other_web_accessed();
