-- 098 — An owner holds the work where one of its museums keeps it. The Bayerische Staatsgemäldesammlungen own the
-- paintings; the Neue Pinakothek or the Sammlung Schack (part of them, 097) is where a work is. A provenance that ends
-- with the authority while the work is at its museum is therefore "ongoing" (provenance_periods: before, only the
-- museum itself counted, and the period ended "unknown" — a gap up to today in the coverage), and no longer reported
-- as "the provenance ends with …, but the work is at …" (quality_issues_live, check provenance_last_owner).
-- institution_holds(owner, museum): the owner is the museum, or an institution it is part of (part_of, upwards).
-- Both views are as before (pg_get_viewdef after 097) except for that one comparison each.
CREATE FUNCTION institution_holds(owner bigint, museum bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(owner = museum, false) OR (owner IS NOT NULL AND museum IS NOT NULL AND EXISTS (
    WITH RECURSIVE up (id, depth) AS (
      SELECT museum, 0
      UNION
      SELECT r.object_id, up.depth + 1 FROM up JOIN relationships r
        ON r.subject_type = 'institution' AND r.subject_id = up.id AND r.relationship_type = 'part_of' AND r.object_type = 'institution'
      WHERE up.depth < 5)
    SELECT 1 FROM up WHERE up.id = owner))
$$;

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
            p.not_sold,
            p.event_id,
            (
                CASE
                    WHEN (p.owner_artist_id IS NOT NULL) THEN 'artist'::text
                    WHEN (p.owner_person_id IS NOT NULL) THEN 'person'::text
                    WHEN (p.owner_institution_id IS NOT NULL) THEN 'institution'::text
                    WHEN (p.owner_place_id IS NOT NULL) THEN 'place'::text
                    ELSE NULL::text
                END)::entity_type AS owner_type,
            COALESCE(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id) AS owner_id,
            (p.role = ANY (ARRAY['owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role, 'publisher'::holder_role])) AS in_chain,
            nx.acquired AS next_acquired,
            nx.acquired_label AS next_label,
            pv.owner_artist_id AS prev_artist,
            pv.owner_person_id AS prev_person,
            pv.owner_institution_id AS prev_institution,
            pv.owner_place_id AS prev_place,
            COALESCE(pv.ended, pv.acquired) AS prev_holding,
            first_value(p."position") OVER w AS first_position,
            ((p.role = ANY (ARRAY['owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role, 'publisher'::holder_role])) AND (nx.id IS NULL)) AS is_last,
            via.names AS via
           FROM (((provenance p
             LEFT JOIN LATERAL ( SELECT n.id,
                    n.acquired,
                    n.acquired_label
                   FROM provenance n
                  WHERE ((n.artwork_id = p.artwork_id) AND (n."position" > p."position") AND (n.role = ANY (ARRAY['owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role, 'publisher'::holder_role])) AND (n.method <> 'settlement'::acquisition_method) AND (n.alternative_to IS NULL))
                  ORDER BY n."position"
                 LIMIT 1) nx ON (true))
             LEFT JOIN LATERAL ( SELECT q."position",
                    q.owner_artist_id,
                    q.owner_person_id,
                    q.owner_institution_id,
                    q.owner_place_id,
                    q.acquired,
                    q.ended
                   FROM provenance q
                  WHERE ((q.artwork_id = p.artwork_id) AND (q."position" < p."position") AND (q.role = ANY (ARRAY['owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role, 'publisher'::holder_role])) AND (q.alternative_to IS NULL))
                  ORDER BY q."position" DESC
                 LIMIT 1) pv ON (true))
             LEFT JOIN LATERAL ( SELECT string_agg(COALESCE(e.name, a.owner_label), ', '::text ORDER BY a."position") AS names
                   FROM (provenance a
                     LEFT JOIN entity_index e ON (((e.type = (
                        CASE
                            WHEN (a.owner_artist_id IS NOT NULL) THEN 'artist'::text
                            WHEN (a.owner_person_id IS NOT NULL) THEN 'person'::text
                            WHEN (a.owner_institution_id IS NOT NULL) THEN 'institution'::text
                            WHEN (a.owner_place_id IS NOT NULL) THEN 'place'::text
                            ELSE NULL::text
                        END)::entity_type) AND (e.id = COALESCE(a.owner_artist_id, a.owner_person_id, a.owner_institution_id, a.owner_place_id)))))
                  WHERE ((p.role = ANY (ARRAY['owner'::holder_role, 'dealer'::holder_role, 'estate'::holder_role, 'publisher'::holder_role])) AND (a.artwork_id = p.artwork_id) AND (a.role = 'agent'::holder_role) AND (NOT a.not_sold) AND ((a.owner_artist_id IS DISTINCT FROM p.owner_artist_id) OR (a.owner_person_id IS DISTINCT FROM p.owner_person_id) OR (a.owner_institution_id IS DISTINCT FROM p.owner_institution_id) OR (a.owner_place_id IS DISTINCT FROM p.owner_place_id)) AND (a."position" < p."position") AND (a."position" > COALESCE(pv."position", '-1'::integer)) AND (a.alternative_to IS NULL))) via ON (true))
          WHERE (p.alternative_to IS NULL)
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
            s.not_sold,
            s.event_id,
            s.owner_type,
            s.owner_id,
            s.in_chain,
            s.next_acquired,
            s.next_label,
            s.prev_artist,
            s.prev_person,
            s.prev_institution,
            s.prev_place,
            s.prev_holding,
            s.first_position,
            s.is_last,
            s.via,
                CASE
                    WHEN (s.ended IS NOT NULL) THEN 'recorded'::text
                    WHEN (s.role = 'event'::holder_role) THEN 'point'::text
                    WHEN (s.next_acquired IS NOT NULL) THEN 'implied'::text
                    WHEN (s.is_last AND (institution_holds(s.owner_institution_id, w.current_institution_id) OR (w.on_loan AND (w.current_institution_id IS NOT NULL)))) THEN 'ongoing'::text
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
    b.price_note,
    b.in_chain,
    b.not_sold,
    b.via
   FROM (b
     LEFT JOIN entity_index o ON (((o.type = b.owner_type) AND (o.id = b.owner_id))));

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
    format('%s %s, but %s %s %s'::text,
        CASE
            WHEN (w.conceived IS NOT NULL) THEN 'designed'::text
            ELSE 'created'::text
        END, COALESCE(w.conceived_label, w.created_label), a.name,
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
    format(
        CASE
            WHEN (g.n = 1) THEN '%1$s: the change of owner (%2$s) is not documented as direct — it may have happened %3$s'::text
            ELSE 'the changes of owner to %1$s are undated or not documented as direct — who held it %3$s?'::text
        END, g.names,
        CASE
            WHEN (g.n = 1) THEN COALESCE(g.acquired_label, 'undated'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN ((g.gap_from IS NULL) AND (g.gap_to IS NULL)) THEN 'at any time'::text
            WHEN (g.gap_from IS NULL) THEN ('before '::text || EXTRACT(year FROM (g.gap_to - 1)))
            WHEN (g.gap_to IS NULL) THEN ('after '::text || EXTRACT(year FROM g.gap_from))
            WHEN (EXTRACT(year FROM g.gap_from) = EXTRACT(year FROM (g.gap_to - 1))) THEN ('in '::text || EXTRACT(year FROM g.gap_from))
            ELSE ((('between '::text || EXTRACT(year FROM g.gap_from)) || ' and '::text) || EXTRACT(year FROM (g.gap_to - 1)))
        END) AS detail
   FROM ( SELECT provenance_gaps.artwork_id,
            provenance_gaps.gap_from,
            provenance_gaps.gap_to,
            min(provenance_gaps.id) AS id,
            count(*) AS n,
            string_agg(provenance_gaps.owner_name, ', '::text ORDER BY provenance_gaps."position") AS names,
            min(provenance_gaps.acquired_label) AS acquired_label
           FROM provenance_gaps
          WHERE (NOT provenance_gaps.direct)
          GROUP BY provenance_gaps.artwork_id, provenance_gaps.gap_from, provenance_gaps.gap_to) g
  WHERE
        CASE
            WHEN ((g.gap_from IS NULL) OR (g.gap_to IS NULL) OR (g.gap_from < g.gap_to)) THEN (daterange(g.gap_from, g.gap_to) && daterange('1933-01-30'::date, '1945-05-09'::date))
            ELSE false
        END
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
          WHERE ((r.artwork_id = p.artwork_id) AND (r."position" > p."position") AND (r.alternative_to IS NULL) AND (r.method = ANY (ARRAY['restitution'::acquisition_method, 'settlement'::acquisition_method])))))))
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
  WHERE ((NOT institution_holds(p.owner_institution_id, w.current_institution_id)) AND (NOT w.on_loan))
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
   FROM (((dup_candidate_pairs c
     JOIN dup_facts a ON (((a.type = c.type) AND (a.id = c.a_id))))
     JOIN dup_facts b ON (((b.type = c.type) AND (b.id = c.b_id))))
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
         SELECT 'material'::text AS text,
            m.m
           FROM unnest(w.materials) m(m)
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM (artwork_materials am
                     JOIN glossary g ON ((g.id = am.term_id)))
                  WHERE ((am.artwork_id = w.id) AND (g.name = m.m)))))) u)
UNION ALL
 SELECT 'provenance_stolen'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-stolen:'::text || p.id) AS issue_key,
    format('stolen%s — not recovered (no end recorded): report it to the Art Loss Register, Interpol, Lost Art'::text, COALESCE((' '::text || p.acquired_label), ''::text)) AS detail
   FROM provenance p
  WHERE ((p.method = 'theft'::acquisition_method) AND (p.ended IS NULL) AND (p.alternative_to IS NULL))
UNION ALL
 SELECT 'provenance_seizure_as_owner'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    p.artwork_id AS entity_id,
    ('prov-seized-owner:'::text || p.id) AS issue_key,
    format('%s: %s (%s), recorded as %s — a seizure or theft gives possession, not title: role possessor?'::text, p.owner_name, replace((p.method)::text, '_'::text, ' '::text), COALESCE(p.acquired_label, 'undated'::text), (p.role)::text) AS detail
   FROM provenance_periods p
  WHERE ((p.method = ANY (ARRAY['confiscation'::acquisition_method, 'theft'::acquisition_method])) AND p.in_chain)
UNION ALL
 SELECT 'holder_after_death'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-after-death:'::text || s.id) AS issue_key,
    format('%s acquired it %s — after their death (%s)'::text, s.owner_name, s.acquired_label, l.death_label) AS detail
   FROM (provenance_chain s
     JOIN ( SELECT 'person'::entity_type AS t,
            people.id,
            people.death,
            people.death_label
           FROM people
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            artists.id,
            artists.death,
            artists.death_label
           FROM artists) l ON (((l.t = s.owner_type) AND (l.id = s.owner_id))))
  WHERE ((s.kind = 'step'::text) AND (s.role <> ALL (ARRAY['estate'::holder_role, 'event'::holder_role])) AND (lower(s.acquired) >= upper(l.death)))
UNION ALL
 SELECT 'holder_before_birth'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-before-birth:'::text || s.id) AS issue_key,
    format('%s acquired it %s — before their birth (%s)'::text, s.owner_name, s.acquired_label, l.birth_label) AS detail
   FROM (provenance_chain s
     JOIN ( SELECT 'person'::entity_type AS t,
            people.id,
            people.birth,
            people.birth_label
           FROM people
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            artists.id,
            artists.birth,
            artists.birth_label
           FROM artists) l ON (((l.t = s.owner_type) AND (l.id = s.owner_id))))
  WHERE ((s.kind = 'step'::text) AND (upper(s.acquired) <= lower(l.birth)))
UNION ALL
 SELECT 'acquired_before_creation'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id,
    ('prov-before-made:'::text || s.id) AS issue_key,
    format('%s acquired it %s — before it was made (%s)'::text, s.owner_name, s.acquired_label, w.created_label) AS detail
   FROM (provenance_chain s
     JOIN artworks w ON ((w.id = s.artwork_id)))
  WHERE ((s.kind = 'step'::text) AND (s.method <> ALL (ARRAY['commission'::acquisition_method, 'creation'::acquisition_method])) AND (upper(s.acquired) <= lower(w.created)))
UNION ALL
 SELECT 'created_where_artist_was_not'::text AS check_id,
    'error'::text AS severity,
    'artwork'::entity_type AS entity_type,
    x.artwork_id AS entity_id,
    ('made-elsewhere:'::text || x.artwork_id) AS issue_key,
    format('made in %s (%s), but %s was in %s then'::text, x.made_in, x.created_label, x.artist, x.places) AS detail
   FROM ( SELECT w.id AS artwork_id,
            w.created_label,
            mp.name AS made_in,
            a.name AS artist,
            string_agg(DISTINCT o.name, ' and '::text) AS places
           FROM ((((((((artworks w
             JOIN artists a ON ((a.id = w.creator_id)))
             JOIN relationships r ON (((r.subject_type = 'artwork'::entity_type) AND (r.subject_id = w.id) AND (r.relationship_type = 'created_in'::text) AND (r.object_type = 'place'::entity_type))))
             JOIN places mp ON ((mp.id = r.object_id)))
             JOIN site_geo mg ON (((mg.type = 'place'::entity_type) AND (mg.id = mp.id))))
             JOIN edges e ON (((e.subject_type = 'artist'::entity_type) AND (e.subject_id = a.id) AND (e.period && w.created))))
             JOIN relationship_types rt ON (((rt.code = e.relationship_type) AND rt.is_physical_presence)))
             JOIN site_geo s ON (((s.type = e.object_type) AND (s.id = e.object_id))))
             JOIN entity_index o ON (((o.type = e.object_type) AND (o.id = e.object_id))))
          WHERE ((w.created IS NOT NULL) AND (mg.marker IS NOT NULL) AND (s.marker IS NOT NULL))
          GROUP BY w.id, w.created, w.created_label, mp.name, a.name
         HAVING (bool_and((st_distance(s.marker, mg.marker) > (100000)::double precision)) AND (range_agg(e.period) @> w.created))) x
UNION ALL
 SELECT 'provenance_date_narrowable'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    i.artwork_id AS entity_id,
    ('prov-narrow:'::text || i.provenance_id) AS issue_key,
    format('%s acquired it %s; %s'::text, p.owner_name, COALESCE(p.acquired_label, 'undated'::text), i.detail) AS detail
   FROM (provenance_inferences i
     JOIN provenance_chain p ON ((p.id = i.provenance_id)))
  WHERE (i.kind = 'narrowed'::text);
