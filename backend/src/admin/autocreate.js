// A reference typed as a name that doesn't exist yet (an artwork's creator or institution) creates a minimal entry
// instead of refusing the save. The new entry is flagged in auto_created (migration 021) until it is completed.
//
//   typed value                         result
//   an existing slug                    that entry (as before)
//   the exact name of an entry          that entry (accent- and case-insensitive, also other names)
//   a name close to an existing one     refused once with "did you mean …?" — a "create new" tick creates it anyway
//   anything else                       a new entry with that name, created in the same transaction as the save
// A place's parent works the same way when the name is a country or region Natural Earth knows (migration 032): the
// new place gets its kind, country code and boundary code — and so its outline — from there.
const { BY_TYPE, SLUG } = require('../content');

const AUTO_TYPES = new Set(['artist', 'institution']);  // types that need nothing but a name

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entry';
async function freeSlug(db, t, base) {
  let slug = slugify(base);
  for (let i = 2; (await db.query(`SELECT 1 FROM ${t.table} WHERE slug = $1`, [slug])).rows.length; i += 1) slug = `${slugify(base)}-${i}`;
  return slug;
}
// "claude-monet" typed into the field → "Claude Monet"
const nameFrom = (v) => (SLUG.test(v) ? v.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : v.replace(/\s+/g, ' '));

// Before validation: replaces typed names in `doc` by slugs. → { creates: [{key, type, name}], errors, confirm: {key: name} }
// `body['new.<key>'] === '1'` confirms creating despite a similar entry.
async function resolveRefs(db, t, doc, body) {
  const out = { creates: [], errors: [], confirm: {} };
  for (const [key, kind] of Object.entries(t.fields)) {
    const type = kind.startsWith('ref:') ? kind.slice(4) : kind === 'parent' && t.type === 'place' ? 'place' : null;
    const v = typeof doc[key] === 'string' ? doc[key].trim() : '';
    if (!type || !(AUTO_TYPES.has(type) || type === 'place') || !v) continue;
    const target = BY_TYPE[type];
    if (SLUG.test(v) && (await db.query('SELECT entity_id($1, $2) AS id', [type, v])).rows[0].id !== null) continue;
    const name = nameFrom(v);
    const exact = (await db.query(`SELECT slug FROM ${target.table} x
      WHERE lower(f_unaccent(x.${target.name})) = lower(f_unaccent($1))
         OR lower(f_unaccent($1)) = ANY (SELECT lower(f_unaccent(ruby_plain(n->>'text'))) FROM jsonb_array_elements(x.names) n)`, [name])).rows;
    if (exact.length === 1) { doc[key] = exact[0].slug; continue; }
    if (!exact.length && body[`new.${key}`] !== '1') {
      const { rows } = await db.query(`
        SELECT slug, name FROM entity_index WHERE type = $2::entity_type AND word_similarity(f_unaccent($1), f_unaccent(name)) >= 0.6
        ORDER BY word_similarity(f_unaccent($1), f_unaccent(name)) DESC LIMIT 1`, [name, type]);
      if (rows.length) {
        out.errors.push(`${key}: no ${type} "${name}" yet — did you mean ${rows[0].name} (${rows[0].slug})? Pick it, or tick "create" below the field.`);
        out.confirm[key] = name;
        continue;
      }
    }
    if (exact.length > 1) { out.errors.push(`${key}: several ${type}s are called "${name}" — pick one from the list.`); continue; }
    let extra = {};
    if (type === 'place') {
      // only countries and regions Natural Earth knows (a place needs geometry); the same country first
      const { rows: b } = await db.query(`
        SELECT code, name, level, country_code FROM boundaries WHERE lower(f_unaccent(name)) = lower(f_unaccent($1))
        ORDER BY (country_code = $2) DESC NULLS LAST, level LIMIT 1`, [name, doc.country_code || null]);
      if (!b.length) { out.errors.push(`${key}: no place "${name}" yet — pick one from the list, or create it first (or use "+ find a place…").`); continue; }
      extra = { kind: b[0].level === 0 ? 'country' : 'region', country_code: b[0].country_code, boundary_code: b[0].code };
      // a region goes into its country, when we have that (Oslo the county → Norway)
      if (b[0].level > 0) {
        const { rows: country } = await db.query(`SELECT id FROM places WHERE kind = 'country' AND (boundary_code = $1 OR country_code = $1)
          ORDER BY (boundary_code = $1) DESC NULLS LAST LIMIT 1`, [b[0].country_code]);
        if (country.length) extra.parent_id = country[0].id;
      }
    }
    out.creates.push({ key, type, name, extra });
    doc[key] = slugify(name);  // placeholder that passes validation; the real (free) slug is set when it is created
  }
  return out;
}

// Inside the save's transaction: create the entries; → Map key → slug. The flag is written by flag() once the
// entry being saved has its id.
async function create(db, creates) {
  const slugs = new Map();
  for (const c of creates) {
    const t = BY_TYPE[c.type];
    const slug = await freeSlug(db, t, c.name);
    const extra = Object.entries(c.extra || {});  // a place: kind, country_code, boundary_code (+ parent_id of a region)
    const { rows } = await db.query(`INSERT INTO ${t.table} (slug, ${t.name}${extra.map(([k]) => `, ${k}`).join('')})
      VALUES ($1, $2${extra.map((_, i) => `, $${i + 3}`).join('')}) RETURNING id`, [slug, c.name, ...extra.map(([, v]) => v)]);
    slugs.set(c.key, slug);
    c.id = rows[0].id;
    c.slug = slug;
  }
  return slugs;
}

async function flag(db, type, id, from, userId) {
  await db.query(`INSERT INTO auto_created (entity_type, entity_id, created_from_type, created_from_id, created_by)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [type, id, from ? from.type : null, from ? from.id : null, userId || null]);
}

async function unflag(db, type, id) {
  await db.query('DELETE FROM auto_created WHERE entity_type = $1 AND entity_id = $2', [type, id]);
}

// For the entry page banner: { created_at, from: {type, slug, name} | null } or null.
async function flagOf(db, type, id) {
  const { rows } = await db.query(`
    SELECT ac.created_at, f.type::text AS from_type, f.slug AS from_slug, f.name AS from_name
    FROM auto_created ac LEFT JOIN entity_index f ON f.type = ac.created_from_type AND f.id = ac.created_from_id
    WHERE ac.entity_type = $1 AND ac.entity_id = $2`, [type, id]);
  if (!rows.length) return null;
  const r = rows[0];
  return { created_at: r.created_at, from: r.from_slug ? { type: r.from_type, slug: r.from_slug, name: r.from_name } : null };
}

module.exports = { AUTO_TYPES, resolveRefs, create, flag, unflag, flagOf, slugify, freeSlug };
