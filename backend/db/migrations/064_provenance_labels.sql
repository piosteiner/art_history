-- 064: provenance period labels as they read — a step whose acquisition is undated but whose end is recorded is
-- "until 17 November 1928" (its period open towards the past), not blank; one acquired at some point in a span
-- ("between 1901 and 28 October 1904", "… or earlier") is "until <its end>", not "between 1901 and 28 October
-- 1904–28 October 1904"; the artist's implied line before such an acquisition: "1901 – by 28 October 1904".

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
            WHEN ((b.acquired IS NULL) AND (b.ended IS NOT NULL)) THEN daterange(NULL::date, upper(b.ended))
            WHEN (b.acquired IS NULL) THEN NULL::daterange
            WHEN (b.end_basis = 'recorded'::text) THEN daterange(lower(b.acquired), GREATEST(upper(b.ended), upper(b.acquired)))
            WHEN (b.end_basis = 'implied'::text) THEN daterange(lower(b.acquired), GREATEST(upper(b.next_acquired), upper(b.acquired)))
            WHEN (b.end_basis = 'ongoing'::text) THEN daterange(lower(b.acquired), NULL::date)
            ELSE b.acquired
        END AS period,
        CASE
            WHEN ((b.acquired IS NULL) AND (b.ended_label IS NOT NULL)) THEN ('until '::text || b.ended_label)
            WHEN (b.acquired IS NULL) THEN NULL::text
            WHEN ((b.end_basis = 'recorded'::text) AND (b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$'::text)) THEN ('until '::text || b.ended_label)
            WHEN ((b.end_basis = 'implied'::text) AND (b.acquired_label ~ '^(between|before|by|at the latest) |or earlier$'::text)) THEN ('until '::text || b.next_label)
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
    NULL::text AS price_note
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
    p.price_note
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
    NULL::text AS price_note
   FROM (artworks w
     JOIN institutions i ON ((i.id = w.current_institution_id)))
  WHERE w.on_loan;
