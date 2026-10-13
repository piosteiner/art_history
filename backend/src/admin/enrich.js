// ---------------------------------------------------------------------------------------------------------------
// Enrich: Wikidata, the GND and SIKART on one page (/:plural/:slug/enrich) — one review, one Apply.
//
// Each source keeps its own comparison (wikidata.js, authority.js) and its own controls. What more than one source
// offers for the same date field (birth, death, founded …) is shown once: the values side by side, grouped where they
// agree (by their date ranges) — pick one, and every source with that value is cited for it. The form is then split
// back into each source's choices ("gnd:take.birth" → the GND's "take.birth"; the merged "pick.birth" → "take" for the
// sources with the picked value, "keep" for the others) and applied in one transaction: Wikidata first, then the GND,
// SIKART. A relationship two sources suggest is created once and cited by both (gnd.apply).
// ---------------------------------------------------------------------------------------------------------------
const { adminPool } = require('../db');
const { BY_TYPE } = require('../content');
const { parseFuzzyDate } = require('../fuzzy-date');
const { html } = require('./html');
const wikidata = require('./wikidata');
const authority = require('./authority');
const metagrid = require('./metagrid');
const japansearch = require('./japansearch');
const arco = require('./arco');
const collab = require('./collab');
const citations = require('./citations');
const { fieldRow, suggestionRow, imageChoice } = require('./wikidata-ui');
const { fieldLabel } = require('./forms');
const { withTx, typeWarning } = require('./core');

const AUTH = Object.keys(authority.SOURCES);  // gnd, sikart, rkd, lc, bnf
const NAMES = { wikidata: 'Wikidata', ...Object.fromEntries(AUTH.map((c) => [c, authority.SOURCES[c].short])) };
const wdLinks = { folderOf: (type) => BY_TYPE[type].folder };
const rangeOf = (text) => { try { return text ? parseFuzzyDate(String(text)).range : null; } catch { return null; } };

// All sources of an entry → { ours, qid, sources: { wikidata: {plan}|{missing}|{error}, gnd: …, sikart: … }, merged, types }
async function load(t, e) {
  const ours = (await collab.currentForm(t, e.id)).form;
  const qid = /^Q[1-9][0-9]*$/.test(e.doc.wikidata_id || '') ? e.doc.wikidata_id : /^Q[1-9][0-9]*$/.test(ours['f.wikidata_id'] || '') ? ours['f.wikidata_id'] : null;
  const wd = qid
    ? wikidata.compare(adminPool, t, qid, ours, { type: t.type, id: e.id }).then((plan) => ({ plan }), (err) => ({ error: `Wikidata ${qid} could not be read: ${err.message}` }))
    : Promise.resolve({ missing: true });
  const [wikidataRes, types, mg, jp, it, ...auth] = await Promise.all([wd, qid ? wikidata.typesOf(qid).catch(() => null) : null,
    ['artist', 'person'].includes(t.type) ? metagrid.find(adminPool, t, e) : null, japansearch.find(t, ours), arco.find(t, e, qid),
    ...AUTH.map((c) => authority.plan(t, e, c))]);
  const sources = { wikidata: wikidataRes, ...Object.fromEntries(AUTH.map((c, i) => [c, auth[i]])) };
  return { ours, qid, sources, merged: mergedRows(t, ours, sources), types, metagrid: mg, japan: jp, arco: it };
}

// The date fields offered by two or more sources → [{ key, ours, groups: [{ range, label, value, offers: [{src, status}] }] }]
function mergedRows(t, ours, sources) {
  const offers = {};  // key → [{src, value, label, status}]
  const add = (key, o) => { (offers[key] ||= []).push(o); };
  const wd = sources.wikidata.plan;
  if (wd) for (const r of wd.rows) if (r.kind === 'date' && r.value) add(r.key, { src: 'wikidata', value: r.value.value, label: r.display, status: r.status });
  for (const code of AUTH) {
    const p = sources[code].plan;
    if (p) for (const r of p.rows) if (r.key !== 'place') add(r.key, { src: code, value: r.theirs, label: r.label || r.theirs, status: r.status });
  }
  const rows = [];
  for (const [key, list] of Object.entries(offers)) {
    if (list.length < 2) continue;
    const groups = [];
    for (const o of list) {
      const range = rangeOf(o.value);
      const g = groups.find((x) => x.range && x.range === range);
      if (g) g.offers.push(o); else groups.push({ range, label: o.label, value: o.value, offers: [o] });
    }
    const oursText = ours[`f.${key}`] || '';
    const oursRange = rangeOf(oursText);
    for (const g of groups) g.same = !!oursRange && g.range === oursRange;
    rows.push({ key, ours: oursText, groups });
  }
  return rows;
}

// --- the page ----------------------------------------------------------------------------------------------------
const radio = (name, value, label, checked) => html`<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${label}</label>`;
const srcList = (offers) => offers.map((o) => NAMES[o.src]).join(', ');

function mergedTable(t, rows) {
  return html`<div class="table-wrap"><table class="diff wd-table enrich-merged"><thead><tr><th>Field</th><th>Yours</th><th>The sources</th></tr></thead><tbody>
    ${rows.map((r) => {
      const offered = r.groups.filter((g) => !g.same);
      // nothing replaces a value of yours by default; an empty field gets the value most sources give
      const best = !r.ours && offered.length ? offered.reduce((a, b) => (b.offers.length > a.offers.length ? b : a)) : null;
      const same = r.groups.find((g) => g.same);
      return html`<tr data-merged="${r.key}"><td>${fieldLabel(t.type, r.key)}</td><td>${r.ours || html`<span class="muted">(empty)</span>`}</td><td>
        ${same ? html`<div class="enrich-same">the same as yours in ${srcList(same.offers)} — cited:
          ${same.offers.map((o) => (o.src === 'wikidata' ? html`<span class="muted small">Wikidata (always)</span> `
            : html`<label class="choice"><input type="checkbox" name="${o.src}:cite.${r.key}" value="cite" checked> ${NAMES[o.src]}</label> `))}</div>` : ''}
        ${offered.map((g) => html`<div>${radio(`pick.${r.key}`, String(r.groups.indexOf(g)), html`<b>${g.label}</b>${String(g.label).includes(g.value) ? '' : html` <span class="muted small">(${g.value})</span>`} — ${srcList(g.offers)}`, g === best)}</div>`)}
        ${offered.length ? html`<div>${radio(`pick.${r.key}`, 'keep', r.ours ? 'keep mine' : 'leave empty', false)}
          ${radio(`pick.${r.key}`, 'later', 'decide later', !best)}
          ${offered.length > 1 ? html` <span class="tag qa-warning">the sources differ</span>` : ''}</div>` : ''}</td></tr>`;
    })}
  </tbody></table></div>`;
}

function sourceLine(t, e, code, res) {
  const name = NAMES[code];
  if (res.error) return html`<li><b>${name}:</b> <span class="flash error inline">${res.error}</span></li>`;
  if (res.missing) {
    if (code === 'wikidata') return html`<li><b>Wikidata:</b> <span class="muted">not linked —</span> <a href="/${t.folder}/${e.slug}/wikidata">Find on Wikidata…</a></li>`;
    if (code === 'sikart') return authority.SOURCES.sikart.types.includes(t.type) ? html`<li><b>SIKART:</b> <span class="muted">no number —</span> <a href="/${t.folder}/${e.slug}/sikart">Find in SIKART…</a></li>` : '';
    if (code === 'gnd') return authority.SOURCES.gnd.types.includes(t.type) ? html`<li><b>GND:</b> <span class="muted">no number — Wikidata and Metagrid often know it</span></li>` : '';
    return '';  // RKD, LC, BnF: compared when the entry has their number
  }
  if (code === 'wikidata') return html`<li><b>Wikidata:</b> <a href="https://www.wikidata.org/wiki/${res.plan.qid}" target="_blank" rel="noopener">${res.plan.qid} ↗</a> — <b>${res.plan.label}</b> <span class="muted">${res.plan.description}</span></li>`;
  return html`<li><b>${name}:</b> ${authority.recordLine(res.plan, code)}</li>`;
}

function page(t, e, data) {
  const { sources, merged, types, qid } = data;
  const wd = sources.wikidata.plan;
  const mergedKeys = merged.map((r) => r.key);
  // an institution's city from the GND only when Wikidata offers none (both would fill the same field)
  const wdPlace = wd && wd.rows.some((r) => r.key === 'place' && r.status !== 'same');
  const auth = AUTH.filter((c) => sources[c].plan);
  const wdIds = wd ? (wd.identifiers || []) : [];
  // numbers Wikidata offers too (the same value) are offered once, by Wikidata
  const authIds = (code) => ({ ...sources[code].plan, ids: (sources[code].plan.ids || []).filter((x) => !wdIds.some((w) => w.code === x.code && w.value === x.value)) });
  const fresh = wd ? wd.suggestions.filter((s) => !s.declined) : [];
  const declined = wd ? wd.suggestions.filter((s) => s.declined) : [];
  return html`<p class="muted"><a href="/${t.folder}/${e.slug}">← ${e.name}</a></p>
    <h1>Enrich ${e.name}</h1>
    ${types && !types.includes(t.type) ? typeWarning(t, types, qid, e) : ''}
    <ul class="enrich-sources">${['wikidata', ...AUTH].map((c) => sourceLine(t, e, c, sources[c]))}</ul>
    ${!wd && !auth.length && !data.japan && !data.arco && !(data.metagrid && (data.metagrid.exact || data.metagrid.candidates.length))
      ? html`<p class="flash warn">No source to compare with yet — link the entry on Wikidata or add a GND / SIKART number first.</p>` : html`
    <p class="muted small">One review for every source. Taken values are cited with their source — a value several sources agree on, with each of
      them. Your own values are never replaced unless you choose so; field values go into the working copy — check them and Publish.
      Relationships, new places and people, and reference records are created when you apply; any suggestion can be linked to another
      of ours instead, and relationships we have can be cited with the source.</p>
    <form method="post" action="/${t.folder}/${e.slug}/enrich" class="wd-form enrich-form">
      ${merged.length ? html`<h2>Offered by several sources</h2>${mergedTable(t, merged)}` : ''}
      ${wd ? html`<h2>Wikidata</h2>
        <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Field</th><th>Yours</th><th>Wikidata</th><th>Take?</th></tr></thead>
          <tbody>${wd.rows.filter((r) => !mergedKeys.includes(r.key)).map((r) => fieldRow(r, wdLinks))}</tbody></table></div>
        ${wd.images.length ? html`<h3>Images (Wikimedia Commons)</h3><div class="wd-images">${wd.images.map((img, i) => imageChoice(img, i))}</div>` : ''}` : ''}
      ${auth.map((code) => html`<h2>${NAMES[code]}</h2>
        ${authority.fieldsTable(t, sources[code].plan, code, { prefix: `${code}:`, skip: [...mergedKeys, ...(wdPlace ? ['place'] : [])] })}
        ${sources[code].plan.names && sources[code].plan.names.length ? html`<h3>Other names in ${NAMES[code]}</h3>${authority.namesTable(sources[code].plan, { prefix: `${code}:` })}` : ''}
        ${authority.variantsLine(sources[code].plan, code)}`)}
      <h2>Relationships</h2>
      ${wd && wd.suggestions.length ? html`<h3>Suggested by Wikidata</h3>
        <p class="actions wd-bulk">Set all open suggestions:
          <button type="button" class="secondary" data-wd-set="link">link where we have it</button>
          <button type="button" class="secondary" data-wd-set="skip">skip</button>
          <button type="button" class="secondary" data-wd-set="later">decide later</button></p>
        <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Relationship</th><th>With</th><th>Period</th><th>Do</th></tr></thead>
          <tbody>${fresh.map((s) => suggestionRow(s, wd.suggestions.indexOf(s), wdLinks))}</tbody></table></div>
        ${declined.length ? html`<details><summary class="muted">skipped before (${declined.length})</summary><table class="diff wd-table"><tbody>
          ${declined.map((s) => suggestionRow(s, wd.suggestions.indexOf(s), wdLinks))}</tbody></table></details>` : ''}` : ''}
      ${auth.map((code) => (sources[code].plan.rels.length ? html`<h3>Suggested by ${NAMES[code]}</h3>${authority.relsTable(sources[code].plan, code, { prefix: `${code}:` })}` : ''))}
      ${!(wd && wd.suggestions.length) && !auth.some((c) => sources[c].plan.rels.length) ? html`<p class="muted">None.</p>` : ''}
      ${wdIds.length || auth.some((c) => authIds(c).ids.length) ? html`<h2>Reference records</h2>
        ${wdIds.length ? html`<div class="table-wrap"><table class="diff wd-table wd-ids"><thead><tr><th>Authority</th><th>Yours</th><th>Wikidata</th><th>Take?</th></tr></thead>
          <tbody>${wdIds.map((x) => html`<tr><td>${x.name}</td><td>${x.ours || html`<span class="muted">(none)</span>`}</td>
            <td><a href="${x.url}" target="_blank" rel="noopener">${x.value} ↗</a></td>
            <td>${x.status === 'same' ? html`<span class="muted">the same</span>`
              : html`<label class="choice"><input type="checkbox" name="idf.${x.code}" value="take"${x.status === 'new' ? ' checked' : ''}> ${x.status === 'new' ? 'add' : 'replace yours'}</label>`}</td></tr>`)}</tbody></table></div>` : ''}
        ${auth.map((code) => (authIds(code).ids.length ? html`<h3>Known to ${NAMES[code]}</h3>${authority.idsTable(authIds(code), { prefix: `${code}:` })}` : ''))}` : ''}
      ${metagrid.section(data.metagrid)}
      ${japansearch.section(data.japan)}
      ${arco.section(data.arco)}
      <div class="actions sticky-actions"><button>Apply selected</button><a class="button secondary" href="/${t.folder}/${e.slug}">Cancel</a></div>
    </form>`}`;
}

// --- applying ----------------------------------------------------------------------------------------------------
// The posted form → each source's own choices (see the top)
function split(body, merged) {
  const own = (k) => !k.includes(':') && !k.startsWith('pick.');
  const choices = { wikidata: Object.fromEntries(Object.entries(body).filter(([k]) => own(k))) };
  for (const code of AUTH) choices[code] = authority.choicesOf(body, `${code}:`);
  for (const r of merged) {
    const pick = body[`pick.${r.key}`] || 'later';
    const chosen = /^\d+$/.test(pick) ? r.groups[Number(pick)] : null;
    for (const g of r.groups) {
      if (g.same) continue;
      for (const o of g.offers) {
        const take = chosen === g ? 'take' : pick === 'later' && o.src === 'wikidata' ? 'later' : 'keep';
        choices[o.src][`take.${r.key}`] = take;
      }
    }
  }
  return choices;
}

// → { form, created, relationships, images, ids } — field values into the working copy, the rest done
async function apply(t, e, data, body, user) {
  const { sources, merged, ours, qid } = data;
  const choices = split(body, merged);
  const results = await withTx(user, async (db) => {
    const out = {};
    if (sources.wikidata.plan) out.wikidata = await wikidata.apply(db, t, { type: t.type, id: e.id }, sources.wikidata.plan, choices.wikidata, user.id);
    for (const code of AUTH) if (sources[code].plan) out[code] = await authority.apply(db, t, e, code, sources[code].plan, choices[code], user);
    out.metagrid = await metagrid.apply(db, t, e, data.metagrid, body);
    return out;
  }, { source: 'enrich' });
  // the working copy: Wikidata's values last — for a value several sources agree on, its text and label win
  const form = {};
  for (const code of [...AUTH].reverse()) if (results[code] && results[code].form) Object.assign(form, results[code].form);
  if (results.wikidata) Object.assign(form, wikidata.withProvenance(results.wikidata.form, ours, qid));
  // the names field, from all sources together: Wikidata's (or ours), the other names ticked in the records, the
  // reading from Japan Search — each source alone computed it from ours and would undo the others
  const added = AUTH.flatMap((code) => (results[code] && results[code].addNames) || []);
  let namesText = (results.wikidata && results.wikidata.form['f.names']) ?? ours['f.names'];
  if (added.length) namesText = authority.withNames(namesText, added);
  const reading = japansearch.apply(data.japan, body, namesText);
  if (reading !== null) namesText = reading;
  // (otherwise the names field is Wikidata's, if it changed it, as before)
  if (added.length || reading !== null) form['f.names'] = namesText;
  // each citation waits for the value that actually went into the working copy
  const settled = (cites) => cites.map((c) => ({ ...c, form: Object.fromEntries(Object.keys(c.form).map((k) => [k, form[k] ?? c.form[k]])) }));
  if (Object.keys(form).length) {
    await collab.applyForm(t, e.id, form, user.username);
    await withTx(user, async (db) => {
      if (results.wikidata && results.wikidata.cites.length) await citations.pendingFromWikidata(db, t.type, e.id, qid, settled(results.wikidata.cites), user.id);
      for (const code of AUTH) {
        if (results[code] && results[code].cites.length) {
          await citations.pendingFromSource(db, t.type, e.id, authority.SOURCES[code].source, sources[code].plan.url, settled(results[code].cites), user.id);
        }
      }
    }, { source: 'enrich' });
  }
  const sum = (k) => Object.values(results).reduce((n, r) => n + (Array.isArray(r[k]) ? r[k].length : r[k] || 0), 0);
  return { form, created: sum('created'), relationships: sum('relationships'), images: sum('images'), ids: sum('ids') };
}

module.exports = { load, page, apply, split, mergedRows };
