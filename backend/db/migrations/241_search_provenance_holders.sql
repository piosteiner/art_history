-- 241 — Artworks found by the names in their provenance (owner 2026-11-07: "you need to be able to search for
-- provenance entries in the artworks section"). "Formerly in" (110) holds only institutions: a search for "bührle" missed
-- the works Emil Bührle gave the Kunsthaus, where he is a person in the provenance. New search field 11 "Provenance":
-- every person and artist who held the work — owner, dealer, possessor, custodian, agent … — and the holders written as
-- text ("Private collection, Paris"), each once, with the years of their steps: "Emil Georg Bührle (1937–1956)".
-- Their other names are matched too ("Goering"). Another source's reading (alternative_to) is left out, as in every
-- computation. Its own tier, after "Now in" and "Formerly in": works found only through it come under "With a matching
-- name in the provenance". Items are separated by " · " — the site shows only the items that matched (catalog.ts).
-- Kept up to date like the other fields: a changed step queues its work, a renamed person their works (derived_touch).

-- one row per holder of a work's provenance (not institutions — they are "Now in" / "Formerly in"; not the artist's
-- creation step — that is "Artist"): the name with the years of each of their steps, the words to match, the place
-- of their first step in the chain (the order the field lists them in)
CREATE FUNCTION provenance_holder_words(aid bigint) RETURNS TABLE (shown text, words text, first integer)
LANGUAGE sql STABLE AS $f$
  WITH s AS (
    SELECT p.position, coalesce(pe.name, ar.name, nullif(btrim(p.owner_label), '')) AS name,
           concat_ws(' ', pe.name, ar.name, p.owner_label, names_text(coalesce(pe.names, ar.names, '[]'::jsonb))) AS words,
           CASE WHEN p.acquired IS NOT NULL AND NOT lower_inf(p.acquired) THEN extract(year FROM lower(p.acquired))::int END AS y0,
           CASE WHEN p.ended IS NOT NULL AND NOT upper_inf(p.ended) THEN extract(year FROM upper(p.ended) - 1)::int END AS y1
    FROM provenance p
    LEFT JOIN people pe ON pe.id = p.owner_person_id
    LEFT JOIN artists ar ON ar.id = p.owner_artist_id
    WHERE p.artwork_id = aid AND p.alternative_to IS NULL AND p.owner_institution_id IS NULL
      AND p.method IS DISTINCT FROM 'creation'
      AND (pe.id IS NOT NULL OR ar.id IS NOT NULL OR nullif(btrim(p.owner_label), '') IS NOT NULL)),
  -- each step's span: "1937–1956", "1952", "from 1945", "until 1941" (a holder with two steps keeps both)
  t AS (SELECT s.*, CASE WHEN y0 IS NULL AND y1 IS NULL THEN NULL WHEN y1 IS NULL THEN 'from ' || y0 WHEN y0 IS NULL THEN 'until ' || y1
                         WHEN y0 = y1 THEN y0::text ELSE y0 || '–' || y1 END AS span FROM s)
  SELECT name || coalesce(' (' || string_agg(span, ', ' ORDER BY position) || ')', ''),
         string_agg(DISTINCT words, ' '), min(position)
  FROM t GROUP BY name
$f$;
COMMENT ON FUNCTION provenance_holder_words(bigint) IS 'A work''s provenance holders (people, artists, text) with their years, for the search field "Provenance" (241)';

DO $$
DECLARE
  def text := pg_get_viewdef('entry_search_fields'::regclass, true);
  anchor text := $a$'Formerly in the collection'::text)) x("position", label, text, match, tier_rank, tier_heading)$a$;
BEGIN
  IF position(anchor IN def) = 0 THEN RAISE EXCEPTION 'entry_search_fields: the artworks'' last field not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW entry_search_fields AS ' || replace(def, anchor, $add$'Formerly in the collection'::text), (11, 'Provenance'::text,
    (SELECT string_agg(ph.shown, ' · '::text ORDER BY ph.first NULLS LAST, ph.shown) FROM provenance_holder_words(w.id) ph),
    (SELECT string_agg(ph.words, ' '::text) FROM provenance_holder_words(w.id) ph),
    3, 'With a matching name in the provenance'::text)) x("position", label, text, match, tier_rank, tier_heading)$add$);
END $$;

-- the stored fields and the list rows of every artwork brought up to date by the worker
INSERT INTO derived_queue (type, id, reason) SELECT 'artwork', id, 'change' FROM artworks;
INSERT INTO list_queue (type, id) SELECT 'artwork', id FROM artworks;
