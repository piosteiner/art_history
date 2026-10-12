// KulturNav (kulturnav.org — the shared authority file of Norwegian, Swedish and Finnish museums): a person's record as
// JSON — birth and death with day and place ("Løten, Hedmark (Norge)"), its numbers in VIAF, ULAN, the Library of
// Congress. Compared like the GND (records.js). Base URL configurable (KULTURNAV_BASE) for the end-to-end tests.
const { memo } = require('./remember');
const { personPlan } = require('./records');

const BASE = process.env.KULTURNAV_BASE || 'https://kulturnav.org';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recordUrl = (id) => `https://kulturnav.org/${id}`;
const remember = memo();

async function fetchRecord(id) {
  if (!UUID.test(id)) throw new Error(`${id} is not a KulturNav id`);
  return remember(id, async () => {
    const res = await fetch(`${BASE}/${id}.json`, { headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' },
      signal: AbortSignal.timeout(15000) });
    if (res.status === 404) throw new Error(`KulturNav ${id} was not found`);
    if (!res.ok) throw new Error(`KulturNav answered ${res.status}`);
    return res.json();
  });
}

// "18631212-D" (day) · "186312-M" (month) · "1863-Y" (year) → our dates
function timeOf(v) {
  const m = /^(\d{4})(\d{2})?(\d{2})?/.exec(String(v || ''));
  if (!m) return null;
  return [m[1], m[2], m[3]].filter(Boolean).join('-');
}
const COUNTRIES = { Norge: 'no', Noreg: 'no', Sverige: 'se', Suomi: 'fi', Finland: 'fi', Danmark: 'dk', Tyskland: 'de', Frankrike: 'fr', Italia: 'it' };
// a localized value { no: …, sv: …, '*': … } → one text
const text = (v) => (v && typeof v === 'object' ? v['*'] || v.en || v.no || v.sv || Object.values(v)[0] : v) || null;

// an event (person.birth / person.death) → { date, place }
function event(props, key) {
  const ev = ((props[key] || [])[0] || {}).value;
  const p = (ev && ev.properties) || {};
  const ref = (((p['event.placeReference'] || [])[0] || {}).value || {}).properties || {};
  const place = text(((ref['placeReference.placeString'] || [])[0] || {}).value) || text(((ref['placeReference.place'] || [])[0] || {}).displayValue);
  // "Løten, Hedmark (Norge)" → "Løten" (records.js drops a trailing "(…)"), in Norway
  const country = COUNTRIES[(/\(([^)]+)\)\s*$/.exec(String(place || '')) || [])[1]] || null;
  return { date: timeOf(((p['event.time'] || [])[0] || {}).value), place: place ? { label: String(place).split(',')[0].trim(), country } : null };
}

async function compare(db, t, entity, doc, id, placeTarget) {
  const d = await fetchRecord(id);
  const p = d.properties || {};
  const born = event(p, 'person.birth');
  const died = event(p, 'person.death');
  const same = (p['entity.sameAs'] || []).map((x) => String(x.value || '')).join(' ');
  const num = (re) => (re.exec(same) || [])[1] || null;
  return personPlan(db, t, entity, doc, {
    id, url: recordUrl(id), name: text(((p['entity.name'] || [])[0] || {}).value) || text(d.caption),
    birth: born.date, death: died.date, birthPlace: born.place, deathPlace: died.place,
    ids: { viaf: num(/viaf\.org\/viaf\/(\d+)/), ulan: num(/ulan\/(500\d{6})/), lc: num(/authorities\/names\/(n[a-z]?\d+)/) },
  }, placeTarget);
}

module.exports = { compare, recordUrl, timeOf };
