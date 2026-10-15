// ---------------------------------------------------------------------------------------------------------------
// Provenance of an artwork (table provenance, migration 031): the owners in order, as the sources record them —
// when each acquired it, how, where it was, whether the handover is documented as direct. The periods are computed
// by the view provenance_periods (each end recorded / implied by the next acquisition / ongoing / unknown) and drawn
// as owned_by / kept_in / transferred_to edges (view edges). Changes are saved immediately, like images.
// 063: the holder's role (owner, dealer, agent, estate, custodian), joint owners (provenance_co_owners), the price;
// the page shows the chain as it is read (view provenance_chain): the artist first and a loan last, implied.
// ---------------------------------------------------------------------------------------------------------------
const { html, raw } = require('./html');
const { BY_TYPE, dateToDoc } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');
const { renderMarkdown } = require('../markdown');

class ProvenanceError extends Error {}

const METHODS = ['creation', 'commission', 'inheritance', 'purchase', 'auction', 'gift', 'bequest', 'exchange',
  'confiscation', 'forced_sale', 'restitution', 'settlement', 'unknown'];
const CERTAINTY = ['attested', 'probable', 'possible', 'disputed'];
const ROLES = ['owner', 'dealer', 'agent', 'estate', 'custodian'];
const ROLE_TEXT = { owner: 'owner', dealer: 'dealer', agent: 'agent — on consignment, held but not owned', estate: 'estate of the owner',
  custodian: 'custodian — held without owning (deposit, loan)' };
const CO_TYPES = ['artist', 'person', 'institution'];
const CO_ARC = { artist: 'owner_artist_id', person: 'owner_person_id', institution: 'owner_institution_id' };
const CO_SLOTS = 3;
const OWNER_TYPES = ['artist', 'person', 'institution', 'place'];
const ARC = { artist: 'owner_artist_id', person: 'owner_person_id', institution: 'owner_institution_id', place: 'owner_place_id' };
const COLS = ['owner_artist_id', 'owner_person_id', 'owner_institution_id', 'owner_place_id', 'owner_label',
  'acquired', 'acquired_label', 'ended', 'ended_label', 'method', 'direct', 'location_id', 'label', 'certainty', 'notes_md', 'metadata',
  'role', 'price', 'price_currency', 'price_note', 'not_sold'];
const CASTS = { acquired: '::daterange', ended: '::daterange', method: '::acquisition_method', certainty: '::certainty', metadata: '::jsonb',
  role: '::holder_role', price: '::numeric' };
// "18,000" · "18'000" · "200.00" · "1 250,50" → 18000 · 18000 · 200 · 1250.5
function priceOf(text) {
  let t = String(text || '').replace(/[\s'’]/g, '');
  if (!t) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) throw new ProvenanceError(`Price: "${text}" is not an amount — write it as a number, e.g. 18000 or 200.50.`);
  return t;
}
// 18000 USD (ca.) — for the page
const priceText = (s) => (s.price === null || s.price === undefined ? ''
  : `${Number(s.price).toLocaleString('en', { maximumFractionDigits: 2 })} ${s.price_currency}${s.price_note ? ` (${s.price_note})` : ''}`);
const methodLabel = (m) => (m === 'forced_sale' ? 'forced sale' : m);
const METHOD_OPTION = { settlement: 'settlement — kept after an agreement with claimants (073)' };
const END_BASIS = {
  recorded: null,
  implied: 'end implied by the next acquisition',
  ongoing: 'ongoing — the current holder',
  unknown: 'end unknown',
};

// Form body → column values (COLS order). Owner "type/slug" and place slug are looked up; throws ProvenanceError.
async function fromForm(db, body, keepMetadata = {}) {
  const text = (k) => String(body[k] ?? '').replace(/\r\n/g, '\n').trim() || null;
  const v = Object.fromEntries(COLS.map((c) => [c, null]));
  const owner = text('owner');
  if (owner) {
    const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(owner);
    if (!m || !OWNER_TYPES.includes(m[1])) throw new ProvenanceError('Owner: pick an artist, person, institution or place from the suggestions — or leave it empty and describe the owner.');
    const id = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Owner: ${owner} does not exist.`);
    v[ARC[m[1]]] = id;
  }
  v.owner_label = text('owner_label');
  if (!owner && !v.owner_label) throw new ProvenanceError('Owner: pick an entry or describe the owner (e.g. "Private collection, Paris").');
  for (const key of ['acquired', 'ended']) {
    let d = null;
    try { d = parseFuzzyDate(text(key)); } catch (err) { throw new ProvenanceError(`${key === 'acquired' ? 'Acquired' : 'Ended'}: ${err.message}`); }
    v[key] = d && d.range;
    v[`${key}_label`] = d ? text(`${key}_label`) || d.label : null;
  }
  v.method = METHODS.includes(body.method) ? body.method : 'unknown';
  v.direct = body.direct === '1';
  const place = text('location');
  if (place) {
    const id = (await db.query('SELECT id FROM places WHERE slug = $1', [place])).rows[0];
    if (!id) throw new ProvenanceError(`Place: "${place}" does not exist — pick one from the suggestions.`);
    v.location_id = id.id;
  }
  v.label = text('label');
  v.certainty = CERTAINTY.includes(body.certainty) ? body.certainty : 'attested';
  v.notes_md = text('notes_md');
  v.role = ROLES.includes(body.role) ? body.role : 'owner';
  // an auction or consignment that ended without a sale (074): only for agents
  v.not_sold = v.role === 'agent' && body.not_sold === '1';
  v.price = priceOf(body.price);
  v.price_currency = text('price_currency') ? text('price_currency').toUpperCase() : null;
  if (v.price_currency && !/^[A-Z]{3}$/.test(v.price_currency)) throw new ProvenanceError('Currency: the three-letter code (ISO 4217) — e.g. CHF, USD, FRF, GBP, DEM.');
  if (v.price !== null && !v.price_currency) throw new ProvenanceError('Price: which currency? (e.g. FRF, USD, CHF)');
  if (v.price === null) v.price_currency = null;
  v.price_note = v.price === null ? null : text('price_note');
  // joint owners besides the first (063): artist, person or institution — each its own "owned by"
  const coOwners = [];
  for (let i = 1; i <= CO_SLOTS; i += 1) {
    const ref = text(`co_owner_${i}`);
    if (!ref) continue;
    const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(ref);
    if (!m || !CO_TYPES.includes(m[1])) throw new ProvenanceError('Joint owner: pick an artist, person or institution from the suggestions.');
    const id = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Joint owner: ${ref} does not exist.`);
    coOwners.push({ type: m[1], id });
  }
  // the "Sources" lines are free-text citations now (050): returned beside the column values
  const sources = String(body.sources || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const { sources: _old, ...rest } = keepMetadata;
  v.metadata = JSON.stringify(rest);
  return Object.assign(COLS.map((c) => v[c]), { sources, coOwners });
}

// A commission as the first step of an artwork's provenance (063: "commissioned" is derived from it) — from Wikidata's
// P88; dated like the work. Nothing when the provenance already starts with this commission. → its id | null
async function addCommission(db, artworkId, ownerType, ownerId) {
  if (!ARC[ownerType]) return null;
  const have = (await db.query(`SELECT id FROM provenance WHERE artwork_id = $1 AND method = 'commission' AND ${ARC[ownerType]} = $2`, [artworkId, ownerId])).rows[0];
  if (have) return null;
  const w = (await db.query('SELECT created::text AS created, created_label FROM artworks WHERE id = $1', [artworkId])).rows[0];
  const v = Object.fromEntries(COLS.map((c) => [c, null]));
  Object.assign(v, { [ARC[ownerType]]: ownerId, acquired: w.created, acquired_label: w.created_label, method: 'commission', direct: false,
    certainty: 'attested', metadata: '{}', role: 'owner', not_sold: false });
  return add(db, artworkId, Object.assign(COLS.map((c) => v[c]), { coOwners: [] }), { first: true });
}

// The step's joint owners, as posted: replaced as a whole
async function saveCoOwners(db, stepId, coOwners = []) {
  await db.query('DELETE FROM provenance_co_owners WHERE provenance_id = $1', [stepId]);
  for (const [i, c] of coOwners.entries()) {
    await db.query(`INSERT INTO provenance_co_owners (provenance_id, position, ${CO_ARC[c.type]}) VALUES ($1, $2, $3)`, [stepId, i, c.id]);
  }
}

// One step with its artwork, for the edit page and the redirect back.
async function byId(db, id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`
    SELECT p.*, w.slug AS artwork_slug, w.title AS artwork_title,
           (SELECT o.type::text || '/' || o.slug FROM entity_index o
             WHERE (o.type, o.id) = (pp.owner_type, pp.owner_id)) AS owner_ref,
           (SELECT slug FROM places WHERE id = p.location_id) AS location_slug, text_sources(NULL, p.id) AS text_sources,
           (SELECT array_agg(o.type::text || '/' || o.slug ORDER BY c.position) FROM provenance_co_owners_x c
             JOIN entity_index o ON (o.type, o.id) = (c.owner_type, c.owner_id) WHERE c.provenance_id = p.id) AS co_owner_refs
    FROM provenance p JOIN artworks w ON w.id = p.artwork_id JOIN provenance_periods pp ON pp.id = p.id
    WHERE p.id = $1`, [id]);
  if (!rows.length) return null;
  return { ...rows[0], artworkUrl: `/artworks/${rows[0].artwork_slug}` };
}

// A step as form values (for editing).
function formValues(step) {
  const acquired = dateToDoc(step.acquired, step.acquired_label, false);
  const ended = dateToDoc(step.ended, step.ended_label, false);
  return {
    owner: step.owner_ref || '', owner_label: step.owner_label || '',
    acquired: acquired.value || '', acquired_label: acquired.label || '',
    ended: ended.value || '', ended_label: ended.label || '',
    method: step.method, direct: step.direct, location: step.location_slug || '', label: step.label || '',
    certainty: step.certainty, notes_md: step.notes_md || '', sources: step.text_sources || [],
    role: step.role || 'owner', price: step.price === null || step.price === undefined ? '' : String(Number(step.price)),
    price_currency: step.price_currency || '', price_note: step.price_note || '', not_sold: !!step.not_sold,
    ...Object.fromEntries((step.co_owner_refs || []).map((ref, i) => [`co_owner_${i + 1}`, ref])),
  };
}

// { first: true }: at the start of the chain (a commission from Wikidata: before every later owner)
async function add(db, artworkId, values, { first = false } = {}) {
  if (first) await db.query('UPDATE provenance SET position = position + 1 WHERE artwork_id = $1', [artworkId]);
  // appended at the end of the chain
  const { rows } = await db.query(`INSERT INTO provenance (artwork_id, position, ${COLS.join(', ')})
    VALUES ($1, ${first ? '0' : '(SELECT coalesce(max(position) + 1, 0) FROM provenance WHERE artwork_id = $1)'},
            ${COLS.map((c, i) => `$${i + 2}${CASTS[c] || ''}`).join(', ')}) RETURNING id`, [artworkId, ...values]);
  await saveCoOwners(db, rows[0].id, values.coOwners);
  return rows[0].id;
}

async function update(db, id, values) {
  await db.query(`UPDATE provenance SET ${COLS.map((c, i) => `${c} = $${i + 2}${CASTS[c] || ''}`).join(', ')} WHERE id = $1`, [id, ...values]);
  await saveCoOwners(db, id, values.coOwners);
}

// Renumbers the artwork's steps 0, 1, 2 … in the given order; only changed rows are written. The unique constraint
// on (artwork_id, position) is DEFERRABLE INITIALLY DEFERRED, so the intermediate duplicates are fine until COMMIT.
async function renumber(db, artworkId, ids) {
  const { rows } = await db.query('SELECT id, position FROM provenance WHERE artwork_id = $1 FOR UPDATE', [artworkId]);
  for (const [pos, id] of ids.entries()) {
    if (rows.find((r) => r.id === id).position !== pos) await db.query('UPDATE provenance SET position = $2 WHERE id = $1', [id, pos]);
  }
}

async function orderedIds(db, artworkId) {
  return (await db.query('SELECT id FROM provenance WHERE artwork_id = $1 ORDER BY position, id', [artworkId])).rows.map((r) => r.id);
}

async function move(db, step, dir) {
  const ids = await orderedIds(db, step.artwork_id);
  const at = ids.indexOf(step.id);
  const to = dir === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(at, 1));
  await renumber(db, step.artwork_id, ids);
}

// A new order from the page (drag and drop): the same steps, in the order given — else nothing changes.
async function reorder(db, artworkId, ids) {
  const now = await orderedIds(db, artworkId);
  const want = ids.map(Number);
  if (want.length !== now.length || [...want].sort((a, b) => a - b).join() !== [...now].sort((a, b) => a - b).join()) {
    throw new ProvenanceError('The provenance changed meanwhile — reload the page and try again.');
  }
  await renumber(db, artworkId, want);
}

async function remove(db, step) {
  await db.query('DELETE FROM provenance WHERE id = $1', [step.id]);
  await renumber(db, step.artwork_id, await orderedIds(db, step.artwork_id));
}

// The chain for the artwork page (view provenance_chain): the recorded steps with their computed periods, the implied
// first line (the artist) and last line (a loan); joint owners with each step.
async function read(db, artworkId) {
  return (await db.query(`
    SELECT p.*, o.slug AS owner_slug, o.name AS owner_entity_name, l.slug AS location_slug, l.name AS location_name, pv.metadata,
           p.period && daterange('1933-01-30', '1945-05-09') AS nazi_era, holder_flag(p.owner_type, p.owner_id) AS flag,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('type', c.owner_type, 'slug', e.slug, 'name', e.name) ORDER BY c.position), '[]')
              FROM provenance_co_owners_x c JOIN entity_index e ON (e.type, e.id) = (c.owner_type, c.owner_id)
             WHERE c.provenance_id = p.id) AS co_owners
    FROM provenance_chain p LEFT JOIN provenance pv ON pv.id = p.id
    LEFT JOIN entity_index o ON (o.type, o.id) = (p.owner_type, p.owner_id)
    LEFT JOIN places l ON l.id = p.location_id
    WHERE p.artwork_id = $1 ORDER BY p.position`, [artworkId])).rows;
}

function form({ action, step = {}, submit }) {
  const v = (k) => step[k] ?? '';
  return html`<form method="post" action="${action}" class="form provenance-form">
    <select id="pv-owner-type" hidden><option data-object-types="${OWNER_TYPES.join(',')}" selected></option></select>
    <div class="row">
      <div class="field"><label for="pv-owner">Owner</label>
        <input id="pv-owner" name="owner" value="${v('owner')}" placeholder="start typing a name" autocomplete="off" data-lookup-from="pv-owner-type">
        <div class="hint">An artist, person, institution or place (a city or state).</div></div>
      <div class="field"><label for="pv-owner-label">Owner description</label>
        <input id="pv-owner-label" name="owner_label" value="${v('owner_label')}" placeholder="e.g. Private collection, Paris">
        <div class="hint">When the owner is unknown or not an entry — or a qualifier for the entry ("as agent").</div></div>
    </div>
    <div class="row">
      <div class="field"><label for="pv-role">Role</label><select id="pv-role" name="role">
        ${ROLES.map((r) => html`<option value="${r}"${r === (step.role || 'owner') ? ' selected' : ''}>${ROLE_TEXT[r]}</option>`)}</select>
        <div class="hint">How the holder had the work: a dealer bought it to sell; an agent held it on consignment or auctioned it;
          a custodian held it on deposit or loan. Agents and custodians hold it alongside the owner — the ownership goes on.</div>
        <label class="choice"><input type="checkbox" name="not_sold" value="1"${step.not_sold ? ' checked' : ''}> not sold <span class="muted">(agents: bought in, withdrawn, returned)</span></label></div>
      <div class="field"><label>Joint owners <span class="muted">(with the owner above)</span></label>
        <select id="pv-co-type" hidden><option data-object-types="${CO_TYPES.join(',')}" selected></option></select>
        ${Array.from({ length: CO_SLOTS }, (_, i) => html`<input name="co_owner_${i + 1}" value="${v(`co_owner_${i + 1}`)}" placeholder="and … (start typing)" autocomplete="off" data-lookup-from="pv-co-type" aria-label="joint owner ${i + 1}">`)}
        <div class="hint">E.g. Léo and Gertrude Stein: one step, two owners.</div></div>
    </div>
    <div class="row">
      <div class="field"><label for="pv-acquired">Acquired</label><input id="pv-acquired" name="acquired" value="${v('acquired')}" placeholder="e.g. 1952, c. 1890, 26 March 1952 or later">
        <input name="acquired_label" value="${v('acquired_label')}" placeholder="label (optional)" aria-label="Acquired label"></div>
      <div class="field"><label for="pv-method">How</label><select id="pv-method" name="method">
        ${METHODS.map((m) => html`<option value="${m}"${m === (step.method || 'unknown') ? ' selected' : ''}>${METHOD_OPTION[m] || methodLabel(m)}</option>`)}</select></div>
      <div class="field"><label for="pv-location">Place</label>
        <input id="pv-location" name="location" value="${v('location')}" placeholder="where the work was" autocomplete="off" data-lookup="place"></div>
    </div>
    <label class="choice"><input type="checkbox" name="direct" value="1"${step.direct ? ' checked' : ''}> documented as passed on directly from the previous owner</label>
    <div class="hint">Leave it unticked when the source doesn't say so — a gap between owners stays visible (and is checked for 1933–1945).</div>
    <div class="row">
      <div class="field"><label for="pv-ended">Ended <span class="muted">(only if a source says so)</span></label><input id="pv-ended" name="ended" value="${v('ended')}" placeholder="date">
        <input name="ended_label" value="${v('ended_label')}" placeholder="label (optional)" aria-label="Ended label"></div>
      <div class="field"><label for="pv-label">Details</label><input id="pv-label" name="label" value="${v('label')}" placeholder="e.g. via Galerie Durand-Ruel, lot 23"></div>
      <div class="field"><label for="pv-cert">Certainty</label><select id="pv-cert" name="certainty">
        ${CERTAINTY.map((c) => html`<option${c === (step.certainty || 'attested') ? ' selected' : ''}>${c}</option>`)}</select></div>
    </div>
    <div class="hint">Without an end, the step lasts until the next owner's acquisition (shown as implied). Known only from one side:
      "26 March 1952 or later" (at the earliest), "1904-10-28 or earlier" (at the latest); between two dates: 1901/1904-10-28.</div>
    <div class="row">
      <div class="field"><label for="pv-price">Price</label><input id="pv-price" name="price" value="${v('price')}" placeholder="e.g. 18000" inputmode="decimal"></div>
      <div class="field"><label for="pv-cur">Currency</label><input id="pv-cur" name="price_currency" value="${v('price_currency')}" placeholder="CHF, USD, FRF …" list="pv-currencies" maxlength="3" autocomplete="off">
        <datalist id="pv-currencies">${['CHF', 'USD', 'EUR', 'GBP', 'FRF', 'DEM', 'RM', 'NOK', 'SEK', 'DKK', 'ITL', 'NLG', 'BEF', 'JPY'].filter((c) => c.length === 3).map((c) => html`<option>${c}</option>`)}</datalist></div>
      <div class="field"><label for="pv-pnote">Price note</label><input id="pv-pnote" name="price_note" value="${v('price_note')}" placeholder="e.g. ca., with two other works, insurance value"></div>
    </div>
    <div class="field"><label for="pv-notes">Notes</label><textarea class="md" id="pv-notes" name="notes_md" rows="2">${v('notes_md')}</textarea></div>
    <div class="field"><label for="pv-src">Sources</label><textarea id="pv-src" name="sources" rows="2">${(step.sources || []).join('\n')}</textarea><div class="hint">One per line.</div></div>
    <div class="actions"><button>${submit}</button></div></form>`;
}

// The "Provenance" section of an artwork's page: the chain in order, with the computed periods; between two steps
// "↓" (documented direct) or "⋮ gap" (not documented); reorder by dragging the handle (editor/sortable.js), edit, add.
// One <tbody> per step (its transfer line and its row), so a step moves as one. The implied lines (the artist first,
// a loan last — view provenance_chain) are shown but not stored: they change with the creator, the date, the loan.
const IMPLIED = { creation: 'implied — the creator and the date', loan: 'implied — “on loan” at the current institution' };
function ownerCell(s) {
  const one = (slug, type, name) => (slug ? html`<a href="/${BY_TYPE[type].folder}/${slug}">${name}</a>` : name);
  const co = (s.co_owners || []).map((c) => html` and ${one(c.slug, c.type, c.name)}`);
  return html`${s.role === 'estate' ? 'Estate of ' : ''}${s.owner_slug ? one(s.owner_slug, s.owner_type, s.owner_entity_name) : s.owner_label}${s.flag ? html` <span class="tag flagged" title="Provenance flag: ${s.flag}">⚑ flagged</span>` : ''}${co}
    ${s.owner_slug && s.owner_label ? html` <span class="muted">(${s.owner_label})</span>` : ''}
    ${s.role && s.role !== 'owner' && s.role !== 'estate' ? html` <span class="tag">${s.role}</span>` : ''}${s.not_sold ? html` <span class="tag">not sold</span>` : ''}`;
}
// Holders between 30 January 1933 and 8 May 1945 (or flagged): where to look them up. Lost Art takes the name in
// the link; Proveana (behind a bot check) and the ERR database are searched on their own pages — the name is shown.
const RESEARCH = [
  { name: 'Lost Art', title: 'German Lost Art Foundation: search and found reports', url: (q) => `https://www.lostart.de/en/search?term=${encodeURIComponent(q)}` },
  { name: 'Proveana', title: 'German Lost Art Foundation: people, dealers, collections and research results — search there for the name', url: () => 'https://www.proveana.de/en' },
  { name: 'ERR (Jeu de Paume)', title: 'Nazi looting in France and Belgium: the owners whose works were taken', url: () => 'https://errproject.org/jeudepaume/owner_list.php' },
  { name: 'Getty Provenance Index', title: 'sales, dealers’ stock books, collections', url: () => 'https://www.getty.edu/research/tools/provenance/search.html' },
];
function research(steps) {
  const seen = new Set();
  const who = steps.filter((s) => s.kind === 'step' && (s.nazi_era || s.flag)).map((s) => ({ name: s.owner_slug ? s.owner_entity_name : s.owner_label, s }))
    .filter((x) => x.name && !seen.has(x.name) && seen.add(x.name));
  if (!who.length) return '';
  return html`<details class="research"${steps.some((s) => s.flag) ? ' open' : ''}><summary><b>Research 1933–1945</b>
      <span class="muted small">— ${who.length} holder${who.length === 1 ? '' : 's'} in that period${steps.some((s) => s.flag) ? ' or flagged' : ''}</span></summary>
    <ul class="small">${who.map(({ name, s }) => html`<li><b>${name}</b>${s.period_label ? html` <span class="muted">(${s.period_label})</span>` : ''}${s.flag ? html` <span class="tag flagged">⚑ ${s.flag}</span>` : ''}:
      ${RESEARCH.map((r, i) => html`${i ? ' · ' : ''}<a href="${r.url(name)}" target="_blank" rel="noopener" title="${r.title}">${r.name} ↗</a>`)}</li>`)}</ul>
    <p class="muted small">Lost Art opens with the name searched; in the others, search for it there. Record what you find as a step's notes and source.</p></details>`;
}

function section({ e, steps, names, cites = {}, marker = null, back = '' }) {
  const stored = steps.filter((s) => s.kind === 'step');
  let n = 0;
  return html`<h2 id="provenance">Provenance</h2>
    ${steps.length ? html`<div class="table-wrap"><table class="provenance" data-sortable="/artworks/${e.slug}/provenance/order">${steps.map((s, i) => {
      const implied = s.kind !== 'step';
      if (!implied) n += 1;
      return html`
      <tbody${implied ? html` class="implied"` : html` class="sort-item" data-sort-id="${s.id}"`}>
      ${i > 0 ? html`<tr class="transfer muted small"><td></td><td></td><td colspan="6">${s.kind === 'loan' ? '⇢ lent'
        // custody (074): deposits, loans, consignments, auctions — beside the ownership, which goes on
        : s.kind === 'step' && !s.in_chain ? '⇢ held alongside the owner (the ownership goes on)'
        : html`${s.direct ? '↓ passed on directly' : '⋮ not documented as direct'}${s.via ? html` · via ${s.via}` : ''}`}</td></tr>` : ''}
      <tr><td class="drag-cell">${!implied && stored.length > 1 ? html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move step ${n}: drag, or arrow keys">⠿</button>` : ''}</td>
        <td>${implied ? '' : `${n}.`}</td>
        <td>${ownerCell(s)}</td>
        <td>${[methodLabel(s.method) !== 'unknown' && methodLabel(s.method), s.acquired_label].filter(Boolean).join(', ') || html`<span class="muted">undated</span>`}
          ${priceText(s) ? html`<div class="small">${priceText(s)}</div>` : ''}
          ${s.label ? html`<div class="muted small">${s.label}</div>` : ''}</td>
        <td>${s.location_slug ? html`<a href="/places/${s.location_slug}">${s.location_name}</a>` : ''}</td>
        <td>${s.period_label || ''}${END_BASIS[s.end_basis] ? html` <span class="tag ${s.end_basis}">${END_BASIS[s.end_basis]}</span>` : ''}
          ${s.certainty !== 'attested' ? html` <span class="muted">· ${s.certainty}</span>` : ''}
          ${implied ? html` <span class="tag implied">${IMPLIED[s.kind]}</span>` : ''}
          ${s.notes_md ? html`<div class="md small">${raw(renderMarkdown(s.notes_md, { names }))}</div>` : ''}</td>
        <td>${!implied && marker ? marker(cites[s.id], { provenance: s.id, label: `step ${n} (${s.owner_slug ? s.owner_name : s.owner_label})` }, back) : ''}</td>
        <td class="nowrap">${implied ? '' : html`<a href="/provenance/${s.id}/edit">edit</a>`}</td></tr></tbody>`;
    })}</table></div>
      ${stored.length > 1 ? html`<p class="muted small">Drag ⠿ to change the order — the periods are recomputed.</p>` : ''}
      ${research(steps)}`
    : html`<p class="muted">None yet. The owners in order, as the sources record them: when each acquired the work and how.</p>`}
    <details><summary><b>+ Add provenance step</b></summary>${form({ action: `/artworks/${e.slug}/provenance`, submit: 'Add' })}</details>`;
}

module.exports = { ProvenanceError, METHODS, ROLES, addCommission, fromForm, byId, formValues, add, update, move, reorder, remove, read, form, section, saveCoOwners, priceText };
