// ---------------------------------------------------------------------------------------------------------------
// Authority files (migration 053): an entry's numbers in Getty ULAN, the GND, VIAF, SIKART, RKD, the Library of
// Congress — with a link to each record. Added on the entry's page (a number or the record's address: the number is
// taken from the link), or by the Wikidata comparison. One number names one entry (UNIQUE): a clash is a duplicate.
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');

class IdentifierError extends Error {}

let cache = null;
async function authorities(db) {
  if (!cache) cache = (await db.query('SELECT code, name, url_template, pattern, wikidata_property, entity_types::text[] AS types FROM authorities ORDER BY position')).rows;
  return cache;
}
const forType = (list, type) => list.filter((a) => a.types.includes(type));
const urlOf = (a, value) => a.url_template.replace('{id}', encodeURIComponent(value));

// The number from what was pasted: the number itself, or a record's web address of that authority
// (d-nb.info/gnd/118559737, portal.dnb.de/…query=nid%3D118559737, getty.edu/vow/…subjectid=500021093, viaf.org/viaf/…).
function numberFrom(code, text) {
  const t = String(text || '').trim();
  let u;
  try { u = new URL(t); } catch { return t; }
  const q = (k) => u.searchParams.get(k);
  const last = u.pathname.split('/').filter(Boolean).pop() || '';
  if (code === 'gnd') return (/(?:^|[=:])nid=?([0-9X-]+)/i.exec(decodeURIComponent(q('query') || '')) || [])[1] || (u.hostname.endsWith('d-nb.info') || u.hostname.endsWith('lobid.org') ? last.replace(/\.json$/, '') : t);
  if (code === 'ulan') return q('subjectid') || (/(500\d{6})/.exec(t) || [])[1] || t;
  if (code === 'sikart') return (/person-(\d+)/.exec(t) || [])[1] || q('id') || (/(\d{6,10})/.exec(t) || [])[1] || t;  // recherche.sik-isea.ch/sik:person-4000055/…
  return last || t;
}

async function list(db, type, id) {
  const all = await authorities(db);
  const { rows } = await db.query('SELECT id, authority, value FROM entry_identifiers WHERE entity_type = $1 AND entity_id = $2', [type, id]);
  return all.filter((a) => rows.some((r) => r.authority === a.code))
    .map((a) => { const r = rows.find((x) => x.authority === a.code); return { id: r.id, code: a.code, name: a.name, value: r.value, url: urlOf(a, r.value) }; });
}

async function add(db, type, id, body) {
  const code = String(body.authority || '');
  const a = (await authorities(db)).find((x) => x.code === code);
  if (!a) throw new IdentifierError('Pick the reference record (authority) first.');
  const value = numberFrom(code, body.value);
  if (!value) throw new IdentifierError(`${a.name}: the number or the link of the record.`);
  // a savepoint: after a failed statement the transaction is aborted — the message needs one more query
  await db.query('SAVEPOINT idf_add');
  try {
    await db.query(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ($1, $2, $3, $4)
      ON CONFLICT (entity_type, entity_id, authority) DO UPDATE SET value = EXCLUDED.value`, [type, id, code, value]);
    await db.query('RELEASE SAVEPOINT idf_add');
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT idf_add');
    throw new IdentifierError(await errorText(db, err, code, value) || err.message);
  }
}

// a Postgres error of this table → a sentence (null: not ours)
async function errorText(db, err, code, value) {
  if (err.constraint === 'entry_identifiers_unique') {
    const { rows } = await db.query(`SELECT e.type::text AS type, e.slug, e.name FROM entry_identifiers i
      JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id) WHERE i.authority = $1 AND i.value = $2`, [code, value]);
    return rows.length ? `${value} is already the number of “${rows[0].name}” (${rows[0].type}/${rows[0].slug}) — the same entry twice? (Merge… on its page)` : `${value} is in use already.`;
  }
  if (['entry_identifiers_pattern', 'entry_identifiers_type'].includes(err.constraint)) return err.message;
  return null;
}

async function remove(db, rowId) { await db.query('DELETE FROM entry_identifiers WHERE id = $1', [rowId]); }
async function byId(db, rowId) {
  if (!/^\d+$/.test(String(rowId))) return null;
  return (await db.query('SELECT * FROM entry_identifiers WHERE id = $1', [rowId])).rows[0] || null;
}

function section({ t, e, ids, available }) {
  const gnd = ids.find((x) => x.code === 'gnd');
  return html`<section id="reference-records"><h2>Reference records</h2>
    <p class="muted small">The numbers of this ${t.type} in authority files — they say exactly who or what is meant, and lead to curated records.</p>
    ${ids.length ? html`<ul class="identifiers">${ids.map((x) => html`<li><b>${x.name}</b>: <a href="${x.url}" target="_blank" rel="noopener">${x.value} ↗</a>
      <form method="post" action="/identifiers/${x.id}/delete" class="inline"><button class="link small">remove</button></form></li>`)}</ul>` : ''}
    ${gnd ? html`<p><a class="button secondary" href="/${t.folder}/${e.slug}/gnd">Compare with the GND…</a>
      <span class="muted small">dates, places, occupations and relationships from the Deutsche Nationalbibliothek's record — cited as the source</span></p>` : ''}
    ${['artist', 'person'].includes(t.type) ? html`<p><a class="button secondary" href="/${t.folder}/${e.slug}/sikart">${ids.some((x) => x.code === 'sikart') ? 'Compare with SIKART…' : 'Find in SIKART…'}</a>
      <span class="muted small">the lexicon of the Swiss Institute for Art Research (SIK-ISEA): life data, places, Heimatort, GND and VIAF — cited as the source</span></p>` : ''}
    ${available.length ? html`<details><summary class="button secondary">+ Add a reference record</summary>
      <form method="post" action="/${t.folder}/${e.slug}/identifiers" class="form bar">
        <select name="authority" aria-label="authority">${available.map((a) => html`<option value="${a.code}">${a.name}</option>`)}</select>
        <input name="value" class="grow" placeholder="the number — or paste the link of the record" aria-label="number or link" required>
        <button>Add</button></form>
      <div class="hint">Wikidata knows most of them: “Wikidata…” on this page takes them over.</div></details>` : ''}
  </section>`;
}

module.exports = { IdentifierError, authorities, forType, urlOf, numberFrom, list, add, remove, byId, section, errorText };
