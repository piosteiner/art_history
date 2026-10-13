-- 063: provenance — who held the work in which role, joint owners, prices, dates known from one side only, and
-- the chain as the provenance standards write it: from the artist to the current holder (Kunsthaus Zürich's
-- "Tournesols sur un fauteuil" as the first complete example).
--
-- * role (enum holder_role): owner · dealer (bought it to sell) · agent (on consignment, as agent: held, not owned)
--   · estate (the owner's estate — "Nachlass Josef Stránský" is Stránský with the role estate, so the link to him
--   stays) · custodian (held without owning: deposit, storage). Agents and custodians give "held by" edges, the
--   others "owned by".
-- * provenance_co_owners: more owners of the same step ("Léo und Gertrude Stein") — each an entry with its own
--   "owned by" edge. An exclusive arc like the step's own owner (artist, person or institution).
-- * price, price_currency (ISO 4217: FRF, USD, CHF …), price_note ("ca.", "insurance value").
-- * A commission is the first step of a provenance (method commission): the "commissioned" link becomes derived from
--   it, like owned_by — entered once, in the provenance. (No stored "commissioned" relationships existed.)
-- * A loan: the lender's step is ongoing when the work is on loan (048: artworks.on_loan) — the lender still owns it.
-- * provenance_chain: the provenance as it is read — an implied first step "the artist" from the creator and the
--   creation date (unless the first step is the creation or a commission, or names the artist), the recorded steps,
--   and an implied last line for a loan ("on loan to … since …", from on_loan_since). Implied lines are computed,
--   never stored: the creator and the loan are recorded once, where they belong.

CREATE TYPE holder_role AS ENUM ('owner', 'dealer', 'agent', 'estate', 'custodian');

ALTER TABLE provenance
  ADD COLUMN role holder_role NOT NULL DEFAULT 'owner',
  ADD COLUMN price numeric(14, 2) CHECK (price >= 0),
  ADD COLUMN price_currency text CHECK (price_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN price_note text CHECK (btrim(price_note) <> ''),
  ADD CONSTRAINT provenance_price_currency CHECK (price IS NULL OR price_currency IS NOT NULL);

CREATE TABLE provenance_co_owners (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provenance_id bigint NOT NULL REFERENCES provenance ON DELETE CASCADE,
  position integer NOT NULL,
  owner_artist_id bigint REFERENCES artists ON DELETE RESTRICT,
  owner_person_id bigint REFERENCES people ON DELETE RESTRICT,
  owner_institution_id bigint REFERENCES institutions ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(owner_artist_id, owner_person_id, owner_institution_id) = 1),
  UNIQUE (provenance_id, position)
);
CREATE INDEX provenance_co_owners_artist ON provenance_co_owners (owner_artist_id) WHERE owner_artist_id IS NOT NULL;
CREATE INDEX provenance_co_owners_person ON provenance_co_owners (owner_person_id) WHERE owner_person_id IS NOT NULL;
CREATE INDEX provenance_co_owners_institution ON provenance_co_owners (owner_institution_id) WHERE owner_institution_id IS NOT NULL;
-- history and the stored quality findings, like every content table (006, 058)
CREATE TRIGGER provenance_co_owners_audit AFTER INSERT OR UPDATE OR DELETE ON provenance_co_owners FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE CONSTRAINT TRIGGER quality_changed AFTER INSERT OR UPDATE OR DELETE ON provenance_co_owners
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quality_changed();

-- the co-owners as (type, id) — the arc read once
CREATE VIEW provenance_co_owners_x AS
SELECT c.id, c.provenance_id, c.position,
       (CASE WHEN c.owner_artist_id IS NOT NULL THEN 'artist' WHEN c.owner_person_id IS NOT NULL THEN 'person' ELSE 'institution' END)::entity_type AS owner_type,
       coalesce(c.owner_artist_id, c.owner_person_id, c.owner_institution_id) AS owner_id
FROM provenance_co_owners c;

INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, is_symmetric, is_physical_presence, derived, sort_order, description)
VALUES ('held_by', 'held by', 'held', 'provenance', '{artwork}', '{artist,person,institution,place}', false, false, true, 81,
        'Held without owning it — an agent (on consignment) or a custodian (deposit); derived from the provenance (063).');
UPDATE relationship_types SET derived = true,
  description = 'Who ordered the work — derived from the provenance: its first step with the method "commission" (063).'
WHERE code = 'commissioned';

CREATE OR REPLACE VIEW provenance_periods AS
WITH s AS (
         SELECT p.id,
            p.artwork_id,
            p."position",
            p.owner_artist_id,
            p.owner_person_id,
            p.owner_institution_id,
            p.owner_place_id,
            p.owner_label,
            p.acquired,
            p.acquired_label,
            p.ended,
            p.ended_label,
            p.method,
            p.direct,
            p.location_id,
            p.label,
            p.certainty,
            p.notes_md,
            p.metadata,
            p.created_at,
            p.updated_at,
            p.role,
            p.price,
            p.price_currency,
            p.price_note,
            (
                CASE
                    WHEN (p.owner_artist_id IS NOT NULL) THEN 'artist'::text
                    WHEN (p.owner_person_id IS NOT NULL) THEN 'person'::text
                    WHEN (p.owner_institution_id IS NOT NULL) THEN 'institution'::text
                    WHEN (p.owner_place_id IS NOT NULL) THEN 'place'::text
                    ELSE NULL::text
                END)::entity_type AS owner_type,
            COALESCE(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id) AS owner_id,
            lead(p.acquired) OVER w AS next_acquired,
            lead(p.acquired_label) OVER w AS next_label,
            lag(p.owner_artist_id, 1) OVER w AS prev_artist,
            lag(p.owner_person_id) OVER w AS prev_person,
            lag(p.owner_institution_id) OVER w AS prev_institution,
            lag(p.owner_place_id) OVER w AS prev_place,
            COALESCE(lag(p.ended) OVER w, lag(p.acquired) OVER w) AS prev_holding,
            first_value(p."position") OVER w AS first_position,
            (lead(p.id) OVER w IS NULL) AS is_last
           FROM provenance p
          WINDOW w AS (PARTITION BY p.artwork_id ORDER BY p."position")
        ), b AS (
         SELECT s.id,
            s.artwork_id,
            s."position",
            s.owner_artist_id,
            s.owner_person_id,
            s.owner_institution_id,
            s.owner_place_id,
            s.owner_label,
            s.acquired,
            s.acquired_label,
            s.ended,
            s.ended_label,
            s.method,
            s.direct,
            s.location_id,
            s.label,
            s.certainty,
            s.notes_md,
            s.metadata,
            s.created_at,
            s.updated_at,
            s.role,
            s.price,
            s.price_currency,
            s.price_note,
            s.owner_type,
            s.owner_id,
            s.next_acquired,
            s.next_label,
            s.prev_artist,
            s.prev_person,
            s.prev_institution,
            s.prev_place,
            s.prev_holding,
            s.first_position,
            s.is_last,
                CASE
                    WHEN (s.ended IS NOT NULL) THEN 'recorded'::text
                    WHEN (s.next_acquired IS NOT NULL) THEN 'implied'::text
                    WHEN (s.is_last AND ((s.owner_institution_id = w.current_institution_id) OR (w.on_loan AND (w.current_institution_id IS NOT NULL)))) THEN 'ongoing'::text
                    ELSE 'unknown'::text
                END AS end_basis,
            (
                CASE
                    WHEN (s.prev_artist IS NOT NULL) THEN 'artist'::text
                    WHEN (s.prev_person IS NOT NULL) THEN 'person'::text
                    WHEN (s.prev_institution IS NOT NULL) THEN 'institution'::text
                    WHEN (s.prev_place IS NOT NULL) THEN 'place'::text
                    ELSE NULL::text
                END)::entity_type AS prev_owner_type,
            COALESCE(s.prev_artist, s.prev_person, s.prev_institution, s.prev_place) AS prev_owner_id
           FROM (s
             JOIN artworks w ON ((w.id = s.artwork_id)))
        )
 SELECT b.id,
    b.artwork_id,
    b."position",
    b.first_position,
    b.is_last,
    b.owner_type,
    b.owner_id,
    b.owner_institution_id,
    COALESCE((o.name || COALESCE(((' ('::text || b.owner_label) || ')'::text), ''::text)), b.owner_label) AS owner_name,
    b.prev_owner_type,
    b.prev_owner_id,
    b.prev_holding,
    b.acquired,
    b.acquired_label,
    b.ended,
    b.ended_label,
    b.method,
    b.direct,
    b.location_id,
    b.label,
    b.certainty,
    b.notes_md,
    b.end_basis,
        CASE
            WHEN (b.acquired IS NULL) THEN NULL::daterange
            WHEN (b.end_basis = 'recorded'::text) THEN daterange(lower(b.acquired), GREATEST(upper(b.ended), upper(b.acquired)))
            WHEN (b.end_basis = 'implied'::text) THEN daterange(lower(b.acquired), GREATEST(upper(b.next_acquired), upper(b.acquired)))
            WHEN (b.end_basis = 'ongoing'::text) THEN daterange(lower(b.acquired), NULL::date)
            ELSE b.acquired
        END AS period,
        CASE
            WHEN (b.acquired IS NULL) THEN NULL::text
            WHEN ((b.end_basis = 'recorded'::text) AND (b.ended_label IS DISTINCT FROM b.acquired_label)) THEN ((b.acquired_label ||
            CASE
                WHEN ((b.acquired_label || b.ended_label) ~ '[–-]'::text) THEN ' – '::text
                ELSE '–'::text
            END) || b.ended_label)
            WHEN ((b.end_basis = 'implied'::text) AND (b.next_label IS DISTINCT FROM b.acquired_label)) THEN ((b.acquired_label ||
            CASE
                WHEN ((b.acquired_label || b.next_label) ~ '[–-]'::text) THEN ' – '::text
                ELSE '–'::text
            END) || b.next_label)
            WHEN (b.end_basis = 'ongoing'::text) THEN ('since '::text || b.acquired_label)
            WHEN (b.end_basis = 'unknown'::text) THEN ('from '::text || b.acquired_label)
            ELSE b.acquired_label
        END AS period_label,
    b.owner_label,
    b.metadata,
    b.role,
    b.price,
    b.price_currency,
    b.price_note
   FROM (b
     LEFT JOIN entity_index o ON (((o.type = b.owner_type) AND (o.id = b.owner_id))));

CREATE OR REPLACE VIEW edges AS
SELECT r.id,
    r.subject_type,
    r.subject_id,
    r.relationship_type,
    r.object_type,
    r.object_id,
    r.period,
    r.period_label,
    r.label,
    r.certainty,
    r.notes_md,
    'relationship'::text AS source,
    NULL::text AS end_basis,
    NULL::bigint AS provenance_id
   FROM relationships r
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    w.id AS subject_id,
    'creator'::text AS relationship_type,
    'artist'::entity_type AS object_type,
    w.creator_id AS object_id,
    NULL::daterange AS period,
    NULL::text AS period_label,
    NULL::text AS label,
    'attested'::certainty AS certainty,
    NULL::text AS notes_md,
    'creator'::text AS source,
    NULL::text AS end_basis,
    NULL::bigint AS provenance_id
   FROM artworks w
  WHERE (w.creator_id IS NOT NULL)
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    p.artwork_id AS subject_id,
    'owned_by'::text AS relationship_type,
    p.owner_type AS object_type,
    p.owner_id AS object_id,
    p.period,
    p.period_label,
    concat_ws(' · '::text, NULLIF(replace((p.method)::text, '_'::text, ' '::text), 'unknown'::text), p.label) AS label,
    p.certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    p.end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE ((p.owner_id IS NOT NULL) AND (p.role <> ALL (ARRAY['agent'::holder_role, 'custodian'::holder_role])))
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    p.artwork_id AS subject_id,
    'kept_in'::text AS relationship_type,
    'place'::entity_type AS object_type,
    p.location_id AS object_id,
    p.period,
    p.period_label,
    p.owner_name AS label,
    p.certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    p.end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE (p.location_id IS NOT NULL)
UNION ALL
 SELECT NULL::bigint AS id,
    p.prev_owner_type AS subject_type,
    p.prev_owner_id AS subject_id,
    'transferred_to'::text AS relationship_type,
    p.owner_type AS object_type,
    p.owner_id AS object_id,
    p.acquired AS period,
    p.acquired_label AS period_label,
    NULLIF(replace((p.method)::text, '_'::text, ' '::text), 'unknown'::text) AS label,
        CASE
            WHEN p.direct THEN p.certainty
            ELSE 'possible'::certainty
        END AS certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    NULL::text AS end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE ((p.owner_id IS NOT NULL) AND (p.prev_owner_id IS NOT NULL) AND ((p.owner_type IS DISTINCT FROM p.prev_owner_type) OR (p.owner_id IS DISTINCT FROM p.prev_owner_id)))
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    p.artwork_id AS subject_id,
    'owned_by'::text AS relationship_type,
    c.owner_type AS object_type,
    c.owner_id AS object_id,
    p.period,
    p.period_label,
    concat_ws(' · '::text, NULLIF(replace((p.method)::text, '_'::text, ' '::text), 'unknown'::text), 'jointly', p.label) AS label,
    p.certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    p.end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
     JOIN provenance_co_owners_x c ON c.provenance_id = p.id
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    p.artwork_id AS subject_id,
    'held_by'::text AS relationship_type,
    p.owner_type AS object_type,
    p.owner_id AS object_id,
    p.period,
    p.period_label,
    concat_ws(' · '::text, p.role::text, p.label) AS label,
    p.certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    p.end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE ((p.owner_id IS NOT NULL) AND (p.role = ANY (ARRAY['agent'::holder_role, 'custodian'::holder_role])))
UNION ALL
 SELECT NULL::bigint AS id,
    p.owner_type AS subject_type,
    p.owner_id AS subject_id,
    'commissioned'::text AS relationship_type,
    'artwork'::entity_type AS object_type,
    p.artwork_id AS object_id,
    p.acquired AS period,
    p.acquired_label AS period_label,
    p.label,
    p.certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    NULL::text AS end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE ((p.owner_id IS NOT NULL) AND (p.method = 'commission'::acquisition_method));

-- The chain as it is read (see the top): implied first and last lines around the recorded steps.
CREATE OR REPLACE VIEW provenance_chain AS
WITH first AS (
  SELECT DISTINCT ON (p.artwork_id) p.artwork_id, p.method, p.owner_artist_id, p.acquired, p.acquired_label, p.direct
  FROM provenance p ORDER BY p.artwork_id, p.position
)
SELECT 'creation'::text AS kind, NULL::bigint AS id, w.id AS artwork_id, -1 AS position,
       'artist'::entity_type AS owner_type, w.creator_id AS owner_id, a.name AS owner_name, NULL::text AS owner_label,
       'owner'::holder_role AS role, w.created AS acquired, w.created_label AS acquired_label, NULL::daterange AS ended, NULL::text AS ended_label,
       'creation'::acquisition_method AS method, true AS direct, NULL::bigint AS location_id, NULL::text AS label,
       'attested'::certainty AS certainty, NULL::text AS notes_md,
       CASE WHEN w.created IS NULL THEN NULL
            WHEN f.acquired IS NOT NULL AND f.direct THEN daterange(lower(w.created), greatest(upper(f.acquired), upper(w.created)))
            ELSE w.created END AS period,
       -- (spaced when either side is itself a span: "1901 – 1901–28 October 1904", as provenance_periods writes it)
       CASE WHEN f.direct AND f.acquired_label IS NOT NULL AND w.created_label IS NOT NULL
            THEN w.created_label || CASE WHEN (w.created_label || f.acquired_label) ~ '[–-]' THEN ' – ' ELSE '–' END || f.acquired_label
            ELSE w.created_label END AS period_label,
       -- until the first owner's acquisition only when it came straight from the artist; else a gap: end unknown
       CASE WHEN f.acquired IS NOT NULL AND f.direct THEN 'implied' ELSE 'unknown' END AS end_basis,
       NULL::numeric AS price, NULL::text AS price_currency, NULL::text AS price_note
FROM artworks w JOIN artists a ON a.id = w.creator_id LEFT JOIN first f ON f.artwork_id = w.id
WHERE f.artwork_id IS NULL OR (f.method NOT IN ('creation', 'commission') AND f.owner_artist_id IS DISTINCT FROM w.creator_id)
UNION ALL
SELECT 'step', p.id, p.artwork_id, p.position, p.owner_type, p.owner_id, p.owner_name, p.owner_label, p.role,
       p.acquired, p.acquired_label, p.ended, p.ended_label, p.method, p.direct, p.location_id, p.label, p.certainty, p.notes_md,
       p.period, p.period_label, p.end_basis, p.price, p.price_currency, p.price_note
FROM provenance_periods p
UNION ALL
SELECT 'loan', NULL, w.id, 1000000, 'institution', i.id, i.name, NULL, 'custodian',
       w.on_loan_since, w.on_loan_since_label, NULL, NULL, 'unknown', false, i.place_id, 'on loan', 'attested', NULL,
       CASE WHEN w.on_loan_since IS NOT NULL THEN daterange(lower(w.on_loan_since), NULL) END,
       CASE WHEN w.on_loan_since_label IS NOT NULL THEN 'since ' || w.on_loan_since_label END,
       'ongoing', NULL, NULL, NULL
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
WHERE w.on_loan;

REVOKE INSERT, UPDATE, DELETE ON provenance_co_owners_x, provenance_chain FROM arthistory_admin;
