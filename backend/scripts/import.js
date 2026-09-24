// Imports the git-tracked YAML in content/ into Postgres. Idempotent: re-running changes nothing
// unless a file changed (unchanged rows are not even touched, so updated_at stays meaningful).
// Runs as arthistory_admin, all in ONE transaction — any error and nothing is written.
//
//   npm run import                  # production DB
//   npm run import:dev              # arthistory_dev
//   npm run import -- --dry-run     # validate + report, then roll back
//   npm run import -- --prune       # also delete relationships of content entities that are no longer in the YAML
//
// Layout: content/<folder>/<slug>.yaml — one entity per file, the file name is its slug.
// Format and examples: content/README.md
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { Client } = require('pg');
const config = require('../src/config');
const { parseFuzzyDate } = require('../src/fuzzy-date');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', '..', 'content');
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');

// Field kinds: text · text[] · json · md · date (→ <col> + <col>_label) · point [lon, lat] · area (GeoJSON)
//              ref:<type> (slug → id, may point at any imported or existing entity) · parent (same-table ref, second pass)
// Order matters: a type may only reference types listed before it (parent refs are resolved afterwards).
const TYPES = [
  { type: 'place', folder: 'places', table: 'places', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', parent: 'parent', country_code: 'text',
    location: 'point', area: 'area', description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'movement', folder: 'movements', table: 'movements', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', parent: 'parent', period: 'date',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artist', folder: 'artists', table: 'artists', fields: {
    name: 'text', sort_name: 'text', alt_names: 'text[]', birth: 'date', death: 'date',
    biography_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'patron', folder: 'patrons', table: 'patrons', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', active: 'date', notes_md: 'md', wikidata_id: 'text', metadata: 'json' } },
  { type: 'institution', folder: 'institutions', table: 'institutions', fields: {
    name: 'text', alt_names: 'text[]', kind: 'text', founded: 'date', place: 'ref:place',
    description_md: 'md', website_url: 'text', wikidata_id: 'text', metadata: 'json' } },
  { type: 'artwork', folder: 'artworks', table: 'artworks', fields: {
    title: 'text', alt_titles: 'text[]', creator: 'ref:artist', attribution_label: 'text', created: 'date',
    kind: 'text', medium: 'text', institution: 'ref:institution', inventory_number: 'text',
    image_url: 'text', image_source_url: 'text', image_license: 'text', image_credit: 'text',
    description_md: 'md', wikidata_id: 'text', metadata: 'json' } },
];
// YAML key → column where they differ.
const REF_COLUMNS = { place: 'place_id', creator: 'creator_id', institution: 'current_institution_id' };
const REL_KEYS = new Set(['type', 'to', 'period', 'period_label', 'label', 'certainty', 'notes_md', 'sources', 'metadata']);

// Collect every problem instead of stopping at the first one.
const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function loadFiles() {
  const entities = [];
  for (const t of TYPES) {
    const dir = path.join(CONTENT_DIR, t.folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
      const file = `${t.folder}/${name}`;
      const slug = name.slice(0, -'.yaml'.length);
      let doc;
      try {
        // The 'core' schema (YAML 1.2) keeps 1853-03-30 a string instead of turning it into a JS Date.
        doc = YAML.parse(fs.readFileSync(path.join(dir, name), 'utf8'), { schema: 'core' });
      } catch (err) {
        fail(file, `YAML syntax: ${err.message}`);
        continue;
      }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { fail(file, 'must be a mapping'); continue; }
      entities.push({ ...t, file, slug, doc });
    }
  }
  return entities;
}

// YAML doc → { columns: {col: [sqlExpr, value]}, refs: [...], parent, relationships }
function toRow(e) {
  const { doc, fields, file } = e;
  const cols = {};
  const refs = [];
  let parent = null;
  const put = (col, value, expr = '$') => { cols[col] = [expr, value]; };

  for (const key of Object.keys(doc)) {
    if (key === 'relationships' || key === 'slug') continue;
    if (key.endsWith('_label') && fields[key.slice(0, -'_label'.length)] === 'date') continue;
    if (!fields[key]) fail(file, `unknown field "${key}"`);
  }
  if (doc.slug !== undefined && doc.slug !== e.slug) fail(file, `slug "${doc.slug}" differs from the file name`);

  for (const [key, kind] of Object.entries(fields)) {
    const v = doc[key] ?? null;
    try {
      if (kind === 'date') {
        const d = parseFuzzyDate(v);
        put(key, d && d.range, '$::daterange');
        put(`${key}_label`, doc[`${key}_label`] ?? (d && d.label));
      } else if (kind === 'text[]') {
        if (v !== null && !(Array.isArray(v) && v.every((s) => typeof s === 'string'))) throw new Error('must be a list of strings');
        put(key, v || []);
      } else if (kind === 'json') {
        if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new Error('must be a mapping');
        put(key, JSON.stringify(v || {}), '$::jsonb');
      } else if (kind === 'point') {
        if (v === null) put(key, null);
        else if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
          && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90) {
          put(key, `SRID=4326;POINT(${v[0]} ${v[1]})`, '$::geography');
        } else throw new Error('must be [longitude, latitude]');
      } else if (kind === 'area') {
        put(key, v && JSON.stringify(v), 'ST_Multi(ST_GeomFromGeoJSON($))::geography');
      } else if (kind === 'parent') {
        parent = v;
      } else if (kind.startsWith('ref:')) {
        refs.push({ col: REF_COLUMNS[key], type: kind.slice(4), slug: v });
      } else {
        if (v !== null && typeof v !== 'string') throw new Error('must be text');
        put(key, v);
      }
    } catch (err) {
      fail(file, `${key}: ${err.message}`);
    }
  }
  const relationships = doc.relationships ?? [];
  if (!Array.isArray(relationships)) fail(file, 'relationships must be a list');
  return { cols, refs, parent, relationships: Array.isArray(relationships) ? relationships : [] };
}

async function main() {
  if (!fs.existsSync(CONTENT_DIR)) throw new Error(`content directory not found: ${CONTENT_DIR}`);
  const entities = loadFiles();
  for (const e of entities) Object.assign(e, toRow(e));

  const seen = new Set();
  for (const e of entities) {
    const key = `${e.type}/${e.slug}`;
    if (seen.has(key)) fail(e.file, 'duplicate slug');
    seen.add(key);
  }
  if (errors.length) return report();

  const client = new Client({ connectionString: config.db.adminUrl, application_name: 'arthistory-import' });
  await client.connect();
  const stats = {};
  const count = (what) => { stats[what] = (stats[what] || 0) + 1; };
  const ids = new Map(); // 'artist/vincent-van-gogh' → id

  // Resolve a slug to an id: imported in this run, or already in the database.
  async function idOf(type, slug) {
    const key = `${type}/${slug}`;
    if (!ids.has(key)) {
      const { rows } = await client.query('SELECT entity_id($1, $2) AS id', [type, slug]);
      if (rows[0].id !== null) ids.set(key, rows[0].id);
    }
    return ids.get(key) ?? null;
  }

  try {
    await client.query('BEGIN');

    // 1. Entities, in dependency order. A single statement per row:
    //    INSERT … ON CONFLICT (slug) DO UPDATE … WHERE <something changed> RETURNING (xmax = 0) AS inserted
    //    xmax = 0 means "this row version was freshly inserted" — a common Postgres idiom to tell insert from update.
    //    No row returned = identical row already existed = untouched.
    for (const e of entities) {
      for (const r of e.refs) {
        let id = null;
        if (r.slug !== null) {
          id = await idOf(r.type, r.slug);
          if (id === null) { fail(e.file, `unknown ${r.type} "${r.slug}"`); continue; }
        }
        e.cols[r.col] = ['$', id];
      }
      const names = Object.keys(e.cols);
      const values = [e.slug];
      const exprs = names.map((c) => { values.push(e.cols[c][1]); return e.cols[c][0].replace('$', () => `$${values.length}`); });
      // geography has no exact "=" operator, so compare those columns by their binary text form.
      const cmp = (prefix) => names.map((c) => (/^(location|area)$/.test(c) ? `${prefix}.${c}::text` : `${prefix}.${c}`)).join(', ');
      const sql = `
        INSERT INTO ${e.table} AS t (slug, ${names.join(', ')}) VALUES ($1, ${exprs.join(', ')})
        ON CONFLICT (slug) DO UPDATE SET ${names.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
          WHERE (${cmp('t')}) IS DISTINCT FROM (${cmp('EXCLUDED')})
        RETURNING id, (xmax = 0) AS inserted`;
      try {
        await client.query('SAVEPOINT entity');
        const { rows } = await client.query(sql, values);
        await client.query('RELEASE SAVEPOINT entity');
        if (rows.length) {
          ids.set(`${e.type}/${e.slug}`, rows[0].id);
          count(`${e.type}s ${rows[0].inserted ? 'inserted' : 'updated'}`);
        } else {
          await idOf(e.type, e.slug);
          count(`${e.type}s unchanged`);
        }
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT entity');
        fail(e.file, err.message);
      }
    }

    // 2. Same-table parents (Arles → Provence → France), now that every row exists.
    for (const e of entities.filter((x) => x.fields.parent)) {
      if (!ids.has(`${e.type}/${e.slug}`)) continue;
      const parentId = e.parent === null ? null : await idOf(e.type, e.parent);
      if (e.parent !== null && parentId === null) { fail(e.file, `unknown parent ${e.type} "${e.parent}"`); continue; }
      const { rowCount } = await client.query(
        `UPDATE ${e.table} SET parent_id = $2 WHERE id = $1 AND parent_id IS DISTINCT FROM $2`,
        [ids.get(`${e.type}/${e.slug}`), parentId]);
      if (rowCount) count('parents set');
    }

    // 3. Relationships, declared in the subject's file.
    const keep = new Set();
    const vocab = new Map((await client.query('SELECT code, is_symmetric FROM relationship_types')).rows.map((r) => [r.code, r]));
    for (const e of entities) {
      const subjectId = ids.get(`${e.type}/${e.slug}`);
      if (subjectId === undefined) continue;
      for (const [i, rel] of e.relationships.entries()) {
        const where = `relationships[${i}]`;
        if (!rel || typeof rel !== 'object') { fail(e.file, `${where}: must be a mapping`); continue; }
        const extra = Object.keys(rel).filter((k) => !REL_KEYS.has(k));
        if (extra.length) { fail(e.file, `${where}: unknown field(s) ${extra.join(', ')}`); continue; }
        if (!vocab.has(rel.type)) { fail(e.file, `${where}: unknown relationship type "${rel.type}"`); continue; }
        const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(rel.to || '');
        if (!m) { fail(e.file, `${where}: "to" must look like place/paris`); continue; }
        const [, objectType, objectSlug] = m;
        if (!TYPES.some((t) => t.type === objectType)) { fail(e.file, `${where}: unknown entity type "${objectType}"`); continue; }
        const objectId = await idOf(objectType, objectSlug);
        if (objectId === null) { fail(e.file, `${where}: ${rel.to} does not exist`); continue; }
        let period;
        try { period = parseFuzzyDate(rel.period); } catch (err) { fail(e.file, `${where}: period: ${err.message}`); continue; }
        const metadata = { ...(rel.metadata || {}), ...(rel.sources ? { sources: rel.sources } : {}) };

        const params = [e.type, subjectId, rel.type, objectType, objectId, period && period.range,
          rel.period_label ?? (period && period.label), rel.label ?? null, rel.certainty ?? 'attested',
          rel.notes_md ?? null, JSON.stringify(metadata)];
        try {
          await client.query('SAVEPOINT rel');
          // The unique key (subject, type, object, period) is the edge's identity; everything else is updatable.
          // Symmetric edges are flipped into canonical order by the BEFORE trigger, before the conflict check.
          const { rows } = await client.query(`
            INSERT INTO relationships AS r (subject_type, subject_id, relationship_type, object_type, object_id, period,
                                            period_label, label, certainty, notes_md, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::daterange, $7, $8, $9, $10, $11::jsonb)
            ON CONFLICT (subject_type, subject_id, relationship_type, object_type, object_id, period) DO UPDATE
              SET period_label = EXCLUDED.period_label, label = EXCLUDED.label, certainty = EXCLUDED.certainty,
                  notes_md = EXCLUDED.notes_md, metadata = EXCLUDED.metadata
              WHERE (r.period_label, r.label, r.certainty, r.notes_md, r.metadata)
                    IS DISTINCT FROM (EXCLUDED.period_label, EXCLUDED.label, EXCLUDED.certainty, EXCLUDED.notes_md, EXCLUDED.metadata)
            RETURNING id, (xmax = 0) AS inserted`, params);
          await client.query('RELEASE SAVEPOINT rel');
          if (rows.length) {
            keep.add(rows[0].id);
            count(`relationships ${rows[0].inserted ? 'inserted' : 'updated'}`);
          } else {
            // Unchanged: look the id up (either direction, in case the trigger flipped a symmetric edge).
            const found = await client.query(`
              SELECT id FROM relationships
              WHERE relationship_type = $3 AND period IS NOT DISTINCT FROM $6::daterange
                AND ((subject_type, subject_id, object_type, object_id) = ($1, $2, $4, $5)
                  OR (subject_type, subject_id, object_type, object_id) = ($4, $5, $1, $2))`, params.slice(0, 6));
            found.rows.forEach((r) => keep.add(r.id));
            count('relationships unchanged');
          }
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT rel');
          fail(e.file, `${where} (${rel.type} → ${rel.to}): ${err.message}`);
        }
      }
    }

    // 4. Optional: relationships a content entity used to declare but no longer does.
    //    (Edges whose subject is NOT in content/ — e.g. added via the admin panel — are never touched.)
    if (PRUNE && !errors.length) {
      const subjects = entities.filter((e) => ids.has(`${e.type}/${e.slug}`));
      const { rowCount } = await client.query(`
        DELETE FROM relationships r
        USING unnest($1::entity_type[], $2::bigint[]) AS s(type, id)
        WHERE r.subject_type = s.type AND r.subject_id = s.id AND r.id <> ALL ($3::bigint[])`,
        [subjects.map((e) => e.type), subjects.map((e) => ids.get(`${e.type}/${e.slug}`)), [...keep]]);
      if (rowCount) stats['relationships pruned'] = rowCount;
    }

    // Entities in the database without a file (created elsewhere, or file deleted): report only, never delete.
    const orphans = await client.query(`
      SELECT type, slug FROM entity_index
      WHERE (type::text || '/' || slug) <> ALL ($1::text[]) ORDER BY type, slug`, [[...seen]]);

    if (errors.length) {
      await client.query('ROLLBACK');
    } else if (DRY_RUN) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
    report(stats, orphans.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

function report(stats = {}, orphans = []) {
  if (errors.length) {
    console.error(`✗ import failed — nothing written (${errors.length} problem${errors.length > 1 ? 's' : ''}):`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exitCode = 1;
    return;
  }
  console.log(`${DRY_RUN ? 'dry run (rolled back)' : '✓ imported'} into ${config.db.name} from ${CONTENT_DIR}`);
  Object.entries(stats).sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));
  if (orphans.length) {
    console.log(`  note: ${orphans.length} entit${orphans.length > 1 ? 'ies' : 'y'} in the database have no file in content/:`);
    orphans.forEach((o) => console.log(`    ${o.type}/${o.slug}`));
  }
}

main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
