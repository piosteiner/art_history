-- 071 — An artwork's type and materials are glossary terms, so they have names in several languages: a search for
-- "Holzschnitt" finds the woodblock prints, "Leinwand" the paintings on canvas, whatever language the museum used.
--
-- The names stay the interface: artworks.kind (text) and artworks.materials (text[]) keep holding names, as before —
-- the form, YAML, the Wikidata review, revert and the views reading them work unchanged. The database resolves them:
--   · term_by_name() finds the term a name means — its main name or any of its other names, any language,
--     case- and accent-insensitive, only in the fitting categories (a type: object type / technique / format;
--     a material: material)
--   · a BEFORE trigger on artworks links them (kind_term_id; the join table artwork_materials) and writes the term's
--     main name instead (one spelling: "Ölgemälde" is stored as "oil painting"); a name that is no term stays as typed
--     (check unlinked_term; sorted out on /quality/batch/terms)
--   · triggers on glossary follow renames and link artworks when a term gets a name they use
-- The medium ("Öl auf Leinwand") stays as the museum wrote it; artwork_term_names() also finds the terms it mentions.

-- the term a name means
CREATE FUNCTION term_by_name(p_name text, p_categories term_category[]) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT g.id FROM glossary g
  WHERE g.category = ANY (p_categories) AND p_name IS NOT NULL AND btrim(p_name) <> ''
    AND (lower(f_unaccent(g.name)) = lower(f_unaccent(btrim(p_name)))
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.names) n
                    WHERE lower(f_unaccent(ruby_plain(n->>'text'))) = lower(f_unaccent(btrim(p_name)))))
  ORDER BY (lower(f_unaccent(g.name)) = lower(f_unaccent(btrim(p_name)))) DESC, g.id
  LIMIT 1
$$;
CREATE FUNCTION kind_categories() RETURNS term_category[] LANGUAGE sql IMMUTABLE RETURN ARRAY['object type', 'technique', 'format']::term_category[];

ALTER TABLE artworks ADD COLUMN kind_term_id bigint REFERENCES glossary ON DELETE RESTRICT;
CREATE INDEX artworks_kind_term_idx ON artworks (kind_term_id) WHERE kind_term_id IS NOT NULL;
-- Derived from artworks.materials by the trigger (so not in the history: the names there are the record).
CREATE TABLE artwork_materials (
  artwork_id bigint NOT NULL REFERENCES artworks ON DELETE CASCADE,
  term_id    bigint NOT NULL REFERENCES glossary ON DELETE RESTRICT,
  position   int NOT NULL,
  PRIMARY KEY (artwork_id, term_id)
);
CREATE INDEX artwork_materials_term_idx ON artwork_materials (term_id);

-- BEFORE: link the type and write the term's main name (and the materials' main names, each once)
CREATE FUNCTION artworks_link_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.kind := nullif(btrim(NEW.kind), '');
  NEW.kind_term_id := term_by_name(NEW.kind, kind_categories());
  IF NEW.kind_term_id IS NOT NULL THEN NEW.kind := (SELECT name FROM glossary WHERE id = NEW.kind_term_id); END IF;
  -- each material by its term's main name; DISTINCT ON keeps the first occurrence, ORDER BY i its place
  NEW.materials := coalesce((SELECT array_agg(x.name ORDER BY x.i) FROM (
      SELECT DISTINCT ON (lower(coalesce(g.name, btrim(m)))) coalesce(g.name, btrim(m)) AS name, i
      FROM unnest(NEW.materials) WITH ORDINALITY u(m, i)
      LEFT JOIN glossary g ON g.id = term_by_name(m, ARRAY['material']::term_category[])
      WHERE btrim(m) <> '' ORDER BY lower(coalesce(g.name, btrim(m))), i) x), '{}');
  RETURN NEW;
END $$;
CREATE TRIGGER artworks_link_terms BEFORE INSERT OR UPDATE OF kind, materials ON artworks
  FOR EACH ROW EXECUTE FUNCTION artworks_link_terms();

-- AFTER: the join table for the materials (needs the row's id on insert)
CREATE FUNCTION artworks_material_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM artwork_materials WHERE artwork_id = NEW.id;
  INSERT INTO artwork_materials (artwork_id, term_id, position)
  SELECT DISTINCT ON (t) NEW.id, t, i FROM (
    SELECT term_by_name(m, ARRAY['material']::term_category[]) AS t, i FROM unnest(NEW.materials) WITH ORDINALITY u(m, i)) x
  WHERE t IS NOT NULL ORDER BY t, i;
  RETURN NULL;
END $$;
CREATE TRIGGER artworks_material_links AFTER INSERT OR UPDATE OF materials ON artworks
  FOR EACH ROW EXECUTE FUNCTION artworks_material_links();

-- A term renamed: its artworks show the new name. A term created or given names: artworks that used one of its names
-- unlinked get linked (setting the column to itself runs the BEFORE trigger again).
CREATE FUNCTION glossary_relink_artworks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE artworks SET kind = NEW.name WHERE kind_term_id = NEW.id;
    UPDATE artworks SET materials = array_replace(materials, OLD.name, NEW.name)
     WHERE id IN (SELECT artwork_id FROM artwork_materials WHERE term_id = NEW.id);
  END IF;
  UPDATE artworks SET kind = kind
   WHERE kind_term_id IS NULL AND kind IS NOT NULL AND term_by_name(kind, kind_categories()) = NEW.id;
  UPDATE artworks w SET materials = materials
   WHERE EXISTS (SELECT 1 FROM unnest(w.materials) m WHERE term_by_name(m, ARRAY['material']::term_category[]) = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM artwork_materials am WHERE am.artwork_id = w.id AND am.term_id = NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER glossary_relink_artworks AFTER INSERT OR UPDATE OF name, names, category ON glossary
  FOR EACH ROW EXECUTE FUNCTION glossary_relink_artworks();

-- Every name of an artwork's terms, all languages — its type, its materials, and the terms its medium mentions (a
-- name of a material or object type as a whole word in the museum's text: "Öl auf Leinwand" → canvas, oil paint).
-- For searching: "Holzschnitt", "Leinwand" find what is stored as woodblock print / canvas.
CREATE FUNCTION term_names(g glossary) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_prepend(g.name, coalesce(array_agg(ruby_plain(n->>'text')), '{}')) FROM jsonb_array_elements(g.names) n
$$;
CREATE FUNCTION artwork_term_names(p_artwork bigint) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT x), '{}') FROM (
    SELECT unnest(term_names(g)) AS x FROM artworks w JOIN glossary g ON g.id = w.kind_term_id WHERE w.id = p_artwork
    UNION ALL
    SELECT unnest(term_names(g)) FROM artwork_materials am JOIN glossary g ON g.id = am.term_id WHERE am.artwork_id = p_artwork
    UNION ALL
    SELECT unnest(term_names(g)) FROM artworks w JOIN glossary g ON g.category IN ('material', 'object type')
    WHERE w.id = p_artwork AND w.medium IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(term_names(g)) nm
                  WHERE f_unaccent(w.medium) ~* ('\m' || regexp_replace(f_unaccent(nm), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'))
  ) t
$$;

-- A starter vocabulary from the types and materials in use, in English and German (more names and the Wikidata ids
-- come from the glossary's Enrich page). Names jsonb as elsewhere: [{text, lang, role}].
INSERT INTO glossary (slug, name, name_lang, category, names) VALUES
  ('oil-painting',    'oil painting',    'en', 'object type', '[{"text": "Ölgemälde", "lang": "de", "role": "translation"}]'),
  ('painting',        'painting',        'en', 'object type', '[{"text": "Gemälde", "lang": "de", "role": "translation"}, {"text": "Malerei", "lang": "de", "role": "translation"}]'),
  ('sculpture',       'sculpture',       'en', 'object type', '[{"text": "Skulptur", "lang": "de", "role": "translation"}, {"text": "Plastik", "lang": "de", "role": "translation"}]'),
  ('woodblock-print', 'woodblock print', 'en', 'object type', '[{"text": "Holzschnitt", "lang": "de", "role": "translation"}, {"text": "Farbholzschnitt", "lang": "de", "role": "translation"}, {"text": "Holzschnittdruck", "lang": "de", "role": "translation"}, {"text": "木版画", "lang": "ja", "role": "translation"}]'),
  ('pastel',          'pastel',          'en', 'object type', '[{"text": "Pastell", "lang": "de", "role": "translation"}]'),
  ('oil-paint',       'oil paint',       'en', 'material',    '[{"text": "Ölfarbe", "lang": "de", "role": "translation"}, {"text": "oil", "role": "alternative"}, {"text": "Öl", "lang": "de", "role": "translation"}]'),
  ('canvas',          'canvas',          'en', 'material',    '[{"text": "Leinwand", "lang": "de", "role": "translation"}]'),
  ('copper',          'copper',          'en', 'material',    '[{"text": "Kupfer", "lang": "de", "role": "translation"}]'),
  ('paper',           'paper',           'en', 'material',    '[{"text": "Papier", "lang": "de", "role": "translation"}]'),
  ('ink',             'ink',             'en', 'material',    '[{"text": "Tusche", "lang": "de", "role": "translation"}, {"text": "Tinte", "lang": "de", "role": "translation"}]'),
  ('pastel-crayon',   'pastel crayon',   'en', 'material',    '[{"text": "Pastellkreide", "lang": "de", "role": "translation"}, {"text": "pastel", "role": "alternative"}, {"text": "Pastell", "lang": "de", "role": "translation"}]'),
  ('wood',            'wood',            'en', 'material',    '[{"text": "Holz", "lang": "de", "role": "translation"}]'),
  ('gold',            'gold',            'en', 'material',    '[{"text": "Gold", "lang": "de", "role": "translation"}]'),
  ('cardboard',       'cardboard',       'en', 'material',    '[{"text": "Karton", "lang": "de", "role": "translation"}, {"text": "Pappe", "lang": "de", "role": "translation"}]')
ON CONFLICT (slug) DO NOTHING;  -- a term with that slug exists already: kept as it is

-- Link what is in use (sets the columns to themselves: the BEFORE trigger resolves and writes main names).
UPDATE artworks SET kind = kind, materials = materials WHERE kind IS NOT NULL OR materials <> '{}';

-- The checks (058: change THIS view): 068's + unlinked_term; object types and materials need no description.
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
    format('created %s, but %s %s %s'::text, w.created_label, a.name,
        CASE
            WHEN (w.created >> a.death) THEN 'died'::text
            ELSE 'was born'::text
        END,
        CASE
            WHEN (w.created >> a.death) THEN a.death_label
            ELSE a.birth_label
        END) AS detail
   FROM (artworks w
     JOIN artists a ON ((a.id = w.creator_id)))
  WHERE ((w.created IS NOT NULL) AND (((a.death IS NOT NULL) AND (w.created >> a.death)) OR ((a.birth IS NOT NULL) AND (w.created << a.birth))))
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
    p.artwork_id AS entity_id,
    ('prov-gap:'::text || p.id) AS issue_key,
    format('%s: the change of owner (%s) is not documented as direct, and the gap lies in 1933–1945'::text, p.owner_name, COALESCE(p.acquired_label, 'undated'::text)) AS detail
   FROM provenance_periods p
  WHERE ((p."position" > p.first_position) AND (NOT p.direct) AND (p.acquired IS NOT NULL) AND (p.prev_holding IS NOT NULL) AND (lower(p.prev_holding) < upper(p.acquired)) AND (daterange(lower(p.prev_holding), upper(p.acquired)) && daterange('1933-01-30'::date, '1945-05-09'::date)))
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
          WHERE ((r.artwork_id = p.artwork_id) AND (r."position" > p."position") AND (r.method = 'restitution'::acquisition_method))))))
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
         SELECT 'artwork'::entity_type,
            artworks.id,
            artworks.description_md
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type,
            places.id,
            places.description_md
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type,
            movements.id,
            movements.description_md
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type,
            institutions.id,
            institutions.description_md
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type,
            people.id,
            people.description_md
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type,
            polities.id,
            polities.description_md
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type,
            events.id,
            events.description_md
           FROM events
        UNION ALL
         SELECT 'term'::entity_type,
            glossary.id,
            glossary.description_md
           FROM glossary
          WHERE (glossary.definition IS NULL) AND glossary.category NOT IN ('material', 'object type')) t
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
         SELECT 'artwork'::entity_type,
            artworks.id,
            artworks.wikidata_id
           FROM artworks
        UNION ALL
         SELECT 'place'::entity_type,
            places.id,
            places.wikidata_id
           FROM places
        UNION ALL
         SELECT 'movement'::entity_type,
            movements.id,
            movements.wikidata_id
           FROM movements
        UNION ALL
         SELECT 'institution'::entity_type,
            institutions.id,
            institutions.wikidata_id
           FROM institutions
        UNION ALL
         SELECT 'person'::entity_type,
            people.id,
            people.wikidata_id
           FROM people
        UNION ALL
         SELECT 'polity'::entity_type,
            polities.id,
            polities.wikidata_id
           FROM polities
        UNION ALL
         SELECT 'event'::entity_type,
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
    ('prov-flag-co:'::text || c.provenance_id || ':'::text || c.owner_type || ':'::text || c.owner_id) AS issue_key,
    format('%s, joint owner (%s): %s'::text, e.name, COALESCE(p.period_label, 'undated'::text), holder_flag(c.owner_type, c.owner_id)) AS detail
   FROM provenance_co_owners_x c
     JOIN provenance_periods p ON p.id = c.provenance_id
     JOIN entity_index e ON e.type = c.owner_type AND e.id = c.owner_id
  WHERE (holder_flag(c.owner_type, c.owner_id) IS NOT NULL)
UNION ALL
-- An artwork's type or material that is no glossary term (yet): typed before 071, imported, or a phrase like
-- "oil paint on canvas" — sorted out on /quality/batch/terms
 SELECT 'unlinked_term'::text, 'info'::text, 'artwork'::entity_type, w.id, 'term:' || w.id || ':' || u.what || ':' || u.value,
    format('%s "%s" is not a glossary term', u.what, u.value)
   FROM artworks w
   CROSS JOIN LATERAL (SELECT 'type' AS what, w.kind AS value WHERE w.kind IS NOT NULL AND w.kind_term_id IS NULL
                       UNION ALL
                       SELECT 'material', m FROM unnest(w.materials) m
                        WHERE NOT EXISTS (SELECT 1 FROM artwork_materials am JOIN glossary g ON g.id = am.term_id
                                          WHERE am.artwork_id = w.id AND g.name = m)) u;

SELECT refresh_quality();
