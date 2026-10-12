// ---------------------------------------------------------------------------------------------------------------
// ArCo — the linked data of Italy's Catalogo generale dei Beni Culturali (dati.beniculturali.it, CC BY 4.0) — on the
// Enrich page of an artist or person with a Wikidata item: ArCo's people link to their Wikidata item (owl:sameAs), so
// the works it catalogues for them are found exactly — how many, the first ones with their catalogue pages. Where an
// artist's works are in Italian public collections: information, nothing is taken.
// Base URL configurable (ARCO_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const { html } = require('./html');

const BASE = process.env.ARCO_BASE || 'https://dati.beniculturali.it';
const SHOWN = 12;
const remember = memo();

async function sparql(query) {
  const res = await fetch(`${BASE}/sparql?${new URLSearchParams({ query, format: 'json' })}`, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`dati.beniculturali.it answered ${res.status}`);
  return ((await res.json()).results || {}).bindings || [];
}

// the catalogued works of the person with this Wikidata item → { total, works: [{ id, title, url }] }
async function worksOf(qid) {
  if (!/^Q[1-9][0-9]*$/.test(qid || '')) return null;
  return remember(qid, async () => {
    const who = `?a <http://www.w3.org/2002/07/owl#sameAs> <http://www.wikidata.org/entity/${qid}> . ?w ?p ?a .
      FILTER(CONTAINS(STR(?w), "/HistoricOrArtisticProperty/") || CONTAINS(STR(?w), "/ArchitecturalOrLandscapeHeritage/"))`;
    const [count, rows] = await Promise.all([
      sparql(`SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ${who} }`),
      sparql(`SELECT DISTINCT ?w ?l WHERE { ${who} ?w <http://www.w3.org/2000/01/rdf-schema#label> ?l } LIMIT ${SHOWN * 3}`)]);
    const works = new Map();
    for (const r of rows) {
      const id = r.w.value.split('/resource/')[1];
      const label = r.l.value;
      // each work has an Italian and an English label ("… di …" / "… by …"): the English one
      if (!works.has(id) || / by /.test(label)) works.set(id, { id, title: label, url: `https://catalogo.beniculturali.it/detail/${id}` });
    }
    return { total: Number((count[0] || {}).n ? count[0].n.value : works.size), works: [...works.values()].slice(0, SHOWN) };
  });
}

// → null (not a person, or no Wikidata item) | { total, works, name } | { error }
async function find(t, e, qid) {
  if (!['artist', 'person'].includes(t.type) || !qid) return null;
  try {
    const r = await worksOf(qid);
    return r && r.total ? { ...r, name: e.name } : null;
  } catch (err) { return { error: err.message }; }
}

function section(arco) {
  if (!arco) return '';
  if (arco.error) return html`<h2>Italian national catalogue (ArCo)</h2><p class="flash error">ArCo could not be read: ${arco.error}</p>`;
  return html`<h2>Italian national catalogue (ArCo)</h2>
    <p class="muted small"><b>${arco.total}</b> work${arco.total === 1 ? '' : 's'} in Italian public collections, found through the Wikidata item —
      for information (where the works are), nothing is taken.
      <a href="https://catalogo.beniculturali.it/search?query=${encodeURIComponent(arco.name)}" target="_blank" rel="noopener">all in the Catalogo generale ↗</a></p>
    <ul class="arco-works">${arco.works.map((w) => html`<li><a href="${w.url}" target="_blank" rel="noopener">${w.title} ↗</a></li>`)}</ul>`;
}

module.exports = { find, section, worksOf };
