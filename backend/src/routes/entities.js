// GET /v1/<plural>          list + search + time filter   (artists, artworks, places, movements, institutions, people, polities, glossary)
// GET /v1/<plural>/:slug    full record + all relationships in both directions + type-specific extras
//
// Public keys are slugs; internal ids never leave the API.
const express = require('express');
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
const nameCols = (col, alt) => `t.${col}_lang, t.${col}_ruby, t.names, name_sort_key(t.${col}, t.${col}_ruby, t.names) AS sort_key,
  coalesce(name_alt_text(t.${col}_ruby, t.names), '') AS search_text,
  (SELECT coalesce(jsonb_agg(ruby_plain(n->>'text')), '[]'::jsonb) FROM jsonb_array_elements(t.names) n) AS ${alt}`;
// raw markup → { <col>_ruby_html, <col>_reading } and names → [{text (plain), lang, role, ruby_html, reading}]
function shapeNames(row, col) {
  if (!('names' in row)) return row;
  const markup = row[`${col}_ruby`];
  delete row[`${col}_ruby`];
  row[`${col}_ruby_html`] = markup ? names.rubyHtml(markup) : null;
  row[`${col}_reading`] = markup ? names.reading(markup) : null;
  row.names = row.names.map((n) => ({ text: names.plain(n.text), lang: n.lang || null, role: n.role,
    ruby_html: names.rubyHtml(n.text), reading: names.hasRuby(n.text) ? names.reading(n.text) : null }));
  return row;
}

// A person's roles, from their relationships (a patron is someone who commissioned or supported, not a type):
// patron · owner (of an artwork) · depicted (in an artwork). Sorted text[]; ?role=patron filters with @>.
// "owner" comes from the provenance (031), asked directly: a filter on the owner can't be pushed through the window
// functions of provenance_periods (they are partitioned by artwork), but here the index provenance_person_idx serves it.
const ROLES = `ARRAY(SELECT x.role FROM (
    SELECT CASE WHEN (r.subject_type, r.subject_id) = ('person', t.id) AND rt.category = 'patronage' THEN 'patron'
                WHEN (r.object_type, r.object_id) = ('person', t.id) AND r.relationship_type = 'depicts_person' THEN 'depicted' END
    FROM relationships r JOIN relationship_types rt ON rt.code = r.relationship_type
    WHERE (r.subject_type, r.subject_id) = ('person', t.id) OR (r.object_type, r.object_id) = ('person', t.id)
    UNION
    SELECT 'owner' FROM provenance pv WHERE pv.owner_person_id = t.id) x(role)
  WHERE x.role IS NOT NULL ORDER BY 1)`;

// Per type: which column is the name, which daterange drives ?from/?to, list/detail columns (SQL on alias t),
// extra list filters (?key=value → SQL with $ placeholder), Markdown columns, default order.
const ENTITIES = {
  artists: {
    type: 'artist', table: 'artists', alt: 'alt_names', name: 'name', period: 't.lifespan',
    list: `t.sort_name, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death, ${mainImage('artist_id')},
           ${birthPlace('artist')}, ${countryCols('artist')}`,
    detail: `t.sort_name, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
             ${allImages('artist_id')}, t.biography_md, ${birthPlace('artist')}, ${countryCols('artist')}`,
    md: ['biography_md'],
    filters: countryFilters('artist'),
    order: 'coalesce(t.sort_name, name_sort_key(t.name, t.name_ruby, t.names))',
  },
  artworks: {
    type: 'artwork', table: 'artworks', alt: 'alt_titles', name: 'title', period: 't.created',
    list: `range_json(t.created, t.created_label) AS created, t.kind, ${mainImage('artwork_id')},
           (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
           (SELECT jsonb_build_object('slug', w.slug, 'title', w.title) FROM artworks w WHERE w.id = t.parent_id) AS part_of, t.part_number,
           artwork_creators(t.id) AS creators, t.on_loan, ${countryCols('artwork')}`,
    detail: `t.attribution_label, range_json(t.created, t.created_label) AS created, t.kind, t.medium,
             t.inventory_number, t.on_loan, range_json(t.on_loan_since, t.on_loan_since_label) AS on_loan_since,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('number', n.number, 'label', n.label,
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
             (SELECT coalesce(jsonb_agg(jsonb_build_object('part', e->>'part', 'height_cm', (e->'cm'->>0)::numeric,
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
      kind: 't.kind = $',
      material: 't.materials @> ARRAY[$]::text[]',  // GIN index artworks_materials_gin
      part_of: "t.parent_id = entity_id('artwork', $)",  // the parts of a series / album …
      ...countryFilters('artwork'),
    },
    order: 'lower(t.created) NULLS LAST, name_sort_key(t.title, t.title_ruby, t.names)',
  },
  places: {
    type: 'place', table: 'places', alt: 'alt_names', name: 'name', period: null,
    // location / area: what to draw — own point and outline, else derived (view place_geo, migration 032):
    // a country with only its code gets the Natural Earth outline and label point
    list: `t.kind, t.country_code, t.boundary_code, (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = t.id) AS location`,
    detail: `t.kind, t.country_code, t.boundary_code, (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = t.id) AS location,
             (SELECT ST_AsGeoJSON(g.outline)::jsonb FROM place_geo g WHERE g.id = t.id) AS area,
             (SELECT jsonb_build_object('location', CASE WHEN t.location IS NOT NULL THEN 'own' ELSE 'derived' END,
                                        'area', g.outline_source) FROM place_geo g WHERE g.id = t.id) AS geometry_source,
             t.description_md`,
    md: ['description_md'],
    filters: { kind: 't.kind::text = $', country: 't.country_code = upper($)' },
    order: 'name_sort_key(t.name, t.name_ruby, t.names)',
  },
  movements: {
    type: 'movement', table: 'movements', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind::text = $' },
    order: 'lower(t.period) NULLS LAST, name_sort_key(t.name, t.name_ruby, t.names)',
  },
  institutions: {
    type: 'institution', table: 'institutions', alt: 'alt_names', name: 'name', period: 't.founded',
    list: `t.kind, range_json(t.founded, t.founded_label) AS founded, ${mainImage('institution_id')},
           ST_AsGeoJSON(t.location)::jsonb AS location,
           (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = t.place_id) AS place,
           ${countryCols('institution')}`,
    detail: `t.kind, range_json(t.founded, t.founded_label) AS founded, t.website_url, t.description_md,
             ST_AsGeoJSON(t.location)::jsonb AS location, t.address,
             ${allImages('institution_id')},
             (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'location', (SELECT ST_AsGeoJSON(g.marker)::jsonb FROM place_geo g WHERE g.id = p.id))
                FROM places p WHERE p.id = t.place_id) AS place, ${countryCols('institution')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', ...countryFilters('institution') },
    order: 'name_sort_key(t.name, t.name_ruby, t.names)',
  },
  people: {
    type: 'person', table: 'people', alt: 'alt_names', name: 'name', period: 'coalesce(t.lifespan, t.active)',
    list: `t.kind, t.occupations, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
           range_json(t.active, t.active_label) AS active, ${ROLES} AS roles, ${birthPlace('person')}, ${countryCols('person')}, ${mainImage('person_id')}`,
    detail: `t.kind, t.occupations, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death,
             range_json(t.active, t.active_label) AS active, ${ROLES} AS roles, t.description_md, ${birthPlace('person')}, ${countryCols('person')}, ${allImages('person_id')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', occupation: 't.occupations @> ARRAY[$]::text[]', role: `${ROLES} @> ARRAY[$]::text[]`, ...countryFilters('person') },
    order: 'name_sort_key(t.name, t.name_ruby, t.names)',
  },
  glossary: {
    type: 'term', table: 'glossary', alt: 'alt_names', name: 'name', period: null,
    list: `t.category, t.definition, ${mainImage('glossary_id')}`,
    detail: `t.category, t.definition, t.description_md, ${allImages('glossary_id')}`,
    md: ['description_md'],
    filters: { category: 't.category::text = $' },
    order: 'lower(f_unaccent(name_sort_key(t.name, t.name_ruby, t.names)))',
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
    filters: { kind: 't.kind::text = $', status: 't.reading_status::text = $', author: "t.authors::text ILIKE '%' || $ || '%'" },
    order: "lower(f_unaccent(coalesce(t.authors[1], t.name))), t.year",
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
                ORDER BY lower(c.period) NULLS LAST, c.name), '[]'::jsonb) FROM events c WHERE c.parent_id = t.id) AS parts,
             ${countryCols('event')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', place: "t.place_id = entity_id('place', $)", part_of: "t.parent_id = entity_id('event', $)", ...countryFilters('event') },
    order: 'lower(t.period) NULLS LAST, name_sort_key(t.name, t.name_ruby, t.names)',
  },
  polities: {
    type: 'polity', table: 'polities', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind = $', country: 't.country_codes @> ARRAY[upper($)]' },  // GIN index polities_country_gin
    order: 'lower(t.period) NULLS LAST, name_sort_key(t.name, t.name_ruby, t.names)',
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

// Everything connected to one entity, in both directions. The label is read from the entity's point of view:
// Van Gogh "lived in" Arles, Arles is "home of" Van Gogh.
const RELATIONSHIPS_SQL = `
  SELECT rt.code AS type,
         CASE WHEN rt.is_symmetric THEN 'mutual'
              WHEN r.subject_type = $1 AND r.subject_id = $2 THEN 'outgoing' ELSE 'incoming' END AS direction,
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 OR rt.is_symmetric THEN rt.label ELSE rt.inverse_label END AS label,
         rt.category, rt.is_physical_presence,
         jsonb_build_object('type', o.type, 'slug', o.slug, 'name', o.name,
                            'period', range_json(o.period, o.period_label)) AS entity,
         range_json(r.period, r.period_label) AS period,
         r.label AS note, r.certainty, r.notes_md,
         r.source <> 'relationship' AS derived, r.end_basis  -- derived: the creator field or the provenance (031)
  FROM edges r
  JOIN relationship_types rt ON rt.code = r.relationship_type
  -- the "other" end: object for outgoing edges, subject for incoming ones
  JOIN entity_index o ON (o.type, o.id) = (
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_type ELSE r.subject_type END,
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_id   ELSE r.subject_id   END)
  -- the creator edges are left out: the artwork's creator / creators and the artist's artworks already list them
  WHERE ((r.subject_type = $1 AND r.subject_id = $2) OR (r.object_type = $1 AND r.object_id = $2)) AND r.source <> 'creator'
  ORDER BY rt.sort_order, lower(r.period) NULLS LAST, o.name`;

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
      LEFT JOIN LATERAL (SELECT 'co' AS role, r.label FROM relationships r
                          WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.subject_id = w.id
                            AND r.object_type = 'artist' AND r.object_id = $1 LIMIT 1) co ON w.creator_id IS DISTINCT FROM $1
      WHERE w.creator_id = $1 OR co.role IS NOT NULL
      ORDER BY lower(w.created) NULLS LAST, w.title`, [id])).rows,
  }),
  // the provenance (031): the steps as recorded, plus the computed period and where its end comes from
  artwork: async (id) => ({
    // series and other wholes (migration 037): what it is part of (the chain upwards, nearest first), its neighbours,
    // and — for a whole — its parts in order
    part_of: (await apiPool.query(`
      WITH RECURSIVE up AS (
        SELECT w.id, w.parent_id, 1 AS depth FROM artworks a JOIN artworks w ON w.id = a.parent_id WHERE a.id = $1
        UNION ALL
        SELECT w.id, w.parent_id, up.depth + 1 FROM up JOIN artworks w ON w.id = up.parent_id WHERE up.depth < 10
      ) SELECT w.slug, w.title, w.kind, w.parts_count FROM up JOIN artworks w ON w.id = up.id ORDER BY up.depth`, [id])).rows,
    ...(await apiPool.query(`
      WITH me AS (SELECT parent_id, part_number, part_sort, title FROM artworks WHERE id = $1),
      sib AS (SELECT a.id, a.slug, a.title, a.part_number,
                     row_number() OVER (ORDER BY a.part_sort NULLS LAST, a.part_number, a.title) AS n
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
      FROM artworks a WHERE a.parent_id = $1 ORDER BY a.part_sort NULLS LAST, a.part_number, a.title`, [id])).rows,
    provenance: (await apiPool.query(`
      SELECT p.position,
             CASE WHEN p.owner_id IS NOT NULL THEN jsonb_build_object('type', p.owner_type, 'slug', o.slug, 'name', o.name) END AS owner,
             p.owner_label, p.owner_name, range_json(p.acquired, p.acquired_label) AS acquired, range_json(p.ended, p.ended_label) AS ended,
             p.method, p.direct, p.label, p.certainty,
             (SELECT jsonb_build_object('slug', l.slug, 'name', l.name) FROM places l WHERE l.id = p.location_id) AS place,
             range_json(p.period, p.period_label) AS period, p.end_basis, p.notes_md, p.metadata->'sources' AS sources
      FROM provenance_periods p LEFT JOIN entity_index o ON (o.type, o.id) = (p.owner_type, p.owner_id)
      WHERE p.artwork_id = $1 ORDER BY p.position`, [id])).rows,
  }),
  institution: async (id) => ({
    artworks: (await apiPool.query(`
      SELECT w.slug, w.title, range_json(w.created, w.created_label) AS created,
             (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = w.creator_id) AS creator
      FROM artworks w WHERE w.current_institution_id = $1 ORDER BY w.title`, [id])).rows,
  }),
  place: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('places'), [id])).rows,
    children: (await apiPool.query('SELECT slug, name, kind FROM places WHERE parent_id = $1 ORDER BY name', [id])).rows,
    institutions: (await apiPool.query('SELECT slug, name, kind FROM institutions WHERE place_id = $1 ORDER BY name', [id])).rows,
  }),
  polity: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('polities'), [id])).rows,
    children: (await apiPool.query(`
      SELECT slug, name, kind, range_json(period, period_label) AS period
      FROM polities WHERE parent_id = $1 ORDER BY lower(period) NULLS LAST, name`, [id])).rows,
  }),
  // a glossary term: where texts link it ("used in"), from the view glossary_links
  term: async (id) => ({
    used_in: (await apiPool.query(`
      SELECT e.type::text AS type, e.slug, e.name FROM glossary_links l
      JOIN glossary g ON g.slug = l.term_slug JOIN entity_index e ON (e.type, e.id) = (l.entity_type, l.entity_id)
      WHERE g.id = $1 AND NOT (e.type = 'term' AND e.id = $1) ORDER BY e.sort_key`, [id])).rows,
  }),
  movement: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('movements'), [id])).rows,
    children: (await apiPool.query(`
      SELECT slug, name, kind, range_json(period, period_label) AS period
      FROM movements WHERE parent_id = $1 ORDER BY lower(period) NULLS LAST, name`, [id])).rows,
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
    SELECT p.type::text AS type, p.slug, p.name, p.subtitle, p.image_url, p.text_md FROM entry_previews p
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

    const { rows } = await apiPool.query(`
      SELECT t.slug, t.${e.name}, ${nameCols(e.name, e.alt)}, ${e.list}, count(*) OVER () AS total
      FROM ${e.table} t
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${rank}${e.order}
      LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);

    const total = rows.length ? Number(rows[0].total) : 0;
    rows.forEach((r) => { delete r.total; nameCountry(shapeNames(r, e.name)); });
    if (e.type === 'source') {
      // siglum + full citation (KHIST guide), and how much of it has been read
      const sources = await bibliography.loadCatalogue(apiPool);
      for (const r of rows) Object.assign(r, { siglum: sources.get(r.slug).siglum, citation: sources.get(r.slug).full });
      const { rows: [stats] } = await apiPool.query(`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE reading_status = 'read')::int AS read, count(*) FILTER (WHERE reading_status = 'reading')::int AS reading,
          count(*) FILTER (WHERE reading_status = 'to_read')::int AS to_read FROM bibliography`);
      return res.json({ data: rows, total, limit, offset, stats });
    }
    res.json({ data: rows, total, limit, offset });
  });

  router.get(`/${plural}/:slug`, async (req, res) => {
    if (!SLUG.test(req.params.slug)) throw notFound(`no ${e.type} "${req.params.slug}"`);
    const { rows } = await apiPool.query(`
      SELECT t.id, t.slug, t.${e.name}, ${nameCols(e.name, e.alt)}, ${e.detail}, t.wikidata_id, t.metadata, t.updated_at
      FROM ${e.table} t WHERE t.slug = $1`, [req.params.slug]);
    if (!rows.length) {
      // an old slug (migration 041): permanently moved to the entry's current address
      const moved = await apiPool.query(`SELECT x.slug FROM slug_history h JOIN ${e.table} x ON x.id = h.entity_id
        WHERE h.entity_type = $1 AND h.old_slug = $2`, [e.type, req.params.slug]);
      if (moved.rows.length) {
        const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
        return res.redirect(301, `${req.baseUrl}/${plural}/${moved.rows[0].slug}${query}`);
      }
      throw notFound(`no ${e.type} "${req.params.slug}"`);
    }
    const { id, ...entity } = rows[0];

    const [rels, extras, mentionedIn] = await Promise.all([
      apiPool.query(RELATIONSHIPS_SQL, [e.type, id]).then((r) => r.rows),
      EXTRAS[e.type] ? EXTRAS[e.type](id) : {},
      // backlinks: the entries whose texts [[link]] this one (view content_links, migration 030); a term has used_in
      e.type === 'term' ? null : apiPool.query(`
        SELECT DISTINCT x.type::text AS type, x.slug, x.name, x.sort_key FROM content_links l
        JOIN entity_index x ON (x.type, x.id) = (l.entity_type, l.entity_id)
        WHERE l.target_type = $1 AND l.target_slug = $2 AND NOT (x.type = $1::entity_type AND x.id = $3)
        ORDER BY x.sort_key`, [e.type, entity.slug, id]).then((r) => r.rows.map(({ sort_key: _, ...m }) => m)),
    ]);
    // [[links]] show the linked entries' names: looked up for exactly the links in these texts
    const steps = extras.provenance || [];
    const env = { names: await linkNames(apiPool, [...e.md.map((f) => entity[f]), ...rels.map((r) => r.notes_md), ...steps.map((p) => p.notes_md)]),
      used: new Set(), cited: new Set() };
    const relationships = rels.map((x) => renderMd(x, ['notes_md'], env));
    steps.forEach((p) => renderMd(p, ['notes_md'], env));
    const body = nameCountry(shapeNames(renderMd(entity, e.md, env), e.name));
    if (mentionedIn) body.mentioned_in = mentionedIn;
    // the glossary terms its texts link, with their short definitions — for tooltips without further requests
    const glossary = env.used.size ? Object.fromEntries((await apiPool.query(
      'SELECT slug, name, category::text AS category, definition FROM glossary WHERE slug = ANY ($1) ORDER BY name', [[...env.used]])).rows
      .map(({ slug, ...rest }) => [slug, rest])) : {};
    // the sources its texts cite (footnotes): siglum and full citation, e.g. for popovers
    const cited = env.names.sources ? Object.fromEntries([...env.cited].filter((s) => env.names.sources.has(s))
      .map((s) => [s, { siglum: env.names.sources.get(s).siglum, citation: env.names.sources.get(s).full }])) : {};
    const entries = await entryPreviews(env.names);
    if (e.type === 'source') {
      const own = (await bibliography.loadCatalogue(apiPool)).get(entity.slug);
      Object.assign(body, { siglum: own.siglum, citation: own.full });
    }
    res.json({ type: e.type, ...body, ...extras, relationships, glossary, bibliography: cited, entries });
  });
}

module.exports = { router, ENTITIES };
