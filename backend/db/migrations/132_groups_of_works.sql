-- 132 — Groups of works, made recognisable. A series, the versions of one composition, a cycle or a pair is an artwork
-- entry with its parts under it (037): the way museums and Wikidata catalogue them (a title, dates, an artist, a story
-- of their own), and the only way that scales (46 prints of one series). But such a whole looked like one more
-- painting: "oil painting" in the lists, asked for its museum web page, its parts labelled "No. 2 of 3" even when they
-- are versions. Now its kind says what it is, through the glossary:
--   - the category 'group of works' (131) holds the kinds of groups — series, versions, cycle, pair to start; an
--     editor can add another (a portfolio) as a term in that category, without code;
--   - artwork_is_group(kind_term_id): a whole of that kind; the admin's form hides the physical fields for it (while
--     empty), the lists name it with its number of parts, the site labels versions "Version 2 of 3";
--   - the check artwork_without_web_page leaves groups out (three versions in three museums have no one page); a new
--     check group_parts_missing (info) says how many of its parts are not entered yet ("1 of 46").
-- A triptych, an album or an altarpiece stays an object (it has a size and a place) — only its parts are labelled.
CREATE OR REPLACE FUNCTION kind_categories() RETURNS term_category[] LANGUAGE sql IMMUTABLE
RETURN ARRAY['object type'::term_category, 'group of works'::term_category, 'technique'::term_category, 'format'::term_category];

CREATE FUNCTION artwork_is_group(term bigint) RETURNS boolean LANGUAGE sql STABLE
RETURN EXISTS (SELECT 1 FROM glossary g WHERE g.id = term AND g.category = 'group of works');

INSERT INTO glossary (slug, name, category, definition, names) VALUES
  ('series', 'series', 'group of works',
   'Works an artist made as a series on one theme or in one format, each a work of its own — Hokusai’s Thirty-six Views of Mount Fuji, Goya’s Black Paintings.',
   '[{"text": "Serie", "lang": "de", "role": "translation"}, {"text": "série", "lang": "fr", "role": "translation"}]'),
  ('versions', 'versions', 'group of works',
   'Several versions of one composition by the same artist — repetitions, often of another size, made for a buyer or a relative or to replace a damaged first version.',
   '[{"text": "Fassungen", "lang": "de", "role": "translation"}, {"text": "versions", "lang": "fr", "role": "translation"}]'),
  ('cycle', 'cycle', 'group of works',
   'Works made to be seen together in one place or one sequence — the paintings of a room, the altarpieces of a cathedral.',
   '[{"text": "Zyklus", "lang": "de", "role": "translation"}, {"text": "cycle", "lang": "fr", "role": "translation"}]'),
  ('pair', 'pair', 'group of works',
   'Two works made to hang or be seen together — pendants.',
   '[{"text": "Pendants", "lang": "de", "role": "translation"}, {"text": "pendants", "lang": "fr", "role": "translation"}]')
-- a term of that name made before as an object type ("series" in the type list) is moved into the category
ON CONFLICT (slug) DO UPDATE SET category = 'group of works';

-- the checks: groups need no web page of their own; a group with fewer parts entered than it has
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  old text := $o$   FROM artworks a
  WHERE (a.web_url IS NULL);$o$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: the end of artwork_without_web_page not found once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old, $n$   FROM artworks a
  WHERE (a.web_url IS NULL) AND NOT artwork_is_group(a.kind_term_id)
UNION ALL
 SELECT 'group_parts_missing'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('group_parts:'::text || w.id) AS issue_key,
    format('%s of %s parts entered', p.n, w.parts_count) AS detail
   FROM artworks w
     CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM artworks c WHERE c.parent_id = w.id) p
  WHERE (w.parts_count IS NOT NULL) AND (p.n < w.parts_count)$n$);
END $$;

-- a whole's list row shows its first part's image and its number of parts: a part's change (its image too) reaches
-- the whole — the parent is an artwork's neighbour, and an image's change spreads to its entry's neighbours
DO $$
DECLARE
  def text := pg_get_functiondef('derived_neighbours(entity_type, bigint)'::regprocedure);
  anchor text := '  UNION SELECT ''artwork'', w.id FROM artworks w WHERE t = ''artwork'' AND w.parent_id = i';
BEGIN
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'derived_neighbours: anchor not found once';
  END IF;
  EXECUTE replace(def, anchor, anchor || '
  UNION SELECT ''artwork'', w.parent_id FROM artworks w WHERE t = ''artwork'' AND w.id = i AND w.parent_id IS NOT NULL');
END $$;
DROP TRIGGER derived_touch ON images;
CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON images
  FOR EACH ROW EXECUTE FUNCTION derived_touch('@entity_type.entity_id+');
