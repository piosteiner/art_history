// Compare an entry with Wikidata and take over reviewed values (never automatically, own values first).
//
//   search(q)                      "Find on Wikidata": candidates { id, label, description }
//   compare(db, t, qid, ours, ids) the review: field rows, image, relationship suggestions, remembered decisions
//   apply(db, t, entity, plan, choices, user)  what was ticked: fields → working copy / draft, new entries,
//                                  relationships, and the decisions remembered in wikidata_reviews (migration 012)
//
// Priority rules (owner's decision): a field that already has a value keeps it unless the editor deliberately picks
// Wikidata's; empty fields are pre-ticked; a declined value is remembered and folded away until Wikidata changes it.
// Wikidata API: https://www.wikidata.org/w/api.php (wbgetentities, wbsearchentities); images: Wikimedia Commons API.
// Base URLs are configurable (WIKIDATA_BASE, COMMONS_BASE) so the end-to-end tests can serve fixtures.
const { BY_TYPE, TYPES, SLUG, toRow } = require('../content');
const { fromStatement, periodOf } = require('../wikidata-time');
const { parseFuzzyDate } = require('../fuzzy-date');

const WIKIDATA = process.env.WIKIDATA_BASE || 'https://www.wikidata.org';
const COMMONS = process.env.COMMONS_BASE || 'https://commons.wikimedia.org';
const UA = 'arthistory-admin/1.0 (+https://arthistory.piogino.ch)';
const LANGS = ['en', 'nl', 'fr', 'de', 'it', 'es', 'ja', 'zh', 'ko', 'ru'];  // alternative names are offered from these
const Q = /^Q[1-9][0-9]*$/;

// --- HTTP with a small cache ------------------------------------------------------------------------------------
const cache = new Map();  // url → { at, data }
async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// light: only English labels/descriptions (cheap for many ids). Otherwise with all statements — big entities
// (a city, a country) carry thousands, so those are fetched one by one, a few in parallel, and only when needed.
async function getEntities(ids, { light = false } = {}) {
  const out = {};
  const list = [...new Set(ids)].filter((id) => Q.test(id));
  const params = (batch) => new URLSearchParams({ action: 'wbgetentities', ids: batch.join('|'), format: 'json',
    ...(light ? { props: 'labels|descriptions', languages: 'en' } : { props: 'labels|aliases|descriptions|claims' }) });
  if (light) {
    for (let i = 0; i < list.length; i += 50) Object.assign(out, (await getJson(`${WIKIDATA}/w/api.php?${params(list.slice(i, i + 50))}`)).entities || {});
    return out;
  }
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      Object.assign(out, (await getJson(`${WIKIDATA}/w/api.php?${params([id])}`)).entities || {});
    }
  }));
  return out;
}

async function search(q) {
  const url = `${WIKIDATA}/w/api.php?${new URLSearchParams({ action: 'wbsearchentities', search: q, language: 'en', uselang: 'en',
    type: 'item', limit: '8', format: 'json' })}`;
  return ((await getJson(url)).search || []).map((r) => ({ id: r.id, label: r.label, description: r.description || '' }));
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
async function commonsImage(file) {
  const url = `${COMMONS}/w/api.php?${new URLSearchParams({ action: 'query', titles: `File:${file}`, prop: 'imageinfo',
    iiprop: 'extmetadata|url', iiurlwidth: '1200', format: 'json' })}`;
  const page = Object.values(((await getJson(url)).query || {}).pages || {})[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const clean = (u) => (u ? u.split('?')[0] : u);  // Commons appends tracking parameters (utm_…) — not for our data
  return {
    image_url: clean(info.thumburl || info.url),
    image_source_url: info.descriptionurl,
    image_license: stripTags(meta.LicenseShortName && meta.LicenseShortName.value) || null,
    image_credit: stripTags(meta.Artist && meta.Artist.value) || null,
  };
}

// --- reading an entity ------------------------------------------------------------------------------------------
const labelOf = (e) => (e && e.labels && ((e.labels.en || e.labels.mul || Object.values(e.labels)[0] || {}).value)) || null;
// Statements of a property, best rank first (preferred → normal; deprecated never).
function statements(e, prop) {
  const all = ((e && e.claims && e.claims[prop]) || []).filter((s) => s.rank !== 'deprecated' && s.mainsnak && s.mainsnak.datavalue);
  return [...all.filter((s) => s.rank === 'preferred'), ...all.filter((s) => s.rank !== 'preferred')];
}
const itemIds = (e, prop) => [...new Set(statements(e, prop).map((s) => s.mainsnak.datavalue.value.id).filter(Boolean))];
const firstString = (e, prop) => { const s = statements(e, prop)[0]; return s ? String(s.mainsnak.datavalue.value) : null; };
const firstTime = (e, ...props) => { for (const p of props) { const s = statements(e, p)[0]; const v = s && fromStatement(s); if (v) return v; } return null; };
function coords(e) {
  const s = statements(e, 'P625')[0];
  if (!s) return null;
  const { latitude, longitude, globe } = s.mainsnak.datavalue.value;
  if (globe && !globe.endsWith('/Q2')) return null;  // on the Moon, Mars … — not a place on our map
  return [Math.round(longitude * 1e5) / 1e5, Math.round(latitude * 1e5) / 1e5];
}
// Alternative names: English aliases and the native name first (pre-ticked for an empty list), then other languages.
function altNames(e, main) {
  const primary = new Set([...((e.aliases && e.aliases.en) || []).map((a) => a.value),
    ...statements(e, 'P1559').map((s) => s.mainsnak.datavalue.value.text)]);
  const other = new Set();
  for (const lang of LANGS) {
    const l = e.labels && e.labels[lang];
    if (l) other.add(l.value);
  }
  const clean = (set) => [...set].filter((n) => n && n !== main);
  const p = clean(primary);
  return { primary: p, other: clean(other).filter((n) => !p.includes(n)) };
}

// Quantities (height P2048, width P2049, depth P2610 / P5524) → centimetres
const UNIT_CM = { Q174728: 1, Q174789: 0.1, Q11573: 100, Q218593: 2.54, Q3710: 30.48 };  // cm, mm, m, inch, foot
function lengthCm(e, ...props) {
  for (const p of props) {
    const s = statements(e, p)[0];
    const v = s && s.mainsnak.datavalue.value;
    const factor = v && UNIT_CM[String(v.unit || '').replace(/^.*\//, '')];
    if (factor) return Math.round(Number(v.amount) * factor * 100) / 100;
  }
  return null;
}

// P31 "instance of" heuristics
const HUMAN = 'Q5';
function placeKind(e) {
  const ids = itemIds(e, 'P31');
  if (ids.some((id) => ['Q6256', 'Q3624078', 'Q7275'].includes(id))) return 'country';
  if (ids.some((id) => ['Q515', 'Q1549591', 'Q484170', 'Q3957', 'Q532', 'Q5119', 'Q2039348', 'Q15284', 'Q747074', 'Q1637706'].includes(id))) return 'settlement';
  if (ids.some((id) => ['Q82794', 'Q36784', 'Q6465', 'Q107390', 'Q10864048', 'Q34876', 'Q13220204', 'Q1620908'].includes(id))) return 'region';
  if (ids.some((id) => ['Q41176', 'Q33506', 'Q16970', 'Q3947'].includes(id))) return 'building';
  return 'site';
}
const isInstitutionLike = (e) => itemIds(e, 'P31').some((id) => ['Q33506', 'Q207694', 'Q3918', 'Q2385804', 'Q1664720', 'Q43229', 'Q16970',
  'Q1030034', 'Q7075', 'Q4830453', 'Q163740', 'Q1497649', 'Q18810687', 'Q2668072'].includes(id));
const isMovementLike = (e) => itemIds(e, 'P31').some((id) => ['Q968159', 'Q1792644', 'Q4692', 'Q2198855', 'Q17537576'].includes(id));

// --- what we take from Wikidata, per type ------------------------------------------------------------------------
// Fields: key → { kind: 'text'|'list'|'date'|'point'|'ref', value, label?, ref?: {type, qid} }
function fieldsFor(t, e) {
  const name = labelOf(e);
  const f = {};
  const nameKey = t.name;
  if (name) f[nameKey] = { kind: 'text', value: name };
  const listKey = Object.keys(t.fields).find((k) => t.fields[k] === 'text[]');
  if (listKey) f[listKey] = { kind: 'list', ...altNames(e, name) };
  const date = (key, ...props) => { const v = firstTime(e, ...props); if (v && key in t.fields) f[key] = { kind: 'date', value: v.value, label: v.label }; };
  const ref = (key, type, prop) => { const id = itemIds(e, prop)[0]; if (id && key in t.fields) f[key] = { kind: 'ref', ref: { type, qid: id } }; };
  const text = (key, value) => { if (value && key in t.fields) f[key] = { kind: 'text', value }; };
  if (t.type === 'artist') { date('birth', 'P569'); date('death', 'P570'); }
  if (t.type === 'patron') {
    const start = firstTime(e, 'P2031', 'P569'); const end = firstTime(e, 'P2032', 'P570');
    if (start || end) f.active = { kind: 'date', value: `${start ? start.value.split('/')[0] : ''}${end ? `/${end.value.split('/').pop()}` : ''}`.replace(/^\//, ''), label: null };
    text('kind', itemIds(e, 'P31').includes(HUMAN) ? 'person' : null);
  }
  if (t.type === 'place') {
    const c = coords(e); if (c) f.location = { kind: 'point', value: c };
    f.kind = { kind: 'text', value: placeKind(e) };
    ref('parent', 'place', 'P131');
    f.country_code = { kind: 'country', qid: itemIds(e, 'P17')[0] || null };
  }
  if (t.type === 'institution') { date('founded', 'P571'); ref('place', 'place', 'P131'); text('website_url', firstString(e, 'P856')); }
  if (t.type === 'movement') {
    const start = firstTime(e, 'P580', 'P571'); const end = firstTime(e, 'P582', 'P576');
    if (start) f.period = { kind: 'date', value: end ? `${start.value.split('/')[0]}/${end.value.split('/').pop()}` : start.value, label: null };
    ref('parent', 'movement', 'P361');
  }
  if (t.type === 'artwork') {
    date('created', 'P571');
    ref('creator', 'artist', 'P170');
    ref('institution', 'institution', 'P195');
    // An inventory number belongs to a collection (qualifier P195): prefer the one of the collection suggested above.
    const collection = itemIds(e, 'P195')[0];
    const invs = statements(e, 'P217');
    const inv = invs.find((s) => ((s.qualifiers || {}).P195 || []).some((q) => q.datavalue && q.datavalue.value.id === collection)) || invs[0];
    if (inv && 'inventory_number' in t.fields) {
      const q = ((inv.qualifiers || {}).P195 || [])[0];
      f.inventory_number = { kind: 'text', value: String(inv.mainsnak.datavalue.value), collectionQid: (q && q.datavalue && q.datavalue.value.id) || collection || null };
    }
    const [h, w, d] = [lengthCm(e, 'P2048'), lengthCm(e, 'P2049'), lengthCm(e, 'P2610', 'P5524')];
    if (h && w) f.dimensions = { kind: 'dimensions', value: d ? [h, w, d] : [h, w] };
    const materialQids = itemIds(e, 'P186');
    if (materialQids.length) f.materials = { kind: 'materials', qids: materialQids };
  }
  f.wikidata_id = { kind: 'text', value: e.id };
  return f;
}

// Relationship suggestions: { type (our code, "~code" = the other side is the subject), prop, qid, period?, period_label? }
const REL_PROPS = {
  artist: [['P19', 'born_in'], ['P20', 'died_in'], ['P551', 'lived_in'], ['P937', 'worked_in'], ['P1066', 'student_of'],
    ['P802', '~student_of'], ['P135', 'associated_with'], ['P463', 'member_of'], ['P69', 'studied_at'], ['P737', 'influenced_by']],
  patron: [['P19', 'born_in'], ['P20', 'died_in'], ['P551', 'lived_in']],
  artwork: [['P1071', 'created_in'], ['P180', 'depicts'], ['P135', 'associated_with'], ['P88', '~commissioned'], ['P127', 'owned_by']],
  movement: [['P495', 'active_in']],
  institution: [],
  place: [],
};
function relsFor(t, e) {
  const out = [];
  for (const [prop, type] of REL_PROPS[t.type] || []) {
    for (const s of statements(e, prop)) {
      const qid = s.mainsnak.datavalue.value.id;
      if (!qid) continue;
      const p = periodOf(s);
      if (!out.some((r) => r.type === type && r.qid === qid)) out.push({ type, prop, qid, period: p ? p.value : null, period_label: p ? p.label : null });
    }
  }
  return out;
}

// --- comparing ---------------------------------------------------------------------------------------------------
// Entries that don't have the Wikidata id yet but carry the same name (accent- and case-insensitive; also an
// alternative name) — so a suggestion links to our "Paris" instead of creating a second one.
async function localByName(db, labels) {
  const pairs = Object.entries(labels).filter(([, l]) => l);
  if (!pairs.length) return {};
  const parts = TYPES.map((t) => {
    const alt = Object.keys(t.fields).find((k) => t.fields[k] === 'text[]');
    return `SELECT '${t.type}' AS type, x.slug, x.${t.name} AS name, x.wikidata_id, q.qid FROM ${t.table} x
      JOIN unnest($1::text[], $2::text[]) AS q(qid, label) ON x.wikidata_id IS NULL
       AND (lower(f_unaccent(x.${t.name})) = lower(f_unaccent(q.label))
         ${alt ? `OR lower(f_unaccent(q.label)) = ANY (SELECT lower(f_unaccent(a)) FROM unnest(x.${alt}) a)` : ''})`;
  });
  const { rows } = await db.query(parts.join(' UNION ALL '), [pairs.map(([q]) => q), pairs.map(([, l]) => l)]);
  const out = {};
  for (const r of rows) (out[r.qid] ||= []).push({ ...r, matchedBy: 'name' });
  return out;
}

// No exact match: the most similar entry of an allowed type (pg_trgm, like the search) — offered, never pre-selected.
async function similarEntry(db, label, types) {
  if (!label || !types.length) return null;
  const { rows } = await db.query(`
    SELECT type::text, slug, name, round(word_similarity(f_unaccent($1), f_unaccent(name))::numeric, 2) AS score FROM entity_index
    WHERE type = ANY ($2::entity_type[]) AND word_similarity(f_unaccent($1), f_unaccent(name)) >= 0.6
    ORDER BY score DESC, name LIMIT 1`, [label, types]);
  return rows[0] || null;
}

async function localByQid(db, qids) {
  if (!qids.length) return {};
  const parts = TYPES.map((t) => `SELECT '${t.type}' AS type, slug, ${t.name} AS name, wikidata_id FROM ${t.table} WHERE wikidata_id = ANY ($1)`);
  const { rows } = await db.query(parts.join(' UNION ALL '), [qids]);
  return Object.fromEntries(rows.map((r) => [r.wikidata_id, r]));
}

// Which of our types a missing target would become.
function targetType(allowed, e) {
  if (allowed.length === 1) return allowed[0];
  if (itemIds(e, 'P31').includes(HUMAN)) return allowed.includes('artist') ? 'artist' : allowed.includes('patron') ? 'patron' : null;
  if (isInstitutionLike(e) && allowed.includes('institution')) return 'institution';
  if (isMovementLike(e) && allowed.includes('movement')) return 'movement';
  if (coords(e) && allowed.includes('place')) return 'place';
  return null;
}

// Minimal doc for creating a missing target from Wikidata (shown in the review, created only if ticked).
function newEntryDoc(type, e) {
  const t = BY_TYPE[type];
  const doc = { [t.name]: labelOf(e), wikidata_id: e.id };
  if (type === 'place') { const c = coords(e); if (!c) return null; doc.location = c; doc.kind = placeKind(e); }
  if (type === 'artist') { const b = firstTime(e, 'P569'); const d = firstTime(e, 'P570'); if (b) doc.birth = b.value; if (d) doc.death = d.value; }
  if (type === 'movement') { const s = firstTime(e, 'P580', 'P571'); if (s) doc.period = s.value; doc.kind = 'movement'; }
  if (type === 'institution') { const f = firstTime(e, 'P571'); if (f) doc.founded = f.value; }
  if (type === 'patron' && itemIds(e, 'P31').includes(HUMAN)) doc.kind = 'person';
  return doc[t.name] ? doc : null;
}
const describeDoc = (type, doc) => [type, doc.birth && `born ${doc.birth}`, doc.death && `died ${doc.death}`,
  doc.location && `at ${doc.location[1]}, ${doc.location[0]}`, doc.kind && doc.kind !== type ? doc.kind : null].filter(Boolean).join(' · ');

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ours: flat form values of the entry (working copy) — {} for a new entry. entity: { type, id } or null.
async function compare(db, t, qid, ours, entity) {
  const entities = await getEntities([qid]);
  const e = entities[qid];
  if (!e || e.missing !== undefined) throw new Error(`${qid} was not found on Wikidata`);
  const fields = fieldsFor(t, e);
  const rels = relsFor(t, e);
  // Everything referenced: our entries with these Q-ids, and Wikidata data for the rest (labels, coordinates …)
  const refQids = [...Object.values(fields).filter((f) => f.ref).map((f) => f.ref.qid), ...rels.map((r) => r.qid),
    ...(fields.country_code && fields.country_code.qid ? [fields.country_code.qid] : []),
    ...Object.values(fields).filter((f) => f.collectionQid).map((f) => f.collectionQid)];
  const byQid = await localByQid(db, refQids);
  const light = await getEntities(refQids, { light: true });
  // Not linked by Q-id yet? Maybe we have it under the same name (it gets the Q-id when linked).
  const byName = await localByName(db, Object.fromEntries(refQids.filter((id) => !byQid[id]).map((id) => [id, labelOf(light[id])])));
  const localFor = (qid, allowed) => byQid[qid] || (byName[qid] || []).find((r) => !allowed || allowed.includes(r.type)) || null;
  // Full data only for what we still don't have (needed to offer it as a new entry), and the country (ISO code).
  const missing = refQids.filter((id) => !byQid[id] && !byName[id]);
  const others = { ...light, ...(await getEntities([...missing, ...(fields.country_code && fields.country_code.qid ? [fields.country_code.qid] : [])])) };
  const reviews = entity ? Object.fromEntries((await db.query(
    'SELECT item, value, decision, decided_at FROM wikidata_reviews WHERE entity_type = $1 AND entity_id = $2', [entity.type, entity.id])).rows
    .map((r) => [r.item, r])) : {};
  const declined = (item, value) => reviews[item] && reviews[item].decision === 'declined' && same(reviews[item].value, value) ? reviews[item] : null;

  const rows = [];
  for (const [key, w] of Object.entries(fields)) {
    const oursVal = ours[`f.${key}`] ?? '';
    if (w.kind === 'list') {
      const have = oursVal.split('\n').map((s) => s.trim()).filter(Boolean);
      const lower = new Set(have.map((s) => s.toLowerCase()));
      const offer = (list, primary) => list.filter((n) => !lower.has(n.toLowerCase())).map((n) => ({ value: n, primary }));
      const items = [...offer(w.primary, true), ...offer(w.other, false)].map((it) => ({ ...it, declined: !!declined(`${key}:${it.value}`, it.value) }));
      if (items.length) rows.push({ key, kind: 'list', ours: have, items, preselect: !have.length });
      continue;
    }
    if (w.kind === 'materials') {  // names of the material items (light request), offered like alternative names
      const names = Object.values(await getEntities(w.qids, { light: true })).map(labelOf).filter(Boolean);
      const have = oursVal.split('\n').map((s) => s.trim()).filter(Boolean);
      const lower = new Set(have.map((s) => s.toLowerCase()));
      const items = names.filter((n) => !lower.has(n.toLowerCase())).map((n) => ({ value: n, primary: false, declined: !!declined(`${key}:${n}`, n) }));
      if (items.length) rows.push({ key, kind: 'list', ours: have, items, preselect: false });
      continue;
    }
    if (w.kind === 'dimensions') {
      const mine = ['h', 'w', 'd'].map((x) => ours[`f.dimensions_${x}`]).filter((x) => x !== undefined && x !== '').map(Number);
      const fmt = (a) => `${a.join(' × ')} cm`;
      rows.push({ key, kind: 'dimensions', ours: mine.length ? fmt(mine) : '', display: fmt(w.value), value: w.value,
        status: !mine.length ? 'empty' : same(mine, w.value) ? 'same' : 'differs', declined: declined(key, w.value) });
      continue;
    }
    if (w.kind === 'country') {
      const c = w.qid && others[w.qid];
      const iso = c && firstString(c, 'P297');
      if (iso) rows.push(scalarRow(key, oursVal, iso, iso, declined(key, iso)));
      continue;
    }
    if (w.kind === 'ref') {
      const target = localFor(w.ref.qid, [w.ref.type]);
      const we = others[w.ref.qid];
      const doc = !target && we ? newEntryDoc(w.ref.type, we) : null;
      const candidate = !target ? await similarEntry(db, labelOf(we), [w.ref.type]) : null;
      rows.push({ key, kind: 'ref', ours: oursVal, qid: w.ref.qid, target, candidate, create: doc ? { type: w.ref.type, doc, describe: describeDoc(w.ref.type, doc) } : null,
        wikiLabel: labelOf(we) || w.ref.qid, value: target ? target.slug : null, declined: declined(key, w.ref.qid),
        status: target && target.slug === oursVal ? 'same' : !oursVal ? 'empty' : 'differs' });
      continue;
    }
    const value = w.kind === 'point' ? `${w.value[0]}, ${w.value[1]}` : w.value;
    if (w.kind === 'point') {
      const [lon, lat] = [ours['f.location_lon'], ours['f.location_lat']];
      const oursPoint = lon && lat ? `${lon}, ${lat}` : '';
      const km = oursPoint ? distanceKm([Number(lon), Number(lat)], w.value) : null;
      rows.push({ ...scalarRow(key, oursPoint, value, w.value, declined(key, w.value)), kind: 'point', km,
        status: !oursPoint ? 'empty' : km < 0.5 ? 'same' : 'differs' });
      continue;
    }
    const display = w.kind === 'date' ? `${w.label || parseFuzzyDate(w.value, { openEnd: true }).label} (${w.value})`
      : w.collectionQid ? `${value} — in the collection of ${labelOf(others[w.collectionQid]) || w.collectionQid}` : value;
    rows.push({ ...scalarRow(key, oursVal, display, w.kind === 'date' ? { value: w.value, label: w.label } : w.value, declined(key, w.value)), kind: w.kind });
  }

  // Image (artworks)
  let image = null;
  // P18 "image": an artwork's picture, an artist's portrait, an institution's building — for every type with image fields
  const file = t.fields.image_url ? firstString(e, 'P18') : null;
  if (file) {
    const img = await commonsImage(file).catch(() => null);
    if (img) image = { ...img, ours: ours['f.image_url'] || '', status: !ours['f.image_url'] ? 'empty' : ours['f.image_url'] === img.image_url ? 'same' : 'differs',
      declined: declined('image', img.image_url) };
  }

  // Relationship suggestions
  const vocab = Object.fromEntries((await db.query('SELECT code, label, inverse_label, subject_types::text[] AS s, object_types::text[] AS o FROM relationship_types')).rows.map((r) => [r.code, r]));
  const existing = entity ? (await db.query(`
    SELECT relationship_type, subject_type::text || '/' || s.slug AS subj, object_type::text || '/' || o.slug AS obj
    FROM relationships r JOIN entity_index s ON s.type = r.subject_type AND s.id = r.subject_id
    JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
    WHERE (r.subject_type, r.subject_id) = ($1::entity_type, $2) OR (r.object_type, r.object_id) = ($1::entity_type, $2)`, [entity.type, entity.id])).rows : [];
  const suggestions = [];
  for (const r of rels) {
    const reverse = r.type.startsWith('~');
    const v = vocab[r.type.replace('~', '')];
    if (!v) continue;
    const allowed = reverse ? v.s : v.o;
    const target = localFor(r.qid, allowed);
    const we = others[r.qid];
    const type = target ? target.type : we ? targetType(allowed, we) : null;
    if (!type || !allowed.includes(type)) continue;
    const doc = !target && we ? newEntryDoc(type, we) : null;
    const candidate = !target ? await similarEntry(db, labelOf(we), allowed) : null;
    if (!target && !doc && !candidate) continue;  // nothing we could link or create (e.g. "night", "sky" as depicted)
    const ref = target ? `${target.type}/${target.slug}` : null;
    const already = ref && existing.some((x) => x.relationship_type === v.code && (reverse ? x.subj === ref : x.obj === ref));
    const item = `rel:${r.type}:${r.qid}`;
    suggestions.push({ item, type: r.type, label: reverse ? v.inverse_label : v.label, qid: r.qid, targetType: type,
      target, candidate, name: target ? target.name : labelOf(we) || r.qid, create: doc ? { type, doc, describe: describeDoc(type, doc) } : null,
      period: r.period, period_label: r.period_label, already, declined: declined(item, r.qid),
      period_display: r.period_label || (r.period ? parseFuzzyDate(r.period, { openEnd: true }).label : '') });
  }
  return { qid, label: labelOf(e), description: (e.descriptions && e.descriptions.en && e.descriptions.en.value) || '', rows, image, suggestions };
}

function scalarRow(key, ours, display, value, declined) {
  const theirs = value && value.value !== undefined ? value.value : value;
  let status = !ours ? 'empty' : String(ours) === String(theirs) ? 'same' : 'differs';
  if (status === 'differs' && value && value.value !== undefined && withinRange(ours, theirs)) status = 'more-precise';
  return { key, ours, display, value, status, declined };
}

// Our date lies within Wikidata's (e.g. "1889-06" in "1889"): ours is just more precise, not in conflict.
function withinRange(ours, theirs) {
  try {
    const bounds = (text) => parseFuzzyDate(text, { openEnd: true }).range.slice(1, -1).split(',');
    const [a1, a2] = bounds(ours);
    const [b1, b2] = bounds(theirs);
    return a1 >= b1 && (b2 === '' || (a2 !== '' && a2 <= b2));
  } catch { return false; }
}

function distanceKm([lon1, lat1], [lon2, lat2]) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

// --- applying ------------------------------------------------------------------------------------------------------
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entry';

async function freeSlug(db, t, base) {
  let slug = slugify(base);
  for (let i = 2; (await db.query(`SELECT 1 FROM ${t.table} WHERE slug = $1`, [slug])).rows.length; i += 1) slug = `${slugify(base)}-${i}`;
  return slug;
}

const sourceNote = (qid) => `Wikidata ${qid} (retrieved ${new Date().toISOString().slice(0, 10)})`;

// An entry recognised by its name gets the Q-id, so the next comparison links it exactly.
async function linkQid(db, target, qid) {
  const t = BY_TYPE[target.type];
  await db.query(`UPDATE ${t.table} SET wikidata_id = $1 WHERE slug = $2 AND wikidata_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM ${t.table} WHERE wikidata_id = $1)`, [qid, target.slug]);
}

// Create a missing target from Wikidata (inside the caller's transaction) → its slug.
async function createEntry(db, type, doc) {
  const t = BY_TYPE[type];
  const existing = (await db.query(`SELECT slug FROM ${t.table} WHERE wikidata_id = $1`, [doc.wikidata_id])).rows[0];
  if (existing) return existing.slug;  // created a moment ago for another suggestion
  const row = toRow({ ...doc, metadata: { sources: [sourceNote(doc.wikidata_id)] } }, t.fields);
  if (row.errors.length) throw new Error(`${type} "${doc[t.name]}": ${row.errors.join('; ')}`);
  const slug = await freeSlug(db, t, doc[t.name]);
  const names = Object.keys(row.cols);
  const values = [slug];
  const exprs = names.map((c) => { values.push(row.cols[c][1]); return row.cols[c][0].replace('$', () => `$${values.length}`); });
  await db.query(`INSERT INTO ${t.table} (slug, ${names.join(', ')}) VALUES ($1, ${exprs.join(', ')})`, values);
  return slug;
}

// → { form: flat form values to put into the working copy / draft, created: [labels], relationships: n }
// choices: take.<key>=take|keep|later (text, date, point), alt.<key>=<name> (repeated) + altrest.<key>=later|decline,
//          ref.<key>=later|keep|link|candidate|create, image=take|keep|later, rel.<i>=later|skip|link|candidate|create
// Only explicit decisions are remembered: keep/skip/decline → 'declined', taking → 'accepted'; "later" records nothing.
async function apply(db, t, entity, plan, choices, userId) {
  const form = {};
  const created = [];
  const decide = async (item, value, taken) => {
    if (!entity || taken === null) return;  // null = decide later
    if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) value = value.value;  // dates: the bare value
    await db.query(`INSERT INTO wikidata_reviews (entity_type, entity_id, item, value, decision, decided_by) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (entity_type, entity_id, item) DO UPDATE SET value = EXCLUDED.value, decision = EXCLUDED.decision,
        decided_by = EXCLUDED.decided_by, decided_at = now()`, [entity.type, entity.id, item, JSON.stringify(value), taken ? 'accepted' : 'declined', userId]);
  };
  for (const row of plan.rows) {
    if (row.status === 'same') continue;
    if (row.kind === 'list') {
      const picked = [].concat(choices[`alt.${row.key}`] || []);
      const declineRest = choices[`altrest.${row.key}`] === 'decline';
      for (const it of row.items) await decide(`${row.key}:${it.value}`, it.value, picked.includes(it.value) ? true : declineRest ? false : null);
      if (picked.length) form[`f.${row.key}`] = [...row.ours, ...row.items.filter((it) => picked.includes(it.value)).map((it) => it.value)].join('\n');
      continue;
    }
    if (row.kind === 'ref') {
      let slug = null;
      const pick = choices[`ref.${row.key}`] || 'later';
      if (pick === 'later') continue;
      if (pick === 'link' && row.target) {
        slug = row.target.slug;
        if (row.target.matchedBy === 'name') await linkQid(db, row.target, row.qid);
      }
      if (pick === 'candidate' && row.candidate) { slug = row.candidate.slug; await linkQid(db, row.candidate, row.qid); }
      if (pick === 'create' && row.create) { slug = await createEntry(db, row.create.type, row.create.doc); created.push(`${row.create.type} ${row.create.doc[BY_TYPE[row.create.type].name]}`); }
      await decide(row.key, row.qid, !!slug);
      if (slug) form[`f.${row.key}`] = slug;
      continue;
    }
    const pick = choices[`take.${row.key}`] || 'later';
    if (pick === 'later') continue;
    const taken = pick === 'take';
    await decide(row.key, row.value, taken);
    if (!taken) continue;
    if (row.kind === 'point') { form['f.location_lon'] = String(row.value[0]); form['f.location_lat'] = String(row.value[1]); } else if (row.kind === 'dimensions') {
      ['h', 'w', 'd'].forEach((x, i) => { form[`f.dimensions_${x}`] = row.value[i] !== undefined ? String(row.value[i]) : ''; });
    } else if (row.kind === 'date') {
      form[`f.${row.key}`] = row.value.value;
      form[`f.${row.key}_label`] = row.value.label || '';
    } else form[`f.${row.key}`] = String(row.value);
  }
  if (plan.image && plan.image.status !== 'same') {
    const pick = choices.image || 'later';
    const taken = pick === 'take';
    if (pick !== 'later') await decide('image', plan.image.image_url, taken);
    if (taken) for (const k of ['image_url', 'image_source_url', 'image_license', 'image_credit']) form[`f.${k}`] = plan.image[k] || '';
  }
  let relationships = 0;
  if (entity) {
    for (const [i, s] of plan.suggestions.entries()) {
      if (s.already) continue;
      const pick = choices[`rel.${i}`] || 'later';
      if (pick === 'later') continue;
      let ref = null;
      if (pick === 'link' && s.target) {
        ref = { type: s.target.type, slug: s.target.slug };
        if (s.target.matchedBy === 'name') await linkQid(db, s.target, s.qid);
      } else if (pick === 'candidate' && s.candidate) {
        ref = { type: s.candidate.type, slug: s.candidate.slug };
        await linkQid(db, s.candidate, s.qid);
      } else if (pick === 'create' && s.create) {
        ref = { type: s.create.type, slug: await createEntry(db, s.create.type, s.create.doc) };
        created.push(`${s.create.type} ${s.name}`);
      }
      await decide(s.item, s.qid, !!ref);
      if (!ref) continue;
      const reverse = s.type.startsWith('~');
      const other = (await db.query('SELECT entity_id($1, $2) AS id', [ref.type, ref.slug])).rows[0].id;
      const [st, si, ot, oi] = reverse ? [ref.type, other, entity.type, entity.id] : [entity.type, entity.id, ref.type, other];
      const period = s.period ? parseFuzzyDate(s.period, { openEnd: true }) : null;
      await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::daterange, $7, $8::jsonb) ON CONFLICT DO NOTHING`,
      [st, si, s.type.replace('~', ''), ot, oi, period && period.range, s.period_label || (period && period.label),
        JSON.stringify({ sources: [sourceNote(plan.qid)] })]);
      relationships += 1;
    }
  }
  return { form, created, relationships };
}

module.exports = { search, compare, apply, slugify, sourceNote, SLUG };
