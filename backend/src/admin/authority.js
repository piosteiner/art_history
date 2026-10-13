// ---------------------------------------------------------------------------------------------------------------
// Comparison with an authority file — the GND (gnd.js, 053) and SIKART (sikart.js, 057) — shared by its own page
// (routes/compare.js), the Enrich page (enrich.js) and the batch pages of the Quality queue (routes/dashboard.js).
// Field values go into the working copy (cited when published), relationships are created at once (cited), values
// that agree are cited as they are; numbers the record knows (SIKART: GND, VIAF) are offered as reference records.
// The tables take a name prefix ("gnd:") so several sources fit into one form.
// ---------------------------------------------------------------------------------------------------------------
const { adminPool } = require('../db');
const { BY_TYPE } = require('../content');
const autocreate = require('./autocreate');
const { html } = require('./html');
const wikidata = require('./wikidata');
const citations = require('./citations');
const identifiers = require('./identifiers');
const gnd = require('./gnd');
const sikart = require('./sikart');
const placefinder = require('./placefinder');
const { formToDoc, fieldLabel } = require('./forms');
const { UserError } = require('./core');
const collab = require('./collab');

// The sources of the bibliography the comparisons cite (059/060 created these — again if deleted)
const SOURCE_ROWS = {
  lc: ['Library of Congress Name Authority File', 'LCNAF', 'https://id.loc.gov/authorities/names.html', 'institution', 'Library of Congress'],
  bnf: ['data.bnf.fr', 'BnF', 'https://data.bnf.fr/', 'institution', 'Bibliothèque nationale de France'],
  rkd: ['RKDartists', 'RKD', 'https://rkd.nl/', 'scholarly', 'RKD – Nederlands Instituut voor Kunstgeschiedenis'],
  kulturnav: ['KulturNav', 'KulturNav', 'https://kulturnav.org/', 'institution', 'Kulturnav / Arts Council Norway'],
  nlk: ['National Library of Korea Linked Open Data', 'NLK', 'https://lod.nl.go.kr/', 'institution', 'National Library of Korea'],
};
const ensureRow = (slug) => (db) => db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
  VALUES ($1, 'web', $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING`, [slug, ...SOURCE_ROWS[slug]]);
// a person's record read by lc.js / bnf.js / rkd.js, compared like SIKART's (records.js)
const person = (mod, code, name) => ({ name, short: name, source: code, types: ['artist', 'person'],
  plan: (t, e, id) => mod.compare(adminPool, t, e, e.doc, id, gnd.placeTarget), opts: { source: code, byNameGets: null, ensure: ensureRow(code) } });

// in this order on the Enrich page
const SOURCES = {
  gnd: { name: 'the GND', short: 'GND', source: 'gnd', types: ['artist', 'person', 'institution'],
    plan: (t, e, id) => gnd.compare(adminPool, t, e, e.doc, id), opts: { source: 'gnd', byNameGets: 'gnd', ensure: gnd.ensureSource } },
  sikart: { name: 'SIKART', short: 'SIKART', source: 'sikart', types: ['artist', 'person'],
    plan: (t, e, id) => sikart.compare(adminPool, t, e, e.doc, id, gnd.placeTarget), opts: { source: 'sikart', byNameGets: null, ensure: sikart.ensureSource } },
  rkd: person(require('./rkd'), 'rkd', 'RKD'),
  lc: { ...person(require('./lc'), 'lc', 'the Library of Congress'), short: 'LC' },
  bnf: { ...person(require('./bnf'), 'bnf', 'the BnF'), short: 'BnF' },
  kulturnav: person(require('./kulturnav'), 'kulturnav', 'KulturNav'),
  nlk: { ...person(require('./nlk'), 'nlk', 'the National Library of Korea'), short: 'NLK' },
};

// A place found in OpenStreetMap (placefinder.settlementByName) → created like the city found on save: the place
// finder's draft (names, Wikidata point, parent region — from Natural Earth if we don't have it) → its slug
async function createPlaceFrom(db, c, user) {
  const placeT = BY_TYPE.place;
  const draft = await placefinder.draftFor(db, c, wikidata.coordsOf, wikidata.slugify);
  const { doc, errors } = formToDoc(draft.form, placeT.fields);
  if (errors.length) throw new UserError(`The place ${c.name}: ${errors.join('; ')}`);
  const parent = await autocreate.resolveRefs(db, placeT, doc, {});
  if (parent.errors.length) delete doc.parent;
  else {
    const slugs = await autocreate.create(db, parent.creates);
    if (slugs.has('parent')) doc.parent = slugs.get('parent');
  }
  return wikidata.createEntry(db, 'place', doc, null, user.id, doc.wikidata_id || null, false);
}

// → { plan } | { missing: true } (no number) | { error }
async function plan(t, e, code) {
  if (!SOURCES[code].types.includes(t.type)) return { missing: true };
  const id = (await identifiers.list(adminPool, t.type, e.id)).find((x) => x.code === code);
  if (!id) return { missing: true };
  try { return { plan: await SOURCES[code].plan(t, e, id.value) }; } catch (err) { return { error: `The ${SOURCES[code].short} record could not be read: ${err.message}` }; }
}

// Apply the ticked choices (inside the caller's transaction) → gnd.apply's result; agreeing values cited now.
async function apply(db, t, e, code, p, choices, user) {
  const r = await gnd.apply(db, t, e, p, choices, citations, { ...SOURCES[code].opts, createPlace: (d, c) => createPlaceFrom(d, c, user),
    // a new artist / person by name: minimal, marked "to complete" (auto_created), from this entry
    createEntry: (d, type, name) => wikidata.createEntry(d, type, { name }, { type: t.type, id: e.id }, user.id) });
  if (r.agreed.length) await citations.citeAgreeingSource(db, t.type, e.id, SOURCES[code].source, p.url, r.agreed, user.id);
  // ticked other names: added to the names of the working copy (the Enrich page combines several sources' itself)
  if (r.addNames.length) r.form['f.names'] = withNames((await collab.currentForm(t, e.id)).form['f.names'], r.addNames);
  return r;
}

// names text + new lines (a name already there — by its text — isn't added twice)
function withNames(text, lines) {
  const have = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const textOf = (l) => l.split('|')[0].trim().toLowerCase();
  for (const l of lines) if (!have.some((h) => textOf(h) === textOf(l))) have.push(l);
  return have.join('\n');
}

// The choices of one source in a form with several: "gnd:take.birth" → "take.birth"
function choicesOf(body, prefix) {
  if (!prefix) return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
}

// --- the tables ------------------------------------------------------------------------------------------------
const radio = (name, value, label, checked) => html`<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${label}</label>`;
const empty = html`<span class="muted">(empty)</span>`;

// skip: field keys shown elsewhere (the Enrich page's rows offered by several sources)
function fieldsTable(t, p, code, { prefix = '', skip = [] } = {}) {
  const c = SOURCES[code];
  const rows = p.rows.filter((r) => !skip.includes(r.key));
  if (!rows.length) {
    return html`<p class="muted">${p.rows.length ? html`Its ${p.rows.map((r) => fieldLabel(t.type, r.key).toLowerCase()).join(' and ')}: above, under “Offered by several sources”.` : 'No field values in its record.'}</p>`;
  }
  return html`<div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Field</th><th>Yours</th><th>${c.short}</th><th>Take?</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${fieldLabel(t.type, r.key)}</td><td>${r.ours || empty}</td>
      <td>${r.label || r.theirs}${r.key !== 'place' ? html` <span class="muted small">(${r.theirs})</span>` : r.create ? html` <span class="muted small">— new place: ${r.create.label}</span>` : ''}</td>
      <td>${r.status === 'same' ? html`<label class="choice"><input type="checkbox" name="${prefix}cite.${r.key}" value="cite" checked> the same — cite it</label>`
        : r.status === 'missing' ? html`<span class="muted">not among our places</span>`
        : html`${radio(`${prefix}take.${r.key}`, 'take', `take ${c.short}’s`, r.status === 'new')} ${radio(`${prefix}take.${r.key}`, 'keep', r.status === 'new' ? 'leave empty' : 'keep mine', r.status !== 'new')}`}</td></tr>`)}
  </tbody></table></div>`;
}

// the record's other names we don't have — ticked ones are added to the entry's names
function namesTable(p, { prefix = '' } = {}) {
  if (!p.names || !p.names.length) return '';
  return html`<div class="table-wrap"><table class="diff wd-table wd-names"><tbody>${p.names.map((n) => html`<tr>
    <td><label class="choice"><input type="checkbox" name="${prefix}name.${n.i}" value="take"${n.preselect ? ' checked' : ''}> <b>${n.text}</b></label></td>
    <td><span class="tag">${n.lang}</span> <span class="muted small">${n.role}</span></td></tr>`)}</tbody></table></div>`;
}

// One row per suggestion, each with its own choice: add · create (the place found in OpenStreetMap; a new artist or
// person — "to complete") · link another of ours (a picker) · skip; ours already: cite this source for it.
function relsTable(p, code, { prefix = '' } = {}) {
  const c = SOURCES[code];
  if (!p.rels.length) return html`<p class="muted">None.</p>`;
  const name = (x) => `${prefix}rel.${x.i}`;
  const other = (x, checked) => html`<span class="rel-other">${radio(name(x), 'other', 'another of ours:', checked)}
    <input name="${prefix}relto.${x.i}" data-lookup="${(x.types || ['place']).join(',')}" placeholder="type a name" aria-label="another entry" class="rel-picker"></span>`;
  const choices = (x) => {
    if (x.already) {
      return html`<span class="muted">have it</span> <label class="choice"><input type="checkbox" name="${prefix}citerel.${x.i}" value="cite" checked> cite ${c.short} for it</label>`;
    }
    const people = (x.types || []).filter((ty) => ty === 'artist' || ty === 'person');
    return html`${x.target || x.create ? radio(name(x), 'add', x.create ? 'create the place and add' : 'add', true) : ''}
      ${!x.target && !x.create ? people.map((ty) => radio(name(x), `new-${ty}`, `new ${ty}`, false)) : ''}
      ${other(x, false)} ${radio(name(x), 'skip', 'skip', !x.target && !x.create)}`;
  };
  return html`<div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Relationship</th><th>${c.short}</th><th>Ours</th><th>Do</th></tr></thead><tbody>
    ${p.rels.map((x) => html`<tr${x.already ? html` class="wd-same"` : ''}><td>${x.label}</td><td>${x.ref.label}</td>
      <td>${x.target ? html`<a href="/${BY_TYPE[x.target.type].folder}/${x.target.slug}">${x.target.name}</a>${x.target.by_id ? '' : html` <span class="muted small">(${x.target.via === 'osm' ? 'found by OpenStreetMap' : 'same name'})</span>`}`
        : x.create ? html`<span class="muted">not in our database —</span> new place <b>${x.create.name}</b> <span class="muted small">(${x.create.label}, OpenStreetMap)</span>`
        : html`<span class="muted">not in our database${(x.types || ['place']).includes('place') ? ', not found in OpenStreetMap' : ''}</span>`}</td>
      <td>${choices(x)}</td></tr>`)}
  </tbody></table></div>`;
}

function idsTable(p, { prefix = '' } = {}) {
  if (!p.ids || !p.ids.length) return '';
  return html`<div class="table-wrap"><table class="diff wd-table wd-ids"><tbody>
    ${p.ids.map((x) => html`<tr><td>${x.name}</td><td>${x.ours || html`<span class="muted">(none)</span>`}</td><td>${x.value}</td>
      <td>${x.status === 'same' ? html`<span class="muted">the same</span>` : html`<label class="choice"><input type="checkbox" name="${prefix}idf.${x.code}" value="take"${x.status === 'new' ? ' checked' : ''}> ${x.status === 'new' ? 'add' : 'replace yours'}</label>`}</td></tr>`)}
  </tbody></table></div>`;
}

const recordLine = (p, code) => html`<a href="${p.url}" target="_blank" rel="noopener">${SOURCES[code].short} ${p.gnd} ↗</a> — <b>${p.info.name}</b>${p.info.occupations.length ? html` · <span class="muted">${p.info.occupations.join(', ')}</span>` : ''}`;
const variantsLine = (p, code) => (p.info.variants.length ? html`<p class="muted small">${code === 'gnd' ? 'Other names in the GND: ' : ''}${p.info.variants.join(' · ')}</p>` : '');

module.exports = { SOURCES, plan, apply, choicesOf, createPlaceFrom, fieldsTable, relsTable, idsTable, namesTable, withNames, recordLine, variantsLine };
