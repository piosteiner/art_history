-- 036 — The bibliography: books, articles, catalogues, lexicon entries, websites, videos, archival sources — typed in
-- once and cited in any text with [[source/slug|S. 45]]. Citations follow the guide of the Kunsthistorisches Institut,
-- Universität Zürich (short references in the notes, full entries in a list; src/bibliography.js, src/markdown.js).
-- A source also records whether it has been read (reading_status, read_on).
CREATE TYPE source_kind AS ENUM ('book', 'catalogue', 'chapter', 'article', 'lexicon_entry', 'catalogue_entry', 'web', 'video', 'archival', 'other');
CREATE TYPE reading_status AS ENUM ('to_read', 'reading', 'read');

CREATE TABLE bibliography (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind              source_kind NOT NULL DEFAULT 'book',
  -- the title, with the name features of 022 (language, furigana, translations)
  name              text NOT NULL CHECK (btrim(name) <> ''),
  name_lang         text CHECK (lang_tag_ok(name_lang)),
  name_ruby         text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  names             jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names)),
  subtitle          text,
  authors           text[] NOT NULL DEFAULT '{}',     -- "Surname, Given names", in order
  editors           text[] NOT NULL DEFAULT '{}',     -- hrsg. von (of this publication)
  compilers         text[] NOT NULL DEFAULT '{}',     -- Bearb. (catalogues, editions)
  container         text,                             -- the volume / journal / lexicon / website a part appeared in
  container_editors text[] NOT NULL DEFAULT '{}',
  volume            text,                             -- Jahrgang, Bd.
  issue             text,                             -- Nr.
  issue_date        text,                             -- "Mai 1972"
  volumes_total     text,                             -- "4" → 4 Bde.
  edition           text,                             -- "überarb. Ausgabe", "2. Aufl."
  original_year     text,                             -- [1985]
  series            text,
  thesis            text,                             -- "Diss. masch."
  place             text,                             -- "Stuttgart und Teufen"
  publisher         text,
  year              text,                             -- text: "1955–1989" is a year too
  pages             text,
  pages_are_columns boolean NOT NULL DEFAULT false,   -- Sp. instead of S.
  catalogue_number  text,
  exhibition        text,                             -- "Paris: Bibliothèque Nationale"
  url               text CHECK (url ~ '^https?://'),
  accessed          daterange CHECK (NOT isempty(accessed)),
  accessed_label    text,
  uploader          text,                             -- video platforms: the user name
  uploaded          daterange CHECK (NOT isempty(uploaded)),
  uploaded_label    text,
  date_text         text,                             -- letters, events: "30.09.1913"
  archive           text,
  shelfmark         text,
  isbn              text,
  doi               text,
  siglum            text,                             -- only to override the generated one
  primary_source    boolean NOT NULL DEFAULT false,   -- Quelle (vs. Forschungsliteratur)
  reading_status    reading_status,
  read_on           daterange CHECK (NOT isempty(read_on)),
  read_on_label     text,
  description_md    text,                             -- own notes: summary, what it says about what
  wikidata_id       text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bibliography_name_trgm ON bibliography USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX bibliography_alt_trgm  ON bibliography USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
CREATE INDEX bibliography_authors_gin ON bibliography USING gin (authors);
CREATE TRIGGER bibliography_updated_at BEFORE UPDATE ON bibliography FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bibliography_delete_relationships AFTER DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships('source');
CREATE TRIGGER bibliography_audit AFTER INSERT OR UPDATE OR DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION audit_row();

CREATE OR REPLACE FUNCTION entity_exists(etype entity_type, eid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'person'      THEN EXISTS (SELECT 1 FROM people       WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
    WHEN 'polity'      THEN EXISTS (SELECT 1 FROM polities     WHERE id = eid)
    WHEN 'term'        THEN EXISTS (SELECT 1 FROM glossary     WHERE id = eid)
    WHEN 'source'      THEN EXISTS (SELECT 1 FROM bibliography WHERE id = eid)
  END
$$;
CREATE OR REPLACE FUNCTION entity_id(etype entity_type, eslug text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'person'      THEN (SELECT id FROM people       WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
    WHEN 'polity'      THEN (SELECT id FROM polities     WHERE slug = eslug)
    WHEN 'term'        THEN (SELECT id FROM glossary     WHERE slug = eslug)
    WHEN 'source'      THEN (SELECT id FROM bibliography WHERE slug = eslug)
  END
$$;
CREATE OR REPLACE FUNCTION entity_table(etype entity_type) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE etype WHEN 'polity' THEN 'polities' WHEN 'person' THEN 'people' WHEN 'term' THEN 'glossary'
                    WHEN 'source' THEN 'bibliography' ELSE etype::text || 's' END
$$;

CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind,
         names, name_sort_key(name, name_ruby, names) AS sort_key, name_alt_text(name_ruby, names) AS alt_text
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind,
         names, name_sort_key(title, title_ruby, names), name_alt_text(title_ruby, names)
    FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM institutions
  UNION ALL
  -- a person's span is the lifespan when known, else the active period (families, orders: only that)
  SELECT 'person', id, slug, name, coalesce(lifespan, active),
         coalesce(nullif(concat_ws('–', birth_label, death_label), ''), active_label), kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM people
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM polities
  UNION ALL
  SELECT 'term', id, slug, name, NULL, NULL, category::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM glossary
  UNION ALL
  SELECT 'source', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM bibliography;

-- [[source/…]] citations count as links: "cited in" on a source's page reads content_links.
CREATE OR REPLACE VIEW content_links AS
SELECT DISTINCT x.entity_type, x.entity_id, coalesce(m[1], 'term') AS target_type, m[2] AS target_slug
FROM (
  SELECT 'artist'::entity_type AS entity_type, id AS entity_id, biography_md AS md FROM artists
  UNION ALL SELECT 'artwork', id, description_md FROM artworks
  UNION ALL SELECT 'institution', id, description_md FROM institutions
  UNION ALL SELECT 'person', id, description_md FROM people
  UNION ALL SELECT 'movement', id, description_md FROM movements
  UNION ALL SELECT 'place', id, description_md FROM places
  UNION ALL SELECT 'polity', id, description_md FROM polities
  UNION ALL SELECT 'term', id, description_md FROM glossary
  UNION ALL SELECT 'source', id, description_md FROM bibliography
  UNION ALL SELECT subject_type, subject_id, notes_md FROM relationships
  UNION ALL SELECT 'artwork', artwork_id, notes_md FROM provenance
) x
CROSS JOIN LATERAL regexp_matches(x.md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]', 'g') AS m
WHERE x.md LIKE '%[[%';

-- Quality view: 034's definition; sources (like glossary terms) needn't have relationships.
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
-- A [[link]] in a text to a glossary term that doesn't exist (yet)
SELECT 'broken_glossary_link', 'warning', l.entity_type, l.entity_id, 'gl:' || l.entity_type || ':' || l.entity_id || ':' || l.term_slug,
       format('links to the glossary term "%s", which doesn''t exist', l.term_slug)
FROM glossary_links l WHERE NOT EXISTS (SELECT 1 FROM glossary g WHERE g.slug = l.term_slug)
UNION ALL
-- Provenance (031): an undocumented change of owner whose gap lies in or across 1933–1945 — the standard red flag
-- of Nazi-era provenance research. The gap runs from the previous owner's last documented holding (their recorded
-- end, else their acquisition) to this acquisition; && is the range overlap operator.
SELECT 'provenance_gap_1933_1945', 'warning', 'artwork', p.artwork_id, 'prov-gap:' || p.id,
       format('%s: the change of owner (%s) is not documented as direct, and the gap lies in 1933–1945',
              p.owner_name, coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.position > p.first_position AND NOT p.direct AND p.acquired IS NOT NULL AND p.prev_holding IS NOT NULL
  AND lower(p.prev_holding) < upper(p.acquired)
  AND daterange(lower(p.prev_holding), upper(p.acquired)) && daterange('1933-01-30', '1945-05-09')
UNION ALL
-- Confiscated or sold under duress: check whether it was restituted (a later step "restitution")
SELECT 'provenance_forced_transfer', 'warning', 'artwork', p.artwork_id, 'prov-forced:' || p.id,
       format('%s: %s (%s) — no later restitution recorded', p.owner_name, replace(p.method::text, '_', ' '), coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.method IN ('confiscation', 'forced_sale')
  AND NOT EXISTS (SELECT 1 FROM provenance r WHERE r.artwork_id = p.artwork_id AND r.position > p.position AND r.method = 'restitution')
UNION ALL
-- The last owner in the provenance is not the institution that holds the work now
SELECT 'provenance_last_owner', 'warning', 'artwork', w.id, 'prov-last:' || w.id,
       format('the provenance ends with %s, but the work is at %s', p.owner_name, i.name)
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
JOIN provenance_periods p ON p.artwork_id = w.id AND p.is_last
WHERE p.owner_institution_id IS DISTINCT FROM w.current_institution_id
UNION ALL
-- A [[type/slug]] link to an entry that doesn't exist (030) — a typo, a renamed slug, a deleted entry, an unknown type
SELECT 'broken_link', 'warning', l.entity_type, l.entity_id, 'link:' || l.entity_type || ':' || l.entity_id || ':' || l.target_type || '/' || l.target_slug,
       format('links to %s/%s, which doesn''t exist', l.target_type, l.target_slug)
FROM content_links l
WHERE l.target_type <> 'term'
  AND NOT EXISTS (SELECT 1 FROM entity_index e WHERE e.type::text = l.target_type AND e.slug = l.target_slug)
UNION ALL
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
              round((ST_Distance(pg.outline, cg.marker) / 1000)::numeric))
FROM places c JOIN places p ON p.id = c.parent_id
JOIN place_geo cg ON cg.id = c.id JOIN place_geo pg ON pg.id = p.id
WHERE pg.outline IS NOT NULL AND c.location IS NOT NULL AND NOT ST_DWithin(pg.outline, cg.marker, 5000)
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
       CASE WHEN i.artwork_id IS NOT NULL THEN 'artwork' WHEN i.artist_id IS NOT NULL THEN 'artist'
         WHEN i.glossary_id IS NOT NULL THEN 'term' ELSE 'institution' END::entity_type,
       coalesce(i.artwork_id, i.artist_id, i.institution_id, i.glossary_id), 'image:' || i.id,
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
  AND e.type NOT IN ('term', 'source')                                                             -- linked from texts                                                                             -- linked from texts
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
-- An institution without its city (place): with a point of its own, the nearest settlement within 25 km is suggested
SELECT 'institution_without_place', 'info', 'institution', i.id, 'institution:' || i.id,
       CASE WHEN s.slug IS NOT NULL THEN format('no place (city) — it lies %s km from %s (%s)', s.km, s.name, s.slug)
            ELSE 'no place (city) set — the map can''t show it unless it has its own point' END
FROM institutions i
LEFT JOIN LATERAL (SELECT p.slug, p.name, round((ST_Distance(g.marker, i.location) / 1000)::numeric, 1) AS km
                   FROM places p JOIN place_geo g ON g.id = p.id
                   WHERE i.location IS NOT NULL AND p.kind = 'settlement' AND ST_DWithin(g.marker, i.location, 25000)
                   ORDER BY g.marker <-> i.location LIMIT 1) s ON true
WHERE i.place_id IS NULL
UNION ALL
-- A place without parent whose point lies inside another place's outline: the smallest such place is suggested
SELECT 'parent_suggestion', 'info', 'place', c.id, 'place:' || c.id || ':' || s.id,
       format('lies inside %s (%s) — set it as parent', s.name, s.slug)
FROM places c JOIN place_geo cg ON cg.id = c.id
CROSS JOIN LATERAL (SELECT p.id, p.name, p.slug FROM places p JOIN place_geo pg ON pg.id = p.id
                    WHERE p.id <> c.id AND pg.outline IS NOT NULL AND ST_Covers(pg.outline, cg.marker)
                    ORDER BY ST_Area(pg.outline) LIMIT 1) s
WHERE c.parent_id IS NULL AND c.kind <> 'country'
UNION ALL
-- A country or region without an outline, while Natural Earth has one with that code / that name in that country
SELECT 'boundary_available', 'info', 'place', p.id, 'place:' || p.id || ':' || b.code,
       format('an outline is available: %s (%s) — set the boundary code', b.name, b.code)
FROM places p
CROSS JOIN LATERAL (SELECT code, name FROM boundaries b
                    WHERE (p.kind = 'country' AND b.level = 0 AND b.code = p.country_code)
                       OR (p.kind = 'region' AND b.level = 1 AND b.country_code = place_country(p.id)->>'code'
                           AND lower(f_unaccent(b.name)) = lower(f_unaccent(p.name)))
                    LIMIT 1) b
WHERE p.kind IN ('country', 'region') AND p.area IS NULL AND p.boundary_code IS NULL
UNION ALL
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
      UNION ALL SELECT 'person', id, description_md FROM people
      UNION ALL SELECT 'polity', id, description_md FROM polities
      UNION ALL SELECT 'term', id, description_md FROM glossary WHERE definition IS NULL) t
WHERE t.md IS NULL
UNION ALL
SELECT 'no_wikidata_id', 'info', t.type, t.id, t.type || ':' || t.id, 'no Wikidata id (compare with Wikidata to add it)'
FROM (SELECT 'artist'::entity_type AS type, id, wikidata_id FROM artists
      UNION ALL SELECT 'artwork', id, wikidata_id FROM artworks
      UNION ALL SELECT 'place', id, wikidata_id FROM places
      UNION ALL SELECT 'movement', id, wikidata_id FROM movements
      UNION ALL SELECT 'institution', id, wikidata_id FROM institutions
      UNION ALL SELECT 'person', id, wikidata_id FROM people
      UNION ALL SELECT 'polity', id, wikidata_id FROM polities) t
WHERE t.wikidata_id IS NULL;
