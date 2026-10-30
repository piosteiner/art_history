// GET /v1/<plural>          list + search + time filter   (artists, artworks, places, movements, institutions, people, polities, glossary)
// GET /v1/<plural>/:slug    full record + all relationships in both directions + type-specific extras
//
// Public keys are slugs; internal ids never leave the API.
const express = require('express');
const { keyExpr, sortKey, natural } = require('../sortkey');
const { apiPool } = require('../db');
const { renderMarkdown, linkNames, firstParagraph, previewText } = require('../markdown');
const names = require('../names');
const bibliography = require('../bibliography');
const { badRequest, notFound, intParam, yearWindowRange } = require('../http');

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Images (table images, migration 017): the main image's URL for lists, and the whole ordered list for details.
// jsonb_agg(… ORDER BY …) builds the JSON array in Postgres, already in the right order.
const mainImage = (fk) => `(SELECT i.url FROM images i WHERE i.${fk} = t.id ORDER BY i.position, i.id LIMIT 1) AS image_url`;
const allImages = (fk) => `(SELECT coalesce(jsonb_agg(jsonb_build_object('url', i.url, 'source_url', i.source_url,
    'license', i.license, 'credit', i.credit, 'caption', i.caption) ORDER BY i.position, i.id), '[]'::jsonb)
  FROM images i WHERE i.${fk} = t.id) AS images, ${mainImage(fk)}`;

// Countries and polities (migration 019). country = today's country, derived from the entry's place (birthplace,
// place of creation, location); polities = the dated links to polities (nationality, created in, located in).
const countryCols = (type) => `entity_country('${type}', t.id) AS country, entity_polities('${type}', t.id) AS polities`;
// The birthplace with its country code, for people.
const birthPlace = (type) => `(SELECT jsonb_build_object('slug', pl.slug, 'name', pl.name, 'country_code', place_country(pl.id)->>'code')
  FROM places pl WHERE pl.id = entity_home_place('${type}', t.id)) AS birth_place`;
const countryFilters = (type) => ({
  country: `entity_country('${type}', t.id)->>'code' = upper($)`,
  polity: `EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id) = ('${type}', t.id)
             AND r.object_type = 'polity' AND r.object_id = entity_id('polity', $))`,
});

// Names in several languages (migration 022): language and furigana of the main name, the other names with their
// roles, the sort key (romanization first) — in lists and details. alt_names / alt_titles stay as plain lists for
// clients written before.
// search_text: what the database searches besides the name (other names, readings, kana in Latin letters, long and
// short — name_alt_text(), migration 023), for clients that filter loaded lists themselves.
const nameCols = (col, alt, type) => `t.${col}_lang, t.${col}_ruby, t.names, ${keyExpr(type, 't', col)} AS sort_key,
  coalesce(name_alt_text(t.${col}_ruby, t.names), '') AS search_text,
  (SELECT coalesce(jsonb_agg(ruby_plain(n->>'text')), '[]'::jsonb) FROM jsonb_array_elements(t.names) n) AS ${alt}`;
// raw markup → { <col>_ruby_html, <col>_reading } and names → [{text (plain), lang, role, status, kind, ruby_html, reading}]
// status: a translation's standing — official · common · own (052); null for the other roles
function shapeNames(row, col) {
  if (!('names' in row)) return row;
  const markup = row[`${col}_ruby`];
  delete row[`${col}_ruby`];
  row[`${col}_ruby_html`] = markup ? names.rubyHtml(markup) : null;
  row[`${col}_reading`] = markup ? names.reading(markup) : null;
  row.names = row.names.map((n) => ({ text: names.plain(n.text), lang: n.lang || null, role: n.role,
    status: n.role === 'translation' ? n.status || 'common' : null, kind: n.kind || null,  // 153: birth name, pseudonym …
    ruby_html: names.rubyHtml(n.text), reading: names.hasRuby(n.text) ? names.reading(n.text) : null }));
  return row;
}

// A person's roles, from their relationships (a patron is someone who commissioned or supported, not a type):
// patron · owner (of an artwork) · depicted (in an artwork). Sorted text[]; ?role=patron filters with @>.
// "owner" comes from the provenance (031), asked directly: a filter on the owner can't be pushed through the window
// functions of provenance_periods (they are partitioned by artwork), but here the index provenance_person_idx serves it.
const ROLES = 'person_roles(t.id)';  // patron / owner / depicted, from relationships and provenance (function, 110)

// Per type: which column is the name, which daterange drives ?from/?to, list/detail columns (SQL on alias t),
// extra list filters (?key=value → SQL with $ placeholder), Markdown columns, default order.
const ENTITIES = {
  artists: {
    type: 'artist', table: 'artists', alt: 'alt_names', name: 'name', period: 'coalesce(t.lifespan, t.active)',  // active: 147
    list: `t.sort_name, t.given_name, t.family_name, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
           range_json(t.active, t.active_label) AS active, ${mainImage('artist_id')},
           ${birthPlace('artist')}, ${countryCols('artist')},
           -- the collections holding their works (now) and that held them (before), with counts (164): a museum's name
           -- finds the artists, "3 works in the Galleria Borghese" — the counterpart of the museums' artists_held
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', i.slug, 'name', i.name, 'now', c.now, 'before', c.before)
                     ORDER BY c.now DESC, c.before DESC, i.name), '[]')
              FROM (SELECT h.institution_id, count(*) FILTER (WHERE h.now)::int AS now, count(*) FILTER (WHERE NOT h.now)::int AS before
                      FROM artwork_holders h JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                     WHERE aa.artist_id = t.id GROUP BY h.institution_id) c
              JOIN institutions i ON i.id = c.institution_id) AS collections`,
    detail: `t.sort_name, t.given_name, t.family_name, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
             range_json(t.active, t.active_label) AS active,
             ${allImages('artist_id')}, t.biography_md, ${birthPlace('artist')}, ${countryCols('artist')}`,
    md: ['biography_md'],
    filters: countryFilters('artist'),
    order: `${sortKey('artist', 't', 'name')}`,
  },
  artworks: {
    type: 'artwork', table: 'artworks', alt: 'alt_titles', name: 'title', period: 't.created',
    // a whole (037) without an image of its own shows its first part's; is_group: a series, versions, a cycle … (132)
    list: `range_json(t.created, t.created_label) AS created, t.kind, t.title_status,
           coalesce((SELECT i.url FROM images i WHERE i.artwork_id = t.id ORDER BY i.position, i.id LIMIT 1),
                    (SELECT i.url FROM artworks c JOIN images i ON i.artwork_id = c.id WHERE c.parent_id = t.id
                      ORDER BY c.part_sort NULLS LAST, c.part_number, c.id, i.position, i.id LIMIT 1)) AS image_url,
           artwork_is_group(t.kind_term_id) AS is_group, t.parts_count,
           (SELECT count(*)::int FROM artworks c WHERE c.parent_id = t.id) AS parts,
           (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
           (SELECT jsonb_build_object('slug', w.slug, 'title', w.title, 'kind', w.kind) FROM artworks w WHERE w.id = t.parent_id) AS part_of, t.part_number,
           artwork_creators(t.id) AS creators, t.on_loan, ${countryCols('artwork')},
           -- type and materials (their names in every language are in search_fields, 110)
           t.materials,
           upper(left(t.provenance_status::text, 1)) AS provenance_category, t.fate,  -- destroyed / partly_destroyed / lost (103)
           -- the institutions that hold it now and those that held it before (view artwork_holders, 107): searching a
           -- list for "Prado" finds what is there and what was
           (SELECT jsonb_build_object(
               'now', coalesce(jsonb_agg(jsonb_build_object('slug', i.slug, 'name', i.name) ORDER BY i.name) FILTER (WHERE h.now), '[]'),
               'before', coalesce(jsonb_agg(jsonb_build_object('slug', i.slug, 'name', i.name) ORDER BY i.name) FILTER (WHERE NOT h.now), '[]'))
             FROM artwork_holders h JOIN institutions i ON i.id = h.institution_id WHERE h.artwork_id = t.id) AS holders,
           (SELECT jsonb_build_object('documented_percent', c.documented_percent, 'has_provenance', c.has_provenance,
                     'gap_1933_1945', c.gap_1933_1945_days > 0) FROM provenance_completeness_stored c WHERE c.artwork_id = t.id) AS provenance_coverage`,
    detail: `t.attribution_label, t.title_status, range_json(t.created, t.created_label) AS created, t.created_span, t.kind, t.medium,
             artwork_is_group(t.kind_term_id) AS is_group,  -- a series, versions, a cycle … (132)
             range_json(t.conceived, t.conceived_label) AS conceived,
             -- 1933–1945 (074): the BAK category A–D, its meaning, the source's wording
             CASE WHEN t.provenance_status IS NOT NULL THEN jsonb_build_object('category', upper(left(t.provenance_status::text, 1)), 'code', t.provenance_status,
             'label', CASE t.provenance_status WHEN 'a_clear' THEN 'clarified: no looted art' WHEN 'b_no_indications' THEN 'not fully clarified, no indications of looted art'
               WHEN 'c_indications' THEN 'not fully clarified, indications of looted art or suspicious circumstances'
               ELSE 'looted art / seized as a result of Nazi persecution' END, 'note', t.provenance_status_note) END AS provenance_status,
             -- what became of it (103): null while extant
             -- partly destroyed without a date: losses at an unknown time (a statue without head and arms) — "fragmentary"
             CASE WHEN t.fate IS NOT NULL THEN jsonb_build_object('status', t.fate, 'label', CASE t.fate WHEN 'destroyed' THEN 'destroyed'
               WHEN 'partly_destroyed' THEN CASE WHEN t.fate_date IS NULL THEN 'fragmentary' ELSE 'partly destroyed' END ELSE 'lost' END,
               'date', range_json(t.fate_date, t.fate_date_label), 'note', t.fate_note,
               'event', fate_event(t.id)) END AS fate,  -- its cause: an event that concerns the work then (171)
             -- whether it was finished (172): null when finished as far as known
             CASE WHEN t.completion IS NOT NULL THEN jsonb_build_object('status', t.completion, 'label', CASE t.completion
               WHEN 'unfinished' THEN 'unfinished' ELSE 'finished by another hand' END,
               'date', range_json(t.completion_date, t.completion_date_label), 'note', t.completion_note) END AS completion,
             -- doubts about it (175): disputed or forgery; and an open theft in its provenance (not recovered)
             CASE WHEN t.authenticity IS NOT NULL THEN jsonb_build_object('status', t.authenticity, 'label', CASE t.authenticity
               WHEN 'disputed' THEN 'attribution disputed' ELSE 'forgery' END,
               'date', range_json(t.authenticity_date, t.authenticity_date_label), 'note', t.authenticity_note) END AS authenticity,
             artwork_stolen(t.id) AS stolen,
             (SELECT jsonb_build_object('slug', g.slug, 'name', g.name) FROM glossary g WHERE g.id = t.kind_term_id) AS kind_term,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', g.slug, 'name', g.name) ORDER BY am.position), '[]')
                FROM artwork_materials am JOIN glossary g ON g.id = am.term_id WHERE am.artwork_id = t.id) AS material_terms,
             artwork_term_names(t.id) AS term_names,
             t.inventory_number, t.on_loan, range_json(t.on_loan_since, t.on_loan_since_label) AS on_loan_since,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('_num_id', n.id, 'number', n.number, 'label', n.label,
                       'institution', (SELECT jsonb_build_object('slug', i.slug, 'name', i.name) FROM institutions i WHERE i.id = n.institution_id),
                       'source', (SELECT jsonb_build_object('slug', b.slug, 'name', b.name) FROM bibliography b WHERE b.id = n.source_id))
                     ORDER BY n.position, n.id), '[]'::jsonb) FROM artwork_numbers n WHERE n.artwork_id = t.id) AS numbers,
             t.web_url, iso_date(t.web_url_accessed) AS web_url_accessed, ${allImages('artwork_id')}, t.description_md, t.parts_count,
             t.materials,
             CASE WHEN t.height_cm IS NOT NULL THEN jsonb_build_object('height_cm', t.height_cm, 'width_cm', t.width_cm,
               'depth_cm', t.depth_cm, 'note', t.dimensions_note,
               'label', concat_ws(' × ', t.height_cm::float8, t.width_cm::float8, t.depth_cm::float8) || ' cm'
                        || CASE WHEN t.width_cm IS NULL THEN ' (height)' ELSE '' END) END AS dimensions,
             -- further measurements (migration 025): mount, frame … in the same shape as dimensions, plus the part
             -- the part's glossary term, a frame, a mount … (134): the site links it
             (SELECT coalesce(jsonb_agg(jsonb_build_object('part', e->>'part', 'height_cm', (e->'cm'->>0)::numeric,
                       'term', (SELECT jsonb_build_object('slug', g.slug, 'name', g.name) FROM glossary g
                                 WHERE g.id = term_by_name(e->>'part', ARRAY['mounting']::term_category[])),
                       'width_cm', (e->'cm'->>1)::numeric, 'depth_cm', (e->'cm'->>2)::numeric,
                       'label', (SELECT string_agg(x, ' × ' ORDER BY i) FROM jsonb_array_elements_text(e->'cm') WITH ORDINALITY AS c(x, i)) || ' cm'
                                || CASE WHEN jsonb_array_length(e->'cm') = 1 THEN ' (height)' ELSE '' END) ORDER BY o), '[]'::jsonb)
                FROM jsonb_array_elements(t.other_dimensions) WITH ORDINALITY AS d(e, o)) AS other_dimensions,
             (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
             artwork_creators(t.id) AS creators,  -- main creator + co-creators (migration 028)
             (SELECT jsonb_build_object('slug', i.slug, 'name', i.name) FROM institutions i WHERE i.id = t.current_institution_id) AS institution,
             -- where it stands (immovable works only, migration 034)
             ST_AsGeoJSON(t.location)::jsonb AS location, ST_AsGeoJSON(t.area)::jsonb AS area,
             ${countryCols('artwork')}`,
    md: ['description_md'],
    filters: {
      // main creator or co-creator (migration 028)
      creator: `(t.creator_id = entity_id('artist', $) OR EXISTS (SELECT 1 FROM relationships r
                 WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.subject_id = t.id
                   AND r.object_type = 'artist' AND r.object_id = entity_id('artist', $)))`,
      institution: "t.current_institution_id = entity_id('institution', $)",
      // by the term's slug or any of its names, any language (071): ?kind=Holzschnitt finds the woodblock prints;
      // with the terms under it (146): ?kind=print finds woodcuts too, ?material=wood the oak panels
      kind: `(t.kind = $ OR t.kind_term_id IN (SELECT glossary_with_narrower(coalesce((SELECT id FROM glossary WHERE slug = $), term_by_name($, kind_categories())))))`,
      material: `(t.materials @> ARRAY[$]::text[] OR EXISTS (SELECT 1 FROM artwork_materials am WHERE am.artwork_id = t.id
                   AND am.term_id IN (SELECT glossary_with_narrower(coalesce((SELECT id FROM glossary WHERE slug = $), term_by_name($, ARRAY['material']::term_category[]))))))`,
      part_of: "t.parent_id = entity_id('artwork', $)",  // the parts of a series / album …
      // gaps in the provenance (078): ?provenance_gap=1933-1945 (no holder known for some time then) or any
      provenance_gap: `(SELECT CASE $ WHEN '1933-1945' THEN c.gap_1933_1945_days > 0 WHEN 'any' THEN c.gap_days > 0 END
                        FROM provenance_completeness_stored c WHERE c.artwork_id = t.id)`,
      ...countryFilters('artwork'),
    },
    order: `lower(t.created) NULLS LAST, ${sortKey('artwork', 't', 'title')}`,
  },
  places: {
    type: 'place', table: 'places', alt: 'alt_names', name: 'name', period: null,
    // location / area: what to draw — own point and outline, else derived (view place_geo, migration 032):
    // a country with only its code gets the Natural Earth outline and label point
    // country_code: its country today — by hand, else where its point lies, else its parent's (155); `within`: the
    // first-level division (canton, Land, province) its point lies in, from Natural Earth
    list: `t.kind, t.designation, place_qualifier(t.id) AS qualifier, place_country(t.id)->>'code' AS country_code, t.boundary_code, (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = t.id) AS location`,
    detail: `t.kind, t.designation, place_qualifier(t.id) AS qualifier, range_json(t.existed, t.existed_label) AS existed, place_country(t.id)->>'code' AS country_code, t.boundary_code, (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = t.id) AS location,
             (SELECT jsonb_build_object('code', b.code, 'name', b.name) FROM boundaries b WHERE b.code = t.within_code AND b.level = 1) AS within,
             (SELECT ST_AsGeoJSON(g.outline)::jsonb FROM place_geo g WHERE g.id = t.id) AS area,
             (SELECT jsonb_build_object('location', CASE WHEN t.location IS NOT NULL THEN 'own' ELSE 'derived' END,
                                        'area', g.outline_source) FROM place_geo g WHERE g.id = t.id) AS geometry_source,
             t.description_md`,
    md: ['description_md'],
    filters: { kind: 't.kind::text = $', country: 't.country_code = upper($)' },
    order: `${sortKey('place', 't', 'name')}`,
  },
  movements: {
    type: 'movement', table: 'movements', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind::text = $' },
    order: `lower(t.period) NULLS LAST, ${sortKey('movement', 't', 'name')}`,
  },
  institutions: {
    type: 'institution', table: 'institutions', alt: 'alt_names', name: 'name', period: 't.founded',
    list: `t.kind, range_json(t.founded, t.founded_label) AS founded, range_json(t.dissolved, t.dissolved_label) AS dissolved, ${mainImage('institution_id')},
           ST_AsGeoJSON(t.location)::jsonb AS location,
           (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = t.place_id) AS place,
           ${countryCols('institution')},
           -- the artists of the works it holds (now) and held (before), with counts (107): an artist's name finds the
           -- museums with their works, "12 works by Vincent van Gogh" links to them
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.name, 'now', c.now, 'before', c.before)
                     ORDER BY c.now DESC, c.before DESC, a.name), '[]')
              FROM (SELECT aa.artist_id, count(*) FILTER (WHERE h.now)::int AS now, count(*) FILTER (WHERE NOT h.now)::int AS before
                      FROM artwork_holders h JOIN artwork_artists aa ON aa.artwork_id = h.artwork_id
                     WHERE h.institution_id = t.id GROUP BY aa.artist_id) c
              JOIN artists a ON a.id = c.artist_id) AS artists_held`,
    detail: `t.kind, range_json(t.founded, t.founded_label) AS founded, range_json(t.dissolved, t.dissolved_label) AS dissolved, t.website_url, t.description_md,
             ST_AsGeoJSON(t.location)::jsonb AS location, t.address,
             ${allImages('institution_id')},
             (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'location', (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = p.id))
                FROM places p WHERE p.id = t.place_id) AS place, ${countryCols('institution')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', ...countryFilters('institution') },
    order: `${sortKey('institution', 't', 'name')}`,
  },
  people: {
    type: 'person', table: 'people', alt: 'alt_names', name: 'name', period: 'coalesce(t.lifespan, t.active)',
    list: `t.sort_name, t.given_name, t.family_name, t.kind, t.occupations, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
           range_json(t.active, t.active_label) AS active, ${ROLES} AS roles, ${birthPlace('person')}, ${countryCols('person')}, ${mainImage('person_id')}`,
    detail: `t.sort_name, t.given_name, t.family_name, t.kind, t.occupations, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
             range_json(t.active, t.active_label) AS active, ${ROLES} AS roles, t.description_md, ${birthPlace('person')}, ${countryCols('person')}, ${allImages('person_id')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', occupation: 't.occupations @> ARRAY[$]::text[]', role: `${ROLES} @> ARRAY[$]::text[]`, ...countryFilters('person') },
    order: `${sortKey('person', 't', 'name')}`,
  },
  glossary: {
    type: 'term', table: 'glossary', alt: 'alt_names', name: 'name', period: null,
    list: `t.category, t.definition, ${mainImage('glossary_id')}`,
    detail: `t.category, t.definition, t.description_md, ${allImages('glossary_id')}`,
    md: ['description_md'],
    filters: { category: 't.category::text = $' },
    order: `${sortKey('term', 't', 'name')}`,
  },
  // the bibliography (migration 036); siglum and the full citation are added in JS (src/bibliography.js)
  bibliography: {
    type: 'source', table: 'bibliography', alt: 'alt_names', name: 'name', period: null,
    list: `t.kind, t.subtitle, t.authors, t.year, t.reading_status, range_json(t.read_on, t.read_on_label) AS read_on, t.primary_source`,
    detail: `t.kind, t.subtitle, t.authors, t.editors, t.compilers, t.container, t.container_editors, t.volume, t.issue, t.issue_date,
             t.volumes_total, t.edition, t.original_year, t.series, t.thesis, t.place, t.publisher, t.year, t.pages, t.pages_are_columns,
             t.catalogue_number, t.exhibition, t.url, range_json(t.accessed, t.accessed_label) AS accessed, t.uploader,
             range_json(t.uploaded, t.uploaded_label) AS uploaded, t.date_text, t.archive, t.shelfmark, t.isbn, t.doi,
             t.primary_source, t.reading_status, range_json(t.read_on, t.read_on_label) AS read_on, t.description_md`,
    md: ['description_md'],
    filters: { kind: 't.kind::text = $', status: 't.reading_status::text = $', author: "f_unaccent(t.authors::text) ILIKE '%' || f_unaccent($) || '%'" },  // accents folded (080)
    order: `coalesce(t.authors[1], ${keyExpr('source', 't')}) COLLATE sort_natural, t.year`,
  },
  // events (migration 047): when, where (city; exact spot or area), part of a larger event, its parts
  events: {
    type: 'event', table: 'events', alt: 'alt_names', name: 'name', period: 't.period',
    list: `t.kind, range_json(t.period, t.period_label) AS period, ${mainImage('event_id')},
           (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = t.place_id) AS place,
           (SELECT jsonb_build_object('slug', w.slug, 'name', w.name) FROM events w WHERE w.id = t.parent_id) AS part_of,
           ST_AsGeoJSON(coalesce(t.location, ST_PointOnSurface(t.area::geometry)::geography))::jsonb AS location, ${countryCols('event')}`,
    detail: `t.kind, range_json(t.period, t.period_label) AS period, t.description_md, ${allImages('event_id')},
             ST_AsGeoJSON(t.location)::jsonb AS location, ST_AsGeoJSON(t.area)::jsonb AS area,
             (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'location', (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = p.id))
                FROM places p WHERE p.id = t.place_id) AS place,
             (SELECT jsonb_build_object('slug', w.slug, 'name', w.name) FROM events w WHERE w.id = t.parent_id) AS part_of,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name, 'kind', c.kind, 'period', range_json(c.period, c.period_label))
                ORDER BY lower(c.period) NULLS LAST, ${sortKey('event', 'c')}), '[]'::jsonb) FROM events c WHERE c.parent_id = t.id) AS parts,
             ${countryCols('event')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', place: "t.place_id = entity_id('place', $)", part_of: "t.parent_id = entity_id('event', $)", ...countryFilters('event') },
    order: `lower(t.period) NULLS LAST, ${sortKey('event', 't', 'name')}`,
  },
  polities: {
    type: 'polity', table: 'polities', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind = $', country: 't.country_codes @> ARRAY[upper($)]' },  // GIN index polities_country_gin
    order: `lower(t.period) NULLS LAST, ${sortKey('polity', 't', 'name')}`,
  },
};

// Country names for codes we have no country place for (Tahiti → PF → "French Polynesia"): ICU's English names.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function nameCountry(row) {
  if (row.country && row.country.code && !row.country.name) {
    try { row.country.name = regionNames.of(row.country.code); } catch { row.country.name = row.country.code; }
  }
  return row;
}

// An edge's category as shown: an artwork depicting another artwork or an event is a depiction like a portrait —
// stored as `depicts`, whose places are map material (category association). The graph uses it too (graph.js).
const edgeCategory = (r, rt) => `CASE WHEN ${rt}.code = 'depicts' AND ${r}.object_type <> 'place' THEN 'depiction' ELSE ${rt}.category END`;

// Everything connected to one entity, in both directions (the stored graph: a moment behind a change, never a full
// computation of the edges view per request). The label is read from the entity's point of view:
// Van Gogh "lived in" Arles, Arles is "home of" Van Gogh.
const RELATIONSHIPS_SQL = `
  SELECT rt.code AS type,
         CASE WHEN rt.is_symmetric THEN 'mutual'
              WHEN r.subject_type = $1 AND r.subject_id = $2 THEN 'outgoing' ELSE 'incoming' END AS direction,
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 OR rt.is_symmetric THEN rt.label ELSE rt.inverse_label END AS label,
         ${edgeCategory('r', 'rt')} AS category, rt.is_physical_presence,
         jsonb_build_object('type', o.type, 'slug', o.slug, 'public_id', o.public_id, 'name', o.name,
                            'period', range_json(o.period, o.period_label),
                            -- what sets a place apart from others of its name (162): "Cambridge (Massachusetts)"
                            'qualifier', CASE WHEN o.type = 'place' THEN place_qualifier(o.id) END,
                            -- its name then (152/159): a former name in use during the relationship ("lived in Tokyo (then Edo)")
                            'name_then', CASE WHEN r.period IS NOT NULL THEN (SELECT jsonb_build_object('text', ruby_plain(nt.text), 'lang', nt.lang,
                              'period', range_json(nt.period, nt.period_label), 'note', nt.note) FROM name_then(o.type, o.id, r.period) nt WHERE nt.id IS NOT NULL) END,
                            -- the state it belonged to then (161): a place's, an institution's city's — at the start of the relationship
                            'polity_then', CASE WHEN r.period IS NOT NULL AND o.type IN ('place', 'institution') THEN (
                              SELECT jsonb_build_object('slug', pl.slug, 'public_id', pl.public_id, 'name', pl.name)
                              FROM polities_at(CASE o.type WHEN 'place' THEN o.id ELSE (SELECT i.place_id FROM institutions i WHERE i.id = o.id) END, r.period) x
                              JOIN polities pl ON pl.id = x.polity_id ORDER BY lower(x.period) NULLS FIRST LIMIT 1) END) AS entity,
         range_json(r.period, r.period_label) AS period,
         r.label AS note, r.certainty, r.notes_md,
         r.source <> 'relationship' AS derived, r.end_basis,  -- derived: the creator field or the provenance (031)
         CASE WHEN r.source = 'relationship' THEN r.relationship_id END AS _rel_id, r.provenance_id AS _prov_id,  -- for their sources
         r.source AS _source
  FROM graph_links r  -- the edges view stored (088), kept up to date per change (126): indexed both ways
  JOIN relationship_types rt ON rt.code = r.relationship_type
  -- the "other" end: object for outgoing edges, subject for incoming ones
  JOIN entity_index o ON (o.type, o.id) = (
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_type ELSE r.subject_type END,
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_id   ELSE r.subject_id   END)
  -- the creator edges are left out: the artwork's creator / creators and the artist's artworks already list them
  WHERE ((r.subject_type = $1 AND r.subject_id = $2) OR (r.object_type = $1 AND r.object_id = $2)) AND r.source <> 'creator'
  ORDER BY rt.sort_order, lower(r.period) NULLS LAST, ${natural('o.sort_key')}`;

// Someone in several phases of a building's history (169) — Frederick I commissioning Schlüter's and Eosander's parts —
// is one line: the phases' labels together, the period from the first start to the last end.
function mergePhaseEdges(rows) {
  const first = new Map();
  return rows.filter((r) => {
    const source = r._source;
    delete r._source;
    if (source !== 'phase') return true;
    const key = `${r.type}|${r.direction}|${r.entity.type}/${r.entity.slug}`;
    const a = first.get(key);
    if (!a) { first.set(key, r); return true; }
    a.note = [a.note, r.note].filter(Boolean).join('; ') || null;
    if (a.period && r.period) {
      const later = (x, y) => (x == null || y == null ? null : (x > y ? x : y));
      a.period = { ...a.period, label: `${a.period.label}, ${r.period.label}`, to: later(a.period.to, r.period.to), to_year: later(a.period.to_year, r.period.to_year) };
    } else a.period = a.period || r.period;
    return false;
  });
}

// Hierarchy upwards (Arles → France), a recursive CTE over parent_id.
const ancestorsSql = (table) => `
  WITH RECURSIVE up AS (
    SELECT parent_id, 1 AS depth FROM ${table} WHERE id = $1
    UNION ALL
    SELECT t.parent_id, up.depth + 1 FROM up JOIN ${table} t ON t.id = up.parent_id WHERE up.depth < 20
  )
  SELECT t.slug, t.name FROM up JOIN ${table} t ON t.id = up.parent_id ORDER BY up.depth`;

// Type-specific additions to the detail response.
const EXTRAS = {
  artist: async (id) => ({
    artworks: (await apiPool.query(`
      SELECT w.slug, w.title, range_json(w.created, w.created_label) AS created, w.kind,
             co.role IS NOT NULL AS co_creator, co.label AS role
      FROM artworks w
      LEFT JOIN LATERAL (SELECT 'co' AS role, string_agg(x.label, '; ' ORDER BY x.o) AS label FROM (
                          SELECT r.label, 0 AS o FROM relationships r
                          WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.subject_id = w.id
                            AND r.object_type = 'artist' AND r.object_id = $1
                          UNION ALL  -- the phases of its building history (169), all in one: "architect · Dome; …"
                          SELECT concat_ws(' · ', pp.role, ph.title), ph.position FROM artwork_phase_people pp JOIN artwork_phases ph ON ph.id = pp.phase_id
                          WHERE ph.artwork_id = w.id AND pp.artist_id = $1) x
                          HAVING count(*) > 0) co ON w.creator_id IS DISTINCT FROM $1
      WHERE w.creator_id = $1 OR co.role IS NOT NULL
      ORDER BY lower(w.created) NULLS LAST, ${sortKey('artwork', 'w', 'title')}`, [id])).rows,
  }),
  // the provenance (031, 063): the chain as it is read — kind "creation" (implied: the artist, from the creator and the
  // date), "step" (recorded), "loan" (implied: on loan at the current institution) — each with its computed period and
  // where its end comes from, the holder's role, joint owners and the price
  artwork: async (id) => ({
    // the building history (169): phases in order — kind, title, parts, period, text; who took part with role and patron
    phases: (await apiPool.query(`
      SELECT ph.kind::text AS kind, ph.title, ph.part, range_json(ph.period, ph.period_label) AS period, ph.notes_md,
             coalesce((SELECT jsonb_agg(jsonb_build_object('type', e.type, 'slug', e.slug, 'name', e.name, 'public_id', e.public_id,
                         'role', pp.role, 'patron', pp.patron) ORDER BY pp.position, pp.id)
                       FROM artwork_phase_people pp
                       JOIN entity_index e ON (e.type, e.id) = (CASE WHEN pp.artist_id IS NOT NULL THEN 'artist'::entity_type
                            WHEN pp.person_id IS NOT NULL THEN 'person'::entity_type ELSE 'institution'::entity_type END,
                            coalesce(pp.artist_id, pp.person_id, pp.institution_id))
                       WHERE pp.phase_id = ph.id), '[]'::jsonb) AS people
      FROM artwork_phases ph WHERE ph.artwork_id = $1 ORDER BY ph.position, ph.id`, [id])).rows,
    // series and other wholes (migration 037): what it is part of (the chain upwards, nearest first), its neighbours,
    // and — for a whole — its parts in order
    part_of: (await apiPool.query(`
      WITH RECURSIVE up AS (
        SELECT w.id, w.parent_id, 1 AS depth FROM artworks a JOIN artworks w ON w.id = a.parent_id WHERE a.id = $1
        UNION ALL
        SELECT w.id, w.parent_id, up.depth + 1 FROM up JOIN artworks w ON w.id = up.parent_id WHERE up.depth < 10
      ) SELECT w.slug, w.title, w.kind, w.parts_count, artwork_is_group(w.kind_term_id) AS is_group  -- is_group (132): "Version 2 of 3"
      FROM up JOIN artworks w ON w.id = up.id ORDER BY up.depth`, [id])).rows,
    ...(await apiPool.query(`
      WITH me AS (SELECT parent_id, part_number, part_sort, title FROM artworks WHERE id = $1),
      sib AS (SELECT a.id, a.slug, a.title, a.part_number,
                     row_number() OVER (ORDER BY a.part_sort NULLS LAST, a.part_number, ${sortKey('artwork', 'a', 'title')}) AS n
              FROM artworks a, me WHERE a.parent_id = me.parent_id)
      SELECT (SELECT part_number FROM me) AS part_number,
             (SELECT jsonb_build_object('slug', p.slug, 'title', p.title, 'part_number', p.part_number) FROM sib p, sib s
                WHERE s.id = $1 AND p.n = s.n - 1) AS previous_part,
             (SELECT jsonb_build_object('slug', p.slug, 'title', p.title, 'part_number', p.part_number) FROM sib p, sib s
                WHERE s.id = $1 AND p.n = s.n + 1) AS next_part`, [id])).rows[0],
    parts: (await apiPool.query(`
      SELECT a.slug, a.title, a.part_number, a.kind, range_json(a.created, a.created_label) AS created,
             (SELECT i.url FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) AS image_url,
             (SELECT count(*)::int FROM artworks c WHERE c.parent_id = a.id) AS parts
      FROM artworks a WHERE a.parent_id = $1 ORDER BY a.part_sort NULLS LAST, a.part_number, ${sortKey('artwork', 'a', 'title')}`, [id])).rows,
    // how far it travelled along its provenance stops (091): null without two places
    travel: await (async () => {
      const { rows: [t] } = await apiPool.query('SELECT km, legs, placed, steps FROM artwork_travel($1)', [id]);
      return t && t.legs ? t : null;
    })(),
    // where the provenance is silent (078): the time since the creation as documented / presumed / gap stretches
    provenance_coverage: await (async () => {
      const [summary, segments] = await Promise.all([
        apiPool.query('SELECT documented_percent, has_provenance, gap_days, gap_1933_1945_days FROM provenance_completeness WHERE artwork_id = $1', [id]),
        apiPool.query(`SELECT kind, range_json(period) AS period, in_1933_1945, before_name AS before, after_name AS after,
                              coalesce(candidates, '{}') AS candidates, before_position, after_position,
                              -- the step it is shown after (079): the last one between its owners dated before it
                              CASE WHEN kind = 'gap' AND before_position IS NOT NULL
                                   THEN provenance_gap_anchor($1, before_position, after_position, period) END AS show_after
                       FROM provenance_coverage($1) ORDER BY period`, [id])]);
      const c = summary.rows[0];
      if (!c || !segments.rows.length) return null;
      return { documented_percent: c.documented_percent, has_provenance: c.has_provenance,
        gap_years: Math.round(c.gap_days / 365.25 * 10) / 10, gap_1933_1945_years: Math.round(c.gap_1933_1945_days / 365.25 * 10) / 10,
        segments: segments.rows };
    })(),
    provenance: (await apiPool.query(`
      SELECT p.kind, p.kind <> 'step' AS implied, p.position,
             CASE WHEN p.owner_id IS NOT NULL THEN jsonb_build_object('type', p.owner_type, 'slug', o.slug, 'public_id', o.public_id, 'name', o.name,
               -- 152: the holder's former name in use then (at the acquisition, else during the holding)
               'name_then', (SELECT jsonb_build_object('text', ruby_plain(nt.text), 'lang', nt.lang, 'period', range_json(nt.period, nt.period_label), 'kind', nt.kind, 'note', nt.note)
                               FROM name_then(p.owner_type, p.owner_id, coalesce(p.acquired, p.period)) nt WHERE nt.id IS NOT NULL)) END AS owner,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('type', c.owner_type, 'slug', x.slug, 'public_id', x.public_id, 'name', x.name) ORDER BY c.position), '[]')
                FROM provenance_co_owners_x c JOIN entity_index x ON (x.type, x.id) = (c.owner_type, c.owner_id)
               WHERE c.provenance_id = p.id) AS co_owners,
             p.role, p.owner_label, p.owner_name, range_json(p.acquired, p.acquired_label) AS acquired, range_json(p.ended, p.ended_label) AS ended,
             p.method, p.direct, p.label, p.certainty,
             CASE WHEN p.price IS NOT NULL THEN jsonb_build_object('amount', p.price, 'currency', p.price_currency, 'note', p.price_note,
               -- in today's Swiss francs (090) — null until exchange rates and price indices are loaded
               'chf_today', price_value(p.price, p.price_currency, lower(p.acquired))) END AS price,
             (SELECT jsonb_build_object('slug', l.slug, 'name', l.name) FROM places l WHERE l.id = p.location_id) AS place,
             range_json(p.period, p.period_label) AS period, p.end_basis, p.notes_md, p.id AS _prov_id,
             -- 074: custody steps (agent, custodian) run beside the ownership; an agent that didn't sell; the agents a handover went through
             p.in_chain, p.not_sold, p.via,
             -- 096: dated after today, announced (an auction to come) — not yet a fact; until when
             (SELECT pv.check_after::text FROM provenance pv WHERE pv.id = p.id) AS planned_until,
             -- 077: further places in order, the step's numbers, the event it belongs to
             (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', l.slug, 'name', l.name, 'period', range_json(x.period, x.period_label)) ORDER BY x.position), '[]')
                FROM provenance_places x JOIN places l ON l.id = x.place_id WHERE x.provenance_id = p.id) AS further_places,
             -- 113: shared = other works recording the same number within its reach (the site links it only then)
             (SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'label', k.label, 'number', n.number,
                       'shared', (SELECT count(DISTINCT x.artwork_id) FROM provenance_number_peers(n.id) x)) ORDER BY n.position), '[]')
                FROM provenance_numbers n JOIN provenance_number_kinds k ON k.code = n.kind WHERE n.provenance_id = p.id) AS numbers,
             (SELECT jsonb_build_object('slug', ev.slug, 'name', ev.name) FROM provenance pv JOIN events ev ON ev.id = pv.event_id WHERE pv.id = p.id) AS event,
             -- 104: the records under the step — inventory entries, catalogues, exhibitions, sightings — by date
             (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'date', range_json(r.date, r.date_label),
                       'place', CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('slug', l.slug, 'name', l.name) END,
                       'room', r.room, 'number', r.number, 'number_certainty', r.number_certainty, 'document', r.document, 'id', r.id,
                       'shared', CASE WHEN r.number IS NOT NULL THEN (SELECT count(DISTINCT x.artwork_id) FROM provenance_record_peers(r.id) x) END,
                       'certainty', r.certainty, 'note', r.note) ORDER BY lower(r.date) NULLS LAST, r.position), '[]')
                FROM provenance_records r LEFT JOIN places l ON l.id = r.place_id WHERE r.provenance_id = p.id) AS records,
             -- 084: what was given in exchange; other sources' readings of this step (not part of the chain)
             (SELECT CASE WHEN pv.exchanged_for_artwork_id IS NOT NULL OR pv.exchanged_for_text IS NOT NULL THEN jsonb_build_object(
                       'artwork', (SELECT jsonb_build_object('slug', x.slug, 'title', x.title) FROM artworks x WHERE x.id = pv.exchanged_for_artwork_id),
                       'text', pv.exchanged_for_text) END FROM provenance pv WHERE pv.id = p.id) AS exchanged_for,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('_prov_id', a.id,
                       'owner', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('type', o.type, 'slug', o.slug, 'public_id', o.public_id, 'name', o.name) END,
                       'owner_label', a.owner_label, 'role', a.role, 'method', a.method,
                       'acquired', range_json(a.acquired, a.acquired_label), 'ended', range_json(a.ended, a.ended_label),
                       'label', a.label, 'certainty', a.certainty, 'notes_md', a.notes_md) ORDER BY a.position), '[]')
                FROM provenance a
                LEFT JOIN entity_index o ON (o.type, o.id) = (CASE WHEN a.owner_artist_id IS NOT NULL THEN 'artist' WHEN a.owner_person_id IS NOT NULL THEN 'person'
                                                                   WHEN a.owner_institution_id IS NOT NULL THEN 'institution' WHEN a.owner_place_id IS NOT NULL THEN 'place' END::entity_type,
                                                              coalesce(a.owner_artist_id, a.owner_person_id, a.owner_institution_id, a.owner_place_id))
                WHERE a.alternative_to = p.id) AS alternatives,
             -- 086: what the dates and places imply for this step (biography × provenance)
             (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'text', i.detail, 'period', range_json(i.period), 'km', i.km) ORDER BY i.kind), '[]')
                FROM provenance_inferences i WHERE i.artwork_id = $1 AND i.provenance_id = p.id) AS inferences  -- by work: reaches into the view (126)
      FROM provenance_chain p LEFT JOIN entity_index o ON (o.type, o.id) = (p.owner_type, p.owner_id)
      WHERE p.artwork_id = $1 ORDER BY p.position`, [id])).rows,
  }),
  institution: async (id) => ({
    artworks: (await apiPool.query(`
      SELECT w.slug, w.title, range_json(w.created, w.created_label) AS created,
             (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = w.creator_id) AS creator
      FROM artworks w WHERE w.current_institution_id = $1 ORDER BY ${sortKey('artwork', 'w', 'title')}`, [id])).rows,
  }),
  place: async (id) => ({
    // the states it belonged to over time (161), inherited from the places above it — the nearest link winning
    polities: (await apiPool.query(`
      SELECT jsonb_build_object('slug', pl.slug, 'public_id', pl.public_id, 'name', pl.name) AS polity,
             -- the link's own label when the piece is all of it, else its years (a piece cut by a link further down)
             range_json(t.period, CASE WHEN t.period = r.period THEN r.period_label
               WHEN lower(t.period) IS NULL AND upper(t.period) IS NULL THEN NULL
               WHEN lower(t.period) IS NULL THEN 'until ' || extract(year FROM upper(t.period) - 1)
               WHEN upper(t.period) IS NULL THEN 'since ' || extract(year FROM lower(t.period))
               ELSE extract(year FROM lower(t.period)) || '–' || extract(year FROM upper(t.period) - 1) END) AS period,
             CASE WHEN t.via_place_id <> $1 THEN jsonb_build_object('slug', v.slug, 'name', v.name) END AS via
      FROM polity_timeline($1) t JOIN polities pl ON pl.id = t.polity_id JOIN places v ON v.id = t.via_place_id
      JOIN relationships r ON r.id = t.relationship_id
      ORDER BY lower(t.period) NULLS FIRST`, [id])).rows,
    ancestors: (await apiPool.query(ancestorsSql('places'), [id])).rows,
    children: (await apiPool.query(`SELECT slug, name, kind FROM places WHERE parent_id = $1 ORDER BY ${natural('name')}`, [id])).rows,
    institutions: (await apiPool.query(`SELECT slug, name, kind FROM institutions t WHERE place_id = $1 ORDER BY ${sortKey('institution', 't')}`, [id])).rows,
  }),
  polity: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('polities'), [id])).rows,
    children: (await apiPool.query(`
      SELECT slug, name, kind, range_json(period, period_label) AS period
      FROM polities WHERE parent_id = $1 ORDER BY lower(period) NULLS LAST, ${natural('name')}`, [id])).rows,
  }),
  // a glossary term: where texts link it ("used in"), from the view glossary_links; its broader terms upwards
  // (Yoroboshi → Noh → …, nearest first) and the terms directly under it (145)
  term: async (id) => ({
    broader: (await apiPool.query(ancestorsSql('glossary'), [id])).rows,
    narrower: (await apiPool.query(`
      SELECT slug, name, category::text AS category, definition FROM glossary t WHERE parent_id = $1 ORDER BY ${sortKey('term', 't')}`, [id])).rows,
    used_in: (await apiPool.query(`
      SELECT e.type::text AS type, e.slug, e.name FROM glossary_links l
      JOIN glossary g ON g.slug = l.term_slug JOIN entity_index e ON (e.type, e.id) = (l.entity_type, l.entity_id)
      WHERE g.id = $1 AND NOT (e.type = 'term' AND e.id = $1) ORDER BY ${natural('e.sort_key')}`, [id])).rows,
  }),
  movement: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('movements'), [id])).rows,
    children: (await apiPool.query(`
      SELECT slug, name, kind, range_json(period, period_label) AS period
      FROM movements t WHERE parent_id = $1 ORDER BY lower(period) NULLS LAST, ${sortKey('movement', 't')}`, [id])).rows,
  }),
};

// env: { terms (glossary names for [[slug]]), used (collects the linked slugs) } — see src/markdown.js
function renderMd(row, fields, env = {}) {
  for (const f of fields) {
    row[f.replace(/_md$/, '_html')] = renderMarkdown(row[f], env);
    delete row[f];
  }
  return row;
}

// Previews of the entries a page's texts [[link]] (view entry_previews, migration 040), for hover popovers like
// Wikipedia's: {"artist/katsushika-hokusai": {type, name, subtitle, image_url, excerpt}}. Only existing entries
// (names has them), not terms or sources — those have their own maps (glossary, bibliography). The excerpts' own
// links read as names too: one more linkNames() over their first paragraphs.
async function entryPreviews(linked) {
  return previewsOf([...linked.keys()].filter((r) => !r.startsWith('term/') && !r.startsWith('source/')));
}

// Previews for a list of "type/slug" refs — the texts' links above, and GET /v1/previews for any internal link.
async function previewsOf(refs) {
  if (!refs.length) return {};
  // two parallel arrays, unnest()ed into (type, slug) pairs: a row comparison the planner can join on
  const { rows } = await apiPool.query(`
    SELECT p.type::text AS type, p.slug, (SELECT e.public_id FROM entity_index e WHERE (e.type, e.slug) = (p.type, p.slug)) AS public_id,
           p.name, p.subtitle, p.image_url, p.text_md FROM entry_previews p
    WHERE (p.type, p.slug) IN (SELECT * FROM unnest($1::entity_type[], $2::text[]))`,
  [refs.map((r) => r.split('/')[0]), refs.map((r) => r.split('/')[1])]);
  const env = { names: await linkNames(apiPool, rows.map((r) => firstParagraph(r.text_md))) };
  return Object.fromEntries(rows.map(({ text_md, ...r }) => [`${r.type}/${r.slug}`, { ...r, excerpt: previewText(text_md, env) }]));
}

const router = express.Router();

// GET /v1/previews?refs=artist/paul-gauguin,place/arles,term/contrapposto — previews of any entries (max. 100), for
// hover popovers on every internal link of a page (fields, relationships, lists, map popups): one request per page.
// Entries that don't exist are left out. Same shape as a detail's `entries`.
const PREVIEW_TYPES = new Set(['artist', 'artwork', 'institution', 'person', 'movement', 'place', 'polity', 'event', 'term', 'source']);
router.get('/previews', async (req, res) => {
  const refs = [...new Set(String(req.query.refs || '').split(',').map((r) => r.trim()).filter(Boolean))];
  if (refs.length > 100) throw badRequest('at most 100 refs');
  const bad = refs.filter((r) => !/^[a-z]+\/[a-z0-9]+(-[a-z0-9]+)*$/.test(r) || !PREVIEW_TYPES.has(r.split('/')[0]));
  if (bad.length) throw badRequest(`not "type/slug": ${bad.slice(0, 3).join(', ')}`);
  res.json({ data: await previewsOf(refs) });
});

// A list's rows for some entries (Map id → row): what the lists serve, computed. The worker stores them per change
// (entry_list_rows, 127: an artwork's row — country, holders now and before, provenance coverage, creators, search
// fields — took ≈ 4 ms; a list of 3,500 artworks 15 s); the list endpoint computes only those not stored yet.
async function listRows(db, plural, ids) {
  const e = ENTITIES[plural];
  const { rows } = await db.query(`
    SELECT t.id AS _id, t.public_id, t.slug, t.${e.name}, ${nameCols(e.name, e.alt, e.type)}, ${e.list},
           -- what a search finds besides the name (view entry_search_fields, 110): the admin's lists use the same
           entry_search_fields_json('${e.type}', t.id) AS search_fields
    FROM ${e.table} t WHERE t.id = ANY ($1::bigint[])`, [ids]);
  return new Map(rows.map(({ _id, ...r }) => [String(_id), nameCountry(shapeNames(r, e.name))]));
}

for (const [plural, e] of Object.entries(ENTITIES)) {
  router.get(`/${plural}`, async (req, res) => {
    const limit = intParam(req.query, 'limit', { min: 1, max: 500, fallback: 100 });
    const offset = intParam(req.query, 'offset', { min: 0, max: 1e6, fallback: 0 });
    const window = yearWindowRange(req.query);
    if (window && !e.period) throw badRequest(`${plural} have no dates; from/to not supported`);
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;

    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    const where = [];
    let rank = '';
    if (q) {
      // Substring match (ILIKE) or fuzzy word match (<%, pg_trgm): "gogh", "Durer", "hokusia" all work.
      // Both are served by the trigram GIN index on f_unaccent(name).
      const like = p(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      const term = p(q);
      // …also in the other names and readings, kana readings in Latin letters too: "kanagawa oki", "große Welle", "utagawa"
      const alt = `f_unaccent(coalesce(name_alt_text(t.${e.name}_ruby, t.names), ''))`;  // index <table>_alt_trgm
      where.push(`(f_unaccent(t.${e.name}) ILIKE f_unaccent(${like}) OR f_unaccent(${term}) <% f_unaccent(t.${e.name})
                   OR ${alt} ILIKE f_unaccent(${like}) OR f_unaccent(${term}) <% ${alt})`);
      rank = `word_similarity(f_unaccent(${term}), f_unaccent(t.${e.name})) DESC, `;
    }
    if (window) where.push(`${e.period} && ${p(window)}::daterange`);
    for (const [key, sql] of Object.entries(e.filters || {})) {
      const v = req.query[key];
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string' || v.length > 100) throw badRequest(`${key}: invalid value`);
      const ph = p(v);  // one parameter, used wherever the filter says $
      where.push(sql.replaceAll('$', () => ph));
    }

    // the rows as stored (entry_list_rows, 127 — kept up to date per change by the worker, src/admin/quality.js); an
    // entry the worker hasn't reached yet (created a moment ago) is computed now
    const { rows: hits } = await apiPool.query(`
      SELECT t.id, r.row, count(*) OVER () AS total
      FROM ${e.table} t LEFT JOIN entry_list_rows r ON r.type = '${e.type}' AND r.id = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${rank}${e.order}
      LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);
    const total = hits.length ? Number(hits[0].total) : 0;
    const missing = hits.filter((h) => !h.row).map((h) => h.id);
    const live = missing.length ? await listRows(apiPool, plural, missing) : new Map();
    const rows = hits.map((h) => h.row || live.get(String(h.id))).filter(Boolean);
    if (e.type === 'source') {
      // siglum + full citation (KHIST guide) — per request: a siglum depends on the other sources ("Smith 2001a/b")
      const sources = await bibliography.loadCatalogue(apiPool);
      for (const r of rows) Object.assign(r, { siglum: sources.get(r.slug).siglum, citation: sources.get(r.slug).full });
      const { rows: [stats] } = await apiPool.query(`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE reading_status = 'read')::int AS read, count(*) FILTER (WHERE reading_status = 'reading')::int AS reading,
          count(*) FILTER (WHERE reading_status = 'to_read')::int AS to_read FROM bibliography`);
      return res.json({ data: rows, total, limit, offset, stats });
    }
    res.json({ data: rows, total, limit, offset });
  });

  // the entry by its public number (085) — /artworks/100586, also /artworks/100586/la-petite-irene (the name is for
  // reading; any or none will do) — or by its slug, as before
  const detail = async (req, res) => {
    const key = req.params.slug;
    // the entry as recorded at a moment (089): rebuilt from the audit log — also an entry deleted since
    if (req.query.as_of !== undefined) return require('./history').asOf(req, res, plural, key);
    let byNumber = /^\d{1,15}$/.test(key);
    if (!byNumber && !SLUG.test(key)) throw notFound(`no ${e.type} "${key}"`);
    if (byNumber) {
      const { rows: [hit] } = await apiPool.query('SELECT type::text AS type, slug, public_id, moved FROM entry_by_public_id($1)', [key]);
      if (!hit || !hit.type) byNumber = false;   // no such number: perhaps a slug of digits ("1984")
    }
    if (byNumber) {
      const { rows: [hit] } = await apiPool.query('SELECT type::text AS type, slug, public_id, moved FROM entry_by_public_id($1)', [key]);
      if (hit.type !== e.type || hit.moved) {
        // another type now (055), or merged into another entry (044): its current number, under the right type
        const plural2 = Object.keys(ENTITIES).find((k) => ENTITIES[k].type === hit.type);
        return res.redirect(301, `${req.baseUrl}/${plural2}/${hit.public_id}`);
      }
    }
    const { rows } = await apiPool.query(`
      SELECT t.id, t.public_id, t.slug, t.${e.name}, ${nameCols(e.name, e.alt, e.type)}, ${e.detail}, t.wikidata_id, t.metadata, t.updated_at
      FROM ${e.table} t WHERE ${byNumber ? 't.public_id = $1::bigint' : 't.slug = $1'}`, [key]);
    if (!rows.length) {
      // an old slug (migration 041): permanently moved to the entry's current address
      const moved = await apiPool.query(`SELECT x.slug FROM slug_history h JOIN ${e.table} x ON x.id = h.entity_id
        WHERE h.entity_type = $1 AND h.old_slug = $2`, [e.type, req.params.slug]);
      if (moved.rows.length) {
        const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(301, `${req.baseUrl}/${plural}/${moved.rows[0].slug}${query}`);
      }
      // moved to another type (055): answered with the new address
      const other = await apiPool.query(`SELECT m.new_type::text AS type, x.slug FROM entry_moves m
        JOIN entity_index x ON (x.type, x.id) = (m.new_type, m.new_id) WHERE m.old_type = $1 AND m.old_slug = $2`, [e.type, req.params.slug]);
      if (other.rows.length) {
        const plural2 = Object.keys(ENTITIES).find((k) => ENTITIES[k].type === other.rows[0].type);
        if (plural2) return res.redirect(301, `${req.baseUrl}/${plural2}/${other.rows[0].slug}`);
      }
      throw notFound(`no ${e.type} "${req.params.slug}"`);
    }
    const { id, ...entity } = rows[0];
    entity.path = `/${plural}/${entity.public_id}/${entity.slug}`;   // the public address (085)

    const [rels, extras, mentionedIn] = await Promise.all([
      apiPool.query(RELATIONSHIPS_SQL, [e.type, id]).then((r) => mergePhaseEdges(r.rows)),
      EXTRAS[e.type] ? EXTRAS[e.type](id) : {},
      // backlinks: the entries whose texts [[link]] this one (view content_links, migration 030); a term has used_in
      e.type === 'term' ? null : apiPool.query(`
        SELECT DISTINCT x.type::text AS type, x.slug, x.public_id, x.name, x.sort_key COLLATE sort_natural AS sort_key FROM content_links l
        JOIN entity_index x ON (x.type, x.id) = (l.entity_type, l.entity_id)
        WHERE l.target_type = $1 AND l.target_slug = $2 AND NOT (x.type = $1::entity_type AND x.id = $3)
        ORDER BY sort_key`, [e.type, entity.slug, id]).then((r) => r.rows.map(({ sort_key: _, ...m }) => m)),
    ]);
    // [[links]] show the linked entries' names: looked up for exactly the links in these texts
    const steps = extras.provenance || [];
    const env = { names: await linkNames(apiPool, [...e.md.map((f) => entity[f]), ...rels.map((r) => r.notes_md), ...steps.map((p) => p.notes_md), ...steps.flatMap((p) => (p.alternatives || []).map((a) => a.notes_md)), ...(extras.phases || []).map((p) => p.notes_md)]),
      used: new Set(), cited: new Set() };
    const relationships = rels.map((x) => renderMd(x, ['notes_md'], env));
    steps.forEach((p) => { renderMd(p, ['notes_md'], env); (p.alternatives || []).forEach((a) => renderMd(a, ['notes_md'], env)); });
    (extras.phases || []).forEach((p) => renderMd(p, ['notes_md'], env));
    const body = nameCountry(shapeNames(renderMd(entity, e.md, env), e.name));
    if (mentionedIn) body.mentioned_in = mentionedIn;
    // the glossary terms its texts link, with their short definitions — for tooltips without further requests
    const glossary = env.used.size ? Object.fromEntries((await apiPool.query(
      `SELECT slug, name, category::text AS category, definition FROM glossary t WHERE slug = ANY ($1) ORDER BY ${sortKey('term', 't')}`, [[...env.used]])).rows
      .map(({ slug, ...rest }) => [slug, rest])) : {};
    // the sources its texts cite (footnotes): siglum and full citation, e.g. for popovers
    const cited = env.names.sources ? Object.fromEntries([...env.cited].filter((s) => env.names.sources.has(s))
      .map((s) => [s, { siglum: env.names.sources.get(s).siglum, citation: env.names.sources.get(s).full }])) : {};
    const entries = await entryPreviews(env.names);
    if (e.type === 'source') {
      const own = (await bibliography.loadCatalogue(apiPool)).get(entity.slug);
      Object.assign(body, { siglum: own.siglum, citation: own.full });
    }
    // Sources for facts (citations, 049/050): of its fields, its relationships, its provenance steps — each as
    // { kind, reliability, text, source?, wikidata?, locator, url, accessed, note, outdated }; the full references of the
    // bibliography sources among them join the `bibliography` map (like those its texts cite).
    const catalogue = await bibliography.loadCatalogue(apiPool);
    // its other names as rows (152): when each was in use, a note — in the order of `names`
    const nameRows = Array.isArray(body.names) && body.names.length ? (await apiPool.query(`
      SELECT id, position, range_json(period, period_label) AS period, note FROM entry_names
      WHERE entity_type = $1 AND entity_id = $2 ORDER BY position`, [e.type, id])).rows : [];
    const { rows: citeRows } = await apiPool.query(`
      SELECT c.*, b.kind::text AS source_kind FROM citation_status c LEFT JOIN bibliography b ON b.id = c.source_id
      WHERE c.pending IS NULL AND ((c.entity_type = $1 AND c.entity_id = $2) OR c.relationship_id = ANY ($3::bigint[])
                                   OR c.provenance_id = ANY ($4::bigint[]) OR c.number_id = ANY ($5::bigint[])
                                   OR c.name_id = ANY ($6::bigint[]))
      ORDER BY c.reliability DESC NULLS LAST, c.id`,
    [e.type, id, rels.map((r) => r._rel_id).filter(Boolean),
      [...rels.map((r) => r._prov_id), ...steps.map((p) => p._prov_id), ...steps.flatMap((p) => (p.alternatives || []).map((a) => a._prov_id))].filter(Boolean),
      (body.numbers || []).map((n) => n._num_id), nameRows.map((n) => n.id)]);
    const shape = (c) => {
      const out = { kind: c.wikidata_item ? 'wikidata' : c.source_id ? 'source' : 'text', reliability: c.reliability };
      if (c.wikidata_item) {
        out.text = `Wikidata, ${c.wikidata_item}${c.wikidata_property ? `, ${c.wikidata_property}` : ''}`;
        out.wikidata = { item: c.wikidata_item, property: c.wikidata_property, url: `https://www.wikidata.org/wiki/${c.wikidata_item}` };
      } else if (c.source_id) {
        const s = catalogue.get(c.source_slug);
        out.text = [s ? s.siglum : c.source_text, bibliography.locator(c.locator, c.source_kind)].filter(Boolean).join(', ');
        out.source = { slug: c.source_slug, siglum: s ? s.siglum : null };
        if (s) cited[c.source_slug] = { siglum: s.siglum, citation: s.full };
      } else out.text = c.text;
      Object.assign(out, { locator: c.locator, url: c.url, accessed: c.accessed ? c.accessed.toISOString().slice(0, 10) : null,
        note: c.note, outdated: !!c.outdated });
      return out;
    };
    const group = (pick) => (list) => list.reduce((acc, c) => { (acc[pick(c)] ||= []).push(shape(c)); return acc; }, {});
    const byField = group((c) => c.field)(citeRows.filter((c) => c.entity_id !== null));
    const byRel = group((c) => c.relationship_id)(citeRows.filter((c) => c.relationship_id !== null));
    const byProv = group((c) => c.provenance_id)(citeRows.filter((c) => c.provenance_id !== null));
    relationships.forEach((r) => { r.sources = (r._rel_id ? byRel[r._rel_id] : r._prov_id ? byProv[r._prov_id] : null) || []; delete r._rel_id; delete r._prov_id; });
    steps.forEach((p) => {
      p.sources = byProv[p._prov_id] || [];
      p.id = p._prov_id;   // the step's number: the anchor full-text search hits point to (provenance_ids)
      delete p._prov_id;
      (p.alternatives || []).forEach((a) => { a.sources = byProv[a._prov_id] || []; delete a._prov_id; });   // 084
    });
    const byNum = group((c) => c.number_id)(citeRows.filter((c) => c.number_id !== null));
    (body.numbers || []).forEach((n) => { n.sources = byNum[n._num_id] || []; delete n._num_id; });  // further numbers (081)
    const byName = group((c) => c.name_id)(citeRows.filter((c) => c.name_id !== null));
    (body.names || []).forEach((n, i) => {  // 152: when in use, the context, its sources
      const r = nameRows.find((x) => x.position === i);
      Object.assign(n, { period: r ? r.period : null, note: r ? r.note : null, sources: (r && byName[r.id]) || [] });
    });
    body.sources = byField;
    // its numbers in authority files (053), with the links to the records
    body.identifiers = (await apiPool.query(`
      SELECT a.code AS authority, a.name, i.value, replace(a.url_template, '{id}', i.value) AS url
      FROM entry_identifiers i JOIN authorities a ON a.code = i.authority
      WHERE i.entity_type = $1 AND i.entity_id = $2 ORDER BY a.position`, [e.type, id])).rows;
    res.json({ type: e.type, ...body, ...extras, relationships, glossary, bibliography: cited, entries });
  };
  router.get(`/${plural}/:slug`, detail);
  router.get(`/${plural}/:slug/:name`, (req, res, next) => (/^\d+$/.test(req.params.slug) ? detail(req, res) : next()));
}

module.exports = { router, ENTITIES, edgeCategory, listRows };
