-- 019 — Polities and countries.
--
-- Two different questions, two answers:
--   "Which country is it in today?"  → derived from places: every place has an ISO code (country_code) or inherits
--                                      one from the nearest parent that has one (Zundert → NL). Nothing new to enter.
--   "Which polity was it part of?"   → new entity type polity (USSR, Russian Empire, Han dynasty, Kingdom of the
--                                      Netherlands …) with its own period, linked by dated relationships:
--                                      artist/patron —nationality→ polity, artwork —created_in_polity→ polity,
--                                      institution —located_in_polity→ polity.
-- "USSR (today Ukraine)" combines both: the polity from the relationship, "today" from the place (Kyiv) — the
-- polity alone can't know it (the USSR became 15 countries). polities.country_codes lists the modern countries on
-- its territory; it is only the fallback for "today" when an entry has no place but a polity (a Han dynasty bronze).

CREATE TABLE polities (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text NOT NULL CHECK (btrim(name) <> ''),
  alt_names      text[] NOT NULL DEFAULT '{}',
  kind           text,                                         -- empire, kingdom, dynasty, republic, city-state …
  parent_id      bigint REFERENCES polities ON DELETE RESTRICT, -- Western Han ⊂ Han dynasty
  period         daterange CHECK (NOT isempty(period)),        -- when it existed (open end = still exists)
  period_label   text,
  -- modern countries (ISO 3166-1 alpha-2) on its territory; a CHECK over the whole array via its text form
  country_codes  text[] NOT NULL DEFAULT '{}' CHECK (array_to_string(country_codes, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  description_md text,
  wikidata_id    text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id <> id)
);
CREATE INDEX polities_parent_idx     ON polities (parent_id);
CREATE INDEX polities_name_trgm      ON polities USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX polities_country_gin    ON polities USING gin (country_codes);      -- WHERE country_codes @> '{UA}'
CREATE INDEX polities_period_gist    ON polities USING gist (period);            -- WHERE period && …
CREATE TRIGGER polities_updated_at BEFORE UPDATE ON polities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER polities_delete_relationships AFTER DELETE ON polities FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships('polity');
CREATE TRIGGER polities_audit AFTER INSERT OR UPDATE OR DELETE ON polities FOR EACH ROW EXECUTE FUNCTION audit_row();

-- The type-dispatching helpers learn the new type.
CREATE OR REPLACE FUNCTION entity_exists(etype entity_type, eid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'patron'      THEN EXISTS (SELECT 1 FROM patrons      WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
    WHEN 'polity'      THEN EXISTS (SELECT 1 FROM polities     WHERE id = eid)
  END
$$;

CREATE OR REPLACE FUNCTION entity_id(etype entity_type, eslug text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'patron'      THEN (SELECT id FROM patrons      WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
    WHEN 'polity'      THEN (SELECT id FROM polities     WHERE slug = eslug)
  END
$$;

-- Table of a type ("polity" → polities: not always type + 's').
CREATE FUNCTION entity_table(etype entity_type) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE etype WHEN 'polity' THEN 'polities' ELSE etype::text || 's' END
$$;

-- CREATE OR REPLACE VIEW may add a UNION branch as long as the columns stay the same.
CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind FROM institutions
  UNION ALL
  SELECT 'patron', id, slug, name, active, active_label, kind FROM patrons
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind FROM polities;

-- Vocabulary: three dated links to polities. Not physical presence — never drawn as travel on the map.
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order) VALUES
  ('nationality', 'nationality', 'nationality of', 'polity', false, false, '{artist,patron}', '{polity}',
   'The polity a person belonged to (citizen or subject) — an art-historical attribution, not derived from places. Several in sequence are fine (Russian Empire, then USSR).', 5),
  ('created_in_polity', 'created in', 'origin of', 'polity', false, false, '{artwork}', '{polity}',
   'The polity where an artwork was made (Han dynasty) — complements created_in (a place).', 17),
  ('located_in_polity', 'located in', 'location of', 'polity', false, false, '{institution}', '{polity}',
   'The polity an institution was in, dated (Hermitage: Russian Empire, USSR, Russia).', 18);

------------------------------------------------------------------------------
-- Countries today, derived from places
------------------------------------------------------------------------------
-- The nearest country code going up the parent chain (recursive CTE that stops at the first place with a code),
-- and the place of kind 'country' with that code if we have one: {"code": "NL", "slug": "netherlands", "name": "Netherlands"}.
CREATE FUNCTION place_country(pid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, country_code, 0 AS depth FROM places WHERE id = pid
    UNION ALL
    SELECT p.id, p.parent_id, p.country_code, up.depth + 1
    FROM up JOIN places p ON p.id = up.parent_id
    WHERE up.country_code IS NULL AND up.depth < 20
  )
  SELECT jsonb_build_object('code', up.country_code, 'slug', c.slug, 'name', c.name)
  FROM up
  LEFT JOIN LATERAL (SELECT slug, name FROM places WHERE kind = 'country' AND country_code = up.country_code ORDER BY id LIMIT 1) c ON true
  WHERE up.country_code IS NOT NULL
  ORDER BY up.depth LIMIT 1
$$;

-- The place that decides an entry's country today: an artist's / patron's birthplace, where an artwork was created,
-- where an institution is (now). The earliest dated one if there are several.
CREATE FUNCTION entity_home_place(etype entity_type, eid bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN etype = 'institution' THEN (SELECT place_id FROM institutions WHERE id = eid)
    WHEN etype IN ('artist', 'patron', 'artwork') THEN (
      SELECT r.object_id FROM relationships r
      WHERE r.subject_type = etype AND r.subject_id = eid AND r.object_type = 'place'
        AND r.relationship_type = CASE etype WHEN 'artwork' THEN 'created_in' ELSE 'born_in' END
      ORDER BY lower(r.period) NULLS LAST, r.id LIMIT 1)
  END
$$;

-- An entry's polities, in time order: [{slug, name, kind, relationship, period, polity_period, country_codes}].
CREATE FUNCTION entity_polities(etype entity_type, eid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'slug', p.slug, 'name', p.name, 'kind', p.kind, 'relationship', r.relationship_type,
           'period', range_json(r.period, r.period_label), 'polity_period', range_json(p.period, p.period_label),
           'country_codes', to_jsonb(p.country_codes))
         ORDER BY lower(r.period) NULLS LAST, lower(p.period) NULLS LAST, p.name), '[]'::jsonb)
  FROM relationships r JOIN polities p ON p.id = r.object_id
  WHERE r.subject_type = etype AND r.subject_id = eid AND r.object_type = 'polity'
$$;

-- Country today: from the home place; without one, from the linked polities if they all lie in one modern country.
-- → {code, slug, name, source: "place"|"polity", place: {slug, name}|null}; name may be null when we have no
-- country place for the code (the API fills it from the ISO code).
CREATE FUNCTION entity_country(etype entity_type, eid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT place_country(pl.id) || jsonb_build_object('source', 'place', 'place', jsonb_build_object('slug', pl.slug, 'name', pl.name))
       FROM places pl WHERE pl.id = entity_home_place(etype, eid)),
    (SELECT jsonb_build_object('code', x.code, 'slug', c.slug, 'name', c.name, 'source', 'polity', 'place', NULL)
       FROM (SELECT min(cc) AS code
               FROM relationships r JOIN polities p ON p.id = r.object_id CROSS JOIN unnest(p.country_codes) cc
              WHERE r.subject_type = etype AND r.subject_id = eid AND r.object_type = 'polity'
             HAVING count(DISTINCT cc) = 1) x
       LEFT JOIN LATERAL (SELECT slug, name FROM places WHERE kind = 'country' AND country_code = x.code ORDER BY id LIMIT 1) c ON true))
$$;

------------------------------------------------------------------------------
-- Data quality: polities in the description / Wikidata / unconnected checks, plus one new error check.
------------------------------------------------------------------------------
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
-- ── info: incomplete ───────────────────────────────────────────────────────────────────────────────────────────
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
