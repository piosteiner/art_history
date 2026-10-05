-- 022 — Names in several languages and scripts: furigana, language tags, translations, romanizations.
--
-- Every entity table gets
--   <name>_lang  BCP 47 tag of the main name (ja, en, zh-Hant …)                       artworks: title_lang
--   <name>_ruby  the main name with furigana markup {神奈川|かながわ}…, NULL without      artworks: title_ruby
--                (<name> itself stays the plain text: lists, search, entity_index never see markup; a CHECK
--                 keeps both in step: ruby_plain(<name>_ruby) = <name>)
--   names        jsonb [{text, lang?, role}] — other names with what they are: original | translation |
--                romanization | alternative. Replaces alt_names / alt_titles (moved in as "alternative").
-- One jsonb column rather than a child table: the names are part of the entry — saved, versioned (audit_log),
-- reverted, co-edited and exported together with it, exactly like its other fields. CHECK names_valid() validates
-- the structure; an expression GIN index makes them searchable with pg_trgm.

-- Ruby markup {base|reading}: plain text and reading (IMMUTABLE → usable in CHECKs and index expressions).
CREATE FUNCTION ruby_plain(s text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(s, '\{([^{}|]+)\|[^{}|]+\}', '\1', 'g') $$;
CREATE FUNCTION ruby_reading(s text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(s, '\{[^{}|]+\|([^{}|]+)\}', '\1', 'g') $$;

-- BCP 47 language tag, as the app writes it (language-Script-REGION-variant): ja, ja-Latn, zh-Latn-pinyin, pt-BR.
CREATE FUNCTION lang_tag_ok(tag text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT tag IS NULL OR tag ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?(-[a-z0-9]{5,8})*$' $$;

-- names: an array of objects with a non-empty text, an optional valid lang, a known role, nothing else.
-- jsonb_array_elements + bool_and checks every element; jsonb ?& / - test the keys.
CREATE FUNCTION names_valid(n jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(n) = 'array' AND coalesce((
    SELECT bool_and(jsonb_typeof(e) = 'object'
                    AND jsonb_typeof(e->'text') = 'string' AND btrim(e->>'text') <> ''
                    AND (e - 'text' - 'lang' - 'role') = '{}'
                    AND public.lang_tag_ok(e->>'lang')
                    AND e->>'role' IN ('original', 'translation', 'romanization', 'alternative'))
    FROM jsonb_array_elements(n) e), true) $$;

-- (Function bodies call each other schema-qualified: since Postgres 17, index builds and other maintenance run with a
--  restricted search_path, and this one is used in an index expression.)
-- All other names as one searchable string: plain texts, plus readings where there is furigana.
CREATE FUNCTION names_text(n jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT string_agg(concat_ws(' · ', public.ruby_plain(e->>'text'),
                              CASE WHEN e->>'text' ~ '\{' THEN public.ruby_reading(e->>'text') END), ' · ')
  FROM jsonb_array_elements(n) e $$;

-- What a name sorts by: its romanization if it has one (神奈川沖浪裏 → Kanagawa-oki nami ura), else itself.
CREATE FUNCTION name_sort_key(name text, n jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce((SELECT public.ruby_plain(e->>'text') FROM jsonb_array_elements(n) WITH ORDINALITY AS x(e, i)
                   WHERE e->>'role' = 'romanization' ORDER BY i LIMIT 1), name) $$;

-- Per table: the new columns, the old lists moved in (with the history/updated_at triggers off, so moving data
-- writes no history and doesn't make every entry look edited today), the old column dropped.
ALTER TABLE places
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE places DISABLE TRIGGER places_audit, DISABLE TRIGGER places_updated_at;
UPDATE places SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE places ENABLE TRIGGER places_audit, ENABLE TRIGGER places_updated_at;
ALTER TABLE places DROP COLUMN alt_names;
CREATE INDEX places_names_trgm ON places USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE movements
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE movements DISABLE TRIGGER movements_audit, DISABLE TRIGGER movements_updated_at;
UPDATE movements SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE movements ENABLE TRIGGER movements_audit, ENABLE TRIGGER movements_updated_at;
ALTER TABLE movements DROP COLUMN alt_names;
CREATE INDEX movements_names_trgm ON movements USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE polities
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE polities DISABLE TRIGGER polities_audit, DISABLE TRIGGER polities_updated_at;
UPDATE polities SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE polities ENABLE TRIGGER polities_audit, ENABLE TRIGGER polities_updated_at;
ALTER TABLE polities DROP COLUMN alt_names;
CREATE INDEX polities_names_trgm ON polities USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE artists
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE artists DISABLE TRIGGER artists_audit, DISABLE TRIGGER artists_updated_at;
UPDATE artists SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE artists ENABLE TRIGGER artists_audit, ENABLE TRIGGER artists_updated_at;
ALTER TABLE artists DROP COLUMN alt_names;
CREATE INDEX artists_names_trgm ON artists USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE patrons
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE patrons DISABLE TRIGGER patrons_audit, DISABLE TRIGGER patrons_updated_at;
UPDATE patrons SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE patrons ENABLE TRIGGER patrons_audit, ENABLE TRIGGER patrons_updated_at;
ALTER TABLE patrons DROP COLUMN alt_names;
CREATE INDEX patrons_names_trgm ON patrons USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE institutions
  ADD COLUMN name_lang text CHECK (lang_tag_ok(name_lang)),
  ADD COLUMN name_ruby text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE institutions DISABLE TRIGGER institutions_audit, DISABLE TRIGGER institutions_updated_at;
UPDATE institutions SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_names) WITH ORDINALITY AS u(a, i))
WHERE alt_names <> '{}';
ALTER TABLE institutions ENABLE TRIGGER institutions_audit, ENABLE TRIGGER institutions_updated_at;
ALTER TABLE institutions DROP COLUMN alt_names;
CREATE INDEX institutions_names_trgm ON institutions USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

ALTER TABLE artworks
  ADD COLUMN title_lang text CHECK (lang_tag_ok(title_lang)),
  ADD COLUMN title_ruby text CHECK (title_ruby IS NULL OR ruby_plain(title_ruby) = title),
  ADD COLUMN names jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names));
ALTER TABLE artworks DISABLE TRIGGER artworks_audit, DISABLE TRIGGER artworks_updated_at;
UPDATE artworks SET names = (SELECT coalesce(jsonb_agg(jsonb_build_object('text', a, 'role', 'alternative') ORDER BY i), '[]')
                         FROM unnest(alt_titles) WITH ORDINALITY AS u(a, i))
WHERE alt_titles <> '{}';
ALTER TABLE artworks ENABLE TRIGGER artworks_audit, ENABLE TRIGGER artworks_updated_at;
ALTER TABLE artworks DROP COLUMN alt_titles;
CREATE INDEX artworks_names_trgm ON artworks USING gin (f_unaccent(names_text(names)) gin_trgm_ops);

-- entity_index learns the other names and the sort key (columns appended: CREATE OR REPLACE VIEW allows that).
CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind,
         names, name_sort_key(name, names) AS sort_key
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind, names, name_sort_key(title, names) FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind, names, name_sort_key(name, names) FROM institutions
  UNION ALL
  SELECT 'patron', id, slug, name, active, active_label, kind, names, name_sort_key(name, names) FROM patrons
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text, names, name_sort_key(name, names) FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text, names, name_sort_key(name, names) FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind, names, name_sort_key(name, names) FROM polities;

-- Quality view: 021's definition plus the info check missing_romanization.
CREATE OR REPLACE VIEW quality_issues AS
WITH rel AS (
  SELECT r.*, rt.label AS type_label, rt.is_physical_presence,
         o.name AS object_name, coalesce(r.period_label, (range_json(r.period))->>'from_year') AS when_text
  FROM relationships r
  JOIN relationship_types rt ON rt.code = r.relationship_type
  JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
)
-- ── errors: contradictions ─────────────────────────────────────────────────────────────────────────────────────
-- Physically somewhere while not alive (the lifespan is open-ended while the death is unknown)
SELECT 'presence_outside_lifespan' AS check_id, 'error' AS severity, 'artist'::entity_type AS entity_type, a.id AS entity_id,
       'rel:' || r.id AS issue_key,
       format('%s %s (%s) lies outside the lifespan', r.type_label, r.object_name, r.when_text) AS detail
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.is_physical_presence AND r.period IS NOT NULL AND a.birth IS NOT NULL AND NOT (r.period && a.lifespan)
UNION ALL
-- "born in" / "died in" dated differently from the birth / death date
SELECT 'birth_death_mismatch', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s is dated %s, the %s %s', r.type_label, r.object_name, r.when_text,
              CASE r.relationship_type WHEN 'born_in' THEN 'birth' ELSE 'death' END,
              CASE r.relationship_type WHEN 'born_in' THEN a.birth_label ELSE a.death_label END)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.period IS NOT NULL AND ((r.relationship_type = 'born_in' AND a.birth IS NOT NULL AND NOT (r.period && a.birth))
                             OR (r.relationship_type = 'died_in' AND a.death IS NOT NULL AND NOT (r.period && a.death)))
UNION ALL
-- Created after the artist's death / before their birth (>> and <<: no overlap at all, so fuzzy dates don't trigger it)
SELECT 'artwork_outside_creator_life', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('created %s, but %s %s %s', w.created_label, a.name,
              CASE WHEN w.created >> a.death THEN 'died' ELSE 'was born' END,
              CASE WHEN w.created >> a.death THEN a.death_label ELSE a.birth_label END)
FROM artworks w JOIN artists a ON a.id = w.creator_id
WHERE w.created IS NOT NULL AND ((a.death IS NOT NULL AND w.created >> a.death) OR (a.birth IS NOT NULL AND w.created << a.birth))
UNION ALL
-- Teacher and student (or collaborators, "contemporaries") who were never alive at the same time
SELECT 'never_alive_together', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s, but their lifespans do not overlap', r.type_label, r.object_name)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
JOIN artists b ON r.object_type = 'artist' AND b.id = r.object_id
WHERE r.relationship_type IN ('student_of', 'collaborated_with', 'contemporary_of')
  AND a.birth IS NOT NULL AND b.birth IS NOT NULL AND NOT (a.lifespan && b.lifespan)
UNION ALL
-- An inventory number without the institution whose collection numbered it (enforced for changes by
-- artworks_inventory_needs_institution, migration 016 — this finds rows that existed before)
SELECT 'inventory_without_institution', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('inventory number %s, but no institution', w.inventory_number)
FROM artworks w WHERE w.inventory_number IS NOT NULL AND w.current_institution_id IS NULL
UNION ALL
-- A dated link to a polity outside the polity's existence (nationality USSR in 1900)
SELECT 'outside_polity_period', 'error', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s (%s) lies outside the existence of %s (%s)', r.type_label, r.object_name, r.when_text, r.object_name,
              coalesce(p.period_label, concat_ws('–', (range_json(p.period))->>'from_year', (range_json(p.period))->>'to_year')))
FROM rel r JOIN polities p ON r.object_type = 'polity' AND p.id = r.object_id
WHERE r.period IS NOT NULL AND p.period IS NOT NULL AND NOT (r.period && p.period)
UNION ALL
-- ── warnings: probably a problem ───────────────────────────────────────────────────────────────────────────────
-- Living in two places at the same time (can be right: a summer house). r1.period * r2.period is the intersection of
-- the two ranges; fuzzy boundaries overlap a little ("Paris until February 1888", "Arles from 20 February 1888"; moving
-- on 8 May gives both periods that day), so only a substantial overlap counts: more than a month, and either more than
-- a year, or one period containing the other, or more than half of the shorter one.
SELECT 'overlapping_residences', 'warning', r1.subject_type, r1.subject_id, 'rel:' || r1.id || ':' || r2.id,
       format('lived in %s (%s) and %s (%s) at the same time', r1.object_name, r1.when_text, r2.object_name, r2.when_text)
FROM rel r1 JOIN rel r2 ON r2.subject_type = r1.subject_type AND r2.subject_id = r1.subject_id AND r2.id > r1.id
CROSS JOIN LATERAL (SELECT r1.period * r2.period AS i) x
CROSS JOIN LATERAL (SELECT coalesce(upper(x.i), lower(x.i) + 36500) - lower(x.i) AS days,
                           least(coalesce(upper(r1.period), lower(r1.period) + 36500) - lower(r1.period),
                                 coalesce(upper(r2.period), lower(r2.period) + 36500) - lower(r2.period)) AS shorter) d
WHERE r1.relationship_type = 'lived_in' AND r2.relationship_type = 'lived_in' AND r1.object_id <> r2.object_id
  AND r1.period && r2.period
  AND d.days > 31 AND (d.days > 366 OR r1.period @> r2.period OR r2.period @> r1.period OR d.days * 2 > d.shorter)
UNION ALL
-- Held by an institution before it was founded
SELECT 'held_before_founded', 'warning', 'artwork', r.subject_id, 'rel:' || r.id,
       format('housed at %s (%s), founded %s', r.object_name, r.when_text, i.founded_label)
FROM rel r JOIN institutions i ON r.object_type = 'institution' AND i.id = r.object_id
WHERE r.relationship_type = 'housed_at' AND r.period IS NOT NULL AND i.founded IS NOT NULL AND r.period << i.founded
UNION ALL
-- A place outside the outline of its parent region (PostGIS: ST_Covers on geography)
SELECT 'outside_parent_area', 'warning', 'place', c.id, 'place:' || c.id,
       format('its point lies outside the outline of %s (%s km away)', p.name,
              round((ST_Distance(p.area, c.location) / 1000)::numeric))
FROM places c JOIN places p ON p.id = c.parent_id
WHERE p.area IS NOT NULL AND c.location IS NOT NULL AND NOT ST_Covers(p.area, c.location)
UNION ALL
-- Probable duplicates: same type, very similar names (pg_trgm similarity, accent-insensitive)
SELECT 'possible_duplicate', 'warning', a.type, a.id, 'dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id),
       format('very similar to %s (%s)', b.name, b.slug)
FROM entity_index a JOIN entity_index b ON b.type = a.type AND b.id <> a.id
WHERE similarity(f_unaccent(a.name), f_unaccent(b.name)) >= 0.75
UNION ALL
SELECT 'artwork_without_creator', 'warning', 'artwork', w.id, 'artwork:' || w.id, 'no creator and no attribution'
FROM artworks w WHERE w.creator_id IS NULL AND w.attribution_label IS NULL
UNION ALL
SELECT 'image_without_license', 'warning',
       CASE WHEN i.artwork_id IS NOT NULL THEN 'artwork' WHEN i.artist_id IS NOT NULL THEN 'artist' ELSE 'institution' END::entity_type,
       coalesce(i.artwork_id, i.artist_id, i.institution_id), 'image:' || i.id,
       concat_ws(' and ', CASE WHEN i.license IS NULL THEN 'no license' END, CASE WHEN i.credit IS NULL THEN 'no credit' END)
       || ' for image ' || i.position + 1 || coalesce(' (' || i.caption || ')', '')
FROM images i WHERE i.license IS NULL OR i.credit IS NULL
UNION ALL
SELECT 'no_relationships', 'warning', e.type, e.id, e.type || ':' || e.id, 'not connected to anything'
FROM entity_index e
WHERE NOT EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id) = (e.type, e.id) OR (r.object_type, r.object_id) = (e.type, e.id))
  AND NOT (e.type = 'artwork' AND EXISTS (SELECT 1 FROM artworks w WHERE w.id = e.id AND (w.creator_id IS NOT NULL OR w.current_institution_id IS NOT NULL)))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM institutions i WHERE i.place_id = e.id))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM places c WHERE c.parent_id = e.id))        -- contains other places
  AND NOT (e.type = 'movement' AND EXISTS (SELECT 1 FROM movements c WHERE c.parent_id = e.id))  -- has sub-movements
  AND NOT (e.type = 'polity' AND EXISTS (SELECT 1 FROM polities c WHERE c.parent_id = e.id))     -- has parts
  AND NOT (e.type = 'institution' AND EXISTS (SELECT 1 FROM artworks w WHERE w.current_institution_id = e.id))
  AND NOT (e.type = 'artist' AND EXISTS (SELECT 1 FROM artworks w WHERE w.creator_id = e.id))
UNION ALL
SELECT 'artist_missing_dates', 'warning', 'artist', a.id, 'artist:' || a.id,
       concat_ws(' and ', CASE WHEN a.birth IS NULL THEN 'no birth date' END, CASE WHEN a.death IS NULL THEN 'no death date' END)
FROM artists a WHERE a.birth IS NULL OR a.death IS NULL
UNION ALL
-- Created automatically (as an artwork's creator / institution, or by the Wikidata comparison) and not edited since
SELECT 'auto_created', 'warning', ac.entity_type, ac.entity_id, 'auto:' || ac.entity_type || ':' || ac.entity_id,
       'created automatically' || coalesce(' while adding ' || f.name, '') || ' — fill in the details'
FROM auto_created ac
LEFT JOIN entity_index f ON f.type = ac.created_from_type AND f.id = ac.created_from_id
UNION ALL
-- ── info: incomplete ───────────────────────────────────────────────────────────────────────────────────────────
-- A name without any Latin letter (kanji, Cyrillic, Arabic …) and no romanization: hard to find and to sort
SELECT 'missing_romanization', 'info', e.type, e.id, e.type || ':' || e.id, format('"%s" has no romanization', e.name)
FROM entity_index e
WHERE e.name !~ '[A-Za-zÀ-ɏ]' AND NOT jsonb_path_exists(e.names, '$[*] ? (@.role == "romanization")')
UNION ALL
-- Without a period a presence can't be placed on the timeline or the travel route
SELECT 'presence_without_period', 'info', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s has no date — not on the timeline or route', r.type_label, r.object_name)
FROM rel r WHERE r.is_physical_presence AND r.period IS NULL
UNION ALL
SELECT 'place_without_parent', 'info', 'place', p.id, 'place:' || p.id, 'not inside any other place (no parent)'
FROM places p WHERE p.parent_id IS NULL AND p.kind <> 'country'
UNION ALL
SELECT 'missing_description', 'info', t.type, t.id, t.type || ':' || t.id, 'no description / biography'
FROM (SELECT 'artist'::entity_type AS type, id, biography_md AS md FROM artists
      UNION ALL SELECT 'artwork', id, description_md FROM artworks
      UNION ALL SELECT 'place', id, description_md FROM places
      UNION ALL SELECT 'movement', id, description_md FROM movements
      UNION ALL SELECT 'institution', id, description_md FROM institutions
      UNION ALL SELECT 'patron', id, notes_md FROM patrons
      UNION ALL SELECT 'polity', id, description_md FROM polities) t
WHERE t.md IS NULL
UNION ALL
SELECT 'no_wikidata_id', 'info', t.type, t.id, t.type || ':' || t.id, 'no Wikidata id (compare with Wikidata to add it)'
FROM (SELECT 'artist'::entity_type AS type, id, wikidata_id FROM artists
      UNION ALL SELECT 'artwork', id, wikidata_id FROM artworks
      UNION ALL SELECT 'place', id, wikidata_id FROM places
      UNION ALL SELECT 'movement', id, wikidata_id FROM movements
      UNION ALL SELECT 'institution', id, wikidata_id FROM institutions
      UNION ALL SELECT 'patron', id, wikidata_id FROM patrons
      UNION ALL SELECT 'polity', id, wikidata_id FROM polities) t
WHERE t.wikidata_id IS NULL;
