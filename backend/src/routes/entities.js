// GET /v1/<plural>          list + search + time filter   (artists, artworks, places, movements, institutions, patrons, polities)
// GET /v1/<plural>/:slug    full record + all relationships in both directions + type-specific extras
//
// Public keys are slugs; internal ids never leave the API.
const express = require('express');
const { apiPool } = require('../db');
const { renderMarkdown } = require('../markdown');
const names = require('../names');
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
const nameCols = (col, alt) => `t.${col}_lang, t.${col}_ruby, t.names, name_sort_key(t.${col}, t.names) AS sort_key,
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
    order: 'coalesce(t.sort_name, name_sort_key(t.name, t.names))',
  },
  artworks: {
    type: 'artwork', table: 'artworks', alt: 'alt_titles', name: 'title', period: 't.created',
    list: `range_json(t.created, t.created_label) AS created, t.kind, ${mainImage('artwork_id')},
           (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
           ${countryCols('artwork')}`,
    detail: `t.attribution_label, range_json(t.created, t.created_label) AS created, t.kind, t.medium,
             t.inventory_number, ${allImages('artwork_id')}, t.description_md,
             t.materials,
             CASE WHEN t.height_cm IS NOT NULL THEN jsonb_build_object('height_cm', t.height_cm, 'width_cm', t.width_cm,
               'depth_cm', t.depth_cm, 'note', t.dimensions_note,
               'label', concat_ws(' × ', t.height_cm::float8, t.width_cm::float8, t.depth_cm::float8) || ' cm'
                        || CASE WHEN t.width_cm IS NULL THEN ' (height)' ELSE '' END) END AS dimensions,
             (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
             (SELECT jsonb_build_object('slug', i.slug, 'name', i.name) FROM institutions i WHERE i.id = t.current_institution_id) AS institution,
             ${countryCols('artwork')}`,
    md: ['description_md'],
    filters: {
      creator: "t.creator_id = entity_id('artist', $)",
      institution: "t.current_institution_id = entity_id('institution', $)",
      kind: 't.kind = $',
      material: 't.materials @> ARRAY[$]::text[]',  // GIN index artworks_materials_gin
      ...countryFilters('artwork'),
    },
    order: 'lower(t.created) NULLS LAST, name_sort_key(t.title, t.names)',
  },
  places: {
    type: 'place', table: 'places', alt: 'alt_names', name: 'name', period: null,
    list: `t.kind, t.country_code, ST_AsGeoJSON(t.location)::jsonb AS location`,
    detail: `t.kind, t.country_code, ST_AsGeoJSON(t.location)::jsonb AS location,
             ST_AsGeoJSON(t.area)::jsonb AS area, t.description_md`,
    md: ['description_md'],
    filters: { kind: 't.kind::text = $', country: 't.country_code = upper($)' },
    order: 'name_sort_key(t.name, t.names)',
  },
  movements: {
    type: 'movement', table: 'movements', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind::text = $' },
    order: 'lower(t.period) NULLS LAST, name_sort_key(t.name, t.names)',
  },
  institutions: {
    type: 'institution', table: 'institutions', alt: 'alt_names', name: 'name', period: 't.founded',
    list: `t.kind, range_json(t.founded, t.founded_label) AS founded, ${mainImage('institution_id')},
           (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = t.place_id) AS place,
           ${countryCols('institution')}`,
    detail: `t.kind, range_json(t.founded, t.founded_label) AS founded, t.website_url, t.description_md,
             ${allImages('institution_id')},
             (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'location', ST_AsGeoJSON(p.location)::jsonb)
                FROM places p WHERE p.id = t.place_id) AS place, ${countryCols('institution')}`,
    md: ['description_md'],
    filters: { kind: 't.kind = $', ...countryFilters('institution') },
    order: 'name_sort_key(t.name, t.names)',
  },
  patrons: {
    type: 'patron', table: 'patrons', alt: 'alt_names', name: 'name', period: 't.active',
    list: `t.kind, range_json(t.active, t.active_label) AS active, ${birthPlace('patron')}, ${countryCols('patron')}`,
    detail: `t.kind, range_json(t.active, t.active_label) AS active, t.notes_md, ${birthPlace('patron')}, ${countryCols('patron')}`,
    md: ['notes_md'],
    filters: { kind: 't.kind = $', ...countryFilters('patron') },
    order: 'name_sort_key(t.name, t.names)',
  },
  polities: {
    type: 'polity', table: 'polities', alt: 'alt_names', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes',
    detail: 't.kind, range_json(t.period, t.period_label) AS period, t.country_codes, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind = $', country: 't.country_codes @> ARRAY[upper($)]' },  // GIN index polities_country_gin
    order: 'lower(t.period) NULLS LAST, name_sort_key(t.name, t.names)',
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
         r.label AS note, r.certainty, r.notes_md
  FROM relationships r
  JOIN relationship_types rt ON rt.code = r.relationship_type
  -- the "other" end: object for outgoing edges, subject for incoming ones
  JOIN entity_index o ON (o.type, o.id) = (
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_type ELSE r.subject_type END,
         CASE WHEN r.subject_type = $1 AND r.subject_id = $2 THEN r.object_id   ELSE r.subject_id   END)
  WHERE (r.subject_type = $1 AND r.subject_id = $2) OR (r.object_type = $1 AND r.object_id = $2)
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
      SELECT slug, title, range_json(created, created_label) AS created, kind
      FROM artworks WHERE creator_id = $1 ORDER BY lower(created) NULLS LAST, title`, [id])).rows,
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
  movement: async (id) => ({
    ancestors: (await apiPool.query(ancestorsSql('movements'), [id])).rows,
    children: (await apiPool.query(`
      SELECT slug, name, kind, range_json(period, period_label) AS period
      FROM movements WHERE parent_id = $1 ORDER BY lower(period) NULLS LAST, name`, [id])).rows,
  }),
};

function renderMd(row, fields) {
  for (const f of fields) {
    row[f.replace(/_md$/, '_html')] = renderMarkdown(row[f]);
    delete row[f];
  }
  return row;
}

const router = express.Router();

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
      // …also in the other names and readings (GIN index <table>_names_trgm): "kanagawa oki", "große Welle", "かながわ"
      const alt = `f_unaccent(coalesce(names_text(t.names), '') || ' ' || coalesce(ruby_reading(t.${e.name}_ruby), ''))`;
      where.push(`(f_unaccent(t.${e.name}) ILIKE f_unaccent(${like}) OR f_unaccent(${term}) <% f_unaccent(t.${e.name})
                   OR ${alt} ILIKE f_unaccent(${like}) OR f_unaccent(${term}) <% ${alt})`);
      rank = `word_similarity(f_unaccent(${term}), f_unaccent(t.${e.name})) DESC, `;
    }
    if (window) where.push(`${e.period} && ${p(window)}::daterange`);
    for (const [key, sql] of Object.entries(e.filters || {})) {
      const v = req.query[key];
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string' || v.length > 100) throw badRequest(`${key}: invalid value`);
      where.push(sql.replace('$', () => p(v)));
    }

    const { rows } = await apiPool.query(`
      SELECT t.slug, t.${e.name}, ${nameCols(e.name, e.alt)}, ${e.list}, count(*) OVER () AS total
      FROM ${e.table} t
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${rank}${e.order}
      LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);

    const total = rows.length ? Number(rows[0].total) : 0;
    rows.forEach((r) => { delete r.total; nameCountry(shapeNames(r, e.name)); });
    res.json({ data: rows, total, limit, offset });
  });

  router.get(`/${plural}/:slug`, async (req, res) => {
    if (!SLUG.test(req.params.slug)) throw notFound(`no ${e.type} "${req.params.slug}"`);
    const { rows } = await apiPool.query(`
      SELECT t.id, t.slug, t.${e.name}, ${nameCols(e.name, e.alt)}, ${e.detail}, t.wikidata_id, t.metadata, t.updated_at
      FROM ${e.table} t WHERE t.slug = $1`, [req.params.slug]);
    if (!rows.length) throw notFound(`no ${e.type} "${req.params.slug}"`);
    const { id, ...entity } = rows[0];

    const [relationships, extras] = await Promise.all([
      apiPool.query(RELATIONSHIPS_SQL, [e.type, id]).then((r) => r.rows.map((x) => renderMd(x, ['notes_md']))),
      EXTRAS[e.type] ? EXTRAS[e.type](id) : {},
    ]);
    res.json({ type: e.type, ...nameCountry(shapeNames(renderMd(entity, e.md), e.name)), ...extras, relationships });
  });
}

module.exports = { router, ENTITIES };
