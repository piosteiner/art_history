// The content model in one place, shared by the YAML import, the YAML export and the admin panel.
// A "doc" is one entity as plain data — exactly what a content/<folder>/<slug>.yaml file holds:
//   { name: 'Vincent van Gogh', birth: '1853-03-30', alt_names: [...], relationships: [{ type, to, period, … }] }
// toRow() turns a doc into validated SQL column values; readDocs() reads rows back into docs.
const { parseFuzzyDate, formatFuzzyDate } = require('./fuzzy-date');
const names = require('./names');
const dimensions = require('./dimensions');

// Field kinds: name (the main name: plain text in <col>, furigana markup in <col>_ruby, language in <col>_lang; the
//                    doc holds the markup version and <key>_lang) · names (other names [{text, lang, role}], jsonb)
//              text · text[] · json · md · date (→ <col> + <col>_label) · period (a date that may be open-ended, "1808/")
//              dimensions [height], [height, width] or [height, width, depth] in cm (→ height_cm, width_cm, depth_cm)
//              dimsets: further measurements [{part, cm: [h, w, d]}] (jsonb; src/dimensions.js)
//              point [lon, lat] · area (GeoJSON)
//              ref:<type> (slug → id, may point at any imported or existing entity) · parent (same-table ref, second pass)
// Order matters: a type may only reference types listed before it (parent refs are resolved afterwards).
// `name` is the column that names an entity (artworks have a title).
const TYPES = [
  { type: 'place', folder: 'places', table: 'places', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', parent: 'parent', country_code: 'text', boundary_code: 'text',
    location: 'point', area: 'area', description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'movement', folder: 'movements', table: 'movements', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', parent: 'parent', period: 'period',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'polity', folder: 'polities', table: 'polities', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', parent: 'parent', period: 'period', country_codes: 'text[]',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artist', folder: 'artists', table: 'artists', name: 'name', fields: {
    name: 'name', sort_name: 'text', names: 'names', birth: 'date', death: 'date',
    biography_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  // people: everyone relevant who isn't an artist (poets, rulers, monks, sitters …) and groups (families, orders);
  // "patron" is a role from the relationships commissioned / patron of (migration 024)
  { type: 'person', folder: 'people', table: 'people', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', occupations: 'text[]', birth: 'date', death: 'date', active: 'period',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'institution', folder: 'institutions', table: 'institutions', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', founded: 'date', place: 'ref:place', location: 'point', address: 'text',
    description_md: 'md', website_url: 'text', wikidata_id: 'text', metadata: 'json' } },
  // events (migration 047): something that happened — when, where (city; exact spot or area), part of a larger event;
  // depicted, taken part in and concerned via relationships
  { type: 'event', folder: 'events', table: 'events', name: 'name', fields: {
    name: 'name', names: 'names', kind: 'text', parent: 'parent', period: 'period', place: 'ref:place',
    location: 'point', area: 'area', description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  // the glossary (migration 027): terms that texts link with [[slug]]; category is a fixed list (enum term_category)
  { type: 'term', folder: 'glossary', table: 'glossary', name: 'name', fields: {
    name: 'name', names: 'names', category: 'text', definition: 'text', description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  // the bibliography (migration 036): cited in texts with [[source/slug|S. 45]] (src/bibliography.js, src/markdown.js)
  { type: 'source', folder: 'bibliography', table: 'bibliography', name: 'name', fields: {
    kind: 'text', name: 'name', subtitle: 'text', names: 'names', authors: 'text[]', editors: 'text[]', compilers: 'text[]',
    container: 'text', container_editors: 'text[]', volume: 'text', issue: 'text', issue_date: 'text', volumes_total: 'text',
    edition: 'text', original_year: 'text', series: 'text', thesis: 'text', place: 'text', publisher: 'text', year: 'text',
    pages: 'text', pages_are_columns: 'bool', catalogue_number: 'text', exhibition: 'text', url: 'text', accessed: 'date',
    uploader: 'text', uploaded: 'date', date_text: 'text', archive: 'text', shelfmark: 'text', isbn: 'text', doi: 'text',
    siglum: 'text', primary_source: 'bool', reading_status: 'text', read_on: 'date',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artwork', folder: 'artworks', table: 'artworks', name: 'title', fields: {
    title: 'name', names: 'names', parent: 'parent', part_number: 'text', parts_count: 'text', creator: 'ref:artist', attribution_label: 'text', created: 'date',
    kind: 'text', medium: 'text', materials: 'text[]', dimensions: 'dimensions', dimensions_note: 'text',
    other_dimensions: 'dimsets',
    institution: 'ref:institution', inventory_number: 'text', web_url: 'text',  // its page at the museum (038)
    on_loan: 'bool', on_loan_since: 'date',  // lent to the institution where it is; the owner is in the provenance (048)
    location: 'point', area: 'area',  // only for works that don't move: buildings, gardens, bridges … (migration 034)
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
];
// Types with images (table images, migration 017): the foreign-key column that points at them.
const IMAGE_FK = { artwork: 'artwork_id', artist: 'artist_id', institution: 'institution_id', term: 'glossary_id', person: 'person_id', event: 'event_id' };
for (const t of TYPES) t.imageFk = IMAGE_FK[t.type] || null;
const BY_TYPE = Object.fromEntries(TYPES.map((t) => [t.type, t]));
const BY_FOLDER = Object.fromEntries(TYPES.map((t) => [t.folder, t]));

// YAML key → column where they differ.
const REF_COLUMNS = { place: 'place_id', creator: 'creator_id', institution: 'current_institution_id' };
const REL_KEYS = new Set(['type', 'to', 'period', 'period_label', 'label', 'certainty', 'notes_md', 'sources', 'metadata']);
const IMAGE_KEYS = ['url', 'source_url', 'license', 'credit', 'caption'];
// A further number of an artwork in YAML (migration 048): whose it is — an institution or a catalogue (source) slug — or a label.
const NUMBER_KEYS = ['number', 'institution', 'source', 'label'];
// A provenance step in YAML (migration 031): owner "type/slug" and/or owner_label, dates as fuzzy text, place = slug.
const PROVENANCE_KEYS = ['owner', 'owner_label', 'acquired', 'acquired_label', 'ended', 'ended_label', 'method', 'direct',
  'place', 'label', 'certainty', 'notes_md', 'sources'];
const ACQUISITION_METHODS = ['creation', 'commission', 'inheritance', 'purchase', 'auction', 'gift', 'bequest', 'exchange',
  'confiscation', 'forced_sale', 'restitution', 'unknown'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LEGACY_ALT = ['alt_names', 'alt_titles'];  // before migration 022: plain lists → names with role "alternative"

// doc → { cols: {col: [sqlExpr, value]}, refs: [{col, type, slug}], parent, relationships, images, errors: ['key: message'] }
// sqlExpr uses "$" as the placeholder for its value. Nothing here touches the database.
function toRow(doc, fields) {
  const cols = {};
  const refs = [];
  const errors = [];
  let parent = null;
  const put = (col, value, expr = '$') => { cols[col] = [expr, value]; };

  for (const key of Object.keys(doc)) {
    if (key === 'relationships' || key === 'images' || key === 'provenance' || key === 'slug') continue;
    if (key.endsWith('_label') && ['date', 'period'].includes(fields[key.slice(0, -'_label'.length)])) continue;
    if (key.endsWith('_lang') && fields[key.slice(0, -'_lang'.length)] === 'name') continue;
    if (LEGACY_ALT.includes(key) && fields.names === 'names') continue;  // older YAML: alt_names / alt_titles
    if (!fields[key]) errors.push(`unknown field "${key}"`);
  }

  for (const [key, kind] of Object.entries(fields)) {
    const v = doc[key] ?? null;
    try {
      if (kind === 'date' || kind === 'period') {
        const d = parseFuzzyDate(v, { openEnd: kind === 'period' });
        put(key, d && d.range, '$::daterange');
        put(`${key}_label`, doc[`${key}_label`] ?? (d && d.label));
      } else if (kind === 'name') {
        if (v !== null && typeof v !== 'string') throw new Error('must be text');
        const err = v && names.rubyError(v);
        if (err) throw new Error(err);
        const markup = v === null ? null : v.trim();
        put(key, markup === null ? null : names.plain(markup));
        put(`${key}_ruby`, markup && names.hasRuby(markup) ? markup : null);
        const lang = names.normLang(doc[`${key}_lang`]);
        if (lang && !names.langOk(lang)) throw new Error(`language "${doc[`${key}_lang`]}" is not a language code (e.g. en, ja, zh-Hant)`);
        put(`${key}_lang`, lang);
      } else if (kind === 'names') {
        const list = v ?? LEGACY_ALT.map((k) => doc[k]).find((x) => x != null) ?? [];
        if (!Array.isArray(list)) throw new Error('must be a list');
        put(key, JSON.stringify(list.map((n, i) => { try { return names.normName(n); } catch (err) { throw new Error(`[${i}] ${err.message}`); } })), '$::jsonb');
      } else if (kind === 'bool') {
        // true / false in YAML; "yes" from forms (a select, so live working copies can carry it)
        put(key, v === true || v === 'yes' || v === 'true');
      } else if (kind === 'dimsets') {
        const list = v ?? [];
        if (!Array.isArray(list)) throw new Error('must be a list of {part, cm}');
        put(key, JSON.stringify(list.map((s, i) => dimensions.normSet(s, i))), '$::jsonb');
      } else if (kind === 'text[]') {
        if (v !== null && !(Array.isArray(v) && v.every((s) => typeof s === 'string'))) throw new Error('must be a list of strings');
        put(key, v || []);
      } else if (kind === 'json') {
        if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new Error('must be a mapping');
        put(key, JSON.stringify(v || {}), '$::jsonb');
      } else if (kind === 'dimensions') {
        // [height], [height, width] or [height, width, depth], centimetres, all > 0 — three numeric columns
        if (v !== null && !(Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every((n) => Number.isFinite(n) && n > 0 && n < 1e6))) {
          throw new Error('must be [height], [height, width] or [height, width, depth] in cm, all greater than 0');
        }
        put('height_cm', v ? v[0] : null, '$::numeric');
        put('width_cm', v && v.length >= 2 ? v[1] : null, '$::numeric');
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
  // images: [{url, source_url, license, credit, caption}] in order (the first is the main image); null = key absent
  let images = null;
  if (doc.images !== undefined) {
    if (!Array.isArray(doc.images)) errors.push('images must be a list');
    else {
      images = doc.images;
      images.forEach((img, i) => {
        if (!img || typeof img !== 'object' || Array.isArray(img)) { errors.push(`images[${i}]: must be a mapping`); return; }
        const extra = Object.keys(img).filter((k) => !IMAGE_KEYS.includes(k));
        if (extra.length) errors.push(`images[${i}]: unknown field(s) ${extra.join(', ')}`);
        if (typeof img.url !== 'string' || !/^https:\/\/\S+$/.test(img.url)) errors.push(`images[${i}]: url (https://…) is required`);
        for (const k of IMAGE_KEYS) if (img[k] != null && typeof img[k] !== 'string') errors.push(`images[${i}].${k}: must be text`);
      });
      const urls = images.map((img) => img && img.url);
      if (new Set(urls).size !== urls.length) errors.push('images: the same url twice');
    }
  }
  // provenance (artworks): [{owner, acquired, method, …}] in order; null = key absent. Owners/places are looked up
  // by the importer; here only the shape is checked.
  let provenance = null;
  if (doc.provenance !== undefined) {
    if (!fields.creator) errors.push('provenance: only artworks have a provenance');
    else if (!Array.isArray(doc.provenance)) errors.push('provenance must be a list');
    else {
      provenance = doc.provenance;
      provenance.forEach((st, i) => {
        const at = `provenance[${i}]`;
        if (!st || typeof st !== 'object' || Array.isArray(st)) { errors.push(`${at}: must be a mapping`); return; }
        const extra = Object.keys(st).filter((k) => !PROVENANCE_KEYS.includes(k));
        if (extra.length) errors.push(`${at}: unknown field(s) ${extra.join(', ')}`);
        if (!st.owner && !st.owner_label) errors.push(`${at}: owner (type/slug) or owner_label is required`);
        if (st.owner && !/^(artist|person|institution|place)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(st.owner)) errors.push(`${at}.owner: must look like person/michel-monet`);
        if (st.method !== undefined && !ACQUISITION_METHODS.includes(st.method)) errors.push(`${at}.method: one of ${ACQUISITION_METHODS.join(', ')}`);
        if (st.certainty !== undefined && !['attested', 'probable', 'possible', 'disputed'].includes(st.certainty)) errors.push(`${at}.certainty: attested, probable, possible or disputed`);
        if (st.direct !== undefined && typeof st.direct !== 'boolean') errors.push(`${at}.direct: true or false`);
        if (st.place !== undefined && !SLUG.test(String(st.place))) errors.push(`${at}.place: a place slug`);
        for (const k of ['acquired', 'ended']) {
          try { parseFuzzyDate(st[k] ?? null); } catch (err) { errors.push(`${at}.${k}: ${err.message}`); }
        }
      });
    }
  }
  // numbers (artworks, 048): [{number, institution | source, label}] in order; null = key absent
  let numbers = null;
  if (doc.numbers !== undefined) {
    if (!fields.creator) errors.push('numbers: only artworks have further numbers');
    else if (!Array.isArray(doc.numbers)) errors.push('numbers must be a list');
    else {
      numbers = doc.numbers;
      numbers.forEach((n, i) => {
        const at = `numbers[${i}]`;
        if (!n || typeof n !== 'object' || Array.isArray(n)) { errors.push(`${at}: must be a mapping`); return; }
        const extra = Object.keys(n).filter((k) => !NUMBER_KEYS.includes(k));
        if (extra.length) errors.push(`${at}: unknown field(s) ${extra.join(', ')}`);
        if (n.number === undefined || n.number === null || String(n.number).trim() === '') errors.push(`${at}: number is required`);
        if (n.institution && n.source) errors.push(`${at}: institution or source, not both`);
        if (!n.institution && !n.source && !n.label) errors.push(`${at}: say whose number it is (institution, source or label)`);
        for (const k of ['institution', 'source']) if (n[k] !== undefined && !SLUG.test(String(n[k]))) errors.push(`${at}.${k}: a slug`);
      });
    }
  }
  return { cols, refs, parent, relationships: Array.isArray(relationships) ? relationships : [], images, provenance, numbers, errors };
}

// Stored date → { value: '1886-03/1888-02-20', label } where label is null when it is just the generated one.
// Two spellings can mean the same range ("1901/1903-05-08" = "1901-01/1903-05-08"); take the one whose generated
// label is the stored label, so the label need not be written out.
function dateToDoc(range, label, openEnd) {
  const value = formatFuzzyDate(range);
  if (value === null) return { value: null, label: label ?? null };
  // Written as "13th century" (or "late 13th century", "1880s"): the label is the text, so show it as the value.
  try { if (label && parseFuzzyDate(label, { openEnd }).range.replace(/"/g, '') === String(range).replace(/"/g, '')) return { value: label, label: null }; } catch { /* not such a text */ }
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
    else if (kind === 'name') cols.push(`coalesce(t.${key}_ruby, t.${key}) AS ${key}`, `t.${key}_lang`);
    else if (kind === 'point') cols.push(`CASE WHEN t.${key} IS NOT NULL THEN jsonb_build_array(ST_X(t.${key}::geometry), ST_Y(t.${key}::geometry)) END AS ${key}`);
    else if (kind === 'dimensions') {
      // [h], [h, w] or [h, w, d]: jsonb_strip_nulls doesn't touch arrays, so drop the trailing NULLs by filtering
      cols.push(`CASE WHEN t.height_cm IS NOT NULL THEN (SELECT jsonb_agg(x ORDER BY i) FROM unnest(ARRAY[t.height_cm, t.width_cm, t.depth_cm])
                   WITH ORDINALITY AS u(x, i) WHERE x IS NOT NULL) END AS ${key}`);
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
    if (kind === 'name' && row[`${key}_lang`]) doc[`${key}_lang`] = row[`${key}_lang`];
    // names: a plain alternative stays a plain string in YAML (as the old lists were)
    if (kind === 'names') v = Array.isArray(v) && v.length ? v.map((n) => (n.role === 'alternative' && !n.lang ? n.text : n)) : null;
    if ((kind === 'text[]' || kind === 'dimsets') && Array.isArray(v) && !v.length) v = null;
    if (kind === 'json' && v && !Object.keys(v).length) v = null;
    if (kind === 'bool' && !v) v = null;
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

// An entry's images in order (the first is the main image).
async function readImages(db, type, id) {
  const fk = IMAGE_FK[type];
  if (!fk) return [];
  const { rows } = await db.query(`SELECT id, position, url, source_url, license, credit, caption FROM images
    WHERE ${fk} = $1 ORDER BY position, id`, [id]);
  return rows;
}

// An artwork's further numbers in doc shape (as written in its YAML file), in order.
async function readNumbers(db, artworkId) {
  const { rows } = await db.query(`
    SELECT n.number, i.slug AS institution, b.slug AS source, n.label FROM artwork_numbers n
    LEFT JOIN institutions i ON i.id = n.institution_id LEFT JOIN bibliography b ON b.id = n.source_id
    WHERE n.artwork_id = $1 ORDER BY n.position, n.id`, [artworkId]);
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
}

// An artwork's provenance in doc shape (as written in its YAML file), in order.
async function readProvenance(db, artworkId) {
  const { rows } = await db.query(`
    SELECT o.type::text || '/' || o.slug AS owner, p.owner_label, p.acquired::text AS acquired, p.acquired_label,
           p.ended::text AS ended, p.ended_label, p.method::text AS method, p.direct, l.slug AS place, p.label,
           p.certainty::text AS certainty, p.notes_md, p.metadata
    FROM provenance p
    LEFT JOIN entity_index o ON (o.type, o.id) = (CASE WHEN p.owner_artist_id IS NOT NULL THEN 'artist' WHEN p.owner_person_id IS NOT NULL THEN 'person'
                                                       WHEN p.owner_institution_id IS NOT NULL THEN 'institution' ELSE 'place' END::entity_type,
                                                  coalesce(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id))
    LEFT JOIN places l ON l.id = p.location_id
    WHERE p.artwork_id = $1 ORDER BY p.position`, [artworkId]);
  return rows.map((r) => {
    const st = {};
    if (r.owner) st.owner = r.owner;
    if (r.owner_label) st.owner_label = r.owner_label;
    for (const k of ['acquired', 'ended']) {
      const d = dateToDoc(r[k], r[`${k}_label`], false);
      if (d.value !== null) st[k] = d.value;
      if (d.label !== null) st[`${k}_label`] = d.label;
    }
    if (r.method !== 'unknown') st.method = r.method;
    if (r.direct) st.direct = true;
    if (r.place) st.place = r.place;
    if (r.label) st.label = r.label;
    if (r.certainty !== 'attested') st.certainty = r.certainty;
    if (r.notes_md) st.notes_md = r.notes_md;
    if (r.metadata && r.metadata.sources) st.sources = r.metadata.sources;
    return st;
  });
}

module.exports = { IMAGE_FK, IMAGE_KEYS, NUMBER_KEYS, PROVENANCE_KEYS, readImages, readProvenance, readNumbers, TYPES, BY_TYPE, BY_FOLDER, REF_COLUMNS, REL_KEYS, SLUG, toRow, readDocs, readRelationships, dateToDoc, docFromJson };
