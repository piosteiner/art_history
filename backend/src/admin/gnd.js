// ---------------------------------------------------------------------------------------------------------------
// Comparison with the GND (Gemeinsame Normdatei of the Deutsche Nationalbibliothek, migration 053) — like the
// Wikidata comparison, smaller: the record comes from lobid.org (the GND as open data, CC0), for an entry that has a
// GND number (Reference records). Fields: birth and death of artists and people, the founding and the city of an
// institution. Relationships: places of birth, death and activity; professional relationships to artists and people.
// Everything taken is cited with the source "GND" and the record's page; values that agree are cited as they are.
// Base URL configurable (LOBID_BASE) so the end-to-end tests can serve fixtures.
// ---------------------------------------------------------------------------------------------------------------
const { parseFuzzyDate } = require('../fuzzy-date');
const placefinder = require('./placefinder');
const { memo } = require('./remember');
const { pickedTarget } = require('./targets');

const LOBID = process.env.LOBID_BASE || 'https://lobid.org';
const recordUrl = (gnd) => `https://d-nb.info/gnd/${gnd}`;
const idOf = (uri) => String(uri || '').split('/').pop();

// remembered for 15 minutes: Apply uses the record the page showed (src/admin/remember.js)
const remember = memo();
const fetchRecord = (gnd) => remember(gnd, () => fetchFresh(gnd));
async function fetchFresh(gnd) {
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

// A place named by an authority file: ours (by GND number or name) · else OpenStreetMap: ours under another name
// ("Genf" → Geneva) or a new place to create → { target } | { create: candidate } | {}
async function placeTarget(db, ref) {
  // a record that names the place's Wikidata item (RKD): exactly ours
  if (ref.qid) {
    const byQid = (await db.query("SELECT 'place' AS type, slug, name, true AS by_id FROM places WHERE wikidata_id = $1", [ref.qid])).rows[0];
    if (byQid) return { target: byQid };
  }
  const target = await ourEntry(db, ['place'], ref);
  if (target) return { target };
  const found = await placefinder.settlementByName(db, ref.label, ref.country || null).catch(() => null);
  if (!found) return {};
  return found.ours ? { target: { type: 'place', ...found.ours, by_id: false, via: 'osm' } } : { create: found.candidate };
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
    const { target, create } = await placeTarget(db, r.placeOfBusiness[0]);
    const ours = doc.place || null;
    rows.push({ key: 'place', ours, theirs: r.placeOfBusiness[0].label, target, create, ref: r.placeOfBusiness[0],
      status: target && ours === target.slug ? 'same' : !target && !create ? 'missing' : ours ? 'differs' : 'new' });
  }
  const { rows: existing } = await db.query(`SELECT r.relationship_type, o.type::text || '/' || o.slug AS other FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id) WHERE r.subject_type = $1 AND r.subject_id = $2`, [t.type, entity.id]);
  const vocab = Object.fromEntries((await db.query('SELECT code, label FROM relationship_types')).rows.map((x) => [x.code, x.label]));
  const rels = [];
  for (const [prop, type, types] of RELS[t.type] || []) {
    for (const ref of r[prop] || []) {
      const { target, create } = types.includes('place') ? await placeTarget(db, ref) : { target: await ourEntry(db, types, ref) };
      const already = !!target && existing.some((x) => x.relationship_type === type && x.other === `${target.type}/${target.slug}`);
      rels.push({ i: rels.length, type, types, label: vocab[type] || type, ref, target, create, already });
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
// its number of — the GND: its own records name targets by GND number), createPlace(db, candidate) → slug (a place
// found in OpenStreetMap, created when ticked)
// choices: take.<key>=take|keep (fields), cite.<key>=cite (agreeing fields), rel.<i>=add, idf.<code>=take
async function apply(db, t, entity, plan, choices, citations, { source = 'gnd', byNameGets = 'gnd', ensure = ensureSource, createPlace, createEntry } = {}) {
  await ensure(db);
  const form = {};
  const cites = [];
  const created = [];
  // a new place once, even when it is the place of birth and of death
  const madePlaces = new Map();
  const placeFrom = async (c, ref) => {
    if (!madePlaces.has(c.label)) {
      const slug = await createPlace(db, c);
      madePlaces.set(c.label, slug);
      created.push(c.name);
      await giveNumber({ type: 'place', slug, by_id: false }, ref);
    }
    return madePlaces.get(c.label);
  };
  // found by its name (or new): it gets its GND number too, so the next comparison finds it exactly
  const giveNumber = async (target, ref) => {
    if (target.by_id || byNameGets !== 'gnd' || !ref || !ref.id) return;
    // a savepoint: in a transaction a failed statement can't just be caught — it would abort the whole save
    await db.query('SAVEPOINT gndid');
    try {
      await db.query(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, entity_id($1, $2), 'gnd', $3)
        ON CONFLICT DO NOTHING`, [target.type, target.slug, idOf(ref.id)]);
      await db.query('RELEASE SAVEPOINT gndid');
    } catch { await db.query('ROLLBACK TO SAVEPOINT gndid'); }
  };
  for (const row of plan.rows) {
    if (row.status === 'same' || row.status === 'missing' || choices[`take.${row.key}`] !== 'take') continue;
    if (row.key === 'place') form['f.place'] = row.target ? row.target.slug : await placeFrom(row.create, row.ref);
    else { form[`f.${row.key}`] = row.theirs; form[`f.${row.key}_label`] = ''; }
    cites.push({ field: row.key, form: { [`f.${row.key}`]: form[`f.${row.key}`] } });
  }
  const agreed = plan.rows.filter((row) => row.status === 'same' && choices[`cite.${row.key}`] === 'cite').map((row) => row.key);
  let relationships = 0;
  // the relationship with this target, if we have it — with or without a period, either way round (symmetric types)
  const existing = (key) => db.query(`SELECT id FROM relationships WHERE relationship_type = $3 AND (
      (subject_type, subject_id, object_type, object_id) = ($1, $2, $4, $5) OR (subject_type, subject_id, object_type, object_id) = ($4, $5, $1, $2))
    ORDER BY period IS NULL DESC LIMIT 1`, key).then((r) => r.rows[0] || null);
  // choices per suggestion: rel.<i> = add (ours / the place found in OpenStreetMap) | new-artist | new-person (created,
  // "to complete") | other (relto.<i>: one of ours picked by hand) | skip; already there: citerel.<i> = cite
  for (const s of plan.rels) {
    const pick = choices[`rel.${s.i}`];
    if (s.already) {
      if (choices[`citerel.${s.i}`] !== 'cite' || !s.target) continue;
      const other = (await db.query('SELECT entity_id($1, $2) AS id', [s.target.type, s.target.slug])).rows[0].id;
      const rel = await existing([t.type, entity.id, s.type, s.target.type, other]);
      if (rel) await citations.citeRelationshipFromSource(db, rel.id, source, plan.url);
      continue;
    }
    let target = null;
    if (pick === 'other') {
      const p = await pickedTarget(db, choices[`relto.${s.i}`], s.types || ['place']);
      // (chosen by hand — perhaps a stand-in, so it does NOT get the record's number)
      if (p) target = { type: p.type, slug: p.slug, by_id: true };
    } else if (pick === 'add' && s.target) {
      target = s.target;
    } else if (pick === 'add' && s.create) {
      target = { type: 'place', slug: await placeFrom(s.create, s.ref), by_id: true };
    } else if ((pick === 'new-artist' || pick === 'new-person') && createEntry && (s.types || []).includes(pick.slice(4))) {
      // a person the record names that we don't have: a minimal entry "to complete" — with its GND number, so the next
      // comparison fills it in
      const type = pick.slice(4);
      target = { type, slug: await createEntry(db, type, natural(s.ref.label)), by_id: false };
      created.push(`${type} ${natural(s.ref.label)}`);
    }
    if (!target) continue;
    s.target = target;
    const other = (await db.query('SELECT entity_id($1, $2) AS id', [s.target.type, s.target.slug])).rows[0].id;
    const key = [t.type, entity.id, s.type, s.target.type, other];
    // there already (another source of the Enrich page added it a moment ago): this source cites it too, no second one
    const have = await existing(key);
    // (a symmetric type may be stored the other way round: then the insert finds it and does nothing)
    const ins = have ? [] : (await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`, key)).rows;
    const relId = have ? have.id : ins.length ? ins[0].id : null;
    if (relId) await citations.citeRelationshipFromSource(db, relId, source, plan.url);
    await giveNumber(s.target, s.ref);
    if (ins.length) relationships += 1;
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
  // other names ticked (records.js: NLK's Korean names …) → lines for the names field ("text | lang | role")
  const addNames = (plan.names || []).filter((n) => choices[`name.${n.i}`] === 'take').map((n) => [n.text, n.lang, n.role].join(' | '));
  return { form, cites, agreed, relationships, ids, created, addNames };
}

module.exports = { fetchRecord, compare, apply, recordUrl, natural, ourEntry, placeTarget, ensureSource };
