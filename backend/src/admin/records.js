// ---------------------------------------------------------------------------------------------------------------
// A person's record in an authority file → the comparison, in the shape of the GND's (gnd.js): used for SIKART,
// the Library of Congress, the BnF and RKD (sikart.js, lc.js, bnf.js, rkd.js). Each of those reads its record into
//   { id, url, name, short, birth, death, birthPlace, deathPlace, ids: { gnd, viaf, … }, variants: [], names: [{text, lang, role, preselect}] }
// (birth/death: a date text our fuzzy dates understand; places: { label, qid? }). The rest is the same for all:
// dates against ours, places of birth and death among ours (by Wikidata id, name, or found in OpenStreetMap),
// the numbers the record knows as reference records.
// ---------------------------------------------------------------------------------------------------------------
const { parseFuzzyDate } = require('../fuzzy-date');

const tryDate = (text) => { try { return text ? parseFuzzyDate(String(text)) : null; } catch { return null; } };
// "Bern (Switzerland)", "Genève (Suisse)", "Bern (city)", "Gurzelen (BE)" → the name itself
const placeName = (label) => String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

// placeTarget(db, {label, qid}) → { target } | { create } | {} — gnd.placeTarget
async function personPlan(db, t, entity, doc, rec, placeTarget) {
  const rows = [];
  for (const key of ['birth', 'death']) {
    const theirs = tryDate(rec[key]);
    if (!theirs) continue;
    const ours = doc[key] || null;
    const same = ours !== null && (tryDate(ours) || {}).range === theirs.range;
    rows.push({ key, ours, theirs: String(rec[key]), label: theirs.label, status: same ? 'same' : ours ? 'differs' : 'new' });
  }
  const { rows: existing } = await db.query(`SELECT r.relationship_type, o.type::text || '/' || o.slug AS other FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id) WHERE r.subject_type = $1 AND r.subject_id = $2`, [t.type, entity.id]);
  const rels = [];
  for (const [field, type, label] of [['birthPlace', 'born_in', 'born in'], ['deathPlace', 'died_in', 'died in']]) {
    const place = rec[field];
    if (!place || !place.label) continue;
    const { target, create } = await placeTarget(db, { label: placeName(place.label), qid: place.qid || null, country: place.country || null });
    const already = !!target && existing.some((x) => x.relationship_type === type && x.other === `place/${target.slug}`);
    rels.push({ i: rels.length, type, types: ['place'], label, ref: { label: place.label }, target, create, already });
  }
  // its numbers elsewhere — new reference records for this entry
  const have = (await db.query('SELECT authority, value FROM entry_identifiers WHERE entity_type = $1 AND entity_id = $2', [t.type, entity.id])).rows;
  const authorities = Object.fromEntries((await db.query('SELECT code, name FROM authorities')).rows.map((a) => [a.code, a.name]));
  const ids = Object.entries(rec.ids || {}).filter(([code, v]) => v && authorities[code]).map(([code, value]) => {
    const ours = (have.find((h) => h.authority === code) || {}).value || null;
    return { code, name: authorities[code], value: String(value), ours, status: ours === String(value) ? 'same' : ours ? 'differs' : 'new' };
  });
  // other names (NLK: the Korean name, hanja forms, art names) we don't have yet
  const haveNames = new Set((Array.isArray(doc.names) ? doc.names : []).map((n) => String(n.text || '').toLowerCase()));
  const names = (rec.names || []).filter((n) => n.text && !haveNames.has(String(n.text).toLowerCase()))
    .map((n, i) => ({ i, text: n.text, lang: n.lang || '', role: n.role || 'alternative', preselect: !!n.preselect }));
  return { id: rec.id, gnd: rec.id, url: rec.url, rows, rels, ids, names,
    info: { name: rec.name, occupations: rec.short ? [rec.short] : [], variants: (rec.variants || []).filter(Boolean) } };
}

module.exports = { personPlan, placeName, tryDate };
