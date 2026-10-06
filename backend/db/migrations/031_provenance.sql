-- 031 — Provenance: who owned an artwork, in order, as the sources record it — acquisitions (when, how, from whom),
-- not ownership periods. The periods are *computed*: each owner holds the work from their acquisition until the next
-- owner's acquisition, and every computed end says where it comes from (recorded / implied / ongoing / unknown) — so
-- nothing is filled in blindly, and the chain still has no blanks.
--
-- Provenance is input for the network and the map, not a separate world: the view `edges` turns each step into the
-- relationships the site draws — owned_by (artwork → owner), kept_in (artwork → place: the work's route on the map)
-- and transferred_to (previous owner → next owner: collector ↔ dealer ↔ museum). owned_by is no longer entered as a
-- relationship; the existing ones move into this table.

CREATE TYPE acquisition_method AS ENUM ('creation', 'commission', 'inheritance', 'purchase', 'auction', 'gift', 'bequest', 'exchange',
                                        'confiscation', 'forced_sale', 'restitution', 'unknown');

CREATE TABLE provenance (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artwork_id            bigint NOT NULL REFERENCES artworks ON DELETE CASCADE,
  position              int NOT NULL CHECK (position >= 0),
  -- The owner: an exclusive arc (as images, 017) — one of four real foreign keys, or only a description
  -- ("Private collection, Paris") when the owner is unknown or not an entry.
  owner_artist_id       bigint REFERENCES artists ON DELETE RESTRICT,
  owner_person_id       bigint REFERENCES people ON DELETE RESTRICT,
  owner_institution_id  bigint REFERENCES institutions ON DELETE RESTRICT,
  owner_place_id        bigint REFERENCES places ON DELETE RESTRICT,     -- a city or state as owner
  owner_label           text CHECK (btrim(owner_label) <> ''),
  acquired              daterange CHECK (NOT isempty(acquired)),         -- when this owner acquired it (fuzzy)
  acquired_label        text,
  ended                 daterange CHECK (NOT isempty(ended)),            -- only when a source records the end
  ended_label           text,
  method                acquisition_method NOT NULL DEFAULT 'unknown',
  direct                boolean NOT NULL DEFAULT false,  -- documented as passed on directly from the previous owner
  location_id           bigint REFERENCES places ON DELETE RESTRICT,    -- where the work was with this owner
  label                 text,                                            -- details: "via Galerie Durand-Ruel", "lot 23"
  certainty             certainty NOT NULL DEFAULT 'attested',
  notes_md              text,
  metadata              jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),  -- sources
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(owner_artist_id, owner_person_id, owner_institution_id, owner_place_id) <= 1),
  CHECK (num_nonnulls(owner_artist_id, owner_person_id, owner_institution_id, owner_place_id) = 1 OR owner_label IS NOT NULL),
  CHECK (ended IS NULL OR acquired IS NULL OR NOT (ended << acquired)),  -- not ending before it began
  -- One step per position. DEFERRABLE INITIALLY DEFERRED: checked at COMMIT, so a reorder can renumber the steps one
  -- by one inside a transaction without tripping over itself halfway.
  CONSTRAINT provenance_position UNIQUE (artwork_id, position) DEFERRABLE INITIALLY DEFERRED
);
-- Foreign keys don't index the referencing side; these serve the RESTRICT checks and "owner of" lookups.
CREATE INDEX provenance_artist_idx      ON provenance (owner_artist_id)      WHERE owner_artist_id IS NOT NULL;
CREATE INDEX provenance_person_idx      ON provenance (owner_person_id)      WHERE owner_person_id IS NOT NULL;
CREATE INDEX provenance_institution_idx ON provenance (owner_institution_id) WHERE owner_institution_id IS NOT NULL;
CREATE INDEX provenance_place_idx       ON provenance (owner_place_id)       WHERE owner_place_id IS NOT NULL;
CREATE INDEX provenance_location_idx    ON provenance (location_id)          WHERE location_id IS NOT NULL;
CREATE TRIGGER provenance_updated_at BEFORE UPDATE ON provenance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER provenance_audit AFTER INSERT OR UPDATE OR DELETE ON provenance FOR EACH ROW EXECUTE FUNCTION audit_row();

-- The computed chain. Window functions look at the neighbouring steps of the same artwork (PARTITION BY artwork_id
-- ORDER BY position): lead() = the next step, lag() = the previous one. The period is built from the boundaries the
-- sources give; end_basis says where its end comes from:
--   recorded  the step's own `ended`
--   implied   the next owner's acquisition (to its upper bound: "1952" = by the end of 1952 at the latest)
--   ongoing   last step, and the owner is the institution that holds the work now → open-ended range
--   unknown   last step otherwise → only the acquisition itself, never an invented end
CREATE VIEW provenance_periods AS
WITH s AS (
  SELECT p.*,
         CASE WHEN p.owner_artist_id IS NOT NULL THEN 'artist' WHEN p.owner_person_id IS NOT NULL THEN 'person'
              WHEN p.owner_institution_id IS NOT NULL THEN 'institution' WHEN p.owner_place_id IS NOT NULL THEN 'place'
         END::entity_type AS owner_type,
         coalesce(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id) AS owner_id,
         lead(p.acquired)       OVER w AS next_acquired,
         lead(p.acquired_label) OVER w AS next_label,
         lag(p.owner_artist_id, 1) OVER w AS prev_artist, lag(p.owner_person_id) OVER w AS prev_person,
         lag(p.owner_institution_id) OVER w AS prev_institution, lag(p.owner_place_id) OVER w AS prev_place,
         coalesce(lag(p.ended) OVER w, lag(p.acquired) OVER w) AS prev_holding,  -- the previous owner's last documented date
         first_value(p.position) OVER w AS first_position,
         lead(p.id) OVER w IS NULL AS is_last
  FROM provenance p
  WINDOW w AS (PARTITION BY p.artwork_id ORDER BY p.position)
), b AS (
  SELECT s.*,
         CASE WHEN s.ended IS NOT NULL THEN 'recorded'
              WHEN s.next_acquired IS NOT NULL THEN 'implied'
              WHEN s.is_last AND s.owner_institution_id = w.current_institution_id THEN 'ongoing'
              ELSE 'unknown' END AS end_basis,
         CASE WHEN s.prev_artist IS NOT NULL THEN 'artist' WHEN s.prev_person IS NOT NULL THEN 'person'
              WHEN s.prev_institution IS NOT NULL THEN 'institution' WHEN s.prev_place IS NOT NULL THEN 'place'
         END::entity_type AS prev_owner_type,
         coalesce(s.prev_artist, s.prev_person, s.prev_institution, s.prev_place) AS prev_owner_id
  FROM s JOIN artworks w ON w.id = s.artwork_id
)
SELECT b.id, b.artwork_id, b.position, b.first_position, b.is_last, b.owner_type, b.owner_id, b.owner_institution_id,
       coalesce(o.name || coalesce(' (' || b.owner_label || ')', ''), b.owner_label) AS owner_name,
       b.prev_owner_type, b.prev_owner_id, b.prev_holding,
       b.acquired, b.acquired_label, b.ended, b.ended_label, b.method, b.direct, b.location_id, b.label, b.certainty,
       b.notes_md, b.end_basis,
       -- greatest(): a fuzzy end that starts before the acquisition ("c. 1950" after "1952") still gives a valid range
       CASE WHEN b.acquired IS NULL THEN NULL
            WHEN b.end_basis = 'recorded' THEN daterange(lower(b.acquired), greatest(upper(b.ended), upper(b.acquired)))
            WHEN b.end_basis = 'implied'  THEN daterange(lower(b.acquired), greatest(upper(b.next_acquired), upper(b.acquired)))
            WHEN b.end_basis = 'ongoing'  THEN daterange(lower(b.acquired), NULL)
            ELSE b.acquired END AS period,
       -- "1926–1952", but "c. 1916–22 – 1926" when a label is itself a span
       CASE WHEN b.acquired IS NULL THEN NULL
            WHEN b.end_basis = 'recorded' AND b.ended_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN b.acquired_label || b.ended_label ~ '[–-]' THEN ' – ' ELSE '–' END || b.ended_label
            WHEN b.end_basis = 'implied' AND b.next_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN b.acquired_label || b.next_label ~ '[–-]' THEN ' – ' ELSE '–' END || b.next_label
            WHEN b.end_basis = 'ongoing' THEN 'since ' || b.acquired_label
            WHEN b.end_basis = 'unknown' THEN 'from ' || b.acquired_label
            ELSE b.acquired_label END AS period_label,
       b.owner_label, b.metadata
FROM b LEFT JOIN entity_index o ON o.type = b.owner_type AND o.id = b.owner_id;

-- Vocabulary: owned_by becomes derived (provenance); two new derived types. Artists may own works too (Degas collected).
UPDATE relationship_types SET object_types = '{artist,person,institution,place}',
  description = 'Ownership — derived from the provenance (table provenance, migration 031); entered in the artwork''s Provenance section.'
 WHERE code = 'owned_by';
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order, derived) VALUES
  ('kept_in', 'kept in', 'location of', 'presence', true, false, '{artwork}', '{place}',
   'Where the work was while with an owner — derived from the provenance (its place); drawn as the artwork''s route.', 17, true),
  ('transferred_to', 'passed to', 'received from', 'provenance', false, false, '{artist,person,institution,place}',
   '{artist,person,institution,place}',
   'A change of owner — derived from two consecutive provenance steps; "possible" when not documented as direct.', 82, true);

-- Derived types now also come from a table (provenance), not only a column: a message that says where to enter them.
CREATE OR REPLACE FUNCTION relationships_not_derived() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT derived FROM relationship_types WHERE code = NEW.relationship_type) THEN
    RAISE EXCEPTION '"%" is derived (creator: the artwork''s creator field; owned_by, kept_in, transferred_to: its provenance) and cannot be stored as a relationship',
      NEW.relationship_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON COLUMN relationship_types.derived IS
  'Edges computed from other data (view edges: the creator field, the provenance), never stored in relationships; not offered in the admin form.';

-- The existing owned_by relationships become provenance steps (in date order per artwork), then owned_by is derived.
-- A period of up to a year is the acquisition; a longer one gives the acquisition year and a recorded end year.
INSERT INTO provenance (artwork_id, position, owner_artist_id, owner_person_id, owner_institution_id, owner_place_id,
                        acquired, acquired_label, ended, ended_label, certainty, notes_md, metadata)
SELECT r.subject_id,
       row_number() OVER (PARTITION BY r.subject_id ORDER BY lower(r.period) NULLS LAST, r.id) - 1,
       CASE WHEN r.object_type = 'artist' THEN r.object_id END, CASE WHEN r.object_type = 'person' THEN r.object_id END,
       CASE WHEN r.object_type = 'institution' THEN r.object_id END, CASE WHEN r.object_type = 'place' THEN r.object_id END,
       CASE WHEN r.period IS NULL THEN NULL WHEN upper(r.period) - lower(r.period) <= 366 THEN r.period
            ELSE year_range(extract(year FROM lower(r.period))::int) END,
       CASE WHEN r.period IS NULL THEN NULL WHEN upper(r.period) - lower(r.period) <= 366
            THEN CASE WHEN r.period = year_range(extract(year FROM lower(r.period))::int)
                      THEN extract(year FROM lower(r.period))::text ELSE r.period_label END
            ELSE extract(year FROM lower(r.period))::text END,
       CASE WHEN r.period IS NOT NULL AND upper(r.period) - lower(r.period) > 366 AND NOT upper_inf(r.period)
            THEN year_range(extract(year FROM upper(r.period) - 1)::int) END,
       CASE WHEN r.period IS NOT NULL AND upper(r.period) - lower(r.period) > 366 AND NOT upper_inf(r.period)
            THEN extract(year FROM upper(r.period) - 1)::text END,
       r.certainty, r.notes_md, r.metadata
FROM relationships r WHERE r.relationship_type = 'owned_by';
DELETE FROM relationships WHERE relationship_type = 'owned_by';
UPDATE relationship_types SET derived = true WHERE code = 'owned_by';

-- All edges the site draws, stored and derived, in one shape — replaces graph_edges (029). The graph, the entity
-- pages, the people roles and the map read this view. `source` says where a row comes from; `end_basis` (provenance
-- only) whether the period's end is recorded, implied, ongoing or unknown. id = the relationship's id (stored rows only).
DROP VIEW graph_edges;
CREATE VIEW edges AS
SELECT r.id, r.subject_type, r.subject_id, r.relationship_type, r.object_type, r.object_id, r.period, r.period_label,
       r.label, r.certainty, r.notes_md, 'relationship' AS source, NULL::text AS end_basis, NULL::bigint AS provenance_id
FROM relationships r
UNION ALL
SELECT NULL, 'artwork', w.id, 'creator', 'artist', w.creator_id, NULL, NULL, NULL, 'attested', NULL, 'creator', NULL, NULL
FROM artworks w WHERE w.creator_id IS NOT NULL
UNION ALL
SELECT NULL, 'artwork', p.artwork_id, 'owned_by', p.owner_type, p.owner_id, p.period, p.period_label,
       concat_ws(' · ', nullif(replace(p.method::text, '_', ' '), 'unknown'), p.label), p.certainty, NULL, 'provenance', p.end_basis, p.id
FROM provenance_periods p WHERE p.owner_id IS NOT NULL
UNION ALL
SELECT NULL, 'artwork', p.artwork_id, 'kept_in', 'place', p.location_id, p.period, p.period_label,
       p.owner_name, p.certainty, NULL, 'provenance', p.end_basis, p.id
FROM provenance_periods p WHERE p.location_id IS NOT NULL
UNION ALL
-- A change of owner between two entries. Not documented as direct: someone may have been in between → "possible".
SELECT NULL, p.prev_owner_type, p.prev_owner_id, 'transferred_to', p.owner_type, p.owner_id, p.acquired, p.acquired_label,
       nullif(replace(p.method::text, '_', ' '), 'unknown'), CASE WHEN p.direct THEN p.certainty ELSE 'possible' END,
       NULL, 'provenance', NULL, p.id
FROM provenance_periods p WHERE p.owner_id IS NOT NULL AND p.prev_owner_id IS NOT NULL
  AND (p.owner_type, p.owner_id) IS DISTINCT FROM (p.prev_owner_type, p.prev_owner_id);

-- [[links]] in provenance notes count for the artwork (content_links keeps its columns, so OR REPLACE works).
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
  UNION ALL SELECT subject_type, subject_id, notes_md FROM relationships
  UNION ALL SELECT 'artwork', artwork_id, notes_md FROM provenance
) x
CROSS JOIN LATERAL regexp_matches(x.md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]', 'g') AS m
WHERE x.md LIKE '%[[%';

-- Quality view: 030's definition + three provenance checks.
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
  AND e.type <> 'term'                                                                             -- linked from texts
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
