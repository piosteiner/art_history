-- 217 — A part is found by every name of its whole (owner, 2026-11-04: "36 views" found 2 of the 46 prints — "Views"
-- from the series' title, "36" only from its German name "36 Ansichten des Berges Fuji", which the prints didn't carry).
-- entry_search_fields (110) as before, but the artworks' "Series" field gets a match text: the whole's title, the
-- part's number and all the whole's names (names_text: translations, romanizations, the readings of furigana) — shown
-- still as "Thirty-six Views of Mount Fuji (no. 36)". The parts' stored fields are queued once; later, a renamed whole
-- spreads to its parts (125). Generated from pg_get_viewdef of the view as it was (migration 193's definition).
CREATE OR REPLACE VIEW entry_search_fields AS
WITH f(type, id, "position", label, text, match, tier_rank, tier_heading) AS (
         SELECT 'artist'::entity_type AS entity_type,
            a.id,
            x."position",
            x.label,
            x.text,
            x.match,
            NULL::integer AS int4,
            NULL::text AS text
           FROM artists a
             CROSS JOIN LATERAL ( VALUES (1,'Filed as'::text,( SELECT e.sort_key
                           FROM entity_index e
                          WHERE e.type = 'artist'::entity_type AND e.id = a.id AND e.sort_key <> a.name),NULL::text), (2,'Lived'::text,NULLIF(range_label(a.birth_label, a.death_label), ''::text),NULL::text), (3,'Born in'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE pl.id = entity_home_place('artist'::entity_type, a.id)), entity_country('artist'::entity_type, a.id)),NULL::text), (4,'Nationality'::text,polity_words('artist'::entity_type, a.id, 'nationality'::text),NULL::text)) x("position", label, text, match)
        UNION ALL
         SELECT 'artist'::entity_type AS entity_type,
            a.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS match,
            x.tier_rank,
            x.tier_heading
           FROM artists a
             CROSS JOIN LATERAL ( VALUES (5,'Works now in'::text,( SELECT string_agg(DISTINCT i.name, ', '::text) AS string_agg
                           FROM artwork_holders h
                             JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                             JOIN institutions i ON i.id = h.institution_id
                          WHERE aa.artist_id = a.id AND h.now),1,'With works now in a matching collection'::text), (6,'Works formerly in'::text,( SELECT string_agg(DISTINCT i.name, ', '::text) AS string_agg
                           FROM artwork_holders h
                             JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                             JOIN institutions i ON i.id = h.institution_id
                          WHERE aa.artist_id = a.id AND NOT h.now),2,'With works formerly in a matching collection'::text)) x("position", label, text, tier_rank, tier_heading)
        UNION ALL
         SELECT 'artwork'::entity_type AS entity_type,
            w.id,
            x."position",
            x.label,
            x.text,
            x.match,
            x.tier_rank,
            x.tier_heading
           FROM artworks w
             CROSS JOIN LATERAL ( SELECT artwork_term_names(w.id) AS terms,
                    entity_country('artwork'::entity_type, w.id) AS country) t
             CROSS JOIN LATERAL ( VALUES (1,'Artist'::text,( SELECT string_agg(c.value ->> 'name'::text, ', '::text) AS string_agg
                           FROM jsonb_array_elements(artwork_creators(w.id)) c(value)),NULL::text,NULL::integer,NULL::text), (2,'Date'::text,w.created_label,NULL::text,NULL::integer,NULL::text), (3,'Type'::text,w.kind,NULLIF(concat_ws(' '::text, w.kind, array_to_string(t.terms, ' '::text)), ''::text),NULL::integer,NULL::text), (4,'Materials'::text,NULLIF(array_to_string(w.materials, ', '::text), ''::text),NULLIF(concat_ws(' '::text, array_to_string(w.materials, ' '::text), array_to_string(t.terms, ' '::text)), ''::text),NULL::integer,NULL::text), (5,'Medium'::text,w.medium,NULL::text,NULL::integer,NULL::text), (6,'Made in'::text,place_and_country((t.country -> 'place'::text) ->> 'name'::text, t.country),NULL::text,NULL::integer,NULL::text), (7,'State'::text,polity_words('artwork'::entity_type, w.id, 'created_in_polity'::text),NULL::text,NULL::integer,NULL::text), (8,'Series'::text,( SELECT p.title || COALESCE((' (no. '::text || w.part_number) || ')'::text, ''::text)
                           FROM artworks p
                          WHERE p.id = w.parent_id),( SELECT concat_ws(' '::text, p.title, w.part_number, names_text(p.names))
                           FROM artworks p
                          WHERE p.id = w.parent_id),NULL::integer,NULL::text), (9,'Now in'::text,( SELECT string_agg(i.name, ', '::text ORDER BY i.name) AS string_agg
                           FROM artwork_holders h
                             JOIN institutions i ON i.id = h.institution_id
                          WHERE h.artwork_id = w.id AND h.now),NULL::text,1,'Now in the collection'::text), (10,'Formerly in'::text,( SELECT string_agg(i.name, ', '::text ORDER BY i.name) AS string_agg
                           FROM artwork_holders h
                             JOIN institutions i ON i.id = h.institution_id
                          WHERE h.artwork_id = w.id AND NOT h.now),NULL::text,2,'Formerly in the collection'::text)) x("position", label, text, match, tier_rank, tier_heading)
        UNION ALL
         SELECT 'movement'::entity_type AS entity_type,
            m.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM movements m
             CROSS JOIN LATERAL ( VALUES (1,'Date'::text,m.period_label), (2,'Kind'::text,m.kind::text)) x("position", label, text)
        UNION ALL
         SELECT 'person'::entity_type AS entity_type,
            p.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM people p
             CROSS JOIN LATERAL ( VALUES (1,'Filed as'::text,( SELECT e.sort_key
                           FROM entity_index e
                          WHERE e.type = 'person'::entity_type AND e.id = p.id AND e.sort_key <> p.name)), (2,'Lived'::text,COALESCE(NULLIF(range_label(p.birth_label, p.death_label), ''::text), 'active '::text || p.active_label)), (3,'Kind'::text,p.kind), (4,'Occupations'::text,NULLIF(array_to_string(p.occupations, ', '::text), ''::text)), (5,'Roles'::text,( SELECT string_agg(
                                CASE r.r
                                    WHEN 'owner'::text THEN 'owner of artworks'::text
                                    WHEN 'depicted'::text THEN 'depicted in artworks'::text
                                    ELSE r.r
                                END, ', '::text) AS string_agg
                           FROM unnest(person_roles(p.id)) r(r))), (6,'Born in'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE pl.id = entity_home_place('person'::entity_type, p.id)), entity_country('person'::entity_type, p.id))), (7,'Nationality'::text,polity_words('person'::entity_type, p.id, 'nationality'::text))) x("position", label, text)
        UNION ALL
         SELECT 'place'::entity_type AS entity_type,
            pl.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM places pl
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,COALESCE(pl.designation, pl.kind::text)), (2,'In'::text,( SELECT pp.name
                           FROM places pp
                          WHERE pp.id = pl.parent_id AND (pp.kind <> ALL (ARRAY['country'::place_kind, 'continent'::place_kind])))), (3,'Country'::text,place_country(pl.id) ->> 'name'::text)) x("position", label, text)
        UNION ALL
         SELECT 'institution'::entity_type AS entity_type,
            i.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            x.tier_rank,
            x.tier_heading
           FROM institutions i
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,i.kind,NULL::integer,NULL::text), (2,'Dates'::text,NULLIF(concat_ws(' · '::text, 'founded '::text || i.founded_label, 'closed '::text || i.dissolved_label), ''::text),NULL::integer,NULL::text), (3,'Location'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE pl.id = i.place_id), entity_country('institution'::entity_type, i.id)),NULL::integer,NULL::text), (4,'Historically in'::text,polity_words('institution'::entity_type, i.id, 'located_in_polity'::text),NULL::integer,NULL::text), (5,'Works by'::text,( SELECT string_agg(DISTINCT a.name, ', '::text) AS string_agg
                           FROM artwork_holders h
                             JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                             JOIN artists a ON a.id = aa.artist_id
                          WHERE h.institution_id = i.id),1,'With works by a matching artist'::text)) x("position", label, text, tier_rank, tier_heading)
        UNION ALL
         SELECT 'source'::entity_type AS entity_type,
            b.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM bibliography b
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,b.kind::text), (2,'Authors'::text,NULLIF(array_to_string((b.authors || b.editors) || b.compilers, ', '::text), ''::text)), (3,'Title'::text,NULLIF(concat_ws(': '::text, b.name, b.subtitle), ''::text)), (4,'In'::text,NULLIF(concat_ws(', '::text, b.container, b.exhibition, b.series), ''::text)), (5,'Published'::text,NULLIF(concat_ws(', '::text, b.place, b.publisher, b.year), ''::text))) x("position", label, text)
        UNION ALL
         SELECT 'event'::entity_type AS entity_type,
            e.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM events e
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,e.kind), (2,'Date'::text,e.period_label), (3,'Where'::text,place_and_country(( SELECT pl.name
                           FROM places pl
                          WHERE pl.id = e.place_id), entity_country('event'::entity_type, e.id))), (4,'Part of'::text,( SELECT p.name
                           FROM events p
                          WHERE p.id = e.parent_id))) x("position", label, text)
        UNION ALL
         SELECT 'literature'::entity_type AS entity_type,
            l.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM literary_works l
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,l.kind), (2,'Author'::text,( SELECT string_agg(COALESCE(pe.name, ar.name), ', '::text ORDER BY r.id) AS string_agg
                           FROM relationships r
                             LEFT JOIN people pe ON r.object_type = 'person'::entity_type AND pe.id = r.object_id
                             LEFT JOIN artists ar ON r.object_type = 'artist'::entity_type AND ar.id = r.object_id
                          WHERE r.subject_type = 'literature'::entity_type AND (r.subject_id = ANY (ARRAY[l.id, l.parent_id])) AND r.relationship_type = 'written_by'::text)), (3,'Written'::text,l.written_label), (4,'Part of'::text,( SELECT p.name
                           FROM literary_works p
                          WHERE p.id = l.parent_id))) x("position", label, text)
        UNION ALL
         SELECT 'term'::entity_type AS entity_type,
            g.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM glossary g
             CROSS JOIN LATERAL ( VALUES (1,'Category'::text,g.category::text), (2,'Definition'::text,g.definition)) x("position", label, text)
        UNION ALL
         SELECT 'polity'::entity_type AS entity_type,
            p.id,
            x."position",
            x.label,
            x.text,
            NULL::text AS text,
            NULL::integer AS int4,
            NULL::text AS text
           FROM polities p
             CROSS JOIN LATERAL ( VALUES (1,'Kind'::text,p.kind), (2,'Date'::text,p.period_label), (3,'Territory today'::text,( SELECT string_agg(b.name, ', '::text) AS string_agg
                           FROM unnest(p.country_codes) c(c)
                             JOIN boundaries b ON b.code = c.c AND b.level = 0))) x("position", label, text)
        )
 SELECT type,
    id,
    "position",
    label,
    text,
    match,
    tier_rank,
    tier_heading,
    type::text = 'artwork'::text AND label = 'Artist'::text OR type::text = 'artwork'::text AND label = 'Date'::text OR type::text = 'artist'::text AND label = 'Lived'::text OR type::text = 'person'::text AND label = 'Lived'::text OR type::text = 'place'::text AND label = 'Kind'::text OR type::text = 'place'::text AND label = 'Country'::text OR type::text = 'place'::text AND label = 'In'::text OR type::text = 'institution'::text AND label = 'Kind'::text OR type::text = 'institution'::text AND label = 'Dates'::text OR type::text = 'source'::text AND label = 'Kind'::text OR type::text = 'event'::text AND label = 'Kind'::text OR type::text = 'literature'::text AND label = 'Kind'::text OR type::text = 'literature'::text AND label = 'Author'::text OR type::text = 'literature'::text AND label = 'Written'::text OR type::text = 'event'::text AND label = 'Date'::text OR type::text = 'event'::text AND label = 'Where'::text OR type::text = 'term'::text AND label = 'Category'::text OR type::text = 'polity'::text AND label = 'Kind'::text OR type::text = 'polity'::text AND label = 'Date'::text OR type::text = 'movement'::text AND label = 'Date'::text AS shown
   FROM f
  WHERE text IS NOT NULL AND btrim(text) <> ''::text;

INSERT INTO derived_queue (type, id, reason) SELECT 'artwork', id, 'change' FROM artworks WHERE parent_id IS NOT NULL;
INSERT INTO list_queue (type, id) SELECT 'artwork', id FROM artworks WHERE parent_id IS NOT NULL;
