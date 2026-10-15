-- 074 — Provenance as the Kunsthaus Zürich's Gauguin works showed it is (owner's review, 2026-10-15):
--  1. custody is not ownership: deposits, loans, consignments and auctions (roles custodian, agent) run ALONGSIDE an
--     ownership. The implied end of an owner's period and the previous owner of a handover now come from the next /
--     previous step of the CHAIN (owner, dealer, estate) — Berthier's ownership no longer ends the day he deposits
--     L'Offrande with Vollard, and Wisselingh (safekeeping for Alfred Gold) is no longer a link between Gold and the
--     next owner. New columns of provenance_periods: in_chain, not_sold, via.
--  2. an auction or consignment that didn't sell: provenance.not_sold (bought in, withdrawn, returned). A handover
--     names the agents it went through ("via Galerie Moos"); the unsold ones aren't among them.
--  3. the 1933–1945 check covers every handover not documented as direct, dated or not: view provenance_gaps gives the
--     span in which it may have happened — after the latest date known before it (the creation for the first owner),
--     before the earliest acquisition known after it.
--  4. settlement (073) answers a forced sale like a restitution.
--  5. artworks.provenance_status: the categories of the Swiss Federal Office of Culture (BAK) for 1933–1945, A–D, with
--     a note for the source's own wording.
--  6. artworks.conceived: when the design, block or model was made (a print pulled or a bronze cast later, after the
--     artist's death); the creator-life check uses it. Relationship copy_after: artwork → the work it copies.

ALTER TABLE provenance ADD COLUMN not_sold boolean NOT NULL DEFAULT false;
ALTER TABLE provenance ADD CONSTRAINT provenance_not_sold_agent CHECK (NOT not_sold OR role = 'agent');
COMMENT ON COLUMN provenance.not_sold IS 'an agent step (auction, consignment) that ended without a sale — bought in, withdrawn, returned';

CREATE TYPE provenance_status AS ENUM ('a_clear', 'b_no_indications', 'c_indications', 'd_seized');
COMMENT ON TYPE provenance_status IS 'BAK categories 1933–1945: A clear, no looted art · B gaps, no indications · C gaps, indications · D looted / seized as a result of Nazi persecution';
ALTER TABLE artworks ADD COLUMN provenance_status provenance_status,
                     ADD COLUMN provenance_status_note text CHECK (btrim(provenance_status_note) <> ''),
                     ADD COLUMN conceived daterange, ADD COLUMN conceived_label text;
INSERT INTO citable_fields (entity_type, field, cols, position)
SELECT 'artwork', v.field, v.cols, (SELECT max(position) FROM citable_fields WHERE entity_type = 'artwork') + v.n
FROM (VALUES ('conceived', '{conceived,conceived_label}'::text[], 1), ('provenance_status', '{provenance_status,provenance_status_note}', 2)) v(field, cols, n);

INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, description, sort_order, derived)
VALUES ('copy_after', 'copy after', 'copied in', 'influence', false, false, '{artwork}', '{artwork}',
        'The artwork copies another one (a copy, a replica by another hand, a version "after" a print).', 91, false);

CREATE OR REPLACE VIEW provenance_periods AS
WITH s AS (
  SELECT p.*,
         (CASE WHEN p.owner_artist_id IS NOT NULL THEN 'artist' WHEN p.owner_person_id IS NOT NULL THEN 'person'
               WHEN p.owner_institution_id IS NOT NULL THEN 'institution' WHEN p.owner_place_id IS NOT NULL THEN 'place' END)::entity_type AS owner_type,
         coalesce(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id) AS owner_id,
         p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AS in_chain,
         nx.acquired AS next_acquired, nx.acquired_label AS next_label,
         pv.owner_artist_id AS prev_artist, pv.owner_person_id AS prev_person, pv.owner_institution_id AS prev_institution, pv.owner_place_id AS prev_place,
         coalesce(pv.ended, pv.acquired) AS prev_holding,
         first_value(p."position") OVER w AS first_position,
         (p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AND nx.id IS NULL) AS is_last,
         via.names AS via
  FROM provenance p
  -- the next and the previous step OF THE CHAIN: who owned it (owner, dealer, estate). Deposits, loans, consignments
  -- and auctions (custodian, agent) happen alongside an ownership — they neither end it nor stand in for an owner.
  -- LATERAL: a subquery that may use the row it stands beside (p) — "the first chain step after this one".
  LEFT JOIN LATERAL (SELECT n.id, n.acquired, n.acquired_label FROM provenance n
                     WHERE n.artwork_id = p.artwork_id AND n."position" > p."position" AND n.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role)
                     ORDER BY n."position" LIMIT 1) nx ON true
  LEFT JOIN LATERAL (SELECT q."position", q.owner_artist_id, q.owner_person_id, q.owner_institution_id, q.owner_place_id, q.acquired, q.ended
                     FROM provenance q
                     WHERE q.artwork_id = p.artwork_id AND q."position" < p."position" AND q.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role)
                     ORDER BY q."position" DESC LIMIT 1) pv ON true
  -- the agents between the previous owner and this one through whom it was sold (an auction, a consignment) — not
  -- those that didn't sell it
  LEFT JOIN LATERAL (SELECT string_agg(coalesce(e.name, a.owner_label), ', ' ORDER BY a."position") AS names
                     FROM provenance a
                     LEFT JOIN entity_index e ON (e.type, e.id) = ((CASE WHEN a.owner_artist_id IS NOT NULL THEN 'artist' WHEN a.owner_person_id IS NOT NULL THEN 'person'
                       WHEN a.owner_institution_id IS NOT NULL THEN 'institution' WHEN a.owner_place_id IS NOT NULL THEN 'place' END)::entity_type,
                       coalesce(a.owner_artist_id, a.owner_person_id, a.owner_institution_id, a.owner_place_id))
                     WHERE p.role IN ('owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role) AND a.artwork_id = p.artwork_id AND a.role = 'agent' AND NOT a.not_sold
                       AND a."position" < p."position" AND a."position" > coalesce(pv."position", -1)) via ON true
  WINDOW w AS (PARTITION BY p.artwork_id ORDER BY p."position")
), b AS (
  SELECT s.*,
         CASE WHEN s.ended IS NOT NULL THEN 'recorded'
              WHEN s.next_acquired IS NOT NULL THEN 'implied'
              WHEN s.is_last AND (s.owner_institution_id = w.current_institution_id OR (w.on_loan AND w.current_institution_id IS NOT NULL)) THEN 'ongoing'
              ELSE 'unknown' END AS end_basis,
         (CASE WHEN s.prev_artist IS NOT NULL THEN 'artist' WHEN s.prev_person IS NOT NULL THEN 'person'
               WHEN s.prev_institution IS NOT NULL THEN 'institution' WHEN s.prev_place IS NOT NULL THEN 'place' END)::entity_type AS prev_owner_type,
         coalesce(s.prev_artist, s.prev_person, s.prev_institution, s.prev_place) AS prev_owner_id
  FROM s JOIN artworks w ON w.id = s.artwork_id
)
SELECT b.id, b.artwork_id, b."position", b.first_position, b.is_last, b.owner_type, b.owner_id, b.owner_institution_id,
       coalesce(o.name || coalesce(' (' || b.owner_label || ')', ''), b.owner_label) AS owner_name,
       b.prev_owner_type, b.prev_owner_id, b.prev_holding, b.acquired, b.acquired_label, b.ended, b.ended_label, b.method, b.direct,
       b.location_id, b.label, b.certainty, b.notes_md, b.end_basis,
       CASE WHEN b.acquired IS NULL AND b.ended IS NOT NULL THEN daterange(NULL::date, upper(b.ended))
            WHEN b.acquired IS NULL THEN NULL::daterange
            WHEN b.end_basis = 'recorded' THEN daterange(lower(b.acquired), greatest(upper(b.ended), upper(b.acquired)))
            WHEN b.end_basis = 'implied' THEN daterange(lower(b.acquired), greatest(upper(b.next_acquired), upper(b.acquired)))
            WHEN b.end_basis = 'ongoing' THEN daterange(lower(b.acquired), NULL::date)
            ELSE b.acquired END AS period,
       CASE WHEN b.acquired IS NULL AND b.ended_label IS NOT NULL THEN 'until ' || b.ended_label
            WHEN b.acquired IS NULL THEN NULL
            WHEN b.end_basis = 'recorded' AND b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$' THEN 'until ' || b.ended_label
            WHEN b.end_basis = 'implied' AND b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$' THEN 'until ' || b.next_label
            WHEN b.end_basis = 'recorded' AND b.ended_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN (b.acquired_label || b.ended_label) ~ '[–-]' THEN ' – ' ELSE '–' END || b.ended_label
            WHEN b.end_basis = 'implied' AND b.next_label IS DISTINCT FROM b.acquired_label
              THEN b.acquired_label || CASE WHEN (b.acquired_label || b.next_label) ~ '[–-]' THEN ' – ' ELSE '–' END || b.next_label
            WHEN b.end_basis = 'ongoing' THEN 'since ' || b.acquired_label
            WHEN b.end_basis = 'unknown' THEN 'from ' || b.acquired_label
            ELSE b.acquired_label END AS period_label,
       b.owner_label, b.metadata, b.role, b.price, b.price_currency, b.price_note,
       b.in_chain, b.not_sold, b.via
FROM b LEFT JOIN entity_index o ON o.type = b.owner_type AND o.id = b.owner_id;

-- The span in which each handover of the chain may have happened, for the 1933–1945 check. Window aggregates over the
-- artwork's steps in order: the latest known date before (max of the earlier steps' acquisition and end; the creation
-- for the first owner) and the earliest acquisition known from here on (min of upper bounds: "by 1947" counts as 1947).
CREATE VIEW provenance_gaps AS
SELECT x.id, x.artwork_id, x."position", x.owner_name, x.acquired_label, x.direct,
       greatest(x.known_before, lower(w.created)) AS gap_from, x.known_after AS gap_to
FROM (
  SELECT p.*,
         max(greatest(lower(p.acquired), lower(p.ended))) OVER (PARTITION BY p.artwork_id ORDER BY p."position" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS known_before,
         min(upper(p.acquired)) OVER (PARTITION BY p.artwork_id ORDER BY p."position" ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS known_after
  FROM provenance_periods p
) x JOIN artworks w ON w.id = x.artwork_id
WHERE x.in_chain;

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
    NULLIF(concat_ws(' · '::text, NULLIF(replace((p.method)::text, '_'::text, ' '::text), 'unknown'::text), 'via '::text || p.via), ''::text) AS label,
        CASE
            WHEN p.direct THEN p.certainty
            ELSE 'possible'::certainty
        END AS certainty,
    NULL::text AS notes_md,
    'provenance'::text AS source,
    NULL::text AS end_basis,
    p.id AS provenance_id
   FROM provenance_periods p
  WHERE ((p.owner_id IS NOT NULL) AND p.in_chain AND (p.prev_owner_id IS NOT NULL) AND ((p.owner_type IS DISTINCT FROM p.prev_owner_type) OR (p.owner_id IS DISTINCT FROM p.prev_owner_id)))
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
   FROM (provenance_periods p
     JOIN provenance_co_owners_x c ON ((c.provenance_id = p.id)))
UNION ALL
 SELECT NULL::bigint AS id,
    'artwork'::entity_type AS subject_type,
    p.artwork_id AS subject_id,
    'held_by'::text AS relationship_type,
    p.owner_type AS object_type,
    p.owner_id AS object_id,
    p.period,
    p.period_label,
    concat_ws(' · '::text, (p.role)::text, CASE WHEN p.not_sold THEN 'not sold'::text END, p.label) AS label,
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

CREATE OR REPLACE VIEW provenance_chain AS
WITH first AS (
         SELECT DISTINCT ON (p.artwork_id) p.artwork_id,
            p.method,
            p.owner_artist_id,
            p.acquired,
            p.acquired_label,
            p.direct
           FROM provenance p
          ORDER BY p.artwork_id, p."position"
        )
 SELECT 'creation'::text AS kind,
    NULL::bigint AS id,
    w.id AS artwork_id,
    '-1'::integer AS "position",
    'artist'::entity_type AS owner_type,
    w.creator_id AS owner_id,
    a.name AS owner_name,
    NULL::text AS owner_label,
    'owner'::holder_role AS role,
    w.created AS acquired,
    w.created_label AS acquired_label,
    NULL::daterange AS ended,
    NULL::text AS ended_label,
    'creation'::acquisition_method AS method,
    true AS direct,
    NULL::bigint AS location_id,
    NULL::text AS label,
    'attested'::certainty AS certainty,
    NULL::text AS notes_md,
        CASE
            WHEN (w.created IS NULL) THEN NULL::daterange
            WHEN ((f.acquired IS NOT NULL) AND f.direct) THEN daterange(lower(w.created), GREATEST(upper(f.acquired), upper(w.created)))
            ELSE w.created
        END AS period,
        CASE
            WHEN (f.direct AND (f.acquired_label IS NOT NULL) AND (w.created_label IS NOT NULL) AND (f.acquired_label ~ '^between .* and '::text)) THEN ((w.created_label || ' – by '::text) || regexp_replace(f.acquired_label, '^between .* and '::text, ''::text))
            WHEN (f.direct AND (f.acquired_label IS NOT NULL) AND (w.created_label IS NOT NULL)) THEN ((w.created_label ||
            CASE
                WHEN ((w.created_label || f.acquired_label) ~ '[–-]'::text) THEN ' – '::text
                ELSE '–'::text
            END) || f.acquired_label)
            ELSE w.created_label
        END AS period_label,
        CASE
            WHEN ((f.acquired IS NOT NULL) AND f.direct) THEN 'implied'::text
            ELSE 'unknown'::text
        END AS end_basis,
    NULL::numeric AS price,
    NULL::text AS price_currency,
    NULL::text AS price_note,
    true AS in_chain,
    false AS not_sold,
    NULL::text AS via
   FROM ((artworks w
     JOIN artists a ON ((a.id = w.creator_id)))
     LEFT JOIN first f ON ((f.artwork_id = w.id)))
  WHERE ((f.artwork_id IS NULL) OR ((f.method <> ALL (ARRAY['creation'::acquisition_method, 'commission'::acquisition_method])) AND (f.owner_artist_id IS DISTINCT FROM w.creator_id)))
UNION ALL
 SELECT 'step'::text AS kind,
    p.id,
    p.artwork_id,
    p."position",
    p.owner_type,
    p.owner_id,
    p.owner_name,
    p.owner_label,
    p.role,
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
    p.period,
    p.period_label,
    p.end_basis,
    p.price,
    p.price_currency,
    p.price_note,
    p.in_chain,
    p.not_sold,
    p.via
   FROM provenance_periods p
UNION ALL
 SELECT 'loan'::text AS kind,
    NULL::bigint AS id,
    w.id AS artwork_id,
    1000000 AS "position",
    'institution'::entity_type AS owner_type,
    i.id AS owner_id,
    i.name AS owner_name,
    NULL::text AS owner_label,
    'custodian'::holder_role AS role,
    w.on_loan_since AS acquired,
    w.on_loan_since_label AS acquired_label,
    NULL::daterange AS ended,
    NULL::text AS ended_label,
    'unknown'::acquisition_method AS method,
    false AS direct,
    i.place_id AS location_id,
    'on loan'::text AS label,
    'attested'::certainty AS certainty,
    NULL::text AS notes_md,
        CASE
            WHEN (w.on_loan_since IS NOT NULL) THEN daterange(lower(w.on_loan_since), NULL::date)
            ELSE NULL::daterange
        END AS period,
        CASE
            WHEN (w.on_loan_since_label IS NOT NULL) THEN ('since '::text || w.on_loan_since_label)
            ELSE NULL::text
        END AS period_label,
    'ongoing'::text AS end_basis,
    NULL::numeric AS price,
    NULL::text AS price_currency,
    NULL::text AS price_note,
    false AS in_chain,
    false AS not_sold,
    NULL::text AS via
   FROM (artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
  WHERE w.on_loan;

-- the checks (058: change THIS view)
CREATE OR REPLACE VIEW quality_issues_live AS
WITH rel AS (
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
            r.metadata,
            r.created_at,
            r.updated_at,
            rt.label AS type_label,
            rt.is_physical_presence,
            o.name AS object_name,
            COALESCE(r.period_label, (range_json(r.period) ->> 'from_year'::text)) AS when_text
           FROM ((relationships r
             JOIN relationship_types rt ON ((rt.code = r.relationship_type)))
             JOIN entity_index o ON (((o.type = r.object_type) AND (o.id = r.object_id))))
        )
 SELECT 'presence_outside_lifespan'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s (%s) lies outside the lifespan'::text, r.type_label, r.object_name, r.when_text) AS detail
   FROM (rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
  WHERE (r.is_physical_presence AND (r.period IS NOT NULL) AND (a.birth IS NOT NULL) AND (NOT (r.period && a.lifespan)))
UNION ALL
 SELECT 'birth_death_mismatch'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s is dated %s, the %s %s'::text, r.type_label, r.object_name, r.when_text,
        CASE r.relationship_type
            WHEN 'born_in'::text THEN 'birth'::text
            ELSE 'death'::text
        END,
        CASE r.relationship_type
            WHEN 'born_in'::text THEN a.birth_label
            ELSE a.death_label
        END) AS detail
   FROM (rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
  WHERE ((r.period IS NOT NULL) AND (((r.relationship_type = 'born_in'::text) AND (a.birth IS NOT NULL) AND (NOT (r.period && a.birth))) OR ((r.relationship_type = 'died_in'::text) AND (a.death IS NOT NULL) AND (NOT (r.period && a.death)))))
UNION ALL
 SELECT 'artwork_outside_creator_life'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    format('%s %s, but %s %s %s'::text, CASE WHEN w.conceived IS NOT NULL THEN 'designed' ELSE 'created' END, COALESCE(w.conceived_label, w.created_label), a.name,
        CASE
            WHEN (COALESCE(w.conceived, w.created) >> a.death) THEN 'died'::text
            ELSE 'was born'::text
        END,
        CASE
            WHEN (COALESCE(w.conceived, w.created) >> a.death) THEN a.death_label
            ELSE a.birth_label
        END) AS detail
   FROM (artworks w
     JOIN artists a ON ((a.id = w.creator_id)))
  WHERE ((COALESCE(w.conceived, w.created) IS NOT NULL) AND (((a.death IS NOT NULL) AND (COALESCE(w.conceived, w.created) >> a.death)) OR ((a.birth IS NOT NULL) AND (COALESCE(w.conceived, w.created) << a.birth))))
UNION ALL
 SELECT 'never_alive_together'::text AS check_id,
    'error'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s, but their lifespans do not overlap'::text, r.type_label, r.object_name) AS detail
   FROM ((rel r
     JOIN artists a ON (((r.subject_type = 'artist'::entity_type) AND (a.id = r.subject_id))))
     JOIN artists b ON (((r.object_type = 'artist'::entity_type) AND (b.id = r.object_id))))
  WHERE ((r.relationship_type = ANY (ARRAY['student_of'::text, 'collaborated_with'::text, 'contemporary_of'::text])) AND (a.birth IS NOT NULL) AND (b.birth IS NOT NULL) AND (NOT (a.lifespan && b.lifespan)))
UNION ALL
 SELECT 'inventory_without_institution'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    format('inventory number %s, but no institution'::text, w.inventory_number) AS detail
   FROM artworks w
  WHERE ((w.inventory_number IS NOT NULL) AND (w.current_institution_id IS NULL))
UNION ALL
 SELECT 'outside_polity_period'::text AS check_id,
    'error'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s (%s) lies outside the existence of %s (%s)'::text, r.type_label, r.object_name, r.when_text, r.object_name, COALESCE(p.period_label, concat_ws('–'::text, (range_json(p.period) ->> 'from_year'::text), (range_json(p.period) ->> 'to_year'::text)))) AS detail
   FROM (rel r
     JOIN polities p ON (((r.object_type = 'polity'::entity_type) AND (p.id = r.object_id))))
  WHERE ((r.period IS NOT NULL) AND (p.period IS NOT NULL) AND (NOT (r.period && p.period)))
UNION ALL
 SELECT 'broken_glossary_link'::text AS check_id,
    'warning'::text AS severity,
    l.entity_type,
    l.entity_id,
    ((((('gl:'::text || l.entity_type) || ':'::text) || l.entity_id) || ':'::text) || l.term_slug) AS issue_key,
    format('links to the glossary term "%s", which doesn''t exist'::text, l.term_slug) AS detail
   FROM glossary_links l
  WHERE (NOT (EXISTS ( SELECT 1
           FROM glossary g
          WHERE (g.slug = l.term_slug))))
UNION ALL
 SELECT 'provenance_gap_1933_1945'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    g.artwork_id AS entity_id,
    ('prov-gap:'::text || g.id) AS issue_key,
    format(CASE WHEN g.n = 1 THEN '%1$s: the change of owner (%2$s) is not documented as direct — it may have happened %3$s'
                ELSE 'the changes of owner to %1$s are undated or not documented as direct — who held it %3$s?' END,
      g.names, CASE WHEN g.n = 1 THEN COALESCE(g.acquired_label, 'undated') ELSE NULL END,
      CASE WHEN g.gap_from IS NULL AND g.gap_to IS NULL THEN 'at any time'
           WHEN g.gap_from IS NULL THEN 'before ' || extract(year FROM g.gap_to - 1)
           WHEN g.gap_to IS NULL THEN 'after ' || extract(year FROM g.gap_from)
           WHEN extract(year FROM g.gap_from) = extract(year FROM g.gap_to - 1) THEN 'in ' || extract(year FROM g.gap_from)
           ELSE 'between ' || extract(year FROM g.gap_from) || ' and ' || extract(year FROM g.gap_to - 1) END) AS detail
   -- one finding per stretch of time: several undated owners in a row share it (who of them held it in 1933–1945?)
   FROM (SELECT artwork_id, gap_from, gap_to, min(id) AS id, count(*) AS n,
                string_agg(owner_name, ', ' ORDER BY "position") AS names, min(acquired_label) AS acquired_label
         FROM provenance_gaps WHERE NOT direct GROUP BY artwork_id, gap_from, gap_to) g
  -- CASE: the range only when its bounds are in order (dates contradicting the order of the steps: no span) — a WHERE
  -- filter would not do, the planner may evaluate conditions in any order
  WHERE CASE WHEN g.gap_from IS NULL OR g.gap_to IS NULL OR g.gap_from < g.gap_to
             THEN daterange(g.gap_from, g.gap_to) && daterange('1933-01-30'::date, '1945-05-09'::date) ELSE false END
UNION ALL
 SELECT 'provenance_forced_transfer'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-forced:'::text || p.id) AS issue_key,
    format('%s: %s (%s) — no later restitution recorded'::text, p.owner_name, replace((p.method)::text, '_'::text, ' '::text), COALESCE(p.acquired_label, 'undated'::text)) AS detail
   FROM provenance_periods p
  WHERE ((p.method = ANY (ARRAY['confiscation'::acquisition_method, 'forced_sale'::acquisition_method])) AND (NOT (EXISTS ( SELECT 1
           FROM provenance r
          WHERE ((r.artwork_id = p.artwork_id) AND (r."position" > p."position") AND (r.method = ANY (ARRAY['restitution'::acquisition_method, 'settlement'::acquisition_method])))))))
UNION ALL
 SELECT 'provenance_last_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('prov-last:'::text || w.id) AS issue_key,
    format('the provenance ends with %s, but the work is at %s'::text, p.owner_name, i.name) AS detail
   FROM ((artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
     JOIN provenance_periods p ON (((p.artwork_id = w.id) AND p.is_last)))
  WHERE ((p.owner_institution_id IS DISTINCT FROM w.current_institution_id) AND (NOT w.on_loan))
UNION ALL
 SELECT 'loan_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('loan:'::text || w.id) AS issue_key,
        CASE
            WHEN (p.artwork_id IS NULL) THEN format('on loan at %s — but the provenance names no owner (the lender)'::text, i.name)
            ELSE format('on loan at %s — but the provenance ends with %s itself'::text, i.name, i.name)
        END AS detail
   FROM ((artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
     LEFT JOIN provenance_periods p ON (((p.artwork_id = w.id) AND p.is_last)))
  WHERE (w.on_loan AND ((p.artwork_id IS NULL) OR (p.owner_institution_id = w.current_institution_id)))
UNION ALL
 SELECT 'broken_link'::text AS check_id,
    'warning'::text AS severity,
    l.entity_type,
    l.entity_id,
    ((((((('link:'::text || l.entity_type) || ':'::text) || l.entity_id) || ':'::text) || l.target_type) || '/'::text) || l.target_slug) AS issue_key,
    format('links to %s/%s, which doesn''t exist'::text, l.target_type, l.target_slug) AS detail
   FROM content_links l
  WHERE ((l.target_type <> 'term'::text) AND (NOT (EXISTS ( SELECT 1
           FROM entity_index e
          WHERE (((e.type)::text = l.target_type) AND (e.slug = l.target_slug))))))
UNION ALL
 SELECT 'overlapping_residences'::text AS check_id,
    'warning'::text AS severity,
    r1.subject_type AS entity_type,
    r1.subject_id AS entity_id,
    ((('rel:'::text || r1.id) || ':'::text) || r2.id) AS issue_key,
    format('lived in %s (%s) and %s (%s) at the same time'::text, r1.object_name, r1.when_text, r2.object_name, r2.when_text) AS detail
   FROM (((rel r1
     JOIN rel r2 ON (((r2.subject_type = r1.subject_type) AND (r2.subject_id = r1.subject_id) AND (r2.id > r1.id))))
     CROSS JOIN LATERAL ( SELECT (r1.period * r2.period) AS i) x)
     CROSS JOIN LATERAL ( SELECT (COALESCE(upper(x.i), (lower(x.i) + 36500)) - lower(x.i)) AS days,
            LEAST((COALESCE(upper(r1.period), (lower(r1.period) + 36500)) - lower(r1.period)), (COALESCE(upper(r2.period), (lower(r2.period) + 36500)) - lower(r2.period))) AS shorter) d)
  WHERE ((r1.relationship_type = 'lived_in'::text) AND (r2.relationship_type = 'lived_in'::text) AND (r1.object_id <> r2.object_id) AND (r1.period && r2.period) AND (d.days > 31) AND ((d.days > 366) OR (r1.period @> r2.period) OR (r2.period @> r1.period) OR ((d.days * 2) > d.shorter)))
UNION ALL
 SELECT 'held_before_founded'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('housed at %s (%s), founded %s'::text, r.object_name, r.when_text, i.founded_label) AS detail
   FROM (rel r
     JOIN institutions i ON (((r.object_type = 'institution'::entity_type) AND (i.id = r.object_id))))
  WHERE ((r.relationship_type = 'housed_at'::text) AND (r.period IS NOT NULL) AND (i.founded IS NOT NULL) AND (r.period << i.founded))
UNION ALL
 SELECT 'outside_parent_area'::text AS check_id,
    'warning'::text AS severity,
    'place'::entity_type AS entity_type,
    c.id AS entity_id,
    ('place:'::text || c.id) AS issue_key,
    format('its point lies outside the outline of %s (%s km away)'::text, p.name, round(((st_distance(pg.outline, cg.marker) / (1000)::double precision))::numeric)) AS detail
   FROM (((places c
     JOIN places p ON ((p.id = c.parent_id)))
     JOIN place_geo cg ON ((cg.id = c.id)))
     JOIN place_geo pg ON ((pg.id = p.id)))
  WHERE ((pg.outline IS NOT NULL) AND (c.location IS NOT NULL) AND (NOT st_dwithin(pg.outline, cg.marker, (5000)::double precision)))
UNION ALL
 SELECT 'possible_duplicate'::text AS check_id,
    'warning'::text AS severity,
    a.type AS entity_type,
    a.id AS entity_id,
    ((('dup:'::text || LEAST(a.id, b.id)) || ':'::text) || GREATEST(a.id, b.id)) AS issue_key,
    format('probably the same as %s (%s) — %s (score %s)'::text, b.name, b.slug, array_to_string(s.reasons, ', '::text), s.score) AS detail
   FROM ((dup_facts a
     JOIN dup_facts b ON (((b.type = a.type) AND (b.id <> a.id))))
     CROSS JOIN LATERAL dup_score(a.*, b.*) s(score, reasons))
  WHERE (dup_maybe(a.*, b.*) AND (s.score >= 50))
UNION ALL
 SELECT 'artwork_without_creator'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('artwork:'::text || w.id) AS issue_key,
    'no creator and no attribution'::text AS detail
   FROM artworks w
  WHERE ((w.creator_id IS NULL) AND (w.attribution_label IS NULL))
UNION ALL
 SELECT 'image_without_license'::text AS check_id,
    'warning'::text AS severity,
    i.entity_type,
    i.entity_id,
    ('image:'::text || i.id) AS issue_key,
    (((concat_ws(' and '::text,
        CASE
            WHEN (i.license IS NULL) THEN 'no license'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (i.credit IS NULL) THEN 'no credit'::text
            ELSE NULL::text
        END) || ' for image '::text) || (i."position" + 1)) || COALESCE(((' ('::text || i.caption) || ')'::text), ''::text)) AS detail
   FROM images i
  WHERE ((i.license IS NULL) OR (i.credit IS NULL))
UNION ALL
 SELECT 'no_relationships'::text AS check_id,
    'warning'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((e.type || ':'::text) || e.id) AS issue_key,
    'not connected to anything'::text AS detail
   FROM entity_index e
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM relationships r
          WHERE (((r.subject_type = e.type) AND (r.subject_id = e.id)) OR ((r.object_type = e.type) AND (r.object_id = e.id)))))) AND (NOT ((e.type = 'artwork'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE ((w.id = e.id) AND ((w.creator_id IS NOT NULL) OR (w.current_institution_id IS NOT NULL))))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM institutions i
          WHERE (i.place_id = e.id))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM places c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'movement'::entity_type) AND (EXISTS ( SELECT 1
           FROM movements c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'polity'::entity_type) AND (EXISTS ( SELECT 1
           FROM polities c
          WHERE (c.parent_id = e.id))))) AND (NOT ((e.type = 'place'::entity_type) AND (EXISTS ( SELECT 1
           FROM events v
          WHERE (v.place_id = e.id))))) AND (NOT ((e.type = 'event'::entity_type) AND (EXISTS ( SELECT 1
           FROM events v
          WHERE (((v.id = e.id) AND ((v.place_id IS NOT NULL) OR (v.parent_id IS NOT NULL))) OR (v.parent_id = e.id)))))) AND (e.type <> ALL (ARRAY['term'::entity_type, 'source'::entity_type])) AND (NOT ((e.type = 'institution'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE (w.current_institution_id = e.id))))) AND (NOT ((e.type = 'artist'::entity_type) AND (EXISTS ( SELECT 1
           FROM artworks w
          WHERE (w.creator_id = e.id))))))
UNION ALL
 SELECT 'artist_missing_dates'::text AS check_id,
    'warning'::text AS severity,
    'artist'::entity_type AS entity_type,
    a.id AS entity_id,
    ('artist:'::text || a.id) AS issue_key,
    concat_ws(' and '::text,
        CASE
            WHEN (a.birth IS NULL) THEN 'no birth date'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (a.death IS NULL) THEN 'no death date'::text
            ELSE NULL::text
        END) AS detail
   FROM artists a
  WHERE ((a.birth IS NULL) OR (a.death IS NULL))
UNION ALL
 SELECT 'auto_created'::text AS check_id,
    'warning'::text AS severity,
    ac.entity_type,
    ac.entity_id,
    ((('auto:'::text || ac.entity_type) || ':'::text) || ac.entity_id) AS issue_key,
    (('created automatically'::text || COALESCE((' while adding '::text || f.name), ''::text)) || ' — fill in the details'::text) AS detail
   FROM (auto_created ac
     LEFT JOIN entity_index f ON (((f.type = ac.created_from_type) AND (f.id = ac.created_from_id))))
UNION ALL
 SELECT 'part_missing_data'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    ('artwork:'::text || a.id) AS issue_key,
    format('no %s — its whole, %s, has %s'::text, concat_ws(' and '::text,
        CASE
            WHEN ((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) THEN 'creator'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.created IS NULL) AND (w.created IS NOT NULL)) THEN 'date'::text
            ELSE NULL::text
        END), w.title, concat_ws(' and '::text,
        CASE
            WHEN ((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) THEN 'one'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((a.created IS NULL) AND (w.created IS NOT NULL)) THEN COALESCE(w.created_label, 'one'::text)
            ELSE NULL::text
        END)) AS detail
   FROM (artworks a
     JOIN artworks w ON ((w.id = a.parent_id)))
  WHERE (((a.creator_id IS NULL) AND (w.creator_id IS NOT NULL)) OR ((a.created IS NULL) AND (w.created IS NOT NULL)))
UNION ALL
 SELECT 'institution_without_place'::text AS check_id,
    'info'::text AS severity,
    'institution'::entity_type AS entity_type,
    i.id AS entity_id,
    ('institution:'::text || i.id) AS issue_key,
        CASE
            WHEN (s.slug IS NOT NULL) THEN format('no place (city) — it lies %s km from %s (%s)'::text, s.km, s.name, s.slug)
            ELSE 'no place (city) set — the map can''t show it unless it has its own point'::text
        END AS detail
   FROM (institutions i
     LEFT JOIN LATERAL ( SELECT p.slug,
            p.name,
            round(((st_distance(g.marker, i.location) / (1000)::double precision))::numeric, 1) AS km
           FROM (places p
             JOIN place_geo g ON ((g.id = p.id)))
          WHERE ((i.location IS NOT NULL) AND (p.kind = 'settlement'::place_kind) AND st_dwithin(g.marker, i.location, (25000)::double precision))
          ORDER BY (g.marker <-> i.location)
         LIMIT 1) s ON (true))
  WHERE (i.place_id IS NULL)
UNION ALL
 SELECT 'parent_suggestion'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    c.id AS entity_id,
    ((('place:'::text || c.id) || ':'::text) || s.id) AS issue_key,
    format('lies inside %s (%s) — set it as parent'::text, s.name, s.slug) AS detail
   FROM ((places c
     JOIN place_geo cg ON ((cg.id = c.id)))
     CROSS JOIN LATERAL ( SELECT p.id,
            p.name,
            p.slug
           FROM (places p
             JOIN place_geo pg ON ((pg.id = p.id)))
          WHERE ((p.id <> c.id) AND (pg.outline IS NOT NULL) AND st_covers(pg.outline, cg.marker))
          ORDER BY (st_area(pg.outline))
         LIMIT 1) s)
  WHERE ((c.parent_id IS NULL) AND (c.kind <> 'country'::place_kind))
UNION ALL
 SELECT 'boundary_available'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ((('place:'::text || p.id) || ':'::text) || b.code) AS issue_key,
    format('an outline is available: %s (%s) — set the boundary code'::text, b.name, b.code) AS detail
   FROM (places p
     CROSS JOIN LATERAL ( SELECT b_1.code,
            b_1.name
           FROM boundaries b_1
          WHERE (((p.kind = 'country'::place_kind) AND (b_1.level = 0) AND (b_1.code = (p.country_code)::text)) OR ((p.kind = 'region'::place_kind) AND (b_1.level = 1) AND ((b_1.country_code)::text = (place_country(p.id) ->> 'code'::text)) AND (lower(f_unaccent(b_1.name)) = lower(f_unaccent(p.name)))))
         LIMIT 1) b)
  WHERE ((p.kind = ANY (ARRAY['country'::place_kind, 'region'::place_kind])) AND (p.area IS NULL) AND (p.boundary_code IS NULL))
UNION ALL
 SELECT 'missing_romanization'::text AS check_id,
    'info'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((e.type || ':'::text) || e.id) AS issue_key,
    format('"%s" has no romanization'::text, e.name) AS detail
   FROM entity_index e
  WHERE ((e.name !~ '[A-Za-zÀ-ɏ]'::text) AND (NOT jsonb_path_exists(e.names, '$[*]?(@."role" == "romanization")'::jsonpath)))
UNION ALL
 SELECT 'presence_without_period'::text AS check_id,
    'info'::text AS severity,
    r.subject_type AS entity_type,
    r.subject_id AS entity_id,
    ('rel:'::text || r.id) AS issue_key,
    format('%s %s has no date — not on the timeline or route'::text, r.type_label, r.object_name) AS detail
   FROM rel r
  WHERE (r.is_physical_presence AND (r.period IS NULL))
UNION ALL
 SELECT 'place_without_parent'::text AS check_id,
    'info'::text AS severity,
    'place'::entity_type AS entity_type,
    p.id AS entity_id,
    ('place:'::text || p.id) AS issue_key,
    'not inside any other place (no parent)'::text AS detail
   FROM places p
  WHERE ((p.parent_id IS NULL) AND (p.kind <> 'country'::place_kind))
UNION ALL
 SELECT 'missing_description'::text AS check_id,
    'info'::text AS severity,
    t.type AS entity_type,
    t.id AS entity_id,
    ((t.type || ':'::text) || t.id) AS issue_key,
    'no description / biography'::text AS detail
   FROM ( SELECT 'artist'::entity_type AS type,
            artists.id,
            artists.biography_md AS md
           FROM artists
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            artworks.id,
            artworks.description_md
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            places.id,
            places.description_md
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            movements.id,
            movements.description_md
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            institutions.id,
            institutions.description_md
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            people.id,
            people.description_md
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            polities.id,
            polities.description_md
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            events.id,
            events.description_md
           FROM events
        UNION ALL
         SELECT 'term'::entity_type AS entity_type,
            glossary.id,
            glossary.description_md
           FROM glossary
          WHERE ((glossary.definition IS NULL) AND (glossary.category <> ALL (ARRAY['material'::term_category, 'object type'::term_category])))) t
  WHERE (t.md IS NULL)
UNION ALL
 SELECT 'no_wikidata_id'::text AS check_id,
    'info'::text AS severity,
    t.type AS entity_type,
    t.id AS entity_id,
    ((t.type || ':'::text) || t.id) AS issue_key,
    'no Wikidata id (compare with Wikidata to add it)'::text AS detail
   FROM ( SELECT 'artist'::entity_type AS type,
            artists.id,
            artists.wikidata_id
           FROM artists
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            artworks.id,
            artworks.wikidata_id
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            places.id,
            places.wikidata_id
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            movements.id,
            movements.wikidata_id
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            institutions.id,
            institutions.wikidata_id
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            people.id,
            people.wikidata_id
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            polities.id,
            polities.wikidata_id
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            events.id,
            events.wikidata_id
           FROM events) t
  WHERE (t.wikidata_id IS NULL)
UNION ALL
 SELECT 'event_without_place'::text AS check_id,
    'info'::text AS severity,
    'event'::entity_type AS entity_type,
    v.id AS entity_id,
    ('event:'::text || v.id) AS issue_key,
    'no place, point or area'::text AS detail
   FROM events v
  WHERE ((v.place_id IS NULL) AND (v.location IS NULL) AND (v.area IS NULL))
UNION ALL
 SELECT 'citation_outdated'::text AS check_id,
    'warning'::text AS severity,
    c.entity_type,
    c.entity_id,
    ('cite:'::text || c.id) AS issue_key,
    format('%s changed since it was cited (%s)'::text, c.field, c.source_text) AS detail
   FROM citation_status c
  WHERE c.outdated
UNION ALL
 SELECT 'weakly_sourced'::text AS check_id,
    'info'::text AS severity,
    w.entity_type,
    w.entity_id,
    ((('sourced:'::text || w.entity_type) || ':'::text) || w.entity_id) AS issue_key,
    concat_ws(' · '::text, ('no source: '::text || string_agg(w.field, ', '::text ORDER BY w."position") FILTER (WHERE (w.best IS NULL))), ('only Wikidata / databases: '::text || string_agg(w.field, ', '::text ORDER BY w."position") FILTER (WHERE (w.best = 'database'::source_reliability)))) AS detail
   FROM field_sourcing w
  WHERE (((w.best IS NULL) OR (w.best = 'database'::source_reliability)) AND (NOT ((w.field = 'title_status'::text) AND ((w.value ->> 'title_status'::text) IS DISTINCT FROM 'official'::text))) AND (NOT ((w.field = 'names'::text) AND (NOT ((w.value -> 'names'::text) @> '[{"status": "official"}]'::jsonb)))))
  GROUP BY w.entity_type, w.entity_id
UNION ALL
 SELECT 'title_translation'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ('title-translation:'::text || w.id) AS issue_key,
    format('the title “%s” is %s translation — does %s use an official one?'::text, w.title,
        CASE w.title_status
            WHEN 'own'::translation_status THEN 'your own'::text
            ELSE 'a common'::text
        END, i.name) AS detail
   FROM (artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
  WHERE (w.title_status = ANY (ARRAY['own'::translation_status, 'common'::translation_status]))
UNION ALL
 SELECT 'type_doubtful'::text AS check_id,
    'info'::text AS severity,
    e.type AS entity_type,
    e.id AS entity_id,
    ((('type:'::text || e.type) || ':'::text) || e.id) AS issue_key,
    type_doubt(e.type, e.name) AS detail
   FROM entity_index e
  WHERE (type_doubt(e.type, e.name) IS NOT NULL)
UNION ALL
 SELECT 'flagged_holder'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-flag:'::text || p.id) AS issue_key,
    format('%s (%s): %s'::text, p.owner_name, COALESCE(p.period_label, 'undated'::text), holder_flag(p.owner_type, p.owner_id)) AS detail
   FROM provenance_periods p
  WHERE (holder_flag(p.owner_type, p.owner_id) IS NOT NULL)
UNION ALL
 SELECT 'flagged_holder'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ((((('prov-flag-co:'::text || c.provenance_id) || ':'::text) || c.owner_type) || ':'::text) || c.owner_id) AS issue_key,
    format('%s, joint owner (%s): %s'::text, e.name, COALESCE(p.period_label, 'undated'::text), holder_flag(c.owner_type, c.owner_id)) AS detail
   FROM ((provenance_co_owners_x c
     JOIN provenance_periods p ON ((p.id = c.provenance_id)))
     JOIN entity_index e ON (((e.type = c.owner_type) AND (e.id = c.owner_id))))
  WHERE (holder_flag(c.owner_type, c.owner_id) IS NOT NULL)
UNION ALL
 SELECT 'unlinked_term'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    w.id AS entity_id,
    ((((('term:'::text || w.id) || ':'::text) || u.what) || ':'::text) || u.value) AS issue_key,
    format('%s "%s" is not a glossary term'::text, u.what, u.value) AS detail
   FROM (artworks w
     CROSS JOIN LATERAL ( SELECT 'type'::text AS what,
            w.kind AS value
          WHERE ((w.kind IS NOT NULL) AND (w.kind_term_id IS NULL))
        UNION ALL
         SELECT 'material'::text,
            m.m
           FROM unnest(w.materials) m(m)
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM (artwork_materials am
                     JOIN glossary g ON ((g.id = am.term_id)))
                  WHERE ((am.artwork_id = w.id) AND (g.name = m.m)))))) u);

SELECT refresh_quality();
