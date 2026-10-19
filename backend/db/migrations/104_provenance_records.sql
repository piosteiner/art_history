-- 104 — Provenance records: the evidence under a step (owner, 2026-10-19, after the Prado's provenances). A royal
-- collection, a church, a dealer are documented by entries, not by changes of hands: "Real Alcázar, summer office,
-- 1700, no. 286; new Royal Palace, antesala de la Furriera, 1747, no. 4 …" — each an inventory (or a catalogue, an
-- exhibition, a sighting) with its date, the residence, the room, the number, and how sure the source is of it
-- ("¿nº 411?", "¿Real Alcázar, 1666?"). Until now they were flattened into the step's text: numbers without their
-- year, rooms not at all, every doubt lost. A record belongs to one step (the holder at the time); its place, dated,
-- is a stop on the map like a further place (077), consecutive records at the same place one stop.
CREATE TYPE provenance_record_kind AS ENUM ('inventory', 'catalogue', 'exhibition', 'sighting', 'document', 'other');

CREATE TABLE provenance_records (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provenance_id    bigint NOT NULL REFERENCES provenance ON DELETE CASCADE,
  position         integer NOT NULL CHECK (position >= 0),
  kind             provenance_record_kind NOT NULL DEFAULT 'inventory',
  date             daterange CHECK (NOT isempty(date)),
  date_label       text CHECK (btrim(date_label) <> ''),
  place_id         bigint REFERENCES places ON DELETE RESTRICT,
  room             text CHECK (btrim(room) <> ''),                 -- where in the place: "summer office", "Sala Reservada"
  number           text CHECK (btrim(number) <> ''),               -- the number in that document; none = not numbered
  number_certainty certainty NOT NULL DEFAULT 'attested',          -- "¿nº 411?" = possible
  document         text CHECK (btrim(document) <> ''),             -- "inventory of the Real Alcázar", "Prado catalogue"
  certainty        certainty NOT NULL DEFAULT 'attested',          -- of the record as a whole: "¿Real Alcázar, 1666?"
  note             text CHECK (btrim(note) <> ''),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provenance_id, position) DEFERRABLE INITIALLY DEFERRED,
  CHECK (num_nonnulls(date, place_id, room, number, document, note) > 0),
  CHECK (number IS NOT NULL OR number_certainty = 'attested')
);
CREATE INDEX provenance_records_step_idx ON provenance_records (provenance_id, position);
CREATE INDEX provenance_records_place_idx ON provenance_records (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX provenance_records_number_idx ON provenance_records (lower(number)) WHERE number IS NOT NULL;
CREATE TRIGGER provenance_records_updated_at BEFORE UPDATE ON provenance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER provenance_records_audit AFTER INSERT OR UPDATE OR DELETE ON provenance_records FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT ON provenance_records TO arthistory_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON provenance_records TO arthistory_admin;

-- Every number of a provenance — a step's own (lot, stock, ERR, Munich …, 077) and those of its records (the
-- inventory numbers) — for the lookups (/v1/provenance-numbers, the admin's /provenance/numbers).
CREATE VIEW provenance_numbers_all AS
SELECT n.provenance_id, n.kind, n.number, n.position, NULL::bigint AS record_id, 'attested'::certainty AS certainty,
       NULL::text AS date_label, NULL::text AS document
FROM provenance_numbers n
UNION ALL
SELECT r.provenance_id, CASE r.kind WHEN 'inventory' THEN 'inventory' WHEN 'catalogue' THEN 'catalogue' WHEN 'exhibition' THEN 'catalogue' ELSE 'other' END,
       r.number, 1000 + r.position, r.id, r.number_certainty, r.date_label, r.document
FROM provenance_records r WHERE r.number IS NOT NULL;
GRANT SELECT ON provenance_numbers_all TO arthistory_api, arthistory_admin;

-- The map's stops (091) with the records' places: after a step's further places, in the records' order (by date),
-- a record only where the place changes (the Royal Palace's inventories of 1747, 1772, 1794: one stop).
CREATE OR REPLACE FUNCTION provenance_stops(aid bigint)
RETURNS TABLE (step bigint, steps bigint, provenance_id bigint, chain_kind text, part integer, part_label text,
               place_id bigint, place_basis text, marker geography)
LANGUAGE sql STABLE AS $$
  WITH chain AS (
    SELECT c.*, row_number() OVER (ORDER BY c.position, c.kind, c.id) AS step, count(*) OVER () AS steps
    FROM provenance_chain c WHERE c.artwork_id = aid AND c.role IS DISTINCT FROM 'event')
  SELECT ch.step, ch.steps, ch.id, ch.kind, pl.part, pl.part_label, pl.place_id, pl.place_basis, g.marker
  FROM chain ch
  LEFT JOIN LATERAL (
    SELECT * FROM (
      (SELECT rel.object_id AS place_id, 'created_in' AS basis, 1 AS pref FROM relationships rel
       WHERE rel.subject_type = 'artwork' AND rel.subject_id = ch.artwork_id
         AND rel.relationship_type = 'created_in' AND rel.object_type = 'place' ORDER BY rel.id LIMIT 1)
      UNION ALL
      (SELECT min(x.object_id), 'artist_residence', 2 FROM artworks w
       JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                   AND x.period && w.created
       JOIN relationship_types rt ON rt.code = x.relationship_type AND rt.is_physical_presence
       WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
      UNION ALL
      (SELECT min(x.object_id), 'artist_workplace', 3 FROM artworks w
       JOIN relationships x ON x.subject_type = 'artist' AND x.subject_id = w.creator_id AND x.object_type = 'place'
                           AND x.relationship_type = 'worked_in' AND x.period IS NULL
       WHERE w.id = ch.artwork_id HAVING count(DISTINCT x.object_id) = 1)
    ) m ORDER BY pref LIMIT 1
  ) made ON ch.location_id IS NULL AND (ch.kind = 'creation' OR ch.method = 'creation')
  LEFT JOIN LATERAL (
    SELECT i.place_id, 'holder_seat' AS basis FROM institutions i WHERE i.id = ch.owner_id
  ) seat ON ch.location_id IS NULL AND ch.owner_type = 'institution' AND ch.kind <> 'creation'
  CROSS JOIN LATERAL (
    SELECT coalesce(ch.location_id, made.place_id, seat.place_id) AS place_id,
           CASE WHEN ch.location_id IS NOT NULL THEN CASE WHEN ch.kind = 'loan' THEN 'holder_seat' ELSE 'recorded' END
                ELSE coalesce(made.basis, seat.basis) END AS place_basis, 0 AS part, NULL::text AS part_label
    UNION ALL
    SELECT x.place_id, 'recorded', x.position + 1, x.period_label FROM provenance_places x WHERE x.provenance_id = ch.id AND ch.kind = 'step'
    UNION ALL
    -- 104: the records' places where they change
    SELECT r.place_id, 'recorded', 100 + r.n, r.date_label FROM (
      SELECT x.place_id, x.date_label, row_number() OVER w AS n, lag(x.place_id) OVER w AS prev
      FROM provenance_records x WHERE x.provenance_id = ch.id AND x.place_id IS NOT NULL AND ch.kind = 'step'
      WINDOW w AS (ORDER BY lower(x.date) NULLS LAST, x.position)) r
    WHERE r.place_id IS DISTINCT FROM coalesce(r.prev, ch.location_id)
  ) pl
  LEFT JOIN site_geo g ON (g.type, g.id) = ('place', pl.place_id)
$$;

-- Full-text search (087): a record is a provenance document of its artwork too — its room, document, number, note
-- ("Bóvedas de Tiziano", "Sala Reservada", "Depósito Grande"). The view is extended as it stands (its other parts
-- unchanged); the GIN index has the view's expression.
CREATE INDEX provenance_records_search_idx ON provenance_records USING gin
  (search_vector(NULL::text, NULL::text, search_join(ARRAY[room, document, note, date_label]), number));
DO $$
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW search_documents AS '
    || rtrim(pg_get_viewdef('search_documents'::regclass), E'; \n')
    || $v$
 UNION ALL
 SELECT 'artwork'::entity_type AS type, p.artwork_id AS id, 'provenance'::text AS part, r.provenance_id,
    search_vector(NULL::text, NULL::text, search_join(ARRAY[r.room, r.document, r.note, r.date_label]), r.number) AS doc,
    NULLIF(concat_ws(' · '::text, search_join(ARRAY[r.room, r.document, r.note, r.date_label]), r.number), ''::text) AS body
   FROM provenance_records r JOIN provenance p ON p.id = r.provenance_id$v$;
END $$;

-- The check (058: the view quality_issues_live): a record dated outside its holder's period — the record belongs to
-- another step, or a date is wrong. Only when both are known.
DO $$
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS '
    || rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n')
    || $v$
 UNION ALL
 SELECT 'provenance_record_outside'::text AS check_id, 'warning'::text AS severity, 'artwork'::entity_type AS entity_type,
    pp.artwork_id AS entity_id, ('prov-record:'::text || r.id) AS issue_key,
    format('%s: %s record %s is outside the period %s'::text, pp.owner_name, r.kind, coalesce(r.date_label, ''), coalesce(pp.period_label, '')) AS detail
   FROM provenance_records r JOIN provenance_periods pp ON pp.id = r.provenance_id
  WHERE r.date IS NOT NULL AND pp.period IS NOT NULL AND NOT (r.date && pp.period)$v$;
END $$;
