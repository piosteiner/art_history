// The content model in one place, shared by the YAML import, the YAML export and the admin panel.
// A "doc" is one entity as plain data — exactly what a content/<folder>/<slug>.yaml file holds:
//   { name: 'Vincent van Gogh', birth: '1853-03-30', alt_names: [...], relationships: [{ type, to, period, … }] }
// toRow() turns a doc into validated SQL column values; readDocs() reads rows back into docs.
const { parseFuzzyDate, formatFuzzyDate } = require('./fuzzy-date');

// Field kinds: text · text[] · json · md · date (→ <col> + <col>_label) · period (a date that may be open-ended, "1808/")
//              dimensions [height, width] or [height, width, depth] in cm (→ height_cm, width_cm, depth_cm)
//              point [lon, lat] · area (GeoJSON)
//              ref:<type> (slug → id, may point at any imported or existing entity) · parent (same-table ref, second pass)
// Order matters: a type may only reference types listed before it (parent refs are resolved afterwards).
// `name` is the column that names an entity (artworks have a title).
const TYPES = [
  { type: 'place', folder: 'places', table: 'places', name: 'name', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', parent: 'parent', country_code: 'text',
    location: 'point', area: 'area', description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'movement', folder: 'movements', table: 'movements', name: 'name', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', parent: 'parent', period: 'period',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artist', folder: 'artists', table: 'artists', name: 'name', fields: {
    name: 'text', sort_name: 'text', alt_names: 'text[]', birth: 'date', death: 'date',
    image_url: 'text', image_source_url: 'text', image_license: 'text', image_credit: 'text',
    biography_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'patron', folder: 'patrons', table: 'patrons', name: 'name', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', active: 'period', notes_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'institution', folder: 'institutions', table: 'institutions', name: 'name', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', founded: 'date', place: 'ref:place',
    image_url: 'text', image_source_url: 'text', image_license: 'text', image_credit: 'text',
    description_md: 'md', website_url: 'text', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artwork', folder: 'artworks', table: 'artworks', name: 'title', fields: {
    title: 'text', alt_titles: 'text[]', creator: 'ref:artist', attribution_label: 'text', created: 'date',
    kind: 'text', medium: 'text', materials: 'text[]', dimensions: 'dimensions', dimensions_note: 'text',
    institution: 'ref:institution', inventory_number: 'text',
    image_url: 'text', image_source_url: 'text', image_license: 'text', image_credit: 'text',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
];
const BY_TYPE = Object.fromEntries(TYPES.map((t) => [t.type, t]));
const BY_FOLDER = Object.fromEntries(TYPES.map((t) => [t.folder, t]));

// YAML key → column where they differ.
const REF_COLUMNS = { place: 'place_id', creator: 'creator_id', institution: 'current_institution_id' };
const REL_KEYS = new Set(['type', 'to', 'period', 'period_label', 'label', 'certainty', 'notes_md', 'sources', 'metadata']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// doc → { cols: {col: [sqlExpr, value]}, refs: [{col, type, slug}], parent, relationships, errors: ['key: message'] }
// sqlExpr uses "$" as the placeholder for its value. Nothing here touches the database.
function toRow(doc, fields) {
  const cols = {};
  const refs = [];
  const errors = [];
  let parent = null;
  const put = (col, value, expr = '$') => { cols[col] = [expr, value]; };

  for (const key of Object.keys(doc)) {
    if (key === 'relationships' || key === 'slug') continue;
    if (key.endsWith('_label') && ['date', 'period'].includes(fields[key.slice(0, -'_label'.length)])) continue;
    if (!fields[key]) errors.push(`unknown field "${key}"`);
  }

  for (const [key, kind] of Object.entries(fields)) {
    const v = doc[key] ?? null;
    try {
      if (kind === 'date' || kind === 'period') {
        const d = parseFuzzyDate(v, { openEnd: kind === 'period' });
        put(key, d && d.range, '$::daterange');
        put(`${key}_label`, doc[`${key}_label`] ?? (d && d.label));
      } else if (kind === 'text[]') {
        if (v !== null && !(Array.isArray(v) && v.every((s) => typeof s === 'string'))) throw new Error('must be a list of strings');
        put(key, v || []);
      } else if (kind === 'json') {
        if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new Error('must be a mapping');
        put(key, JSON.stringify(v || {}), '$::jsonb');
      } else if (kind === 'dimensions') {
        // [height, width] or [height, width, depth], centimetres, all > 0 — three numeric columns
        if (v !== null && !(Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every((n) => Number.isFinite(n) && n > 0 && n < 1e6))) {
          throw new Error('must be [height, width] or [height, width, depth] in cm, all greater than 0');
        }
        put('height_cm', v ? v[0] : null, '$::numeric');
        put('width_cm', v ? v[1] : null, '$::numeric');
        put('depth_cm', v && v.length === 3 ? v[2] : null, '$::numeric');
      } else if (kind === 'point') {
        if (v === null) put(key, null);
        else if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
          && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90) {
          put(key, `SRID=4326;POINT(${v[0]} ${v[1]})`, '$::geography');
        } else throw new Error('must be [longitude, latitude]');
      } else if (kind === 'area') {
        if (v !== null && !(v && typeof v === 'object' && ['Polygon', 'MultiPolygon'].includes(v.type) && Array.isArray(v.coordinates))) {
          throw new Error('must be a GeoJSON Polygon or MultiPolygon');
        }
        // ST_MakeValid repairs hand-drawn mistakes (a self-crossing "bow tie" becomes two polygons); it returns a valid
        // input unchanged. ST_CollectionExtract(…, 3) keeps only the polygon parts, ST_Multi makes it a MultiPolygon.
        put(key, v && JSON.stringify(v), 'ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($)), 3))::geography');
      } else if (kind === 'md') {
        if (v !== null && typeof v !== 'string') throw new Error('must be text');
        // Trailing whitespace is dropped however the text arrives (YAML block scalars end with a newline, forms don't).
        put(key, v === null ? null : v.replace(/\s+$/, '') || null);
      } else if (kind === 'parent') {
        if (v !== null && !SLUG.test(v)) throw new Error('must be a slug');
        parent = v;
      } else if (kind.startsWith('ref:')) {
        if (v !== null && !SLUG.test(v)) throw new Error('must be a slug');
        refs.push({ col: REF_COLUMNS[key], type: kind.slice(4), slug: v });
      } else {
        if (v !== null && typeof v !== 'string') throw new Error('must be text');
        put(key, v);
      }
    } catch (err) {
      errors.push(`${key}: ${err.message}`);
    }
  }
  const relationships = doc.relationships ?? [];
  if (!Array.isArray(relationships)) errors.push('relationships must be a list');
  return { cols, refs, parent, relationships: Array.isArray(relationships) ? relationships : [], errors };
}

// Stored date → { value: '1886-03/1888-02-20', label } where label is null when it is just the generated one.
// Two spellings can mean the same range ("1901/1903-05-08" = "1901-01/1903-05-08"); take the one whose generated
// label is the stored label, so the label need not be written out.
function dateToDoc(range, label, openEnd) {
  const value = formatFuzzyDate(range);
  if (value === null) return { value: null, label: label ?? null };
  for (const text of [value, formatFuzzyDate(range, { coarseStart: true })]) {
    if (label === parseFuzzyDate(text, { openEnd }).label) return { value: text, label: null };
  }
  return { value, label };
}

// SELECT list that reads a table back in doc shape (alias t).
function docColumns(t) {
  const cols = ['t.id', 't.slug', 't.updated_at::text AS version'];
  for (const [key, kind] of Object.entries(t.fields)) {
    if (kind === 'date' || kind === 'period') cols.push(`t.${key}::text AS ${key}`, `t.${key}_label`);
    else if (kind === 'point') cols.push(`CASE WHEN t.${key} IS NOT NULL THEN jsonb_build_array(ST_X(t.${key}::geometry), ST_Y(t.${key}::geometry)) END AS ${key}`);
    else if (kind === 'dimensions') {
      cols.push(`CASE WHEN t.height_cm IS NOT NULL THEN jsonb_build_array(t.height_cm, t.width_cm)
                   || CASE WHEN t.depth_cm IS NOT NULL THEN jsonb_build_array(t.depth_cm) ELSE '[]'::jsonb END END AS ${key}`);
    }
    else if (kind === 'area') cols.push(`ST_AsGeoJSON(t.${key})::jsonb AS ${key}`);
    else if (kind === 'parent') cols.push(`(SELECT p.slug FROM ${t.table} p WHERE p.id = t.parent_id) AS ${key}`);
    else if (kind.startsWith('ref:')) cols.push(`(SELECT r.slug FROM ${BY_TYPE[kind.slice(4)].table} r WHERE r.id = t.${REF_COLUMNS[key]}) AS ${key}`);
    else cols.push(`t.${key}`);
  }
  return cols.join(', ');
}

// Row from docColumns() → doc. Empty values are left out, dates written as fuzzy text, default labels dropped.
function rowToDoc(row, t) {
  const doc = {};
  for (const [key, kind] of Object.entries(t.fields)) {
    let v = row[key];
    if (kind === 'date' || kind === 'period') {
      const d = dateToDoc(v, row[`${key}_label`], kind === 'period');
      if (d.value !== null) doc[key] = d.value;
      if (d.label !== null) doc[`${key}_label`] = d.label;
      continue;
    }
    if (kind === 'text[]' && Array.isArray(v) && !v.length) v = null;
    if (kind === 'json' && v && !Object.keys(v).length) v = null;
    if (v !== null && v !== undefined) doc[key] = v;
  }
  return doc;
}

// Read entities as docs: [{ id, slug, version (updated_at as text, for edit conflicts), doc }]. `where` is SQL on alias t.
async function readDocs(db, t, where = 'true', params = []) {
  const { rows } = await db.query(`SELECT ${docColumns(t)} FROM ${t.table} t WHERE ${where} ORDER BY t.slug`, params);
  return rows.map((row) => ({ id: row.id, slug: row.slug, version: row.version, doc: rowToDoc(row, t) }));
}

// Relationships whose subject is (type, id), in doc shape (as written in the subject's YAML file), with their ids.
async function readRelationships(db, type, id) {
  const { rows } = await db.query(`
    SELECT r.id, r.relationship_type AS type, o.type::text || '/' || o.slug AS "to", o.name AS to_name,
           r.period::text AS period, r.period_label, r.label, r.certainty::text AS certainty, r.notes_md, r.metadata
    FROM relationships r JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
    JOIN relationship_types rt ON rt.code = r.relationship_type
    WHERE r.subject_type = $1 AND r.subject_id = $2
    ORDER BY rt.sort_order, lower(r.period) NULLS FIRST, o.slug`, [type, id]);
  return rows.map((r) => {
    const rel = { type: r.type, to: r.to };
    const d = dateToDoc(r.period, r.period_label, true);
    if (d.value !== null) rel.period = d.value;
    if (d.label !== null) rel.period_label = d.label;
    if (r.label !== null) rel.label = r.label;
    if (r.certainty !== 'attested') rel.certainty = r.certainty;
    if (r.notes_md !== null) rel.notes_md = r.notes_md;
    const { sources, ...rest } = r.metadata || {};
    if (sources !== undefined) rel.sources = sources;
    if (Object.keys(rest).length) rel.metadata = rest;
    return { id: r.id, to_name: r.to_name, rel };
  });
}

// A stored row (to_jsonb of the table, e.g. audit_log.new_row) read back as a doc: jsonb_populate_record turns the JSON
// into a real row of the table's type, so the same docColumns() expressions (refs → slugs, dates → text …) apply.
async function docFromJson(db, t, json) {
  const { rows } = await db.query(`SELECT ${docColumns(t)} FROM jsonb_populate_record(NULL::${t.table}, $1::jsonb) t`, [JSON.stringify(json)]);
  return rowToDoc(rows[0], t);
}

module.exports = { TYPES, BY_TYPE, BY_FOLDER, REF_COLUMNS, REL_KEYS, SLUG, toRow, readDocs, readRelationships, dateToDoc, docFromJson };
