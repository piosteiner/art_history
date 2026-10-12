// ---------------------------------------------------------------------------------------------------------------
// Metagrid (api.metagrid.ch, Swiss Academy of Humanities and Social Sciences): a concordance of ~40 Swiss and
// international databases — for one person, its numbers in the GND, SIKART, HLS, VIAF, the Library of Congress,
// dodis, fotoCH … On the Enrich page: the person searched by name; a concordance that contains one of our numbers is
// the same person for sure, otherwise the candidates (best: the same dates) are offered to pick. The numbers of the
// authority files we keep become reference records; the other databases are listed as links.
// Base URL configurable (METAGRID_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const { html } = require('./html');

const BASE = process.env.METAGRID_BASE || 'https://api.metagrid.ch';
// Metagrid's providers → our authorities (059); dodis numbers persons "P…"
const MAP = { gnd: 'gnd', sikart: 'sikart', viaf: 'viaf', loc: 'lc', 'hls-dhs-dss': 'hls', dodis: 'dodis', sudoc: 'idref', fotoch: 'fotoch' };
const valueOf = (code, id) => (code === 'dodis' && /^\d+$/.test(id) ? `P${id}` : String(id));
// how the other providers are called on the page
const PROVIDERS = { burgerbibliothek: 'Burgerbibliothek Bern', ethz: 'ETH-Bibliothek', helveticat: 'Helveticat', bsg: 'Schweizerische Nationalbibliothek (BSG)',
  histhub: 'histHub', hallernet: 'hallerNet', kbga: 'Karl Barth-Gesamtausgabe', georgfischer: 'Georg Fischer Archiv', sturzenegger: 'Sturzenegger-Stiftung',
  fotostiftung: 'Fotostiftung Schweiz', vitrosearch: 'Vitrosearch (Glasmalerei)', parlamentch: 'Parlament.ch', 'elites-suisses-au-xxe-siecle': 'Elites suisses',
  'hls-dhs-dss': 'HLS', loc: 'Library of Congress', sudoc: 'IdRef / Sudoc' };
const providerName = (slug) => PROVIDERS[slug] || slug;
const remember = memo();

async function search(name) {
  return remember(name, async () => {
    const res = await fetch(`${BASE}/search?${new URLSearchParams({ group: '1', query: name })}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Metagrid answered ${res.status}`);
    return ((await res.json()).concordances || []).map(concordance);
  });
}

// one concordance → { id, name, birth, death, numbers: [{code, value, url}], links: [{provider, url}] }
function concordance(c) {
  const res = c.resources || [];
  const meta = (k) => (res.map((r) => (r.metadata || {})[k]).filter(Boolean).sort((a, b) => b.length - a.length)[0]) || '';
  const numbers = [];
  for (const r of res) {
    const code = MAP[(r.provider || {}).slug];
    if (code && r.identifier && !numbers.some((n) => n.code === code)) numbers.push({ code, value: valueOf(code, r.identifier), url: (r.link || {}).uri });
  }
  const first = res[0] && res[0].metadata ? `${res[0].metadata.first_name || ''} ${res[0].metadata.last_name || ''}`.trim() : '';
  return { id: c.id, name: first || String(c.name || '').replace(/\s+\d{4}.*$/, '').trim(), birth: meta('birth_date'), death: meta('death_date'), numbers,
    links: res.filter((r) => !MAP[(r.provider || {}).slug] && r.link).map((r) => ({ provider: providerName(r.provider.slug), url: r.link.uri })) };
}

// The entry in Metagrid → { exact, candidates, error } — numbers with their status against ours
async function find(db, t, e) {
  const ours = (await db.query('SELECT authority AS code, value FROM entry_identifiers WHERE entity_type = $1 AND entity_id = $2', [t.type, e.id])).rows;
  const names = (await db.query('SELECT code, name FROM authorities')).rows;
  let hits;
  try { hits = await search(e.name); } catch (err) { return { error: `Metagrid could not be searched: ${err.message}` }; }
  const status = (c) => ({ ...c, numbers: c.numbers.filter((n) => names.some((a) => a.code === n.code)).map((n) => {
    const mine = ours.find((o) => o.code === n.code);
    return { ...n, name: names.find((a) => a.code === n.code).name, ours: mine ? mine.value : null, status: !mine ? 'new' : mine.value === n.value ? 'same' : 'differs' };
  }) });
  const exact = hits.find((c) => c.numbers.some((n) => ours.some((o) => o.code === n.code && o.value === n.value)));
  if (exact) return { exact: status(exact), candidates: [] };
  // the same years of birth and death first; only people with at least one number we keep
  // (our dates are ranges — "[1853-03-14,1853-03-15)": the first year in them)
  const year = (v) => (String(v || '').match(/\d{4}/) || [''])[0];
  const score = (c) => (year(c.birth) && year(c.birth) === year(e.doc.birth) ? 2 : 0) + (year(c.death) && year(c.death) === year(e.doc.death) ? 2 : 0);
  const candidates = hits.filter((c) => c.numbers.length).map((c) => ({ ...status(c), score: score(c) }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
  return { exact: null, candidates };
}

// --- the Enrich page's section ----------------------------------------------------------------------------------
const numbersOf = (c) => html`${c.numbers.map((n) => html`<label class="choice">${n.status === 'same'
  ? html`<span class="muted">${n.name}: ${n.value} (have it)</span>`
  : html`<input type="checkbox" name="mg:${c.id}:${n.code}" value="take"${n.status === 'new' ? ' checked' : ''}> ${n.name}: <a href="${n.url}" target="_blank" rel="noopener">${n.value} ↗</a>${n.status === 'differs' ? html` <span class="tag qa-warning">yours: ${n.ours}</span>` : ''}`}</label> `)}
  ${c.links.length ? html`<div class="muted small">Also in: ${c.links.map((l, i) => html`${i ? ' · ' : ''}<a href="${l.url}" target="_blank" rel="noopener">${l.provider} ↗</a>`)}</div>` : ''}`;
const life = (c) => [c.birth, c.death].some(Boolean) ? `${c.birth || '?'} – ${c.death || '?'}` : '';

function section(mg) {
  if (!mg) return '';
  if (mg.error) return html`<h2>Other databases (Metagrid)</h2><p class="flash error">${mg.error}</p>`;
  if (mg.exact) {
    return html`<h2>Other databases (Metagrid)</h2>
      <p class="muted small">The same person — Metagrid's record contains one of our numbers. Ticked numbers become reference records.</p>
      <input type="hidden" name="mg:pick" value="${mg.exact.id}">
      <div class="mg-candidate"><b>${mg.exact.name}</b> <span class="muted">${life(mg.exact)}</span><div>${numbersOf(mg.exact)}</div></div>`;
  }
  if (!mg.candidates.length) return html`<h2>Other databases (Metagrid)</h2><p class="muted">Nobody of that name in Metagrid.</p>`;
  // pre-selected only when one candidate alone has the same dates
  const best = mg.candidates.filter((c) => c.score >= 2);
  const pre = best.length === 1 ? best[0] : null;
  return html`<h2>Other databases (Metagrid)</h2>
    <p class="muted small">People of this name in Metagrid — pick the one that is this ${'entry'}; its ticked numbers become reference records.</p>
    ${mg.candidates.map((c) => html`<div class="mg-candidate"><label class="choice"><input type="radio" name="mg:pick" value="${c.id}"${c === pre ? ' checked' : ''}>
      <b>${c.name}</b> <span class="muted">${life(c)}</span></label><div>${numbersOf(c)}</div></div>`)}
    <label class="choice"><input type="radio" name="mg:pick" value=""${pre ? '' : ' checked'}> none of these</label>`;
}

// the ticked numbers of the picked concordance → reference records (inside the caller's transaction) → { ids, created }
async function apply(db, t, e, mg, body) {
  const out = { ids: 0, created: [] };
  if (!mg || mg.error) return out;
  const c = mg.exact || mg.candidates.find((x) => x.id === body['mg:pick']);
  if (!c) return out;
  for (const n of c.numbers) {
    if (n.status === 'same' || body[`mg:${c.id}:${n.code}`] !== 'take') continue;
    await db.query('SAVEPOINT mg');
    try {
      await db.query(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, $2, $3, $4)
        ON CONFLICT (entity_type, entity_id, authority) DO UPDATE SET value = EXCLUDED.value`, [t.type, e.id, n.code, n.value]);
      await db.query('RELEASE SAVEPOINT mg');
      out.ids += 1;
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT mg');
      out.created.push(`(${n.name} ${n.value} not added: ${/unique|duplicate/i.test(err.message) ? 'the number of another entry' : err.message})`);
    }
  }
  return out;
}

module.exports = { search, find, section, apply, concordance, MAP };
