-- 013 — Data quality: every check is one SELECT in the view quality_issues (admin page /quality, src/admin/quality.js).
--
-- A row = one finding: (check, severity, entity it belongs to, issue_key identifying it, human-readable detail).
--   error    a contradiction — something here cannot be right
--   warning  probably a problem — worth a look
--   info     incomplete — fine, but the map/timeline/site would show more with it
-- Findings that are correct anyway (a posthumous cast, two homes at once) are acknowledged in quality_acks and hidden.
-- The date checks are range operators on the daterange columns (data-model.md):
--   a && b   overlap      a << b   a lies entirely before b      a >> b   a lies entirely after b
-- To change a check: a new migration with CREATE OR REPLACE VIEW (never edit this one once applied).
CREATE VIEW quality_issues AS
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
SELECT 'image_without_license', 'warning', 'artwork', w.id, 'artwork:' || w.id,
       concat_ws(' and ', CASE WHEN w.image_license IS NULL THEN 'no license' END, CASE WHEN w.image_credit IS NULL THEN 'no credit' END)
       || ' for its image'
FROM artworks w WHERE w.image_url IS NOT NULL AND (w.image_license IS NULL OR w.image_credit IS NULL)
UNION ALL
SELECT 'no_relationships', 'warning', e.type, e.id, e.type || ':' || e.id, 'not connected to anything'
FROM entity_index e
WHERE NOT EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id) = (e.type, e.id) OR (r.object_type, r.object_id) = (e.type, e.id))
  AND NOT (e.type = 'artwork' AND EXISTS (SELECT 1 FROM artworks w WHERE w.id = e.id AND (w.creator_id IS NOT NULL OR w.current_institution_id IS NOT NULL)))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM institutions i WHERE i.place_id = e.id))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM places c WHERE c.parent_id = e.id))        -- contains other places
  AND NOT (e.type = 'movement' AND EXISTS (SELECT 1 FROM movements c WHERE c.parent_id = e.id))  -- has sub-movements
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
      UNION ALL SELECT 'patron', id, notes_md FROM patrons) t
WHERE t.md IS NULL
UNION ALL
SELECT 'no_wikidata_id', 'info', t.type, t.id, t.type || ':' || t.id, 'no Wikidata id (compare with Wikidata to add it)'
FROM (SELECT 'artist'::entity_type AS type, id, wikidata_id FROM artists
      UNION ALL SELECT 'artwork', id, wikidata_id FROM artworks
      UNION ALL SELECT 'place', id, wikidata_id FROM places
      UNION ALL SELECT 'movement', id, wikidata_id FROM movements
      UNION ALL SELECT 'institution', id, wikidata_id FROM institutions
      UNION ALL SELECT 'patron', id, wikidata_id FROM patrons) t
WHERE t.wikidata_id IS NULL;

-- Findings marked "OK" (correct despite the check) — hidden from the lists, shown again on request.
CREATE TABLE quality_acks (
  check_id  text NOT NULL,
  issue_key text NOT NULL,
  note      text,
  acked_by  bigint REFERENCES admin_users ON DELETE SET NULL,
  acked_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (check_id, issue_key)
);

REVOKE ALL ON quality_issues, quality_acks FROM arthistory_api;
