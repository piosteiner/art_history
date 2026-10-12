// The National Library of Korea's linked data (lod.nl.go.kr, SPARQL): a Korean person — years of birth and death, the
// place of birth (in Korean: "경기도 안산" → the town, 안산), the Korean name (prefLabel) and other names — the hanja
// forms and art names (號) among the altLabels — and its numbers in the GND, LC, VIAF, ULAN. Compared like the GND
// (records.js); the names are offered as other names. Base URL configurable (NLK_BASE) for the end-to-end tests.
const { memo } = require('./remember');
const { personPlan } = require('./records');

const BASE = process.env.NLK_BASE || 'https://lod.nl.go.kr';
const recordUrl = (id) => `https://lod.nl.go.kr/page/${id}`;
const remember = memo();

async function fetchRecord(id) {
  if (!/^KAC[0-9]{9}$/.test(id)) throw new Error(`${id} is not a National Library of Korea number`);
  return remember(id, async () => {
    const query = `SELECT ?p ?o WHERE { <http://lod.nl.go.kr/resource/${id}> ?p ?o FILTER(!CONTAINS(STR(?p), '/create')) }`;
    const res = await fetch(`${BASE}/sparql?${new URLSearchParams({ query })}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`lod.nl.go.kr answered ${res.status}`);
    const rows = ((await res.json()).results || {}).bindings || [];
    if (!rows.length) throw new Error(`NLK ${id} was not found`);
    return rows.map((b) => [b.p.value, b.o.value]);
  });
}

// "경기도 안산" → "안산시": the town (last word), named as OpenStreetMap names it — with 시 (city) unless it has a suffix
// already (시 city, 군 county, 구 district, 도 province, 읍/면 town)
const town = (place) => { const w = String(place).trim().split(/\s+/).pop(); return /[시군구도읍면]$/.test(w) ? w : `${w}시`; };
const HAN = /^[㐀-鿿豈-﫿]+$/;
const HANGUL = /^[가-힯ᄀ-ᇿ\s]+$/;

async function compare(db, t, entity, doc, id, placeTarget) {
  const pairs = await fetchRecord(id);
  const get = (suffix) => (pairs.find(([p]) => p.endsWith(suffix)) || [])[1] || null;
  const all = (suffix) => pairs.filter(([p]) => p.endsWith(suffix)).map(([, o]) => o);
  const same = all('owl#sameAs').join(' ');
  const num = (re) => (re.exec(same) || [])[1] || null;
  const year = (v) => (/^\d{3,4}$/.test(String(v || '')) ? String(v) : null);
  const name = get('core#prefLabel') || get('foaf/0.1/name');
  const birthPlace = get('birthPlace');
  // the Korean name, then its hanja forms and art names — Latin forms ("Kim, Hongdo") are left out
  const names = [];
  if (name && HANGUL.test(name)) names.push({ text: name, lang: 'ko', role: 'original', preselect: true });
  for (const alt of all('core#altLabel')) {
    if (HAN.test(alt)) names.push({ text: alt, lang: 'ko-Hani', role: 'alternative' });
    else if (HANGUL.test(alt) && alt !== name) names.push({ text: alt, lang: 'ko', role: 'alternative' });
  }
  return personPlan(db, t, entity, doc, {
    id, url: recordUrl(id), name, short: get('jobTitle'),
    birth: year(get('birthYear')), death: year(get('deathYear')),
    // "경기도 안산": province, then town — the town
    birthPlace: birthPlace ? { label: town(birthPlace), country: 'kr' } : null,
    ids: { gnd: num(/d-nb\.info\/gnd\/([0-9X-]+)/), lc: num(/authorities\/names\/(n[a-z]?\d+)/), viaf: num(/viaf\.org\/viaf\/(\d+)/), ulan: num(/ulan\/(500\d{6})/) },
    names,
  }, placeTarget);
}

module.exports = { compare, recordUrl };
