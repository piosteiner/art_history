-- 134 — The parts of further measurements (025: "frame | 92.2 × 111 × 7.2") as glossary terms, like materials (071):
-- a part written in any language the term knows ("Rahmenmass", "mit Rahmen", "cadre", "with frame") is saved as the
-- term's name ("frame"), so the same thing is called the same everywhere, the API names the term and the site links
-- it to the glossary — where an article can say what a frame is and why most are not original. The category
-- 'mounting' (133) holds them; an editor can add another (a showcase, a box) as a term there.
INSERT INTO glossary (slug, name, name_lang, category, definition, names) VALUES
  ('frame', 'frame', 'en', 'mounting', 'The border around a picture: it protects its edges and sets it off from the wall — given here as the size with frame.',
   '[{"text": "with frame", "lang": "en", "role": "alternative"}, {"text": "framed", "lang": "en", "role": "alternative"},
     {"text": "Rahmen", "lang": "de", "role": "translation"}, {"text": "Rahmenmass", "lang": "de", "role": "alternative"}, {"text": "Rahmenmaß", "lang": "de", "role": "alternative"},
     {"text": "mit Rahmen", "lang": "de", "role": "alternative"}, {"text": "cadre", "lang": "fr", "role": "translation"}, {"text": "avec cadre", "lang": "fr", "role": "alternative"},
     {"text": "cornice", "lang": "it", "role": "translation"}, {"text": "lijst", "lang": "nl", "role": "translation"}]'),
  ('mount', 'mount', 'en', 'mounting', 'A card window around a drawing, print or watercolour, between it and the frame (a passe-partout).',
   '[{"text": "mat", "lang": "en", "role": "alternative"}, {"text": "passe-partout", "lang": "fr", "role": "translation"}, {"text": "Passepartout", "lang": "de", "role": "translation"}]'),
  ('stretcher', 'stretcher', 'en', 'mounting', 'The wooden frame a canvas is stretched on, behind the picture — with keys to tighten it (unlike a strainer).',
   '[{"text": "Keilrahmen", "lang": "de", "role": "translation"}, {"text": "châssis", "lang": "fr", "role": "translation"}]'),
  ('sheet', 'sheet', 'en', 'mounting', 'The whole sheet of paper of a print or drawing — larger than the image printed or drawn on it.',
   '[{"text": "Blatt", "lang": "de", "role": "translation"}, {"text": "Blattmass", "lang": "de", "role": "alternative"}, {"text": "Blattmaß", "lang": "de", "role": "alternative"}, {"text": "feuille", "lang": "fr", "role": "translation"}]'),
  ('plate-mark', 'plate mark', 'en', 'mounting', 'The edge pressed into the paper by the plate of an etching or engraving — the size of the plate.',
   '[{"text": "Plattenrand", "lang": "de", "role": "translation"}, {"text": "cuvette", "lang": "fr", "role": "translation"}]'),
  ('base', 'base', 'en', 'mounting', 'What a sculpture stands on — a plinth or pedestal, made with it or later.',
   '[{"text": "plinth", "lang": "en", "role": "alternative"}, {"text": "pedestal", "lang": "en", "role": "alternative"},
     {"text": "Sockel", "lang": "de", "role": "translation"}, {"text": "socle", "lang": "fr", "role": "translation"}]')
ON CONFLICT (slug) DO NOTHING;

-- saved as the term's name (the trigger of 071 that does it for the type and the materials)
DO $$
DECLARE
  def text := pg_get_functiondef('artworks_link_terms'::regproc);
  anchor text := '  RETURN NEW;';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'artworks_link_terms: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, $add$  -- the parts of further measurements by their mounting term's name (134): "Rahmenmass" → "frame"
  IF NEW.other_dimensions IS NOT NULL AND jsonb_typeof(NEW.other_dimensions) = 'array' THEN
    NEW.other_dimensions := coalesce((SELECT jsonb_agg(CASE WHEN g.name IS NOT NULL THEN jsonb_set(e, '{part}', to_jsonb(g.name)) ELSE e END ORDER BY o)
      FROM jsonb_array_elements(NEW.other_dimensions) WITH ORDINALITY x(e, o)
      LEFT JOIN glossary g ON g.id = term_by_name(e->>'part', ARRAY['mounting']::term_category[])), '[]'::jsonb);
  END IF;
$add$ || anchor);
END $$;
-- the trigger also on a change of the further measurements (it ran on the type and the materials only)
DROP TRIGGER artworks_link_terms ON artworks;
CREATE TRIGGER artworks_link_terms BEFORE INSERT OR UPDATE OF kind, materials, other_dimensions ON artworks
  FOR EACH ROW EXECUTE FUNCTION artworks_link_terms();
-- the parts written before, by their terms now
UPDATE artworks SET other_dimensions = other_dimensions WHERE jsonb_array_length(coalesce(other_dimensions, '[]')) > 0;
