// ---------------------------------------------------------------------------------------------------------------
// Comparison with the GND (Gemeinsame Normdatei of the Deutsche Nationalbibliothek, migration 053) — like the
// Wikidata comparison, smaller: the record comes from lobid.org (the GND as open data, CC0), for an entry that has a
// GND number (Reference records). Fields: birth and death of artists and people, the founding and the city of an
// institution. Relationships: places of birth, death and activity; professional relationships to artists and people.
// Everything taken is cited with the source "GND" and the record's page; values that agree are cited as they are.
// Base URL configurable (LOBID_BASE) so the end-to-end tests can serve fixtures.
// ---------------------------------------------------------------------------------------------------------------
const { parseFuzzyDate } = require('../fuzzy-date');

const LOBID = process.env.LOBID_BASE || 'https://lobid.org';
const recordUrl = (gnd) => `https://d-nb.info/gnd/${gnd}`;
const idOf = (uri) => String(uri || '').split('/').pop();

async function fetchRecord(gnd) {
  const res = await fetch(`${LOBID}/gnd/${encodeURIComponent(gnd)}.json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error(`GND ${gnd} was not found`);
  if (!res.ok) throw new Error(`the GND service answered ${res.status}`);
  return res.json();
}

// "Marc, Franz" → "Franz Marc" (the GND writes people surname first)
const natural = (label) => { const m = /^([^,]+),\s*(.+)$/.exec(String(label || '')); return m ? `${m[2]} ${m[1]}` : String(label || ''); };

// One of ours for a GND reference: by its GND number, else by name (also among other names: "Moskau" for Moscow).
async function ourEntry(db, types, ref) {
  const gnd = idOf(ref.id);
  const byId = (await db.query(`SELECT e.type::text AS type, e.slug, e.name, true AS by_id FROM entry_identifiers i
    JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id)
    WHERE i.authority = 'gnd' AND i.value = $1 AND i.entity_type = ANY ($2::entity_type[])`, [gnd, types])).rows[0];
  if (byId) return byId;
  const names = [...new Set([ref.label, natural(ref.label)].filter(Boolean))];
  return (await db.query(`SELECT e.type::text AS type, e.slug, e.name, false AS by_id FROM entity_index e
    WHERE e.type = ANY ($2::entity_type[]) AND EXISTS (SELECT 1 FROM unnest($1::text[]) x
      WHERE lower(f_unaccent(e.name)) = lower(f_unaccent(x))
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.names) n WHERE lower(f_unaccent(public.ruby_plain(n ->> 'text'))) = lower(f_unaccent(x))))
    ORDER BY e.name LIMIT 1`, [names, types])).rows[0] || null;
}

const FIELDS = {
  artist: [['birth', 'dateOfBirth'], ['death', 'dateOfDeath']],
  person: [['birth', 'dateOfBirth'], ['death', 'dateOfDeath']],
  institution: [['founded', 'dateOfEstablishment']],
};
const RELS = {
  artist: [['placeOfBirth', 'born_in', ['place']], ['placeOfDeath', 'died_in', ['place']], ['placeOfActivity', 'worked_in', ['place']],
    ['professionalRelationship', 'collaborated_with', ['artist', 'person']]],
  person: [['placeOfBirth', 'born_in', ['place']], ['placeOfDeath', 'died_in', ['place']], ['placeOfActivity', 'worked_in', ['place']],
    ['professionalRelationship', 'collaborated_with', ['artist', 'person']]],
};

// The comparison: { gnd, url, name, rows: [{key, ours, theirs, status}], rels: [{i, type, label, ref, target, already}], info }
async function compare(db, t, entity, doc, gnd) {
  const r = await fetchRecord(gnd);
  const rows = [];
  for (const [key, prop] of FIELDS[t.type] || []) {
    const v = (r[prop] || [])[0];
    if (!v) continue;
    let theirs;
    try { theirs = parseFuzzyDate(String(v)); } catch { continue; }
    const ours = doc[key] || null;
    const same = ours !== null && (String(ours) === String(v) || (() => { try { return parseFuzzyDate(String(ours)).range === theirs.range; } catch { return false; } })());
    rows.push({ key, ours, theirs: String(v), label: theirs.label, status: same ? 'same' : ours ? 'differs' : 'new' });
  }
  if (t.type === 'institution' && (r.placeOfBusiness || []).length) {
    const target = await ourEntry(db, ['place'], r.placeOfBusiness[0]);
    const ours = doc.place || null;
    rows.push({ key: 'place', ours, theirs: r.placeOfBusiness[0].label, target, ref: r.placeOfBusiness[0],
      status: target && ours === target.slug ? 'same' : !target ? 'missing' : ours ? 'differs' : 'new' });
  }
  const { rows: existing } = await db.query(`SELECT r.relationship_type, o.type::text || '/' || o.slug AS other FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id) WHERE r.subject_type = $1 AND r.subject_id = $2`, [t.type, entity.id]);
  const vocab = Object.fromEntries((await db.query('SELECT code, label FROM relationship_types')).rows.map((x) => [x.code, x.label]));
  const rels = [];
  for (const [prop, type, types] of RELS[t.type] || []) {
    for (const ref of r[prop] || []) {
      const target = await ourEntry(db, types, ref);
      const already = !!target && existing.some((x) => x.relationship_type === type && x.other === `${target.type}/${target.slug}`);
      rels.push({ i: rels.length, type, label: vocab[type] || type, ref, target, already });
    }
  }
  const info = { name: r.preferredName, occupations: (r.professionOrOccupation || []).map((x) => x.label),
    variants: (r.variantName || []).slice(0, 8) };
  return { gnd, url: recordUrl(gnd), rows, rels, info };
}

// Apply the ticked values: → { form (into the working copy), cites (pending citations), agreed (fields to cite now),
// relationships } — relationships are inserted here (cited with the GND), targets found by name get the GND number.
// The GND as a source of the bibliography (053 created it; again if it was deleted).
async function ensureSource(db) {
  await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
    VALUES ('gnd', 'web', 'Gemeinsame Normdatei (GND)', 'GND', 'https://d-nb.info/gnd/', 'institution', 'Deutsche Nationalbibliothek')
    ON CONFLICT (slug) DO NOTHING`);
}

// opts: source (the bibliography slug the values are cited with), byNameGets (the authority a target found by name gets
// its number of — the GND: its own records name targets by GND number)
async function apply(db, t, entity, plan, choices, citations, { source = 'gnd', byNameGets = 'gnd', ensure = ensureSource } = {}) {
  await ensure(db);
  const form = {};
  const cites = [];
  for (const row of plan.rows) {
    if (row.status === 'same' || row.status === 'missing' || choices[`take.${row.key}`] !== 'take') continue;
    if (row.key === 'place') form['f.place'] = row.target.slug;
    else { form[`f.${row.key}`] = row.theirs; form[`f.${row.key}_label`] = ''; }
    cites.push({ field: row.key, form: { [`f.${row.key}`]: form[`f.${row.key}`] } });
  }
  const agreed = plan.rows.filter((row) => row.status === 'same').map((row) => row.key);
  let relationships = 0;
  for (const s of plan.rels) {
    if (s.already || !s.target || choices[`rel.${s.i}`] !== 'add') continue;
    const other = (await db.query('SELECT entity_id($1, $2) AS id', [s.target.type, s.target.slug])).rows[0].id;
    const ins = await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`, [t.type, entity.id, s.type, s.target.type, other]);
    if (ins.rows.length) await citations.citeRelationshipFromSource(db, ins.rows[0].id, source, plan.url);
    // found by its name: now it gets its GND number too, so the next comparison finds it exactly
    if (!s.target.by_id && byNameGets === 'gnd' && s.ref.id) {
      // a savepoint: in a transaction a failed statement can't just be caught — it would abort the whole save
      await db.query('SAVEPOINT gndid');
      try {
        await db.query(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, $2, 'gnd', $3)
          ON CONFLICT DO NOTHING`, [s.target.type, other, idOf(s.ref.id)]);
        await db.query('RELEASE SAVEPOINT gndid');
      } catch { await db.query('ROLLBACK TO SAVEPOINT gndid'); }
    }
    relationships += 1;
  }
  // numbers the record knows (SIKART: its GND and VIAF numbers) — ticked ones become reference records
  let ids = 0;
  for (const x of plan.ids || []) {
    if (x.status === 'same' || choices[`idf.${x.code}`] !== 'take') continue;
    await db.query('SAVEPOINT idf');
    try {
      await db.query(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, $2, $3, $4)
        ON CONFLICT (entity_type, entity_id, authority) DO UPDATE SET value = EXCLUDED.value`, [t.type, entity.id, x.code, x.value]);
      await db.query('RELEASE SAVEPOINT idf');
      ids += 1;
    } catch { await db.query('ROLLBACK TO SAVEPOINT idf'); }
  }
  return { form, cites, agreed, relationships, ids };
}

module.exports = { fetchRecord, compare, apply, recordUrl, natural, ourEntry, ensureSource };
