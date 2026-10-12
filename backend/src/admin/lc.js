// The Library of Congress Name Authority File (id.loc.gov, public domain): a person's record as JSON-LD (MADS/RDF) —
// birth and death as EDTF dates, places of birth and death ("Bern (Switzerland)"), the GND / VIAF numbers it links.
// Compared like the GND (records.js). Base URL configurable (LC_BASE) for the end-to-end tests.
const { memo } = require('./remember');
const { personPlan } = require('./records');

const BASE = process.env.LC_BASE || 'https://id.loc.gov';
const MADS = 'http://www.loc.gov/mads/rdf/v1#';
const recordUrl = (id) => `https://id.loc.gov/authorities/names/${id}.html`;
const remember = memo();

async function fetchRecord(id) {
  return remember(id, async () => {
    const res = await fetch(`${BASE}/authorities/names/${encodeURIComponent(id)}.json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) throw new Error(`LC ${id} was not found`);
    if (!res.ok) throw new Error(`id.loc.gov answered ${res.status}`);
    return res.json();
  });
}

// EDTF → our fuzzy dates: 1853-03-14 · 1853-03 · 1853 · 1853~ / 1853? (approximate → "c. 1853")
const edtf = (v) => {
  const s = String(v || '').trim();
  const m = /^(\d{4})[~?%]$/.exec(s);
  return m ? `c. ${m[1]}` : /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) ? s : null;
};

async function compare(db, t, entity, doc, id, placeTarget) {
  const graph = await fetchRecord(id);
  const node = (uri) => graph.find((n) => n['@id'] === uri) || {};
  const first = (n, p) => ((n[MADS + p] || [])[0] || {});
  const label = (uri) => { const l = (node(uri)[`${MADS}authoritativeLabel`] || []).find((x) => !x['@language']) || (node(uri)[`${MADS}authoritativeLabel`] || [])[0]; return l ? l['@value'] : null; };
  const rwo = node(`http://id.loc.gov/rwo/agents/${id}`);
  const auth = node(`http://id.loc.gov/authorities/names/${id}`);
  const place = (p) => { const uri = first(rwo, p)['@id']; return uri && label(uri) ? { label: label(uri) } : null; };
  // the numbers it links (closeMatch / exactMatch to other authority files)
  const text = JSON.stringify(auth);
  const num = (re) => (re.exec(text) || [])[1] || null;
  return personPlan(db, t, entity, doc, {
    id, url: recordUrl(id), name: label(`http://id.loc.gov/authorities/names/${id}`),
    birth: edtf(first(rwo, 'birthDate')['@value']), death: edtf(first(rwo, 'deathDate')['@value']),
    birthPlace: place('birthPlace'), deathPlace: place('deathPlace'),
    ids: { gnd: num(/d-nb\.info\/gnd\/([0-9X-]+)/), viaf: num(/viaf\.org\/viaf\/(\d+)/) },
  }, placeTarget);
}

module.exports = { compare, recordUrl, edtf };
