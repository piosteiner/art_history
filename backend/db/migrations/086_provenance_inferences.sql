-- 086 — Biography × provenance (owner: "can the artist's biography be connected with the provenance of the
-- paintings?" — Gauguin painted Tournesols sur un fauteuil in 1901 in the South Seas, Vollard bought it in Paris).
-- What the dates and places imply, computed live:
--   view provenance_inferences — conclusions per provenance step (the step that received the work):
--     narrowed    the giver died during the receiver's acquisition window: "from Gauguin during his lifetime —
--                 by 8 May 1903 at the latest" (period = the narrowed window);
--     from_estate the acquisition lies wholly after the giver's death: it came from the estate or the heirs;
--     travelled   the giver was demonstrably far (> 100 km) from the place of the handover for the whole window:
--                 "Gauguin was in Atuona then: the work travelled to Paris, ≈ 14,000 km" (PostGIS ST_Distance on the
--                 places' markers; his stays, merged and without their uncertain first and last years, contain the
--                 whole window — presence_core()).
--     Only for handovers documented as direct, between holders of the chain; not for inheritances (a death is
--     their cause, not a clue).
--   checks in quality_issues_live: contradictions (error) — acquired after the holder's death or before their
--   birth; acquired before the work was made; made in a place where the artist demonstrably was not — and
--   (info) provenance_date_narrowable for each 'narrowed' conclusion.

-- A stay given in whole years ("lived in Tahiti 1891–1893") is certain only from the year after it began to the year
-- before it ended: Gauguin left for Tahiti in April 1891 — in February 1891 he was still in Paris. Ends on 1 January
-- (year precision) move inwards by a year; precise dates stay.
CREATE FUNCTION presence_core(r daterange) RETURNS daterange LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lo < hi THEN daterange(lo, hi) ELSE 'empty'::daterange END
  FROM (SELECT (lower(r) + CASE WHEN extract(doy FROM lower(r)) = 1 THEN interval '1 year' ELSE interval '0' END)::date AS lo,
               (upper(r) - CASE WHEN extract(doy FROM upper(r)) = 1 THEN interval '1 year' ELSE interval '0' END)::date AS hi) b
$$;

CREATE VIEW provenance_inferences AS
-- holders who are people or artists: their lifetimes
WITH life AS (
  SELECT 'person'::entity_type AS t, id, birth, death, birth_label, death_label FROM people
  UNION ALL
  SELECT 'artist'::entity_type, id, birth, death, birth_label, death_label FROM artists),
-- where people and artists demonstrably were: dated physical presence at a place or an institution's site
presence AS (
  SELECT e.subject_type AS t, e.subject_id AS id, e.period, s.marker, o.name AS place
  FROM edges e
  JOIN relationship_types rt ON rt.code = e.relationship_type AND rt.is_physical_presence
  JOIN site_geo s ON (s.type, s.id) = (e.object_type, e.object_id)
  JOIN entity_index o ON (o.type, o.id) = (e.object_type, e.object_id)
  WHERE e.subject_type IN ('person', 'artist') AND e.period IS NOT NULL AND s.marker IS NOT NULL),
-- each holding of the chain with the one after it (a settlement goes on with the same owner: not a handover)
chain AS (
  SELECT c.*, lead(c.id) OVER w AS n_id, lead(c.acquired) OVER w AS n_acq, lead(c.acquired_label) OVER w AS n_label,
         lead(c.direct) OVER w AS n_direct, lead(c.method) OVER w AS n_method, lead(c.role) OVER w AS n_role,
         lead(c.location_id) OVER w AS n_loc, lead(c.owner_name) OVER w AS n_name
  FROM provenance_chain c WHERE c.in_chain AND c.method <> 'settlement'
  WINDOW w AS (PARTITION BY c.artwork_id ORDER BY c.position)),
pairs AS (
  SELECT ch.*, l.death, l.death_label,
         -- the handover's window, within the giver's lifetime
         ch.n_acq * daterange(NULL, upper(l.death)) AS win
  FROM chain ch JOIN life l ON (l.t, l.id) = (ch.owner_type, ch.owner_id)
  WHERE ch.n_id IS NOT NULL AND ch.role <> 'estate' AND ch.n_direct AND ch.n_role <> 'estate'
    AND ch.n_method NOT IN ('inheritance', 'bequest') AND ch.n_acq IS NOT NULL)
SELECT p.artwork_id, p.n_id AS provenance_id, 'narrowed'::text AS kind, p.win AS period, NULL::integer AS km,
       format('from %s during %s lifetime — by %s at the latest (%s died then)', p.owner_name,
              CASE WHEN p.owner_type = 'artist' THEN 'the artist''s' ELSE 'their' END, p.death_label, p.owner_name) AS detail
FROM pairs p
WHERE p.death IS NOT NULL AND upper(p.death) > coalesce(lower(p.n_acq), '-infinity') AND upper(p.death) < coalesce(upper(p.n_acq), 'infinity')
UNION ALL
SELECT p.artwork_id, p.n_id, 'from_estate', p.n_acq, NULL,
       format('after %s''s death (%s): from the estate or the heirs', p.owner_name, p.death_label)
FROM pairs p
WHERE p.death IS NOT NULL AND lower(p.n_acq) >= upper(p.death)
UNION ALL
SELECT f.artwork_id, f.n_id, 'travelled', f.win, f.km,
       format('%s was in %s then: the work travelled to %s, ≈ %s km', f.owner_name, f.places, f.dest, to_char(f.km, 'FM999,999'))
FROM (
  SELECT p.artwork_id, p.n_id, p.win, p.owner_name, dest.name AS dest, string_agg(DISTINCT pr.place, ' and ') AS places,
         round(min(ST_Distance(pr.marker, g.marker)) / 1000)::integer AS km,
         bool_and(ST_Distance(pr.marker, g.marker) > 100000) AS all_far,   -- every place they were then is far from it
         range_agg(pr.period) AS stays
  FROM pairs p
  JOIN places dest ON dest.id = p.n_loc
  JOIN site_geo g ON (g.type, g.id) = ('place', p.n_loc)
  JOIN presence pr ON (pr.t, pr.id) = (p.owner_type, p.owner_id) AND pr.period && p.win
  WHERE NOT isempty(p.win) AND lower(p.win) IS NOT NULL AND upper(p.win) IS NOT NULL AND g.marker IS NOT NULL
  GROUP BY p.artwork_id, p.n_id, p.win, p.owner_name, dest.name) f
-- and we know where they were the whole time: the stays merged, each without its uncertain first and last year
WHERE f.all_far AND (SELECT range_agg(presence_core(c)) FROM unnest(f.stays) c WHERE NOT isempty(presence_core(c))) @> f.win;

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
 SELECT 'holder_after_death'::text AS check_id, 'error'::text AS severity, 'artwork'::entity_type AS entity_type,
    s.artwork_id AS entity_id, ('prov-after-death:'::text || s.id) AS issue_key,
    format('%s acquired it %s — after their death (%s)'::text, s.owner_name, s.acquired_label, l.death_label) AS detail
   FROM provenance_chain s
     JOIN (SELECT 'person'::entity_type AS t, id, death, death_label FROM people UNION ALL SELECT 'artist'::entity_type, id, death, death_label FROM artists) l
       ON ((l.t, l.id) = (s.owner_type, s.owner_id))
  WHERE ((s.kind = 'step'::text) AND (s.role <> ALL (ARRAY['estate'::holder_role, 'event'::holder_role])) AND (lower(s.acquired) >= upper(l.death)))
UNION ALL
 SELECT 'holder_before_birth'::text, 'error'::text, 'artwork'::entity_type, s.artwork_id, ('prov-before-birth:'::text || s.id),
    format('%s acquired it %s — before their birth (%s)'::text, s.owner_name, s.acquired_label, l.birth_label)
   FROM provenance_chain s
     JOIN (SELECT 'person'::entity_type AS t, id, birth, birth_label FROM people UNION ALL SELECT 'artist'::entity_type, id, birth, birth_label FROM artists) l
       ON ((l.t, l.id) = (s.owner_type, s.owner_id))
  WHERE ((s.kind = 'step'::text) AND (upper(s.acquired) <= lower(l.birth)))
UNION ALL
 SELECT 'acquired_before_creation'::text, 'error'::text, 'artwork'::entity_type, s.artwork_id, ('prov-before-made:'::text || s.id),
    format('%s acquired it %s — before it was made (%s)'::text, s.owner_name, s.acquired_label, w.created_label)
   FROM provenance_chain s JOIN artworks w ON (w.id = s.artwork_id)
  WHERE ((s.kind = 'step'::text) AND (s.method <> ALL (ARRAY['commission'::acquisition_method, 'creation'::acquisition_method]))
     AND (upper(s.acquired) <= lower(w.created)))
UNION ALL
 SELECT 'created_where_artist_was_not'::text, 'error'::text, 'artwork'::entity_type, x.artwork_id, ('made-elsewhere:'::text || x.artwork_id),
    format('made in %s (%s), but %s was in %s then'::text, x.made_in, x.created_label, x.artist, x.places)
   FROM (SELECT w.id AS artwork_id, w.created_label, mp.name AS made_in, a.name AS artist, string_agg(DISTINCT o.name, ' and '::text) AS places
           FROM artworks w
             JOIN artists a ON (a.id = w.creator_id)
             JOIN relationships r ON ((r.subject_type = 'artwork'::entity_type) AND (r.subject_id = w.id) AND (r.relationship_type = 'created_in'::text) AND (r.object_type = 'place'::entity_type))
             JOIN places mp ON (mp.id = r.object_id)
             JOIN site_geo mg ON ((mg.type = 'place'::entity_type) AND (mg.id = mp.id))
             JOIN edges e ON ((e.subject_type = 'artist'::entity_type) AND (e.subject_id = a.id) AND (e.period && w.created))
             JOIN relationship_types rt ON ((rt.code = e.relationship_type) AND rt.is_physical_presence)
             JOIN site_geo s ON ((s.type = e.object_type) AND (s.id = e.object_id))
             JOIN entity_index o ON ((o.type = e.object_type) AND (o.id = e.object_id))
          WHERE ((w.created IS NOT NULL) AND (mg.marker IS NOT NULL) AND (s.marker IS NOT NULL))
          GROUP BY w.id, w.created, w.created_label, mp.name, a.name
         HAVING (bool_and((st_distance(s.marker, mg.marker) > (100000)::double precision)) AND (range_agg(e.period) @> w.created))) x
UNION ALL
 SELECT 'provenance_date_narrowable'::text, 'info'::text, 'artwork'::entity_type, i.artwork_id, ('prov-narrow:'::text || i.provenance_id),
    format('%s acquired it %s; %s'::text, p.owner_name, coalesce(p.acquired_label, 'undated'::text), i.detail)
   FROM provenance_inferences i JOIN provenance_chain p ON (p.id = i.provenance_id)
  WHERE (i.kind = 'narrowed'::text);

SELECT refresh_quality();
