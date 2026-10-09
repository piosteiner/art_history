// ---------------------------------------------------------------------------------------------------------------
// Comparison with SIKART (the lexicon of SIK-ISEA, the Swiss Institute for Art Research, migration 057), for artists
// and people with a SIKART number (Reference records) — like the GND comparison (src/admin/gnd.js). The research
// portal (recherche.sik-isea.ch) loads its records from api.recherche.sik-isea.ch; that interface is not documented
// as public, so: one record at a time, on request, facts only (dates, places, numbers) — the lexicon articles and the
// images are SIK-ISEA's and only linked. Everything taken is cited with the source "SIKART" and the record's page.
// Base URL configurable (SIKART_BASE) so the end-to-end tests can serve fixtures.
// ---------------------------------------------------------------------------------------------------------------
const { parseFuzzyDate } = require('../fuzzy-date');

const API = process.env.SIKART_BASE || 'https://api.recherche.sik-isea.ch/api/v1/graphs/sik/data';
const recordUrl = (id) => `https://recherche.sik-isea.ch/sik:person-${id}/in/sikart`;

async function get(path) {
  const res = await fetch(`${API}/${path}`, {
    headers: { Accept: 'application/ld+json, application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database; one record on request)' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the SIKART service answered ${res.status}`);
  return res.json();
}
const nodes = (d) => (d && Array.isArray(d['@graph']) ? d['@graph'] : d ? [d] : []).filter((x) => x && typeof x === 'object');

// "∗ 14.3.1853 Bern,\n† 19.5.1918 Genf" → { birth: {value: '1853-03-14', place: 'Bern'}, death: {…} }
// Dates: 14.3.1853 · 3.1853 · 1853 · um 1600 (→ c. 1600) · 1853/1854; the rest of the line is the place.
function lifeData(note) {
  const out = {};
  for (const [key, mark] of [['birth', '∗'], ['death', '†']]) {
    const m = new RegExp(`${mark === '∗' ? '[∗*]' : '†'}\\s*([^\\n]+)`).exec(String(note || ''));
    if (!m) continue;
    const line = m[1].replace(/,\s*$/, '').trim();
    const d = /^(?:(um|ca\.)\s*)?(?:(\d{1,2})\.)?(?:(\d{1,2})\.)?(\d{3,4})(?:\s*\/\s*(\d{3,4}))?\s*(.*)$/.exec(line);
    if (!d) continue;
    const [, circa, a, b, year, year2, rest] = d;
    const day = b ? a : null;
    const month = b || a;
    let value = year2 ? `${year}/${year2}` : month ? `${year}-${String(month).padStart(2, '0')}${day ? `-${String(day).padStart(2, '0')}` : ''}` : year;
    if (circa) value = `c. ${year}`;
    try { parseFuzzyDate(value); } catch { continue; }
    out[key] = { value, place: rest.replace(/^,\s*/, '').trim() || null };
  }
  return out;
}

async function retrieve(id) {
  const d = await get(`sikapi:RetrievePerson/sik:person-${encodeURIComponent(id)}/`);
  const all = nodes(d);
  const p = all.find((x) => x['@id'] === `sik:person-${id}`);
  if (!p) throw new Error(`SIKART ${id} was not found`);
  const label = (ref) => { const n = all.find((x) => x['@id'] === ref); return n ? n['sikapi:label'] || null : null; };
  const sameAs = [].concat(p['sikapi:same_as'] || []);
  const num = (re) => { const u = sameAs.find((x) => re.test(x)); return u ? re.exec(u)[1] : null; };
  return { id: String(id), url: recordUrl(id), name: p['sikapi:preferred_name'] || p['sikapi:label'], note: p['sikapi:note_biographical_data'] || '',
    short: p['sikapi:short_biography'] || null, hometown: label(p['sikapi:has_hometown']), citizenship: label(p['sikapi:has_citizenship']),
    life: lifeData(p['sikapi:note_biographical_data']), gnd: num(/d-nb\.info\/gnd\/([0-9X-]+)/), viaf: num(/viaf\.org\/viaf\/(\d+)/) };
}

// people in SIKART by name → [{id, name, note, short}]
async function search(q) {
  const d = await get(`sikapi:SearchPersons/?q=${encodeURIComponent(q)}&limit=12`);
  return nodes(d).filter((x) => /^sik:person-\d+$/.test(x['@id'] || ''))
    .map((x) => ({ id: x['@id'].slice('sik:person-'.length), name: x['sikapi:preferred_name'] || x['sikapi:label'],
      note: x['sikapi:note_biographical_data'] || '', short: x['sikapi:short_biography'] || '', url: recordUrl(x['@id'].slice('sik:person-'.length)) }));
}

// The comparison, in the shape of the GND one: { url, rows, rels, ids, info }
async function compare(db, t, entity, doc, id, ourEntry) {
  const r = await retrieve(id);
  const rows = [];
  for (const key of ['birth', 'death']) {
    const v = r.life[key];
    if (!v) continue;
    const theirs = parseFuzzyDate(v.value);
    const ours = doc[key] || null;
    const same = ours !== null && (() => { try { return parseFuzzyDate(String(ours)).range === theirs.range; } catch { return false; } })();
    rows.push({ key, ours, theirs: v.value, label: theirs.label, status: same ? 'same' : ours ? 'differs' : 'new' });
  }
  const { rows: existing } = await db.query(`SELECT r.relationship_type, o.type::text || '/' || o.slug AS other FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id) WHERE r.subject_type = $1 AND r.subject_id = $2`, [t.type, entity.id]);
  const rels = [];
  for (const [key, type, label] of [['birth', 'born_in', 'born in'], ['death', 'died_in', 'died in']]) {
    const place = r.life[key] && r.life[key].place;
    if (!place) continue;
    const target = await ourEntry(db, ['place'], { label: place.replace(/\s*\([A-Z]{2}\)$/, '') });
    const already = !!target && existing.some((x) => x.relationship_type === type && x.other === `place/${target.slug}`);
    rels.push({ i: rels.length, type, label, ref: { label: place }, target, already });
  }
  // its numbers elsewhere: GND, VIAF — new reference records for this entry
  const have = (await db.query('SELECT authority, value FROM entry_identifiers WHERE entity_type = $1 AND entity_id = $2', [t.type, entity.id])).rows;
  const ids = [['gnd', 'GND', r.gnd], ['viaf', 'VIAF', r.viaf]].filter(([, , v]) => v).map(([code, name, value]) => {
    const ours = (have.find((h) => h.authority === code) || {}).value || null;
    return { code, name, value, ours, status: ours === value ? 'same' : ours ? 'differs' : 'new' };
  });
  return { gnd: id, url: r.url, rows, rels, ids, info: { name: r.name, occupations: r.short ? [r.short] : [],
    variants: [r.hometown && `Heimatort: ${r.hometown}`, r.citizenship && `Bürgerrecht: ${r.citizenship}`, r.note && `SIKART: ${r.note.replace(/\n/g, ' ')}`].filter(Boolean) } };
}

async function ensureSource(db) {
  await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
    VALUES ('sikart', 'web', 'SIKART Lexikon und Datenbank', 'SIKART', 'https://recherche.sik-isea.ch/', 'scholarly', 'Schweizerisches Institut für Kunstwissenschaft (SIK-ISEA)')
    ON CONFLICT (slug) DO NOTHING`);
}

module.exports = { retrieve, search, compare, ensureSource, lifeData, recordUrl };
