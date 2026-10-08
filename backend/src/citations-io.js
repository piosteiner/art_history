// Citations (migrations 049/050) in the YAML snapshot (content/README.md) — read back by `npm run import`.
//   free text:  "Letter 577"
//   a source:   { source: <bibliography slug>, locator: "S. 45", url: https://…, accessed: 2026-10-08, note: … }
//   Wikidata:   { wikidata: Q45585, property: P2048, accessed: 2026-10-08 }
// Existing citations stay; listed ones that are missing are added (free text: the lines replace the old lines).
async function importCitations(db, target, list) {
  if (!Array.isArray(list)) return;
  const [col, id, field] = target.relationship ? ['relationship_id', target.relationship, null]
    : target.provenance ? ['provenance_id', target.provenance, null] : [null, target.id, target.field];
  const where = col ? `${col} = $1` : 'entity_type = $1::entity_type AND entity_id = $2 AND field = $3';
  const key = col ? [id] : [target.type, id, field];
  const lines = list.filter((c) => typeof c === 'string').map((s) => s.trim()).filter(Boolean);
  await db.query(`DELETE FROM citations WHERE ${where} AND text IS NOT NULL AND text <> ALL ($${key.length + 1}::text[])`, [...key, lines]);
  const cols = col ? [col] : ['entity_type', 'entity_id', 'field'];
  const value = col ? 'NULL' : `(SELECT field_value(er.r, f.cols) FROM entity_rows er JOIN citable_fields f ON f.entity_type = er.type
      WHERE er.type = $1::entity_type AND er.id = $2 AND f.field = $3)`;
  for (const c of list) {
    let sourceId = null;
    if (c && typeof c === 'object' && c.source) {
      sourceId = (await db.query("SELECT entity_id('source', $1) AS id", [c.source])).rows[0].id;
      if (sourceId === null) throw new Error(`source "${c.source}" does not exist`);
    }
    const v = typeof c === 'string' ? { text: c.trim() }
      : { source_id: sourceId, wikidata_item: c.wikidata || null, wikidata_property: c.property || null,
        locator: c.locator ?? null, url: c.url ?? null, accessed: c.accessed ? String(c.accessed) : null, note: c.note ?? null };
    if (typeof c === 'string' && !v.text) continue;
    const names = Object.keys(v);
    const params = [...key, ...names.map((n) => v[n])];
    const same = names.map((n, i) => `${n} IS NOT DISTINCT FROM $${key.length + i + 1}${n === 'accessed' ? '::date' : ''}`).join(' AND ');
    await db.query(`INSERT INTO citations (${[...cols, ...names, ...(col ? [] : ['cited_value'])].join(', ')})
      SELECT ${[...key.map((_, i) => `$${i + 1}${!col && i === 0 ? '::entity_type' : ''}`), ...names.map((n, i) => `$${key.length + i + 1}${n === 'accessed' ? '::date' : ''}`), ...(col ? [] : [value])].join(', ')}
      WHERE NOT EXISTS (SELECT 1 FROM citations WHERE ${where} AND ${same})`, params);
  }
}

module.exports = { importCitations };
