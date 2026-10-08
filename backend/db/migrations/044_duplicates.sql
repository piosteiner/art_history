-- 044 — Duplicates: prevented where an identifier exists, recognised by evidence everywhere else, and merged.
--
-- 1. Hard rules. An inventory number identifies an object within its collection: two "Untitled" can't both be
--    Kunsthaus 1942/12. A Natural Earth outline belongs to one place. Partial unique indexes: only rows that have
--    the value take part (NULLs never collide anyway; the WHERE keeps the index small and says what is meant).
CREATE UNIQUE INDEX artworks_inventory_unique ON artworks (current_institution_id, lower(btrim(inventory_number)))
  WHERE inventory_number IS NOT NULL AND current_institution_id IS NOT NULL;
CREATE UNIQUE INDEX places_boundary_unique ON places (boundary_code) WHERE boundary_code IS NOT NULL;

-- 2. Evidence. Names alone don't decide ("Untitled", "Man on a Bench"): every entry is reduced to the facts that can
--    tell two entries apart (dup_facts), and dup_score() weighs a pair — points for agreeing facts, minus points for
--    contradicting ones. ≥ 50: shown as possible duplicate; ≥ 70: creating it asks first (src/admin/duplicates.js).
--    One definition for the create form, the live box while typing and the quality page.

-- every name of an entry, lower-case and without accents (the name plus translations, romanizations …)
CREATE FUNCTION dup_names(name text, names jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT lower(public.f_unaccent(x))), '{}') FROM (
    SELECT name UNION ALL SELECT n ->> 'text' FROM jsonb_array_elements(coalesce(names, '[]')) n) s(x)
  WHERE x IS NOT NULL AND btrim(x) <> ''
$$;

-- the best trigram similarity between any name of one and any of the other (0–1)
CREATE FUNCTION names_similarity(a text[], b text[]) RETURNS real LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(max(similarity(x, y)), 0) FROM unnest(a) x, unnest(b) y
$$;

-- One row per entry, the same columns for every type (NULL where a type doesn't have it). A view has a row type,
-- so dup_score() can take two of its rows as arguments.
CREATE VIEW dup_facts AS
SELECT 'artwork'::entity_type AS type, w.id, w.slug, w.title AS name, dup_names(w.title, w.names) AS names, w.kind,
       w.created AS period, NULL::daterange AS birth, NULL::daterange AS death, w.creator_id,
       w.current_institution_id AS institution_id, w.inventory_number, w.height_cm, w.width_cm,
       coalesce(w.location, ST_PointOnSurface(w.area::geometry)::geography) AS point, NULL::bigint AS place_id,
       w.parent_id, w.part_number, NULL::text AS web_host, NULL::text AS year, NULL::text[] AS authors,
       NULL::text AS isbn, NULL::text AS doi
  FROM artworks w
UNION ALL
SELECT 'artist', a.id, a.slug, a.name, dup_names(a.name, a.names), NULL, NULL, a.birth, a.death, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM artists a
UNION ALL
SELECT 'person', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind, NULL, p.birth, p.death, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM people p
UNION ALL
SELECT 'place', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       g.marker, NULL, p.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM places p LEFT JOIN place_geo g ON g.id = p.id
UNION ALL
SELECT 'institution', i.id, i.slug, i.name, dup_names(i.name, i.names), i.kind, i.founded, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       i.location, i.place_id, NULL, NULL, lower(substring(i.website_url FROM '^https?://(?:www\.)?([^/:?#]+)')), NULL, NULL, NULL, NULL
  FROM institutions i
UNION ALL
SELECT 'movement', m.id, m.slug, m.name, dup_names(m.name, m.names), m.kind::text, m.period, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, m.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM movements m
UNION ALL
SELECT 'polity', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind, p.period, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, p.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM polities p
UNION ALL
SELECT 'term', g.id, g.slug, g.name, dup_names(g.name, g.names), g.category::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM glossary g
UNION ALL
SELECT 'source', b.id, b.slug, b.name, dup_names(b.name, b.names), b.kind::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, nullif(btrim(b.year), ''),
       (SELECT array_agg(lower(public.f_unaccent(x))) FROM unnest(b.authors) x),
       nullif(regexp_replace(upper(coalesce(b.isbn, '')), '[^0-9X]', '', 'g'), ''), nullif(lower(btrim(b.doi)), '')
  FROM bibliography b;

-- Could the two be the same at all? Similar names, or an identifier in common. Cheap enough to run on every pair.
CREATE FUNCTION dup_maybe(a dup_facts, b dup_facts) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT names_similarity(a.names, b.names) >= 0.5 OR a.doi = b.doi OR a.isbn = b.isbn OR a.web_host = b.web_host
      OR (a.institution_id = b.institution_id AND lower(btrim(a.inventory_number)) = lower(btrim(b.inventory_number)))
$$;

-- The weighing. OUT parameters make it return a row (score, reasons), used with CROSS JOIN LATERAL.
CREATE FUNCTION dup_score(a dup_facts, b dup_facts, OUT score int, OUT reasons text[]) LANGUAGE plpgsql STABLE AS $$
DECLARE
  s real := names_similarity(a.names, b.names);
  d double precision;
  -- dimensions in cm: the same within 1 cm or 2 %, different beyond 3 cm and 5 %
  close_h boolean; far_h boolean; close_w boolean; far_w boolean;
BEGIN
  score := 0; reasons := '{}';
  IF s >= 0.999 THEN
    -- a person's or a place's full name says more than a title ("Untitled") or a book title
    score := CASE WHEN a.type IN ('artwork', 'source') THEN 50 ELSE 70 END; reasons := reasons || 'same name'::text;
  ELSIF s >= 0.5 THEN
    score := round(s * 55); reasons := reasons || format('similar name (%s %%)', round(s * 100));
  END IF;

  IF a.type = 'artwork' THEN
    IF a.institution_id = b.institution_id AND lower(btrim(a.inventory_number)) = lower(btrim(b.inventory_number)) THEN
      score := score + 100; reasons := reasons || 'same inventory number in the same collection'::text;
    END IF;
    IF a.creator_id IS NOT NULL AND b.creator_id IS NOT NULL THEN
      IF a.creator_id = b.creator_id THEN score := score + 20; reasons := reasons || 'same creator'::text;
      ELSE score := score - 60; reasons := reasons || 'different creators'::text; END IF;
    END IF;
    IF a.institution_id IS NOT NULL AND b.institution_id IS NOT NULL THEN
      IF a.institution_id = b.institution_id THEN score := score + 10; reasons := reasons || 'same collection'::text;
      ELSE score := score - 10; reasons := reasons || 'different collections'::text; END IF;
    END IF;
    IF a.height_cm IS NOT NULL AND b.height_cm IS NOT NULL THEN
      close_h := abs(a.height_cm - b.height_cm) <= greatest(1, 0.02 * greatest(a.height_cm, b.height_cm));
      far_h   := abs(a.height_cm - b.height_cm) >  greatest(3, 0.05 * greatest(a.height_cm, b.height_cm));
      close_w := a.width_cm IS NULL OR b.width_cm IS NULL OR abs(a.width_cm - b.width_cm) <= greatest(1, 0.02 * greatest(a.width_cm, b.width_cm));
      far_w   := a.width_cm IS NOT NULL AND b.width_cm IS NOT NULL AND abs(a.width_cm - b.width_cm) > greatest(3, 0.05 * greatest(a.width_cm, b.width_cm));
      IF close_h AND close_w THEN score := score + 20; reasons := reasons || 'same dimensions'::text;
      ELSIF far_h OR far_w THEN score := score - 40; reasons := reasons || 'different dimensions'::text; END IF;
    END IF;
    IF a.parent_id = b.parent_id AND a.part_number IS NOT NULL AND b.part_number IS NOT NULL AND a.part_number <> b.part_number THEN
      score := score - 60; reasons := reasons || format('different parts of one series (No. %s / %s)', a.part_number, b.part_number);
    END IF;
  END IF;

  -- created (artworks), founded (institutions), period (movements, polities) — a person's "active" is too vague
  IF a.period IS NOT NULL AND b.period IS NOT NULL AND a.type <> 'person' THEN
    IF a.period && b.period THEN score := score + 10; reasons := reasons || 'dates agree'::text;
    ELSE score := score - 30; reasons := reasons || 'different dates'::text; END IF;
  END IF;
  IF a.birth IS NOT NULL AND b.birth IS NOT NULL THEN
    IF a.birth && b.birth THEN score := score + 15; reasons := reasons || 'birth dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different birth dates'::text; END IF;
  END IF;
  IF a.death IS NOT NULL AND b.death IS NOT NULL THEN
    IF a.death && b.death THEN score := score + 15; reasons := reasons || 'death dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different death dates'::text; END IF;
  END IF;

  -- a city and a region of the same name (Oslo, Kyoto) are two things; so are a technique and a style
  IF a.type IN ('place', 'term') AND a.kind IS NOT NULL AND b.kind IS NOT NULL THEN
    IF a.kind = b.kind THEN score := score + 5;
    ELSE score := score - 25; reasons := reasons || format('different kinds (%s / %s)', a.kind, b.kind); END IF;
  END IF;

  IF a.point IS NOT NULL AND b.point IS NOT NULL THEN
    d := ST_Distance(a.point, b.point);
    IF a.type = 'place' THEN
      IF d < 5000 THEN score := score + 25; reasons := reasons || 'close together'::text;
      ELSIF d < 25000 THEN score := score + 10; reasons := reasons || format('%s km apart', round(d / 1000));
      ELSIF d > 100000 THEN score := score - 50; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'institution' THEN
      IF d <= 300 THEN score := score + 25; reasons := reasons || 'same spot'::text;
      ELSIF d > 20000 THEN score := score - 40; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'artwork' THEN
      IF d <= 200 THEN score := score + 15; reasons := reasons || 'same spot'::text;
      ELSIF d > 5000 THEN score := score - 30; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    END IF;
  END IF;
  IF a.place_id IS NOT NULL AND b.place_id IS NOT NULL THEN
    IF a.place_id = b.place_id THEN score := score + 10; reasons := reasons || 'same city'::text;
    ELSE score := score - 20; reasons := reasons || 'different cities'::text; END IF;
  END IF;
  IF a.web_host = b.web_host THEN score := score + 40; reasons := reasons || 'same website'::text; END IF;

  IF a.type = 'source' THEN
    IF a.doi = b.doi THEN score := score + 100; reasons := reasons || 'same DOI'::text; END IF;
    -- a chapter has the ISBN of its book: strong, but not proof
    IF a.isbn = b.isbn THEN score := score + 40; reasons := reasons || 'same ISBN'::text; END IF;
    IF a.year IS NOT NULL AND b.year IS NOT NULL THEN
      IF a.year = b.year THEN score := score + 15; reasons := reasons || 'same year'::text;
      ELSE score := score - 40; reasons := reasons || 'different years'::text; END IF;
    END IF;
    IF cardinality(a.authors) > 0 AND cardinality(b.authors) > 0 THEN
      IF a.authors && b.authors THEN score := score + 20; reasons := reasons || 'same author'::text;
      ELSE score := score - 30; reasons := reasons || 'different authors'::text; END IF;
    END IF;
  END IF;
END $$;

-- The candidates for one entry, best first — minus the pairs someone said are different (quality_acks, the same key
-- as the quality page's: dup:<smaller id>:<larger id>).
CREATE FUNCTION duplicate_candidates(etype entity_type, eid bigint, min_score int DEFAULT 50)
RETURNS TABLE (id bigint, slug text, name text, score int, reasons text[]) LANGUAGE sql STABLE AS $$
  SELECT b.id, b.slug, b.name, s.score, s.reasons
  FROM dup_facts a JOIN dup_facts b ON b.type = a.type AND b.id <> a.id
  CROSS JOIN LATERAL dup_score(a, b) s
  WHERE a.type = etype AND a.id = eid AND dup_maybe(a, b) AND s.score >= min_score
    AND NOT EXISTS (SELECT 1 FROM quality_acks k WHERE k.check_id = 'possible_duplicate'
                    AND k.issue_key = 'dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id))
  ORDER BY s.score DESC, b.name LIMIT 10
$$;

-- 3. The quality check uses the same weighing (043's view; only possible_duplicate changes).
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
-- Probable duplicates: weighed by dup_score (names and evidence), 044
SELECT 'possible_duplicate', 'warning', a.type, a.id, 'dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id),
       format('probably the same as %s (%s) — %s (score %s)', b.name, b.slug, array_to_string(s.reasons, ', '), s.score)
FROM dup_facts a JOIN dup_facts b ON b.type = a.type AND b.id <> a.id
CROSS JOIN LATERAL dup_score(a, b) s
WHERE dup_maybe(a, b) AND s.score >= 50
UNION ALL
SELECT 'artwork_without_creator', 'warning', 'artwork', w.id, 'artwork:' || w.id, 'no creator and no attribution'
FROM artworks w WHERE w.creator_id IS NULL AND w.attribution_label IS NULL
UNION ALL
SELECT 'image_without_license', 'warning',
       i.entity_type, i.entity_id, 'image:' || i.id,
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
-- A part of a series / album / triptych without creator or date, while the whole has one
SELECT 'part_missing_data', 'info', 'artwork', a.id, 'artwork:' || a.id,
       format('no %s — its whole, %s, has %s', concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'creator' END,
                                                             CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN 'date' END),
              w.title, concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'one' END,
                                          CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN coalesce(w.created_label, 'one') END))
FROM artworks a JOIN artworks w ON w.id = a.parent_id
WHERE (a.creator_id IS NULL AND w.creator_id IS NOT NULL) OR (a.created IS NULL AND w.created IS NOT NULL)
UNION ALL
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

-- 4. Merging a duplicate into the entry that stays. Everything that points at the duplicate is moved: foreign keys
--    (found in the catalog, pg_constraint — so a table added later is covered without changing this function),
--    relationships (type + id, no foreign key), images, provenance, bookkeeping. Then the duplicate is deleted, its
--    slug leads to the kept entry (slug_history, 041) and [[links]] to it are rewritten (current_links, 042). Fields
--    the kept entry doesn't have are filled from the duplicate — in groups that belong together (a date and its
--    label, all dimensions, institution and inventory number), never mixed. Its other names become alternative names.
--    Returns what it did as JSON — the merge page runs it in a transaction it rolls back for the preview.
--    History source "merge": one change set, revertable like any other.
CREATE FUNCTION json_empty(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NULL OR v IN ('null', '""', '[]', '{}')
$$;

CREATE FUNCTION merge_entries(etype entity_type, keep_id bigint, dup_id bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  tbl text := public.entity_table(etype);
  name_col text := CASE etype WHEN 'artwork' THEN 'title' ELSE 'name' END;
  keep_row jsonb; dup_row jsonb;
  merged jsonb := '{}'; moved jsonb := '{}'; filled text[] := '{}'; differing text[] := '{}';
  new_names jsonb; added int := 0; texts bigint := 0; n bigint; m bigint;
  prev_source text := current_setting('arthistory.source', true);
  r record; g record; e jsonb;
BEGIN
  IF keep_id = dup_id THEN RAISE EXCEPTION 'An entry can''t be merged into itself.'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 FOR UPDATE', tbl) INTO keep_row USING keep_id;
  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 FOR UPDATE', tbl) INTO dup_row USING dup_id;
  IF keep_row IS NULL OR dup_row IS NULL THEN RAISE EXCEPTION 'Entry not found.'; END IF;
  PERFORM set_config('arthistory.source', 'merge', true);

  -- relationships: those between the two would point at itself, those the kept entry has already would be doubled
  DELETE FROM relationships WHERE (subject_type = etype AND subject_id = dup_id AND object_type = etype AND object_id = keep_id)
                               OR (subject_type = etype AND subject_id = keep_id AND object_type = etype AND object_id = dup_id);
  DELETE FROM relationships d WHERE d.subject_type = etype AND d.subject_id = dup_id AND EXISTS (
    SELECT 1 FROM relationships k WHERE k.subject_type = etype AND k.subject_id = keep_id AND k.relationship_type = d.relationship_type
      AND k.object_type = d.object_type AND k.object_id = d.object_id AND k.period IS NOT DISTINCT FROM d.period);
  DELETE FROM relationships d WHERE d.object_type = etype AND d.object_id = dup_id AND EXISTS (
    SELECT 1 FROM relationships k WHERE k.object_type = etype AND k.object_id = keep_id AND k.relationship_type = d.relationship_type
      AND k.subject_type = d.subject_type AND k.subject_id = d.subject_id AND k.period IS NOT DISTINCT FROM d.period);
  UPDATE relationships SET subject_id = keep_id WHERE subject_type = etype AND subject_id = dup_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE relationships SET object_id = keep_id WHERE object_type = etype AND object_id = dup_id;
  GET DIAGNOSTICS m = ROW_COUNT;
  IF n + m > 0 THEN moved := moved || jsonb_build_object('relationships', n + m); END IF;

  -- the kept entry's parent was the duplicate: now the duplicate's parent
  IF (keep_row ->> 'parent_id')::bigint = dup_id THEN
    EXECUTE format('UPDATE %I SET parent_id = $1 WHERE id = $2', tbl) USING nullif((dup_row ->> 'parent_id')::bigint, keep_id), keep_id;
    keep_row := keep_row || jsonb_build_object('parent_id', nullif((dup_row ->> 'parent_id')::bigint, keep_id));
  END IF;
  -- an artwork's provenance steps and any entry's images: the duplicate's after the kept one's (an image both have: once)
  IF etype = 'artwork' THEN
    UPDATE provenance SET position = position + (SELECT coalesce(max(position), -1) + 1 FROM provenance WHERE artwork_id = keep_id)
     WHERE artwork_id = dup_id;
  END IF;
  FOR r IN SELECT a.attname AS col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.conrelid = 'images'::regclass AND c.confrelid = tbl::regclass LOOP
    EXECUTE format('DELETE FROM images d WHERE d.%1$I = $1 AND EXISTS (SELECT 1 FROM images k WHERE k.%1$I = $2 AND k.url = d.url)', r.col)
      USING dup_id, keep_id;
    EXECUTE format('UPDATE images SET position = position + (SELECT coalesce(max(position), -1) + 1 FROM images WHERE %1$I = $2) WHERE %1$I = $1', r.col)
      USING dup_id, keep_id;
  END LOOP;

  -- every foreign key that points at this table: creator, institution, place, parent, provenance owner, images …
  FOR r IN SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           WHERE c.contype = 'f' AND c.confrelid = tbl::regclass AND cardinality(c.conkey) = 1 LOOP
    EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', r.child, r.col, r.col) USING keep_id, dup_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN moved := moved || jsonb_build_object(r.child || '.' || r.col, n); END IF;
  END LOOP;

  -- bookkeeping by (type, id)
  UPDATE auto_created SET created_from_id = keep_id WHERE created_from_type = etype AND created_from_id = dup_id;
  UPDATE wikidata_reviews d SET entity_id = keep_id WHERE d.entity_type = etype AND d.entity_id = dup_id
     AND NOT EXISTS (SELECT 1 FROM wikidata_reviews k WHERE k.entity_type = etype AND k.entity_id = keep_id AND k.item = d.item);
  DELETE FROM wikidata_reviews WHERE entity_type = etype AND entity_id = dup_id;
  DELETE FROM live_docs WHERE entity_type = etype AND entity_id = dup_id;
  DELETE FROM admin_drafts WHERE entity_type = etype AND entity_id = dup_id;
  UPDATE slug_history SET entity_id = keep_id WHERE entity_type = etype AND entity_id = dup_id;

  -- the duplicate goes; its address now leads to the kept entry
  EXECUTE format('DELETE FROM %I WHERE id = $1', tbl) USING dup_id;
  INSERT INTO slug_history (entity_type, old_slug, entity_id) VALUES (etype, dup_row ->> 'slug', keep_id)
  ON CONFLICT (entity_type, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, changed_at = now();

  -- fill what the kept entry lacks, group by group (after the delete: the Wikidata id is unique)
  FOR g IN
    SELECT grp, array_agg(attname::text) AS cols FROM (
      SELECT attname, CASE WHEN attname IN ('height_cm', 'width_cm', 'depth_cm', 'dimensions_note', 'other_dimensions') THEN 'dimensions'
                           WHEN attname IN ('current_institution_id', 'inventory_number') THEN 'collection'
                           WHEN attname IN ('parent_id', 'part_number') THEN 'series'
                           WHEN attname IN ('location', 'area', 'boundary_code') THEN 'geometry'
                           WHEN attname IN ('web_url', 'web_url_accessed') THEN 'web'
                           ELSE regexp_replace(attname, '_label$', '') END AS grp
      FROM pg_attribute WHERE attrelid = tbl::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
        AND attname NOT IN ('id', 'slug', 'created_at', 'updated_at', 'sort_name', 'names', 'metadata',
                            name_col, name_col || '_lang', name_col || '_ruby')) c
    GROUP BY grp
  LOOP
    IF NOT EXISTS (SELECT 1 FROM unnest(g.cols) c WHERE NOT public.json_empty(dup_row -> c)) THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(g.cols) c WHERE NOT public.json_empty(keep_row -> c))
       AND (dup_row ->> 'parent_id') IS DISTINCT FROM keep_id::text THEN
      merged := merged || (SELECT jsonb_object_agg(c, dup_row -> c) FROM unnest(g.cols) c);
      filled := filled || ARRAY(SELECT c FROM unnest(g.cols) c WHERE NOT public.json_empty(dup_row -> c));
    ELSE
      differing := differing || ARRAY(SELECT c FROM unnest(g.cols) c
                                      WHERE NOT public.json_empty(dup_row -> c) AND (keep_row -> c) IS DISTINCT FROM (dup_row -> c));
    END IF;
  END LOOP;
  -- names: the duplicate's name and other names become the kept entry's other names (one "original" at most)
  IF keep_row ? 'names' THEN
    new_names := coalesce(keep_row -> 'names', '[]');
    FOR e IN SELECT value FROM jsonb_array_elements(coalesce(dup_row -> 'names', '[]')
                                                     || jsonb_build_array(jsonb_build_object('text', dup_row ->> name_col, 'role', 'alternative'))) LOOP
      IF lower(e ->> 'text') <> lower(keep_row ->> name_col)
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(new_names) x WHERE lower(x ->> 'text') = lower(e ->> 'text')) THEN
        IF e ->> 'role' = 'original' AND EXISTS (SELECT 1 FROM jsonb_array_elements(new_names) x WHERE x ->> 'role' = 'original') THEN
          e := e || '{"role": "alternative"}';
        END IF;
        new_names := new_names || jsonb_build_array(e);
        added := added + 1;
      END IF;
    END LOOP;
    IF added > 0 THEN merged := merged || jsonb_build_object('names', new_names); END IF;
  END IF;
  IF NOT public.json_empty(dup_row -> 'metadata') THEN
    merged := merged || jsonb_build_object('metadata', (dup_row -> 'metadata') || coalesce(keep_row -> 'metadata', '{}'));
  END IF;
  IF merged <> '{}' THEN
    EXECUTE format('UPDATE %I SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r) WHERE id = $2', tbl,
                   (SELECT string_agg(format('%I', k), ', ') FROM jsonb_object_keys(merged) k),
                   (SELECT string_agg(format('r.%I', k), ', ') FROM jsonb_object_keys(merged) k), tbl)
      USING merged, keep_id;
  END IF;

  -- [[links]] to the duplicate now name the kept entry
  FOR r IN SELECT * FROM public.markdown_columns LOOP
    EXECUTE format('UPDATE %I SET %I = public.current_links(%2$I) WHERE %2$I LIKE %L', r.tbl, r.col, '%[[%' || (dup_row ->> 'slug') || '%');
    GET DIAGNOSTICS n = ROW_COUNT;
    texts := texts + n;
  END LOOP;

  PERFORM set_config('arthistory.source', coalesce(prev_source, ''), true);
  RETURN jsonb_build_object('kept', keep_row ->> 'slug', 'removed', dup_row ->> 'slug', 'moved', moved,
                            'filled', to_jsonb(filled), 'differing', to_jsonb(differing), 'names_added', added, 'texts', texts);
END $$;
