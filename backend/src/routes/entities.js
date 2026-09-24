// GET /v1/<plural>          list + search + time filter   (artists, artworks, places, movements, institutions, patrons)
// GET /v1/<plural>/:slug    full record + all relationships in both directions + type-specific extras
//
// Public keys are slugs; internal ids never leave the API.
const express = require('express');
const { apiPool } = require('../db');
const { renderMarkdown } = require('../markdown');
const { badRequest, notFound, intParam, yearWindowRange } = require('../http');

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Per type: which column is the name, which daterange drives ?from/?to, list/detail columns (SQL on alias t),
// extra list filters (?key=value → SQL with $ placeholder), Markdown columns, default order.
const ENTITIES = {
  artists: {
    type: 'artist', table: 'artists', name: 'name', period: 't.lifespan',
    list: 't.sort_name, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death',
    detail: 't.sort_name, t.alt_names, range_json(t.birth, t.birth_label) AS birth, range_json(t.death, t.death_label) AS death, t.biography_md',
    md: ['biography_md'],
    order: 'coalesce(t.sort_name, t.name)',
  },
  artworks: {
    type: 'artwork', table: 'artworks', name: 'title', period: 't.created',
    list: `range_json(t.created, t.created_label) AS created, t.kind,
           (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator`,
    detail: `t.alt_titles, t.attribution_label, range_json(t.created, t.created_label) AS created, t.kind, t.medium,
             t.inventory_number, t.image_url, t.image_source_url, t.image_license, t.image_credit, t.description_md,
             (SELECT jsonb_build_object('slug', a.slug, 'name', a.name) FROM artists a WHERE a.id = t.creator_id) AS creator,
             (SELECT jsonb_build_object('slug', i.slug, 'name', i.name) FROM institutions i WHERE i.id = t.current_institution_id) AS institution`,
    md: ['description_md'],
    filters: {
      creator: "t.creator_id = entity_id('artist', $)",
      institution: "t.current_institution_id = entity_id('institution', $)",
      kind: 't.kind = $',
    },
    order: 'lower(t.created) NULLS LAST, t.title',
  },
  places: {
    type: 'place', table: 'places', name: 'name', period: null,
    list: `t.kind, t.country_code, ST_AsGeoJSON(t.location)::jsonb AS location`,
    detail: `t.alt_names, t.kind, t.country_code, ST_AsGeoJSON(t.location)::jsonb AS location,
             ST_AsGeoJSON(t.area)::jsonb AS area, t.description_md`,
    md: ['description_md'],
    filters: { kind: 't.kind::text = $', country: 't.country_code = upper($)' },
    order: 't.name',
  },
  movements: {
    type: 'movement', table: 'movements', name: 'name', period: 't.period',
    list: 't.kind, range_json(t.period, t.period_label) AS period',
    detail: 't.alt_names, t.kind, range_json(t.period, t.period_label) AS period, t.description_md',
    md: ['description_md'],
    filters: { kind: 't.kind::text = $' },
    order: 'lower(t.period) NULLS LAST, t.name',
  },
  institutions: {
    type: 'institution', table: 'institutions', name: 'name', period: 't.founded',
    list: `t.kind, range_json(t.founded, t.founded_label) AS founded,
           (SELECT jsonb_build_object('slug', p.slug, 'name', p.name) FROM places p WHERE p.id = t.place_id) AS place`,
    detail: `t.alt_names, t.kind, range_json(t.founded, t.founded_label) AS founded, t.website_url, t.description_md,
             (SELECT jsonb_build_object('slug', p.slug, 'name', p.name, 'location', ST_AsGeoJSON(p.location)::jsonb)
                FROM places p WHERE p.id = t.place_id) AS place`,
    md: ['description_md'],
    filters: { kind: 't.kind = $' },
    order: 't.name',
  },
  patrons: {
    type: 'patron', table: 'patrons', name: 'name', period: 't.active',
    list: 't.kind, range_json(t.active, t.active_label) AS active',
    detail: 't.alt_names, t.kind, range_json(t.active, t.active_label) AS active, t.notes_md',
    md: ['notes_md'],
    order: 't.name',
  },
};

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
      where.push(`(f_unaccent(t.${e.name}) ILIKE f_unaccent(${like}) OR f_unaccent(${term}) <% f_unaccent(t.${e.name}))`);
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
      SELECT t.slug, t.${e.name}, ${e.list}, count(*) OVER () AS total
      FROM ${e.table} t
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${rank}${e.order}
      LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);

    const total = rows.length ? Number(rows[0].total) : 0;
    rows.forEach((r) => delete r.total);
    res.json({ data: rows, total, limit, offset });
  });

  router.get(`/${plural}/:slug`, async (req, res) => {
    if (!SLUG.test(req.params.slug)) throw notFound(`no ${e.type} "${req.params.slug}"`);
    const { rows } = await apiPool.query(`
      SELECT t.id, t.slug, t.${e.name}, ${e.detail}, t.wikidata_id, t.metadata, t.updated_at
      FROM ${e.table} t WHERE t.slug = $1`, [req.params.slug]);
    if (!rows.length) throw notFound(`no ${e.type} "${req.params.slug}"`);
    const { id, ...entity } = rows[0];

    const [relationships, extras] = await Promise.all([
      apiPool.query(RELATIONSHIPS_SQL, [e.type, id]).then((r) => r.rows.map((x) => renderMd(x, ['notes_md']))),
      EXTRAS[e.type] ? EXTRAS[e.type](id) : {},
    ]);
    res.json({ type: e.type, ...renderMd(entity, e.md), ...extras, relationships });
  });
}

module.exports = { router, ENTITIES };
