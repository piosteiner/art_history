// The Bibliothèque nationale de France (data.bnf.fr, Licence Ouverte): a person's record from the SPARQL endpoint —
// birth and death (bio:birth "1853-03-14"), places of birth and death ("Berne", "Genève (Suisse)"), the VIAF and IdRef
// numbers it links. Compared like the GND (records.js). Base URL configurable (BNF_BASE) for the end-to-end tests.
const { memo } = require('./remember');
const { personPlan } = require('./records');

const BASE = process.env.BNF_BASE || 'https://data.bnf.fr';
const recordUrl = (id) => `https://data.bnf.fr/ark:/12148/cb${id}`;
const remember = memo();

// every statement about the person → [[predicate, object], …]
async function fetchRecord(id) {
  if (!/^[0-9]{8}[0-9bcdfghjkmnpqrstvwxz]$/.test(id)) throw new Error(`${id} is not a BnF number`);
  return remember(id, async () => {
    const query = `SELECT ?p ?o WHERE { <http://data.bnf.fr/ark:/12148/cb${id}#about> ?p ?o }`;
    const url = `${BASE}/sparql?${new URLSearchParams({ query, format: 'application/sparql-results+json' })}`;
    const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' },
      signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`data.bnf.fr answered ${res.status}`);
    const rows = ((await res.json()).results || {}).bindings || [];
    if (!rows.length) throw new Error(`BnF ${id} was not found`);
    return rows.map((b) => [b.p.value, b.o.value]);
  });
}

// "1853-03-14" · "1853" · "18.." (unknown — left out)
const dateOf = (v) => (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v || '')) ? String(v) : null);

async function compare(db, t, entity, doc, id, placeTarget) {
  const pairs = await fetchRecord(id);
  const get = (suffix) => (pairs.find(([p]) => p.endsWith(suffix)) || [])[1] || null;
  const all = (suffix) => pairs.filter(([p]) => p.endsWith(suffix)).map(([, o]) => o);
  const same = all('owl#sameAs').join(' ');
  const num = (re) => (re.exec(same) || [])[1] || null;
  return personPlan(db, t, entity, doc, {
    id, url: recordUrl(id), name: get('foaf/0.1/name'), short: get('biographicalInformation'),
    birth: dateOf(get('bio/0.1/birth')), death: dateOf(get('bio/0.1/death')),
    birthPlace: get('ElementsGr2/placeOfBirth') ? { label: get('ElementsGr2/placeOfBirth') } : null,
    deathPlace: get('ElementsGr2/placeOfDeath') ? { label: get('ElementsGr2/placeOfDeath') } : null,
    ids: { viaf: num(/viaf\.org\/viaf\/(\d+)/), idref: num(/idref\.fr\/([0-9]{8}[0-9X])/) },
  }, placeTarget);
}

module.exports = { compare, recordUrl };
