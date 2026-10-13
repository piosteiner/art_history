// What "link to another of ours" posts on the comparison pages (a picker: "slug", or "type/slug" when several types
// are allowed) → the entry, checked against the types the relationship allows → { type, slug, id } | null
async function pickedTarget(db, value, allowed) {
  const v = String(value || '').trim();
  if (!v) return null;
  const [type, slug] = v.includes('/') ? v.split('/') : [allowed.length === 1 ? allowed[0] : null, v];
  if (!type || !allowed.includes(type) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) return null;
  const id = (await db.query('SELECT entity_id($1, $2) AS id', [type, slug])).rows[0].id;
  return id ? { type, slug, id } : null;
}

module.exports = { pickedTarget };
