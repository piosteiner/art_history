// A work's building history (migration 169): its phases in order, each with the people, artists and institutions who
// took part. Shared by the API (detail `phases`), the YAML export/import (`phases:` in an artwork's file) and the CMS
// (src/admin/routes/phases.js).
//
// Who took part, one per line (CMS and YAML alike):   artist/andreas-schluter | architect
//                                                     person/frederick-i-of-prussia | commissioned it | patron
// type/slug, then the role as written (optional), then "patron" when they commissioned the phase ("person/x | patron"
// without a role).
const { parseFuzzyDate } = require('./fuzzy-date');

const KINDS = {
  construction: 'construction', extension: 'extension', alteration: 'alteration', completion: 'completion',
  restoration: 'restoration', damage: 'damage', destruction: 'destruction', demolition: 'demolition',
  reconstruction: 'reconstruction', other: 'other',
};
const TYPES = { artist: 'artist_id', person: 'person_id', institution: 'institution_id' };
const TABLES = { artist: 'artists', person: 'people', institution: 'institutions' };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// "artist/x | role | patron" lines → [{type, slug, role, patron}] or {error}
function parsePeople(text) {
  const out = [];
  for (const [i, raw] of String(text || '').split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    let [ref, role, flag, ...rest] = line.split('|').map((s) => s.trim());
    if (!flag && /^patron$/i.test(role || '')) [role, flag] = [null, role];   // "person/x | patron": no role written
    const [type, slug] = ref.split('/');
    if (!TYPES[type] || !SLUG.test(slug || '')) return { error: `line ${i + 1}: “${ref}” is not artist/…, person/… or institution/… with a slug` };
    if (rest.length || (flag && !/^patron$/i.test(flag))) return { error: `line ${i + 1}: the third part may only be “patron”` };
    out.push({ type, slug, role: role || null, patron: !!flag });
  }
  return { people: out };
}
const peopleText = (people) => people.map((p) => [`${p.type}/${p.slug}`, p.role, p.patron ? 'patron' : null]
  .filter((x) => x).join(' | ')).join('\n');

// the phases of a work in order, with their people (name and slug for links; role, patron)
async function read(db, artworkId) {
  const { rows } = await db.query(`
    SELECT ph.id, ph.position, ph.kind::text AS kind, ph.title, ph.part, ph.period::text AS period, ph.period_label, ph.notes_md,
           coalesce((SELECT jsonb_agg(jsonb_build_object('type', e.type, 'slug', e.slug, 'name', e.name, 'public_id', e.public_id,
                       'role', pp.role, 'patron', pp.patron) ORDER BY pp.position, pp.id)
                     FROM artwork_phase_people pp
                     JOIN entity_index e ON (e.type, e.id) = (CASE WHEN pp.artist_id IS NOT NULL THEN 'artist'::entity_type
                          WHEN pp.person_id IS NOT NULL THEN 'person'::entity_type ELSE 'institution'::entity_type END,
                          coalesce(pp.artist_id, pp.person_id, pp.institution_id))
                     WHERE pp.phase_id = ph.id), '[]'::jsonb) AS people
    FROM artwork_phases ph WHERE ph.artwork_id = $1 ORDER BY ph.position, ph.id`, [artworkId]);
  return rows;
}

// a phase from a form or a YAML doc → checked values, or an error
function check(input) {
  const kind = String(input.kind || '').trim();
  if (!KINDS[kind]) return { error: `kind is one of ${Object.keys(KINDS).join(', ')}` };
  const title = String(input.title || '').trim().replace(/\s+/g, ' ');
  if (!title) return { error: 'a phase needs a title (“Baroque rebuilding”)' };
  let period = null;
  let periodLabel = null;
  const when = String(input.period ?? '').trim();
  if (when) {
    let d;
    try { d = parseFuzzyDate(when, { openEnd: true }); } catch (err) { return { error: `period: ${err.message}` }; }
    period = d && d.range;
    periodLabel = (input.period_label && String(input.period_label).trim()) || (d && d.label);
  }
  const people = Array.isArray(input.people) ? { people: input.people } : parsePeople(input.people);
  if (!people.error && people.people.some((p) => !TYPES[p.type] || !SLUG.test(p.slug || ''))) people.error = 'each one is artist/…, person/… or institution/… with a slug';
  if (people.error) return { error: `who took part — ${people.error}` };
  const text = (v) => { const s = String(v ?? '').trim(); return s || null; };
  return { phase: { kind, title, part: text(input.part), period, period_label: periodLabel, notes_md: text(input.notes_md), people: people.people } };
}

// write one phase (insert when no id) and replace its people; position: given or last
async function save(db, artworkId, phase, id = null) {
  let phaseId = id;
  if (phaseId) {
    await db.query(`UPDATE artwork_phases SET kind = $2, title = $3, part = $4, period = $5::daterange, period_label = $6, notes_md = $7
      WHERE id = $1 AND artwork_id = $8`, [phaseId, phase.kind, phase.title, phase.part, phase.period, phase.period_label, phase.notes_md, artworkId]);
  } else {
    ({ rows: [{ id: phaseId }] } = await db.query(`INSERT INTO artwork_phases (artwork_id, position, kind, title, part, period, period_label, notes_md)
      VALUES ($1, coalesce($8, (SELECT coalesce(max(position), 0) + 10 FROM artwork_phases WHERE artwork_id = $1)), $2, $3, $4, $5::daterange, $6, $7)
      RETURNING id`, [artworkId, phase.kind, phase.title, phase.part, phase.period, phase.period_label, phase.notes_md, phase.position ?? null]));
  }
  await db.query('DELETE FROM artwork_phase_people WHERE phase_id = $1', [phaseId]);
  for (const [i, p] of phase.people.entries()) {
    const { rows: [who] } = await db.query(`SELECT id FROM ${TABLES[p.type]} WHERE slug = $1`, [p.slug]);
    if (!who) { const err = new Error(`no ${p.type} “${p.slug}”`); err.userError = true; throw err; }
    await db.query(`INSERT INTO artwork_phase_people (phase_id, position, ${TYPES[p.type]}, role, patron) VALUES ($1, $2, $3, $4, $5)`,
      [phaseId, i, who.id, p.role, !!p.patron]);
  }
  return phaseId;
}

function periodDoc(ph) {
  if (!ph.period) return { period: ph.period_label || null };
  const d = require('./content').dateToDoc(ph.period, ph.period_label, true);
  return { period: d.value, ...(d.label ? { period_label: d.label } : {}) };
}
// the phases in doc shape (YAML export): period as written, people as {who, role, patron}
async function docs(db, artworkId) {
  return (await read(db, artworkId)).map((ph) => Object.fromEntries(Object.entries({
    // the period as the other dates of the YAML: a text that parses back to the same range, the label beside it when
    // it is free wording ("after 1648, until 1688" doesn't parse — before, the export wrote it and the import failed)
    kind: ph.kind, title: ph.title, part: ph.part, ...periodDoc(ph), notes_md: ph.notes_md,
    people: ph.people.length ? ph.people.map((p) => Object.fromEntries(Object.entries({ who: `${p.type}/${p.slug}`, role: p.role, patron: p.patron || null })
      .filter(([, v]) => v !== null))) : null,
  }).filter(([, v]) => v !== null)));
}
// a doc's phases → the checked form check() wants (people {who, role, patron} → {type, slug, role, patron})
const fromDoc = (ph) => ({ ...ph, people: (ph.people || []).map((p) => { const [type, slug] = String(p.who || '').split('/'); return { type, slug, role: p.role || null, patron: !!p.patron }; }) });

module.exports = { KINDS, TYPES, parsePeople, peopleText, read, check, save, docs, fromDoc };
