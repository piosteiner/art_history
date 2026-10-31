// RKDartists (RKD – Netherlands Institute for Art History, data.rkd.nl, Linked Data in CIDOC-CRM): a person, the events
// of birth and death (E67/E69) with their time-span (P82a/P82b) and place (P7) — the places carry their Wikidata item,
// so ours are found exactly. Each node is a request of its own (about seven per person; remembered for 15 minutes).
// Compared like the GND (records.js). Base URL configurable (RKD_BASE) for the end-to-end tests.
const { memo } = require('./remember');
const { personPlan } = require('./records');
const { getJson } = require('./http');

const BASE = process.env.RKD_BASE || 'https://data.rkd.nl';
const CRM = 'http://www.cidoc-crm.org/cidoc-crm/';
const recordUrl = (id) => `https://rkd.nl/en/explore/artists/${id}`;
const remember = memo();

// one node by its address — only RKD's own (the record names the addresses we follow)
function node(uri) {
  if (!String(uri).startsWith(`${BASE}/`)) return Promise.resolve({});
  return remember(uri, async () => {
    const list = await getJson(uri, { accept: 'application/ld+json', missing: null });
    if (!list) return {};
    return (Array.isArray(list) ? list : [list]).find((n) => n['@id'] === uri) || {};
  });
}
const ref = (n, p) => ((n[p] || [])[0] || {})['@id'] || null;
const val = (n, p) => ((n[p] || [])[0] || {})['@value'] || null;

// a time-span → our date text: one day · one month · one year · a range of years ("1600/1605")
function spanText(ts) {
  const a = val(ts, `${CRM}P82a_begin_of_the_begin`);
  const b = val(ts, `${CRM}P82b_end_of_the_end`);
  if (!a && !b) return null;
  if (!a || !b || a === b) return String(a || b).slice(0, 10);
  if (a.slice(0, 7) === b.slice(0, 7) && a.slice(8, 10) === '01') return a.slice(0, 7);
  if (a.slice(0, 4) === b.slice(0, 4)) return a.slice(0, 4);
  return `${a.slice(0, 4)}/${b.slice(0, 4)}`;
}

async function event(person, prop) {
  const ev = await node(ref(person, prop));
  if (!ev['@id']) return { date: null, place: null };
  const [ts, pl] = await Promise.all([node(ref(ev, `${CRM}P4_has_time-span`)), node(ref(ev, `${CRM}P7_took_place_at`))]);
  const label = ((pl['http://www.w3.org/2004/02/skos/core#prefLabel'] || []).find((l) => l['@language'] === 'en') || {})['@value']
    || val(pl, 'http://www.w3.org/2000/01/rdf-schema#label');
  const qid = ((pl['http://www.w3.org/2004/02/skos/core#exactMatch'] || []).map((x) => /wikidata\.org\/entity\/(Q\d+)/.exec(x['@id'])).find(Boolean) || [])[1] || null;
  return { date: spanText(ts), place: label ? { label, qid } : null };
}

async function compare(db, t, entity, doc, id, placeTarget) {
  if (!/^[0-9]{1,7}$/.test(String(id))) throw new Error(`${id} is not an RKD number`);
  const person = await node(`${BASE}/artists/${id}`);
  if (!person['@id']) throw new Error(`RKD ${id} was not found`);
  const [born, died] = await Promise.all([event(person, `${CRM}P98i_was_born`), event(person, `${CRM}P100i_died_in`)]);
  // (the link to other authority files: an "…equivalent" property)
  const equiv = JSON.stringify(Object.entries(person).filter(([k]) => /equivalent$/i.test(k)).map(([, v]) => v));
  const num = (re) => (re.exec(equiv) || [])[1] || null;
  const name = val(person, 'http://www.w3.org/2000/01/rdf-schema#label');
  return personPlan(db, t, entity, doc, {
    id: String(id), url: recordUrl(id), name,
    birth: born.date, death: died.date, birthPlace: born.place, deathPlace: died.place,
    ids: { viaf: num(/viaf\.org\/viaf\/(\d+)/), ulan: num(/ulan\/(500\d{6})/) },
  }, placeTarget);
}

module.exports = { compare, recordUrl, spanText };
