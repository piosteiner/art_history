-- 087 — Full-text search (owner, 2026-10-16: "we are not really using all the power that comes with postgres").
-- Until now the search found names (trigram similarity, 080). Now it also reads the texts: biographies, descriptions,
-- definitions, provenance notes — "Tahiti", "confiscated 1941", "Vollard's stock books".
--
--  * text search configurations search_en / search_de / search_fr / search_simple: copies of Postgres' english,
--    german, french and simple, with the unaccent dictionary in front of the stemmer — "Gemälde", "Gemalde" and
--    "gemälden" give one lexeme, "Irène" = "Irene". (Accents folded inside the configuration, not before it, so
--    ts_headline can highlight the text as written.)
--  * search_lexemes(text): the text in all four (the language of a text isn't recorded; stems of all three plus
--    the words as written — names and foreign words); search_vector(a, b, c, d): weighted A name, B other names,
--    C texts, D the rest (numbers, addresses).
--  * a GIN index per table on that expression (no stored column: the audit log copies whole rows, and the vector
--    can always be recomputed); view search_documents = the same expressions, so its WHERE doc @@ query uses them.
--    Provenance steps are documents of their artwork (part 'provenance').
--  * search_query(text): websearch_to_tsquery in the four configurations, OR-ed — "quotes" for phrases, - to exclude,
--    or; search_headline(text, query): the snippet, in the configuration that matched, marks as \x01…\x02 (the API
--    escapes the text and turns them into <mark>).

CREATE TEXT SEARCH CONFIGURATION search_simple (COPY = simple);
CREATE TEXT SEARCH CONFIGURATION search_en (COPY = english);
CREATE TEXT SEARCH CONFIGURATION search_de (COPY = german);
CREATE TEXT SEARCH CONFIGURATION search_fr (COPY = french);
ALTER TEXT SEARCH CONFIGURATION search_simple ALTER MAPPING FOR word, hword, hword_part WITH unaccent, simple;
ALTER TEXT SEARCH CONFIGURATION search_en ALTER MAPPING FOR word, hword, hword_part WITH unaccent, english_stem;
ALTER TEXT SEARCH CONFIGURATION search_de ALTER MAPPING FOR word, hword, hword_part WITH unaccent, german_stem;
ALTER TEXT SEARCH CONFIGURATION search_fr ALTER MAPPING FOR word, hword, hword_part WITH unaccent, french_stem;

-- Markdown as plain text: [[type/slug|label]] → label, [[type/slug]] → the slug's words ("james cook"), footnotes
-- [[source/…]] out, [text](url) → text, emphasis, heading and quote marks out.
CREATE FUNCTION md_plain(md text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE t text := regexp_replace(md, '\[\[source/[^]]*\]\]', '', 'g');
BEGIN
  -- hyphens of slugs in links without a label become spaces, one per link and round
  WHILE t ~ '\[\[[^]|]*-[^]|]*\]\]' LOOP
    t := regexp_replace(t, '(\[\[[^]|-]*)-([^]|]*\]\])', '\1 \2', 'g');
  END LOOP;
  RETURN btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
    '\[\[[^]|]*\|([^]]*)\]\]', '\1', 'g'),
    '\[\[(?:[a-z]+/)?([^]]*)\]\]', '\1', 'g'),
    '\[([^]]*)\]\([^)]*\)', '\1', 'g'),
    '^[ \t]*[#>]+', '', 'gn'),          -- headings and quotes: marks at the start of a line ('n': ^ = each line)
    '[*_`]+|\s+', ' ', 'g'));
END $$;

-- array_to_string and concat_ws are only STABLE (they take any type, and some types print differently by setting);
-- for text they are immutable — this wrapper says so, so it may stand in an index expression. NULLs are skipped.
CREATE FUNCTION search_join(a text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN array_to_string(a, ' ');

-- an enum's label is STABLE in Postgres' eyes because a value can be renamed (ALTER TYPE … RENAME VALUE). Renaming
-- an acquisition method needs REINDEX INDEX provenance_search_idx afterwards.
CREATE FUNCTION search_method(m acquisition_method) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN replace(m::text, '_', ' ');

CREATE FUNCTION search_lexemes(t text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN to_tsvector('search_simple', coalesce(t, '')) || to_tsvector('search_en', coalesce(t, ''))
    || to_tsvector('search_de', coalesce(t, '')) || to_tsvector('search_fr', coalesce(t, ''));

CREATE FUNCTION search_vector(a text, b text, c text, d text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN setweight(search_lexemes(a), 'A') || setweight(search_lexemes(b), 'B')
    || setweight(search_lexemes(c), 'C') || setweight(search_lexemes(d), 'D');

CREATE FUNCTION search_query(q text) RETURNS tsquery LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN websearch_to_tsquery('search_simple', q) || websearch_to_tsquery('search_en', q)
    || websearch_to_tsquery('search_de', q) || websearch_to_tsquery('search_fr', q);

-- the snippet: up to two fragments around the matches, in the first configuration whose reading matches
CREATE FUNCTION search_headline(t text, q text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT ts_headline(c.cfg, t, websearch_to_tsquery(c.cfg, q),
                     'MaxFragments=2, MinWords=6, MaxWords=20, StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', FragmentDelimiter=" … "')
  FROM (VALUES (1, 'search_en'::regconfig), (2, 'search_de'), (3, 'search_fr'), (4, 'search_simple')) c(n, cfg)
  WHERE t IS NOT NULL AND to_tsvector(c.cfg, t) @@ websearch_to_tsquery(c.cfg, q)
  ORDER BY c.n LIMIT 1
$$;

CREATE INDEX artists_search_idx ON artists USING gin (search_vector(name, name_alt_text(name_ruby, names), md_plain(biography_md), provenance_flag));
CREATE INDEX artworks_search_idx ON artworks USING gin (search_vector(title, name_alt_text(title_ruby, names), search_join(ARRAY[md_plain(description_md), kind, medium, search_join(materials)]), search_join(ARRAY[inventory_number, provenance_status_note])));
CREATE INDEX institutions_search_idx ON institutions USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), search_join(ARRAY[address, provenance_flag])));
CREATE INDEX people_search_idx ON people USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind, search_join(occupations)]), provenance_flag));
CREATE INDEX movements_search_idx ON movements USING gin (search_vector(name, name_alt_text(name_ruby, names), md_plain(description_md), NULL::text));
CREATE INDEX places_search_idx ON places USING gin (search_vector(name, name_alt_text(name_ruby, names), md_plain(description_md), NULL::text));
CREATE INDEX polities_search_idx ON polities USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text));
CREATE INDEX glossary_search_idx ON glossary USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[definition, md_plain(description_md)]), NULL::text));
CREATE INDEX bibliography_search_idx ON bibliography USING gin (search_vector(search_join(ARRAY[name, subtitle]), search_join(ARRAY[name_alt_text(name_ruby, names), search_join(authors), search_join(editors)]), search_join(ARRAY[container, series, exhibition, publisher, place, search_join(container_editors), search_join(compilers)]), search_join(ARRAY[year, catalogue_number])));
CREATE INDEX events_search_idx ON events USING gin (search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text));
CREATE INDEX provenance_search_idx ON provenance USING gin (search_vector(NULL::text, NULL::text, search_join(ARRAY[owner_label, label, exchanged_for_text, md_plain(notes_md)]), search_join(ARRAY[search_method(method), price_note])));

CREATE VIEW search_documents AS
 SELECT 'artist'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), md_plain(biography_md), provenance_flag) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), md_plain(biography_md), provenance_flag), '') AS body
   FROM artists
UNION ALL
 SELECT 'artwork'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(title, name_alt_text(title_ruby, names), search_join(ARRAY[md_plain(description_md), kind, medium, search_join(materials)]), search_join(ARRAY[inventory_number, provenance_status_note])) AS doc,
    nullif(concat_ws(' · ', name_alt_text(title_ruby, names), search_join(ARRAY[md_plain(description_md), kind, medium, search_join(materials)]), search_join(ARRAY[inventory_number, provenance_status_note])), '') AS body
   FROM artworks
UNION ALL
 SELECT 'institution'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), search_join(ARRAY[address, provenance_flag])) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), search_join(ARRAY[address, provenance_flag])), '') AS body
   FROM institutions
UNION ALL
 SELECT 'person'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind, search_join(occupations)]), provenance_flag) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind, search_join(occupations)]), provenance_flag), '') AS body
   FROM people
UNION ALL
 SELECT 'movement'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), md_plain(description_md), NULL::text) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), md_plain(description_md), NULL::text), '') AS body
   FROM movements
UNION ALL
 SELECT 'place'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), md_plain(description_md), NULL::text) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), md_plain(description_md), NULL::text), '') AS body
   FROM places
UNION ALL
 SELECT 'polity'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text), '') AS body
   FROM polities
UNION ALL
 SELECT 'term'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[definition, md_plain(description_md)]), NULL::text) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), search_join(ARRAY[definition, md_plain(description_md)]), NULL::text), '') AS body
   FROM glossary
UNION ALL
 SELECT 'source'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(search_join(ARRAY[name, subtitle]), search_join(ARRAY[name_alt_text(name_ruby, names), search_join(authors), search_join(editors)]), search_join(ARRAY[container, series, exhibition, publisher, place, search_join(container_editors), search_join(compilers)]), search_join(ARRAY[year, catalogue_number])) AS doc,
    nullif(concat_ws(' · ', search_join(ARRAY[name_alt_text(name_ruby, names), search_join(authors), search_join(editors)]), search_join(ARRAY[container, series, exhibition, publisher, place, search_join(container_editors), search_join(compilers)]), search_join(ARRAY[year, catalogue_number])), '') AS body
   FROM bibliography
UNION ALL
 SELECT 'event'::entity_type AS type, id, 'entry'::text AS part, NULL::bigint AS provenance_id,
    search_vector(name, name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text) AS doc,
    nullif(concat_ws(' · ', name_alt_text(name_ruby, names), search_join(ARRAY[md_plain(description_md), kind]), NULL::text), '') AS body
   FROM events
UNION ALL
 SELECT 'artwork'::entity_type, artwork_id, 'provenance', id,
    search_vector(NULL::text, NULL::text, search_join(ARRAY[owner_label, label, exchanged_for_text, md_plain(notes_md)]), search_join(ARRAY[search_method(method), price_note])),
    nullif(concat_ws(' · ', search_join(ARRAY[owner_label, label, exchanged_for_text, md_plain(notes_md)]), search_join(ARRAY[search_method(method), price_note])), '')
   FROM provenance;
COMMENT ON VIEW search_documents IS 'full-text documents (087): one per entry, one per provenance step (part provenance, of its artwork); doc uses the GIN expression indexes';
