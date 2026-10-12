// ---------------------------------------------------------------------------------------------------------------
// Comparison with SIKART (the lexicon of SIK-ISEA, the Swiss Institute for Art Research, migration 057), for artists
// and people with a SIKART number (Reference records) — like the GND comparison (src/admin/gnd.js). The research
// portal (recherche.sik-isea.ch) loads its records from api.recherche.sik-isea.ch; that interface is not documented
// as public, so: one record at a time, on request, facts only (dates, places, numbers) — the lexicon articles and the
// images are SIK-ISEA's and only linked. Everything taken is cited with the source "SIKART" and the record's page.
// Base URL configurable (SIKART_BASE) so the end-to-end tests can serve fixtures.
// ---------------------------------------------------------------------------------------------------------------
const { parseFuzzyDate } = require('../fuzzy-date');
const { memo } = require('./remember');
const { personPlan } = require('./records');

const API = process.env.SIKART_BASE || 'https://api.recherche.sik-isea.ch/api/v1/graphs/sik/data';
const recordUrl = (id) => `https://recherche.sik-isea.ch/sik:person-${id}/in/sikart`;

// remembered for 15 minutes: Apply uses the record the page showed (src/admin/remember.js)
const remember = memo();
const get = (path) => remember(path, () => getFresh(path));
async function getFresh(path) {
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

// The comparison, in the shape of the GND one (records.js): dates and places from the biographical note, its GND and
// VIAF numbers; Heimatort and citizenship shown, not stored
async function compare(db, t, entity, doc, id, placeTarget) {
  const r = await retrieve(id);
  return personPlan(db, t, entity, doc, {
    id, url: r.url, name: r.name, short: r.short,
    birth: r.life.birth && r.life.birth.value, death: r.life.death && r.life.death.value,
    birthPlace: r.life.birth && r.life.birth.place ? { label: r.life.birth.place } : null,
    deathPlace: r.life.death && r.life.death.place ? { label: r.life.death.place } : null,
    ids: { gnd: r.gnd, viaf: r.viaf },
    variants: [r.hometown && `Heimatort: ${r.hometown}`, r.citizenship && `Bürgerrecht: ${r.citizenship}`, r.note && `SIKART: ${r.note.replace(/\n/g, ' ')}`],
  }, placeTarget);
}

async function ensureSource(db) {
  await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
    VALUES ('sikart', 'web', 'SIKART Lexikon und Datenbank', 'SIKART', 'https://recherche.sik-isea.ch/', 'scholarly', 'Schweizerisches Institut für Kunstwissenschaft (SIK-ISEA)')
    ON CONFLICT (slug) DO NOTHING`);
}

module.exports = { retrieve, search, compare, ensureSource, lifeData, recordUrl };
