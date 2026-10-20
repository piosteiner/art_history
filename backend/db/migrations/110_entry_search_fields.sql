-- 110 — One definition of what a search finds besides the name (owner, 2026-10-20: "prado" in the admin's artworks
-- found only titles and artists, the site's lists also the works in the Prado or once there). Until now the site built
-- its searchable fields in the browser (frontend/src/catalog.ts) and the admin matched names, other names and slugs in
-- SQL — two definitions that drifted apart. Now the view entry_search_fields has them, per entry: a label (shown as
-- the reason of a hit: "Now in: Museo del Prado"), the text, what is matched when it is more than the text (a type's
-- names in every language), and a tier — entries found only through a tiered field come after the others, under its
-- heading ("Now in the collection", then "Formerly in the collection"). The admin's lists match against it in SQL,
-- the API sends it with the lists (search_fields), the site matches against what it gets. The same rules on both
-- sides: every word of the query in the name, the other names or a field (folded: f_unaccent / fold.ts).

-- People's roles from their relationships and the provenance (was a snippet in src/routes/entities.js)
CREATE FUNCTION person_roles(pid bigint) RETURNS text[] LANGUAGE sql STABLE RETURN ARRAY(
  SELECT x.role FROM (
    SELECT CASE WHEN (r.subject_type, r.subject_id) = ('person', pid) AND rt.category = 'patronage' THEN 'patron'
                WHEN (r.object_type, r.object_id) = ('person', pid) AND r.relationship_type = 'depicts_person' THEN 'depicted' END
    FROM relationships r JOIN relationship_types rt ON rt.code = r.relationship_type
    WHERE (r.subject_type, r.subject_id) = ('person', pid) OR (r.object_type, r.object_id) = ('person', pid)
    UNION
    SELECT CASE WHEN pv.method = 'commission' THEN 'patron' ELSE 'owner' END FROM provenance pv WHERE pv.owner_person_id = pid
    UNION
    SELECT 'owner' FROM provenance_co_owners c WHERE c.owner_person_id = pid) x(role)
  WHERE x.role IS NOT NULL ORDER BY 1);

-- Today's country as words: its place entry's name, else Natural Earth's ("Spain")
CREATE FUNCTION country_words(c jsonb) RETURNS text LANGUAGE sql STABLE
RETURN coalesce(c->>'name', (SELECT b.name FROM boundaries b WHERE b.code = c->>'code' AND b.level = 0 LIMIT 1), c->>'code');

-- the polities an entry is linked to by one relationship, as words ("Habsburg Monarchy, Kingdom of Spain")
CREATE FUNCTION polity_words(etype entity_type, eid bigint, rel text) RETURNS text LANGUAGE sql STABLE
RETURN (SELECT string_agg(p->>'name', ', ') FROM jsonb_array_elements(entity_polities(etype, eid)) p WHERE p->>'relationship' = rel);

-- "Zundert, Netherlands": a place and today's country
CREATE FUNCTION place_and_country(place_name text, c jsonb) RETURNS text LANGUAGE sql STABLE
RETURN nullif(concat_ws(', ', place_name, CASE WHEN c IS NOT NULL THEN country_words(c) END), '');

CREATE VIEW entry_search_fields AS
WITH f (type, id, position, label, text, match, tier_rank, tier_heading) AS (
  -- artists: filed as, born in, nationality; their life dates
  SELECT 'artist'::entity_type, a.id, x.position, x.label, x.text, x.match, NULL::int, NULL::text FROM artists a
  CROSS JOIN LATERAL (VALUES
    (1, 'Filed as', (SELECT e.sort_key FROM entity_index e WHERE e.type = 'artist' AND e.id = a.id AND e.sort_key <> a.name), NULL::text),
    (2, 'Lived', nullif(concat_ws('–', a.birth_label, a.death_label), ''), NULL),
    (3, 'Born in', place_and_country((SELECT pl.name FROM places pl WHERE pl.id = entity_home_place('artist', a.id)), entity_country('artist', a.id)), NULL),
    (4, 'Nationality', polity_words('artist', a.id, 'nationality'), NULL)) x(position, label, text, match)
  UNION ALL
  -- artworks: the artists, the date, type and materials (glossary terms: every name in every language matches — 071),
  -- where it was made, the state, the series; the museums that hold it now, then those that held it (107)
  SELECT 'artwork', w.id, x.position, x.label, x.text, x.match, x.tier_rank, x.tier_heading FROM artworks w
  CROSS JOIN LATERAL (SELECT artwork_term_names(w.id) AS terms, entity_country('artwork', w.id) AS country) t
  CROSS JOIN LATERAL (VALUES
    (1, 'Artist', (SELECT string_agg(c->>'name', ', ') FROM jsonb_array_elements(artwork_creators(w.id)) c), NULL::text, NULL::int, NULL::text),
    (2, 'Date', w.created_label, NULL, NULL, NULL),
    (3, 'Type', w.kind::text, nullif(concat_ws(' ', w.kind::text, array_to_string(t.terms, ' ')), ''), NULL, NULL),
    (4, 'Materials', nullif(array_to_string(w.materials, ', '), ''), nullif(concat_ws(' ', array_to_string(w.materials, ' '), array_to_string(t.terms, ' ')), ''), NULL, NULL),
    (5, 'Medium', w.medium, NULL, NULL, NULL),
    (6, 'Made in', place_and_country(t.country->'place'->>'name', t.country), NULL, NULL, NULL),
    (7, 'State', polity_words('artwork', w.id, 'created_in_polity'), NULL, NULL, NULL),
    (8, 'Series', (SELECT p.title || coalesce(' (no. ' || w.part_number || ')', '') FROM artworks p WHERE p.id = w.parent_id), NULL, NULL, NULL),
    (9, 'Now in', (SELECT string_agg(i.name, ', ' ORDER BY i.name) FROM artwork_holders h JOIN institutions i ON i.id = h.institution_id
                   WHERE h.artwork_id = w.id AND h.now), NULL, 1, 'Now in the collection'),
    (10, 'Formerly in', (SELECT string_agg(i.name, ', ' ORDER BY i.name) FROM artwork_holders h JOIN institutions i ON i.id = h.institution_id
                         WHERE h.artwork_id = w.id AND NOT h.now), NULL, 2, 'Formerly in the collection')) x(position, label, text, match, tier_rank, tier_heading)
  UNION ALL
  SELECT 'movement', m.id, x.position, x.label, x.text, NULL, NULL, NULL FROM movements m
  CROSS JOIN LATERAL (VALUES (1, 'Date', m.period_label), (2, 'Kind', m.kind::text)) x(position, label, text)
  UNION ALL
  -- people: filed as, dates, kind, occupations, roles, born in, nationality
  SELECT 'person', p.id, x.position, x.label, x.text, NULL, NULL, NULL FROM people p
  CROSS JOIN LATERAL (VALUES
    (1, 'Filed as', (SELECT e.sort_key FROM entity_index e WHERE e.type = 'person' AND e.id = p.id AND e.sort_key <> p.name)),
    (2, 'Lived', coalesce(nullif(concat_ws('–', p.birth_label, p.death_label), ''), 'active ' || p.active_label)),
    (3, 'Kind', p.kind::text),
    (4, 'Occupations', nullif(array_to_string(p.occupations, ', '), '')),
    (5, 'Roles', (SELECT string_agg(CASE r WHEN 'owner' THEN 'owner of artworks' WHEN 'depicted' THEN 'depicted in artworks' ELSE r END, ', ')
                  FROM unnest(person_roles(p.id)) r)),
    (6, 'Born in', place_and_country((SELECT pl.name FROM places pl WHERE pl.id = entity_home_place('person', p.id)), entity_country('person', p.id))),
    (7, 'Nationality', polity_words('person', p.id, 'nationality'))) x(position, label, text)
  UNION ALL
  SELECT 'place', pl.id, x.position, x.label, x.text, NULL, NULL, NULL FROM places pl
  CROSS JOIN LATERAL (VALUES (1, 'Kind', pl.kind::text),
    (2, 'Country', (SELECT b.name FROM boundaries b WHERE b.code = pl.country_code AND b.level = 0 LIMIT 1))) x(position, label, text)
  UNION ALL
  -- institutions: kind, dates, where, historically in; an artist's name finds the museums with their works (107)
  SELECT 'institution', i.id, x.position, x.label, x.text, NULL, x.tier_rank, x.tier_heading FROM institutions i
  CROSS JOIN LATERAL (VALUES
    (1, 'Kind', i.kind::text, NULL::int, NULL::text),
    (2, 'Dates', nullif(concat_ws(' · ', 'founded ' || i.founded_label, 'closed ' || i.dissolved_label), ''), NULL, NULL),
    (3, 'Location', place_and_country((SELECT pl.name FROM places pl WHERE pl.id = i.place_id), entity_country('institution', i.id)), NULL, NULL),
    (4, 'Historically in', polity_words('institution', i.id, 'located_in_polity'), NULL, NULL),
    (5, 'Works by', (SELECT string_agg(DISTINCT a.name, ', ') FROM artwork_holders h JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                     JOIN artists a ON a.id = aa.artist_id WHERE h.institution_id = i.id), 1, 'With works by a matching artist')) x(position, label, text, tier_rank, tier_heading)
  UNION ALL
  -- sources: authors and editors, the title, where it appeared, year
  SELECT 'source', b.id, x.position, x.label, x.text, NULL, NULL, NULL FROM bibliography b
  CROSS JOIN LATERAL (VALUES
    (1, 'Kind', b.kind::text),
    (2, 'Authors', nullif(array_to_string(b.authors || b.editors || b.compilers, ', '), '')),
    (3, 'Title', nullif(concat_ws(': ', b.name, b.subtitle), '')),
    (4, 'In', nullif(concat_ws(', ', b.container, b.exhibition, b.series), '')),
    (5, 'Published', nullif(concat_ws(', ', b.place, b.publisher, b.year), ''))) x(position, label, text)
  UNION ALL
  SELECT 'event', e.id, x.position, x.label, x.text, NULL, NULL, NULL FROM events e
  CROSS JOIN LATERAL (VALUES (1, 'Kind', e.kind::text), (2, 'Date', e.period_label),
    (3, 'Where', place_and_country((SELECT pl.name FROM places pl WHERE pl.id = e.place_id), entity_country('event', e.id))),
    (4, 'Part of', (SELECT p.name FROM events p WHERE p.id = e.parent_id))) x(position, label, text)
  UNION ALL
  SELECT 'term', g.id, x.position, x.label, x.text, NULL, NULL, NULL FROM glossary g
  CROSS JOIN LATERAL (VALUES (1, 'Category', g.category::text), (2, 'Definition', g.definition)) x(position, label, text)
  UNION ALL
  SELECT 'polity', p.id, x.position, x.label, x.text, NULL, NULL, NULL FROM polities p
  CROSS JOIN LATERAL (VALUES (1, 'Kind', p.kind::text), (2, 'Date', p.period_label),
    (3, 'Territory today', (SELECT string_agg(b.name, ', ') FROM unnest(p.country_codes) c JOIN boundaries b ON b.code = c AND b.level = 0))) x(position, label, text)
)
-- shown: what a list shows under the name anyway (an artwork's artist and date, a person's dates …) — a word found
-- there is visible, not a hidden reason; the site's cards show these as their meta line
SELECT type, id, position, label, text, match, tier_rank, tier_heading,
       (type::text, label) IN (('artwork', 'Artist'), ('artwork', 'Date'), ('artist', 'Lived'), ('person', 'Lived'), ('place', 'Kind'),
         ('place', 'Country'), ('institution', 'Kind'), ('institution', 'Dates'), ('source', 'Kind'), ('event', 'Kind'), ('event', 'Date'),
         ('event', 'Where'), ('term', 'Category'), ('polity', 'Kind'), ('polity', 'Date'), ('movement', 'Date')) AS shown
FROM f WHERE text IS NOT NULL AND btrim(text) <> '';
COMMENT ON VIEW entry_search_fields IS 'what a search finds besides an entry''s name, per entry (110): label, text, match, tier, shown — the admin''s lists, the API''s lists and the site use it';
GRANT SELECT ON entry_search_fields TO arthistory_api, arthistory_admin;

-- an entry's fields as the API sends them: [{label, text, match?, shown?, tier?: {rank, heading}}] in order
CREATE FUNCTION entry_search_fields_json(etype entity_type, eid bigint) RETURNS jsonb LANGUAGE sql STABLE
RETURN (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('label', f.label, 'text', f.text, 'match', f.match, 'shown', CASE WHEN f.shown THEN true END,
          'tier', CASE WHEN f.tier_rank IS NOT NULL THEN jsonb_build_object('rank', f.tier_rank, 'heading', f.tier_heading) END)) ORDER BY f.position), '[]')
        FROM entry_search_fields f WHERE f.type = etype AND f.id = eid);
