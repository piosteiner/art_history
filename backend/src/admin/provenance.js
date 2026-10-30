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
const { stepList } = require('./provenance-records');
const autocreate = require('./autocreate');

class ProvenanceError extends Error {}

const METHODS = ['creation', 'commission', 'inheritance', 'purchase', 'auction', 'gift', 'bequest', 'exchange', 'transfer',
  'confiscation', 'theft', 'forced_sale', 'forced_gift', 'restitution', 'settlement', 'claim', 'dissolution', 'find', 'partage', 'spoils_of_war', 'in_lieu', 'unknown'];
const CERTAINTY = ['attested', 'probable', 'possible', 'disputed'];
const ROLES = ['owner', 'dealer', 'estate', 'publisher', 'agent', 'custodian', 'foundry', 'trustee', 'possessor', 'event'];
const ROLE_TEXT = { owner: 'owner', dealer: 'dealer', agent: 'agent — on consignment, auction: held, not owned', estate: 'estate of the owner',
  custodian: 'custodian — held without owning (deposit, loan)', publisher: 'publisher — of an edition (prints)',
  possessor: 'possessor — held without good title: seized, looted, stolen, or received from those who took it (the owner keeps the title)',
  foundry: 'foundry — cast and held it', trustee: 'trustee — held in trust or as security (Treuhand, Sicherungsübereignung)',
  event: 'event — no holder: a claim, a settlement between others, a collection dissolved' };
// 077: further places of a step, numbers of a step (the kinds of provenance_number_kinds — the same list)
const PLACE_SLOTS = 3;
const NUMBER_SLOTS = 4;
const NUMBER_KINDS = [['lot', 'lot'], ['stock', 'dealer’s stock no.'], ['inventory', 'inventory no.'], ['catalogue', 'catalogue no.'],
  ['ek', '“Entartete Kunst” no. (EK)'], ['err', 'ERR no.'], ['munich', 'Munich Central Collecting Point no.'], ['linz', 'Linz no.'],
  ['aussee', 'Alt-Aussee no.'], ['lugt', 'Lugt (collector’s mark)'], ['other', 'other number']];
const CO_TYPES = ['artist', 'person', 'institution'];
const CO_ARC = { artist: 'owner_artist_id', person: 'owner_person_id', institution: 'owner_institution_id' };
const CO_SLOTS = 3;
const OWNER_TYPES = ['artist', 'person', 'institution', 'place'];
const ARC = { artist: 'owner_artist_id', person: 'owner_person_id', institution: 'owner_institution_id', place: 'owner_place_id' };
const COLS = ['owner_artist_id', 'owner_person_id', 'owner_institution_id', 'owner_place_id', 'owner_label',
  'acquired', 'acquired_label', 'ended', 'ended_label', 'method', 'direct', 'location_id', 'label', 'certainty', 'notes_md', 'metadata',
  'role', 'price', 'price_currency', 'price_note', 'not_sold', 'event_id', 'alternative_to', 'exchanged_for_artwork_id', 'exchanged_for_text',
  'check_after'];
const CASTS = { acquired: '::daterange', ended: '::daterange', method: '::acquisition_method', certainty: '::certainty', metadata: '::jsonb',
  role: '::holder_role', price: '::numeric', check_after: '::date' };
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
const METHOD_WORDS = { forced_sale: 'forced sale', forced_gift: 'forced gift', spoils_of_war: 'spoils of war', in_lieu: 'in lieu of tax', partage: 'partage of finds' };
const methodLabel = (m) => METHOD_WORDS[m] || m;
const METHOD_OPTION = { settlement: 'settlement — an agreement with claimants (073)', transfer: 'transfer — Übertragung, Übernahme (to a foundation …)',
  theft: 'theft — stolen (a possessor step: the owner keeps the title; its end = recovered)', claim: 'claim — raised (an event)',
  dissolution: 'dissolution — a collection dissolved, a firm wound up (an event)',
  forced_gift: 'forced gift — given under duress, no price (121)', find: 'find — found or dug up: a chance find, an excavation (120)', partage: 'partage — the division of excavation finds (120)',
  spoils_of_war: 'spoils of war — taken in war, or a war contribution under a treaty (120)', in_lieu: 'in lieu — accepted in payment of a tax: dation (120)' };
const END_BASIS = {
  recorded: null,
  implied: 'end implied by the next acquisition',
  ongoing: 'ongoing — the current holder',
  unknown: 'end unknown',
};

const today = () => new Date().toISOString().slice(0, 10);
// "[2026-11-18,2026-11-19)" → { from: '2026-11-18', day: '2026-11-18' } — its first and last day (open end: the first)
function lastDay(range) {
  const m = /^[[(](\d{4,}-\d{2}-\d{2})?,(\d{4,}-\d{2}-\d{2})?([\])])$/.exec(String(range || ''));
  if (!m || !m[1]) return null;
  if (!m[2]) return { from: m[1], day: m[1] };
  const end = new Date(`${m[2]}T00:00:00Z`);
  if (m[3] === ')') end.setUTCDate(end.getUTCDate() - 1);
  return { from: m[1], day: end.toISOString().slice(0, 10) };
}

// "new:person:Name" from the owner pickers' "+ New person …": created with the step, flagged from the artwork
// (autocreate.quickCreate, via 'provenance'). → { type, id } | null when the value isn't such a request
async function quickCreate(db, value, ctx) {
  try {
    return await autocreate.quickCreate(db, value, { types: CO_TYPES, from: ctx.artworkId ? { type: 'artwork', id: ctx.artworkId } : null,
      userId: ctx.userId, via: 'provenance' });
  } catch (err) {
    throw err instanceof autocreate.QuickError ? new ProvenanceError(err.message) : err;
  }
}

// Form body → column values (COLS order). Owner "type/slug" and place slug are looked up; throws ProvenanceError.
// ctx: { artworkId, userId } — the artwork a quick-added owner is flagged as created from.
async function fromForm(db, body, keepMetadata = {}, ctx = {}) {
  const text = (k) => String(body[k] ?? '').replace(/\r\n/g, '\n').trim() || null;
  const v = Object.fromEntries(COLS.map((c) => [c, null]));
  const owner = text('owner');
  const quick = owner && await quickCreate(db, owner, ctx);
  if (quick) v[ARC[quick.type]] = quick.id;
  else if (owner) {
    const m = /^([a-z]+)\/([a-z0-9-]+)$/.exec(owner);
    if (!m || !OWNER_TYPES.includes(m[1])) throw new ProvenanceError('Owner: pick an artist, person, institution or place from the suggestions — or leave it empty and describe the owner.');
    const id = (await db.query('SELECT entity_id($1, $2) AS id', [m[1], m[2]])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Owner: ${owner} does not exist.`);
    v[ARC[m[1]]] = id;
  }
  v.owner_label = text('owner_label');
  const role = ROLES.includes(body.role) ? body.role : 'owner';
  if (!owner && !v.owner_label && !(role === 'event' && text('label'))) {
    throw new ProvenanceError(role === 'event' ? 'An event: describe it under "Details" (e.g. "settlement between the heirs of Jakob Goldschmidt and Elsa Essberger").'
      : 'Owner: pick an entry or describe the owner (e.g. "Private collection, Paris").');
  }
  for (const key of ['acquired', 'ended']) {
    let d = null;
    try { d = parseFuzzyDate(text(key)); } catch (err) { throw new ProvenanceError(`${key === 'acquired' ? 'Acquired' : 'Ended'}: ${err.message}`); }
    // a date after today is planned (096): an auction announced, a gift promised — check after its last day
    const last = lastDay(d && d.range);
    if (last && last.from > today()) v.check_after = [v.check_after, last.day].filter(Boolean).sort().pop();
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
  v.role = role;
  // an auction or consignment that ended without a sale (074): only for agents
  v.not_sold = v.role === 'agent' && body.not_sold === '1';
  // the event it belongs to (077): an auction, an exhibition, a seizure — a slug from the suggestions
  const event = text('event');
  if (event) {
    const id = (await db.query("SELECT entity_id('event', $1) AS id", [event])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Event: "${event}" does not exist — pick one from the suggestions (or create it first).`);
    v.event_id = id;
  }
  // another source's reading of a step (084): the step it is an alternative to (the trigger checks the artwork)
  v.alternative_to = /^\d+$/.test(String(body.alternative_to || '')) ? Number(body.alternative_to) : null;
  // what was given in exchange (084): an artwork of ours and/or words
  const exchanged = text('exchanged_for');
  if (exchanged) {
    const id = (await db.query("SELECT entity_id('artwork', $1) AS id", [exchanged])).rows[0].id;
    if (id === null) throw new ProvenanceError(`Exchanged for: "${exchanged}" is not an artwork of ours — pick one from the suggestions, or describe it in words.`);
    v.exchanged_for_artwork_id = id;
  }
  v.exchanged_for_text = text('exchanged_for_text');
  // further places, in order (077): where the holder took it — "Köln, Berlin & Genf"
  const places = [];
  for (let i = 1; i <= PLACE_SLOTS; i += 1) {
    const slug = text(`place_${i}`);
    if (!slug) continue;
    const id = (await db.query('SELECT id FROM places WHERE slug = $1', [slug])).rows[0];
    if (!id) throw new ProvenanceError(`Further place ${i}: "${slug}" does not exist — pick one from the suggestions.`);
    let d = null;
    try { d = parseFuzzyDate(text(`place_date_${i}`)); } catch (err) { throw new ProvenanceError(`Further place ${i}, date: ${err.message}`); }
    places.push({ place_id: id.id, period: d && d.range, period_label: d && d.label });
  }
  // numbers of the step (077): lot, stock no., EK, ERR, Munich … — searchable
  const numbers = [];
  for (let i = 1; i <= NUMBER_SLOTS; i += 1) {
    const number = text(`number_${i}`);
    if (!number) continue;
    const kind = NUMBER_KINDS.some(([k]) => k === body[`number_kind_${i}`]) ? body[`number_kind_${i}`] : 'other';
    numbers.push({ kind, number });
  }
  v.price = priceOf(body.price);
  v.price_currency = text('price_currency') ? text('price_currency').toUpperCase() : null;
  if (v.price_currency && !/^[A-Z]{2,4}$/.test(v.price_currency)) throw new ProvenanceError('Currency: the code — ISO 4217 (CHF, USD, FRF, GBP, DEM) or a historical one without (RM for Reichsmark, AFRF for French francs before 1960).');
  if (v.price !== null && !v.price_currency) throw new ProvenanceError('Price: which currency? (e.g. FRF, USD, CHF)');
  if (v.price === null) v.price_currency = null;
  v.price_note = v.price === null ? null : text('price_note');
  // joint owners besides the first (063): artist, person or institution — each its own "owned by"
  const coOwners = [];
  for (let i = 1; i <= CO_SLOTS; i += 1) {
    const ref = text(`co_owner_${i}`);
    if (!ref) continue;
    const quickCo = await quickCreate(db, ref, ctx);
    if (quickCo) { coOwners.push(quickCo); continue; }
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
  return Object.assign(COLS.map((c) => v[c]), { sources, coOwners, places, numbers });
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
    certainty: 'attested', metadata: '{}', role: 'owner', not_sold: false, event_id: null, alternative_to: null,
    exchanged_for_artwork_id: null, exchanged_for_text: null });
  return add(db, artworkId, Object.assign(COLS.map((c) => v[c]), { coOwners: [] }), { first: true });
}

// The step's further places and numbers (077), as posted: replaced as a whole
async function saveExtras(db, stepId, { places, numbers } = {}) {
  if (places) {
    await db.query('DELETE FROM provenance_places WHERE provenance_id = $1', [stepId]);
    for (const [i, pl] of places.entries()) {
      await db.query('INSERT INTO provenance_places (provenance_id, position, place_id, period, period_label) VALUES ($1, $2, $3, $4::daterange, $5)',
        [stepId, i, pl.place_id, pl.period, pl.period_label]);
    }
  }
  if (numbers) {
    await db.query('DELETE FROM provenance_numbers WHERE provenance_id = $1', [stepId]);
    for (const [i, n] of numbers.entries()) {
      await db.query('INSERT INTO provenance_numbers (provenance_id, kind, number, position) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [stepId, n.kind, n.number, i]);
    }
  }
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
             JOIN entity_index o ON (o.type, o.id) = (c.owner_type, c.owner_id) WHERE c.provenance_id = p.id) AS co_owner_refs,
           (SELECT slug FROM events WHERE id = p.event_id) AS event_slug,
           (SELECT slug FROM artworks WHERE id = p.exchanged_for_artwork_id) AS exchanged_for_slug,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', l.slug, 'period', x.period::text, 'period_label', x.period_label) ORDER BY x.position), '[]')
              FROM provenance_places x JOIN places l ON l.id = x.place_id WHERE x.provenance_id = p.id) AS further_places,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'number', n.number) ORDER BY n.position), '[]')
              FROM provenance_numbers n WHERE n.provenance_id = p.id) AS step_numbers
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
    price_currency: step.price_currency || '', price_note: step.price_note || '', not_sold: !!step.not_sold, event: step.event_slug || '',
    alternative_to: step.alternative_to ? String(step.alternative_to) : '', exchanged_for: step.exchanged_for_slug || '',
    exchanged_for_text: step.exchanged_for_text || '',
    ...Object.fromEntries((step.further_places || []).flatMap((pl, i) => {
      const d = dateToDoc(pl.period, pl.period_label, false);
      return [[`place_${i + 1}`, pl.slug], [`place_date_${i + 1}`, d.value || '']];
    })),
    ...Object.fromEntries((step.step_numbers || []).flatMap((n, i) => [[`number_kind_${i + 1}`, n.kind], [`number_${i + 1}`, n.number]])),
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
  await saveExtras(db, rows[0].id, values);
  return rows[0].id;
}

async function update(db, id, values) {
  await db.query(`UPDATE provenance SET ${COLS.map((c, i) => `${c} = $${i + 2}${CASTS[c] || ''}`).join(', ')} WHERE id = $1`, [id, ...values]);
  await saveCoOwners(db, id, values.coOwners);
  await saveExtras(db, id, values);
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
  // the main steps in order, then the alternative readings (084) — they stay beside their step, outside the order
  return (await db.query('SELECT id, alternative_to IS NOT NULL AS alt FROM provenance WHERE artwork_id = $1 ORDER BY alternative_to IS NOT NULL, position, id', [artworkId])).rows;
}

const mainIds = (rows) => rows.filter((r) => !r.alt).map((r) => r.id);
const altIds = (rows) => rows.filter((r) => r.alt).map((r) => r.id);
async function move(db, step, dir) {
  const rows = await orderedIds(db, step.artwork_id);
  const ids = mainIds(rows);
  const at = ids.indexOf(step.id);
  const to = dir === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(at, 1));
  await renumber(db, step.artwork_id, [...ids, ...altIds(rows)]);
}

// A new order from the page (drag and drop): the same steps, in the order given — else nothing changes.
async function reorder(db, artworkId, ids) {
  const rows = await orderedIds(db, artworkId);
  const now = mainIds(rows);
  const want = ids.map(Number);
  if (want.length !== now.length || [...want].sort((a, b) => a - b).join() !== [...now].sort((a, b) => a - b).join()) {
    throw new ProvenanceError('The provenance changed meanwhile — reload the page and try again.');
  }
  await renumber(db, artworkId, [...want, ...altIds(rows)]);
}

async function remove(db, step) {
  await db.query('DELETE FROM provenance WHERE id = $1', [step.id]);
  const rows = await orderedIds(db, step.artwork_id);
  await renumber(db, step.artwork_id, [...mainIds(rows), ...altIds(rows)]);
}

// The chain for the artwork page (view provenance_chain): the recorded steps with their computed periods, the implied
// first line (the artist) and last line (a loan); joint owners with each step.
async function read(db, artworkId) {
  return (await db.query(`
    SELECT p.*, o.slug AS owner_slug, o.name AS owner_entity_name, l.slug AS location_slug, l.name AS location_name, pv.metadata,
           pv.check_after::text AS check_after, pv.check_after < current_date AS check_due,
           p.period && daterange('1933-01-30', '1945-05-09') AS nazi_era, holder_flag(p.owner_type, p.owner_id) AS flag,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('type', c.owner_type, 'slug', e.slug, 'name', e.name) ORDER BY c.position), '[]')
              FROM provenance_co_owners_x c JOIN entity_index e ON (e.type, e.id) = (c.owner_type, c.owner_id)
             WHERE c.provenance_id = p.id) AS co_owners,
           (SELECT jsonb_build_object('slug', ev.slug, 'name', ev.name) FROM events ev WHERE ev.id = pv.event_id) AS event,
           CASE WHEN pv.exchanged_for_artwork_id IS NOT NULL OR pv.exchanged_for_text IS NOT NULL THEN jsonb_build_object(
             'slug', (SELECT slug FROM artworks WHERE id = pv.exchanged_for_artwork_id), 'title', (SELECT title FROM artworks WHERE id = pv.exchanged_for_artwork_id),
             'text', pv.exchanged_for_text) END AS exchanged_for,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', l.slug, 'name', l.name, 'period_label', x.period_label) ORDER BY x.position), '[]')
              FROM provenance_places x JOIN places l ON l.id = x.place_id WHERE x.provenance_id = p.id) AS further_places,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', k.label, 'number', n.number) ORDER BY n.position), '[]')
              FROM provenance_numbers n JOIN provenance_number_kinds k ON k.code = n.kind WHERE n.provenance_id = p.id) AS step_numbers,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'detail', i.detail) ORDER BY i.kind), '[]')
              FROM provenance_inferences i WHERE i.artwork_id = $1 AND i.provenance_id = p.id) AS inferences,  -- by work: reaches into the view (126)
           (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'date_label', r.date_label, 'room', r.room, 'number', r.number,
                     'number_certainty', r.number_certainty, 'document', r.document, 'certainty', r.certainty, 'note', r.note,
                     'place_slug', l.slug, 'place_name', l.name) ORDER BY lower(r.date) NULLS LAST, r.position), '[]')
              FROM provenance_records r LEFT JOIN places l ON l.id = r.place_id WHERE r.provenance_id = p.id) AS records
    FROM provenance_chain p LEFT JOIN provenance pv ON pv.id = p.id
    LEFT JOIN entity_index o ON (o.type, o.id) = (p.owner_type, p.owner_id)
    LEFT JOIN places l ON l.id = p.location_id
    WHERE p.artwork_id = $1 ORDER BY p.position`, [artworkId])).rows;
}

// Other sources' readings of steps (084): not in the chain — read from the table, grouped by the step they belong to
async function readAlternatives(db, artworkId) {
  const { rows } = await db.query(`
    SELECT p.id, p.alternative_to, p.role::text AS role, p.method::text AS method, p.acquired_label, p.ended_label, p.label,
           p.certainty::text AS certainty, p.notes_md, p.owner_label, o.slug AS owner_slug, o.name AS owner_entity_name, o.type::text AS owner_type
    FROM provenance p
    LEFT JOIN entity_index o ON (o.type, o.id) = (CASE WHEN p.owner_artist_id IS NOT NULL THEN 'artist' WHEN p.owner_person_id IS NOT NULL THEN 'person'
                                                       WHEN p.owner_institution_id IS NOT NULL THEN 'institution' WHEN p.owner_place_id IS NOT NULL THEN 'place' END::entity_type,
                                                  coalesce(p.owner_artist_id, p.owner_person_id, p.owner_institution_id, p.owner_place_id))
    WHERE p.artwork_id = $1 AND p.alternative_to IS NOT NULL ORDER BY p.position`, [artworkId]);
  const by = new Map();
  for (const r of rows) by.set(r.alternative_to, [...(by.get(r.alternative_to) || []), r]);
  return by;
}

// choices: the artwork's main steps [{id, label}] — for "another reading of"
function form({ action, step = {}, submit, choices = [] }) {
  const v = (k) => step[k] ?? '';
  return html`<form method="post" action="${action}" class="form provenance-form">
    <select id="pv-owner-type" hidden><option data-object-types="${OWNER_TYPES.join(',')}" selected></option></select>
    <div class="row">
      <div class="field"><label for="pv-owner">Owner</label>
        <input id="pv-owner" name="owner" value="${v('owner')}" placeholder="start typing a name" autocomplete="off" data-lookup-from="pv-owner-type" data-quick-new="person,institution,artist">
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
        ${Array.from({ length: CO_SLOTS }, (_, i) => html`<input name="co_owner_${i + 1}" value="${v(`co_owner_${i + 1}`)}" placeholder="and … (start typing)" autocomplete="off" data-lookup-from="pv-co-type" data-quick-new="person,institution,artist" aria-label="joint owner ${i + 1}">`)}
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
      <div class="field"><label for="pv-cur">Currency</label><input id="pv-cur" name="price_currency" value="${v('price_currency')}" placeholder="CHF, USD, FRF, RM …" list="pv-currencies" maxlength="4" autocomplete="off">
        <datalist id="pv-currencies">${['CHF', 'USD', 'EUR', 'GBP', 'AFRF', 'FRF', 'DEM', 'RM', 'ATS', 'NOK', 'SEK', 'DKK', 'ITL', 'NLG', 'BEF', 'JPY'].map((c) => html`<option>${c}</option>`)}</datalist></div>
      <div class="field"><label for="pv-pnote">Price note</label><input id="pv-pnote" name="price_note" value="${v('price_note')}" placeholder="e.g. ca., with two other works, insurance value"></div>
    </div>
    <div class="row">
      <div class="field"><label for="pv-event">Event</label><input id="pv-event" name="event" value="${v('event')}" placeholder="the auction, exhibition, seizure …" autocomplete="off" data-lookup="event">
        <div class="hint">An entry of the Events — e.g. the sale it was bought at, the exhibition it was bought from.</div></div>
      <div class="field"><label>Further places <span class="muted">(after the place above, in order)</span></label>
        ${Array.from({ length: PLACE_SLOTS }, (_, i) => html`<div class="field-pair"><input name="place_${i + 1}" value="${v(`place_${i + 1}`)}" placeholder="then in …" autocomplete="off" data-lookup="place" aria-label="further place ${i + 1}">
          <input name="place_date_${i + 1}" value="${v(`place_date_${i + 1}`)}" placeholder="from when (optional)" aria-label="further place ${i + 1}: date"></div>`)}
        <div class="hint">Where the holder took it: “Köln, Berlin & Genf” — an emigration is a route on the map.</div></div>
    </div>
    <div class="field"><label>Numbers <span class="muted">(searchable)</span></label>
      ${Array.from({ length: NUMBER_SLOTS }, (_, i) => html`<div class="field-pair"><select name="number_kind_${i + 1}" aria-label="kind of number ${i + 1}">
          ${NUMBER_KINDS.map(([k, label]) => html`<option value="${k}"${k === (v(`number_kind_${i + 1}`) || 'lot') ? ' selected' : ''}>${label}</option>`)}</select>
        <input name="number_${i + 1}" value="${v(`number_${i + 1}`)}" placeholder="e.g. 107 · 4317 · EK 5363" aria-label="number ${i + 1}"></div>`)}
      <div class="hint">Lot, dealer's stock number, “Entartete Kunst”, ERR, Munich Central Collecting Point, Linz, Alt-Aussee — found again under Provenance numbers.</div></div>
    <div class="row">
      <div class="field"><label for="pv-exchanged">Exchanged for</label><input id="pv-exchanged" name="exchanged_for" value="${v('exchanged_for')}" placeholder="an artwork of ours …" autocomplete="off" data-lookup="artwork">
        <input name="exchanged_for_text" value="${v('exchanged_for_text')}" placeholder="… or in words: a Florentine tondo" aria-label="exchanged for, in words">
        <div class="hint">What the holder gave for it (method exchange; with a price for a part exchange).</div></div>
      <div class="field"><label for="pv-alt">Another reading of</label><select id="pv-alt" name="alternative_to">
          <option value="">— no: a step of the provenance</option>
          ${choices.filter((c) => String(c.id) !== String(step.id || '')).map((c) => html`<option value="${c.id}"${String(c.id) === String(v('alternative_to')) ? ' selected' : ''}>${c.label}</option>`)}</select>
        <div class="hint">When sources contradict each other: this step is another source's version of the one chosen — shown beside it, with its own sources, left out of the chain and the map.</div></div>
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
    ${s.role === 'possessor' ? html` <span class="tag flagged" title="held without good title — the owner keeps the title">possessor, without title</span>`
      : s.role && s.role !== 'owner' && s.role !== 'estate' ? html` <span class="tag">${s.role}</span>` : ''}${s.not_sold ? html` <span class="tag">not sold</span>` : ''}${s.method === 'theft' ? html` <span class="tag flagged">${s.ended ? 'stolen — recovered' : 'stolen'}</span>` : ''}`;
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

// Where the provenance is silent (078): the time since the creation as documented / presumed / gap stretches.
async function coverage(db, artworkId) {
  const { rows } = await db.query(`SELECT kind, lower(period)::text AS from_date, upper(period)::text AS to_date,
      extract(year FROM lower(period))::int AS from_year, extract(year FROM upper(period) - 1)::int AS to_year,
      (upper(period) - lower(period)) AS days, in_1933_1945, before_name, after_name, coalesce(candidates, '{}') AS candidates,
      before_position, after_position,
      -- the line it goes after (079): the last step between its owners dated before it — e.g. an unsold auction
      CASE WHEN kind = 'gap' AND before_position IS NOT NULL THEN provenance_gap_anchor($1, before_position, after_position, period) END AS show_after
      FROM provenance_coverage($1) ORDER BY period`, [artworkId]);
  return rows;
}
// What became of it (103) and its cause (171), for the bar's end and the table's closing line; null while extant.
async function fate(db, artworkId) {
  const { rows } = await db.query(`SELECT fate::text AS status, fate_date_label AS date_label, lower(fate_date)::text AS from_date,
      fate_note AS note, fate_event(id) AS event FROM artworks WHERE id = $1 AND fate IS NOT NULL`, [artworkId]);
  return rows[0] || null;
}
const FATE_WORD = { destroyed: 'Destroyed', partly_destroyed: 'Partly destroyed', lost: 'Lost' };
// The closing line: destroyed — the end of the provenance; lost — whereabouts unknown; partly destroyed — at its time
function fateRow(f, slug) {
  return html`<tbody class="fate fate-${f.status}"><tr><td></td><td></td><td colspan="6">
    <b>${FATE_WORD[f.status]}</b>${f.date_label ? html` ${f.status === 'lost' ? 'since ' : ''}${f.date_label}` : ''}${f.note ? html` — ${f.note}` : ''}${f.event ? html` · <a href="/events/${f.event.slug}">${f.event.name}</a>` : ''}
    <span class="muted small">${f.status === 'destroyed' ? '— the end of its provenance.' : f.status === 'lost' ? '— whereabouts unknown since; the provenance ends here until it reappears.' : '— the parts go on.'}</span>
    ${f.event ? '' : html` <span class="muted small">(link an event that <i>concerns</i> the work at that date to name the cause)</span>`}
    <a class="small" href="/artworks/${slug}/edit#f-fate">edit the fate</a></td></tr></tbody>`;
}
const ERA = ['1933-01-30', '1945-05-09'];
const years = (g) => (g.from_year === g.to_year ? `${g.from_year}` : `${g.from_year}–${g.to_year}`);
const duration = (days) => (days >= 365 ? `${Math.round(days / 365.25)} year${Math.round(days / 365.25) === 1 ? '' : 's'}` : `${Math.max(1, Math.round(days / 30.4))} months`);

// A bar from the creation to today: documented (solid), presumed (hatched), gaps (open, red edge); 1933–1945 shaded.
// A destroyed or lost work's ends with its destruction or loss (170, 173): "destroyed May 1945" instead of "today".
function coverageBar(segs, f = null) {
  if (!segs.length) return '';
  const end = f && f.status !== 'partly_destroyed' ? `${f.status}${f.date_label ? ` ${f.date_label}` : ''}` : 'today';
  const t = (d) => Date.parse(d);
  const [t0, t1] = [t(segs[0].from_date), t(segs[segs.length - 1].to_date)];
  const x = (d) => Math.max(0, Math.min(1000, ((t(d) - t0) / (t1 - t0)) * 1000));
  const documented = segs.filter((g) => g.kind === 'documented').reduce((n, g) => n + g.days, 0);
  const total = segs.reduce((n, g) => n + g.days, 0);
  const eraGap = segs.filter((g) => g.kind === 'gap' && g.in_1933_1945);
  return html`<figure class="coverage">
    <svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label="Provenance coverage from ${segs[0].from_year} to ${end === 'today' ? 'today' : `when it was ${end}`}">
      <defs><pattern id="cov-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" class="cov-presumed"></rect></pattern></defs>
      ${t(ERA[1]) > t0 ? html`<rect class="cov-era" x="${x(ERA[0])}" y="0" width="${x(ERA[1]) - x(ERA[0])}" height="28"><title>1933–1945</title></rect>` : ''}
      ${segs.map((g) => html`<rect class="cov-${g.kind === 'presumed' ? 'presumed-seg' : g.kind}" x="${x(g.from_date)}" y="6" width="${Math.max(1, x(g.to_date) - x(g.from_date))}" height="16"
        ${g.kind === 'presumed' ? html` fill="url(#cov-hatch)"` : ''}><title>${years(g)}: ${g.kind === 'gap' ? `no holder known${g.before_name ? ` — after ${g.before_name}` : ''}${g.after_name ? `, before ${g.after_name}` : ''}` : g.kind}</title></rect>`)}
    </svg>
    <figcaption class="small"><span>${segs[0].from_year}</span> <span class="muted">— ${Math.round((100 * documented) / total)}% documented ·
      ${segs.filter((g) => g.kind === 'gap').length} gap${segs.filter((g) => g.kind === 'gap').length === 1 ? '' : 's'}${eraGap.length ? html` · <b class="cov-warn">${eraGap.length} touching 1933–1945</b>` : ''} —</span>
      <span>${end}</span>
      <span class="cov-legend muted"><i class="cov-documented"></i> documented <i class="cov-presumed-key"></i> presumed <i class="cov-gap"></i> no holder known <i class="cov-era"></i> 1933–1945</span></figcaption>
  </figure>`;
}
// A gap as a line of the table, after the step it follows (show_after: the last step dated before it, 079)
function gapRow(g) {
  return html`<tbody class="gap"><tr class="gap-row"><td></td><td></td><td colspan="6">
    <b>Gap ${years(g)}</b> <span class="muted">(${duration(g.days)})</span>${g.in_1933_1945 ? html` <span class="tag era">touches 1933–1945</span>` : ''} — no holder known.
    ${g.candidates.length ? html`<span class="muted">Undated, possibly then: ${g.candidates.join(', ')}.</span>` : ''}</td></tr></tbody>`;
}

// the main steps as choices for "another reading of" — numbered as in the table
// A planned step (096): marked until its day; after it, the question whether it happened — "Went as planned" or edit it.
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function plannedMark(s, back = '') {
  if (!s.check_due) return html` <span class="tag planned" title="dated after today: you will be asked after this day whether it happened">planned · check after ${dayText(s.check_after)}</span>`;
  return html`<div class="planned-due small">⏰ Planned for ${dayText(s.check_after)} — did it happen?
    <form method="post" action="/provenance/${s.id}/confirm${back}" class="inline"><button class="small">Went as planned</button></form>
    or <a href="/provenance/${s.id}/edit">edit the step</a></div>`;
}

function stepChoices(steps) {
  let n = 0;
  return steps.filter((s) => s.kind === 'step').map((s) => { n += 1; return { id: s.id, label: `${n}. ${s.owner_slug ? s.owner_entity_name : s.owner_label || s.label || ''} ${s.acquired_label || ''}`.trim() }; });
}

function section({ e, steps, names, cites = {}, marker = null, back = '', gaps = null, alternatives = new Map(), fate: f = null }) {
  const stored = steps.filter((s) => s.kind === 'step');
  let n = 0;
  // the closing line after the last step; partly destroyed after the last step that began by then
  const startOf = (s) => (/^[[(](\d{4}-\d\d-\d\d)/.exec(s.period || '') || [])[1] || '';
  // fragmentary (partly destroyed at an unknown time) has no place in the chain — the facts say it
  const fateAt = !f || (f.status === 'partly_destroyed' && !f.from_date) ? -1 : f.status !== 'partly_destroyed' ? steps.length - 1
    : steps.reduce((at, s, i) => (startOf(s) && startOf(s) <= f.from_date ? i : at), steps.length - 1);
  return html`<h2 id="provenance">Provenance</h2>
    ${gaps && gaps.length ? coverageBar(gaps, f) : ''}
    ${steps.length ? html`<div class="table-wrap"><table class="provenance" data-sortable="/artworks/${e.slug}/provenance/order">${(gaps || []).filter((g) => g.kind === 'gap' && g.before_position === null).map(gapRow)}${steps.map((s, i) => {
      const implied = s.kind !== 'step';
      if (!implied) n += 1;
      return html`
      <tbody${implied ? html` class="implied"` : html` class="sort-item" data-sort-id="${s.id}"`}>
      ${i > 0 ? html`<tr class="transfer muted small"><td></td><td></td><td colspan="6">${s.kind === 'loan' ? '⇢ lent'
        // custody (074): deposits, loans, consignments, auctions — beside the ownership, which goes on
        : s.kind === 'step' && s.role === 'event' ? '• an event — no one took it over'
        : s.kind === 'step' && s.role === 'possessor' ? '⚠ taken from its owner — held without title; the ownership goes on'
        : s.kind === 'step' && !s.in_chain ? '⇢ held alongside the owner (the ownership goes on)'
        : html`${s.direct ? '↓ passed on directly' : '⋮ not documented as direct'}${s.via ? html` · via ${s.via}` : ''}`}</td></tr>` : ''}
      <tr><td class="drag-cell">${!implied && stored.length > 1 ? html`<button type="button" class="drag-handle" title="Drag to reorder (or focus and use ↑ ↓)" aria-label="Move step ${n}: drag, or arrow keys">⠿</button>` : ''}</td>
        <td>${implied ? '' : `${n}.`}</td>
        <td>${ownerCell(s)}</td>
        <td>${[methodLabel(s.method) !== 'unknown' && methodLabel(s.method), s.acquired_label].filter(Boolean).join(', ') || html`<span class="muted">undated</span>`}
          ${priceText(s) ? html`<div class="small">${priceText(s)}</div>` : ''}
          ${s.label ? html`<div class="muted small">${s.label}</div>` : ''}
          ${s.event ? html`<div class="small">at <a href="/events/${s.event.slug}">${s.event.name}</a></div>` : ''}
          ${(s.inferences || []).map((i) => html`<div class="small inference" title="derived from the dates and places (biography × provenance)"><span class="tag">derived</span> ${i.detail}</div>`)}
          ${s.exchanged_for ? html`<div class="small">exchanged for ${s.exchanged_for.slug ? html`<a href="/artworks/${s.exchanged_for.slug}">${s.exchanged_for.title}</a>` : ''}${s.exchanged_for.slug && s.exchanged_for.text ? ' — ' : ''}${s.exchanged_for.text || ''}</div>` : ''}
          ${(s.step_numbers || []).length ? html`<div class="small">${s.step_numbers.map((n, i) => html`${i ? ' · ' : ''}${n.kind} <a href="/provenance/numbers?q=${encodeURIComponent(n.number)}">${n.number}</a>`)}</div>` : ''}
          ${stepList(s.records)}</td>
        <td>${s.location_slug ? html`<a href="/places/${s.location_slug}">${s.location_name}</a>` : ''}${(s.further_places || []).map((pl) => html` → <a href="/places/${pl.slug}">${pl.name}</a>${pl.period_label ? html` <span class="muted small">(${pl.period_label})</span>` : ''}`)}</td>
        <td>${s.period_label || ''}${END_BASIS[s.end_basis] ? html` <span class="tag ${s.end_basis}">${END_BASIS[s.end_basis]}</span>` : ''}
          ${s.certainty !== 'attested' ? html` <span class="muted">· ${s.certainty}</span>` : ''}
          ${implied ? html` <span class="tag implied">${IMPLIED[s.kind]}</span>` : ''}
          ${!implied && s.check_after ? plannedMark(s) : ''}
          ${s.notes_md ? html`<div class="md small">${raw(renderMarkdown(s.notes_md, { names }))}</div>` : ''}</td>
        <td>${!implied && marker ? marker(cites[s.id], { provenance: s.id, label: `step ${n} (${s.owner_slug ? s.owner_name : s.owner_label})` }, back) : ''}</td>
        <td class="nowrap">${implied ? '' : html`<a href="/provenance/${s.id}/edit">edit</a>`}</td></tr></tbody>
      ${(alternatives.get(s.id) || []).map((a) => html`<tbody class="alternative"><tr><td></td><td class="muted">↳</td>
        <td colspan="4"><span class="tag">another reading</span> ${ownerCell(a)} — ${[methodLabel(a.method) !== 'unknown' && methodLabel(a.method), [a.acquired_label, a.ended_label].filter(Boolean).join('–')].filter(Boolean).join(', ') || 'undated'}
          ${a.certainty !== 'attested' ? html` <span class="muted">· ${a.certainty}</span>` : ''}
          ${a.label ? html`<div class="muted small">${a.label}</div>` : ''}${a.notes_md ? html`<div class="md small">${raw(renderMarkdown(a.notes_md, { names }))}</div>` : ''}</td>
        <td>${marker ? marker(cites[a.id], { provenance: a.id, label: `another reading of step ${n}` }, back) : ''}</td>
        <td class="nowrap"><a href="/provenance/${a.id}/edit">edit</a></td></tr></tbody>`)}
      ${(gaps || []).filter((g) => g.kind === 'gap' && (g.show_after ?? g.before_position) === s.position).map(gapRow)}${i === fateAt ? fateRow(f, e.slug) : ''}`;
    })}</table></div>
      ${stored.length > 1 ? html`<p class="muted small">Drag ⠿ to change the order — the periods are recomputed.</p>` : ''}
      ${research(steps)}`
    : html`<p class="muted">None yet. The owners in order, as the sources record them: when each acquired the work and how.</p>`}
    <details><summary><b>+ Add provenance step</b></summary>${form({ action: `/artworks/${e.slug}/provenance`, submit: 'Add', choices: stepChoices(steps) })}</details>`;
}

module.exports = { ProvenanceError, plannedMark, dayText, METHODS, ROLES, NUMBER_KINDS, saveExtras, coverage, coverageBar, fate, readAlternatives, stepChoices, addCommission, fromForm, byId, formValues, add, update, move, reorder, remove, read, form, section, saveCoOwners, priceText };
