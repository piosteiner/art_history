// Admin panel — the Quality queue: the next entry of a filter, and batch pages for checks many entries share
// (find their Wikidata items; cite the values the GND or SIKART agrees with). src/admin/quality.js has the queue itself.
// Mounted by src/admin/index.js in a fixed order (before the entry pages: /quality/next is not /:plural/:slug).
const express = require('express');
const { adminPool } = require('../../db');
const { BY_TYPE } = require('../../content');
const { html } = require('../html');
const quality = require('../quality');
const wikidata = require('../wikidata');
const citations = require('../citations');
const authority = require('../authority');
const { fieldLabel } = require('../forms');
const { send, withTx, findEntity } = require('../core');

const router = express.Router();
const PER_PAGE = 10;
const keyOf = (r) => `${r.type}/${r.slug}`;
const fromKey = (k) => { const [type, slug] = String(k).split('/'); return BY_TYPE[type] && slug ? { t: BY_TYPE[type], slug } : null; };
const pageOf = (req) => Math.max(0, Number.parseInt(req.query.p ?? (req.body || {}).p, 10) || 0);
// a few at a time — Wikidata and the GND are asked for every entry of the page
async function inBatches(list, n, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(...await Promise.all(list.slice(i, i + n).map(fn)));
  return out;
}
const pager = (base, p, total) => html`<p class="actions">${p > 0 ? html`<a class="button secondary" href="${base}p=${p - 1}">← previous ${PER_PAGE}</a>` : ''}
  <span class="muted">${Math.min(total, p * PER_PAGE + 1)}–${Math.min(total, (p + 1) * PER_PAGE)} of ${total}</span>
  ${(p + 1) * PER_PAGE < total ? html`<a class="button secondary" href="${base}p=${p + 1}">next ${PER_PAGE} →</a>` : ''}</p>`;

// "Next issue →" from an entry page
router.get('/quality/next', async (req, res) => {
  const filter = quality.filterOf(req.query);
  await quality.current(adminPool);  // the entry just fixed has left the list
  const n = await quality.next(adminPool, filter, String(req.query.after || ''), Number.parseInt(req.query.pos, 10) || 0);
  if (!n) return res.redirect(303, `/quality?${quality.filterQuery(filter, { done: 'queue-done' })}`);
  res.redirect(303, quality.queueLink(n, filter, n.pos));
});

// ---------------------------------------------------------------------------------------------------------------
// Entries without a Wikidata id: the best hits of a Wikidata search by name, side by side — pick, link them all.
// An exact name is pre-selected; nothing else. Linked entries are then ready for Enrich.
// ---------------------------------------------------------------------------------------------------------------
async function withoutWikidata(type) {
  return quality.issues(adminPool, { check: 'no_wikidata_id', type: BY_TYPE[type] ? type : undefined });
}
router.get('/quality/batch/wikidata', async (req, res) => {
  await quality.current(adminPool);
  const type = BY_TYPE[req.query.type] ? req.query.type : '';
  const all = await withoutWikidata(type);
  const p = pageOf(req);
  const rows = all.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
  const hits = await inBatches(rows, 4, (r) => wikidata.search(r.name).then((list) => list.slice(0, 4), () => null));
  const base = `/quality/batch/wikidata?${type ? `type=${type}&` : ''}`;
  send(req, res, { title: 'Find Wikidata items', body: html`<p class="muted"><a href="/quality?check=no_wikidata_id">← Quality</a></p>
    <h1>Find Wikidata items</h1>
    <p class="muted">For each entry the best hits of a Wikidata search by its name. Pick the right one — or none. An exact name is
      pre-selected; check its description. Linking only sets the Wikidata id: <b>Enrich…</b> then compares the values.</p>
    ${!all.length ? html`<p class="flash ok">Every entry has its Wikidata id.</p>` : html`
    <form method="post" action="/quality/batch/wikidata" class="wd-form batch-form"><input type="hidden" name="type" value="${type}"><input type="hidden" name="p" value="${p}">
      <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Entry</th><th>Wikidata</th></tr></thead><tbody>
      ${rows.map((r, i) => {
        const list = hits[i];
        const exact = list && list.find((h) => String(h.label).toLowerCase() === String(r.name).toLowerCase());
        return html`<tr data-entry="${keyOf(r)}"><td><a href="/${BY_TYPE[r.type].folder}/${r.slug}" target="_blank">${r.name}</a> <span class="tag">${r.type}</span></td><td>
          ${list === null ? html`<span class="flash error inline">search failed</span>` : !list.length ? html`<span class="muted">nothing found</span>` : ''}
          ${(list || []).map((h) => html`<div><label class="choice"><input type="radio" name="q.${keyOf(r)}" value="${h.id}"${h === exact ? ' checked' : ''}>
            <b>${h.label}</b> <span class="muted small">${h.description || ''}</span></label> <a class="tag" href="https://www.wikidata.org/wiki/${h.id}" target="_blank" rel="noopener">${h.id} ↗</a></div>`)}
          <div><label class="choice"><input type="radio" name="q.${keyOf(r)}" value=""${exact ? '' : ' checked'}> none of these</label>
            <a class="small" href="/${BY_TYPE[r.type].folder}/${r.slug}/wikidata" target="_blank">search myself…</a></div></td></tr>`;
      })}</tbody></table></div>
      <div class="actions sticky-actions"><button>Link the picked items</button></div>
    </form>${pager(base, p, all.length)}`}` });
});
router.post('/quality/batch/wikidata', async (req, res) => {
  const done = [];
  const failed = [];
  await withTx(req.user, async (db) => {
    for (const [k, v] of Object.entries(req.body)) {
      if (!k.startsWith('q.') || !/^Q[1-9][0-9]*$/.test(String(v))) continue;
      const ref = fromKey(k.slice(2));
      if (!ref) continue;
      // one at a time: an item already linked to another entry is refused (unique) — the others still go in
      await db.query('SAVEPOINT link');
      try {
        const { rows } = await db.query(`UPDATE ${ref.t.table} SET wikidata_id = $1 WHERE slug = $2 AND wikidata_id IS NULL RETURNING name`, [v, ref.slug]);
        await db.query('RELEASE SAVEPOINT link');
        if (rows.length) done.push({ t: ref.t, slug: ref.slug, name: rows[0].name, qid: v });
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT link');
        failed.push({ t: ref.t, slug: ref.slug, qid: v, why: /unique|duplicate/i.test(err.message) ? 'already the item of another entry' : err.message });
      }
    }
  }, { source: 'wikidata' });
  const type = BY_TYPE[req.body.type] ? req.body.type : '';
  send(req, res, { title: 'Find Wikidata items', body: html`<p class="muted"><a href="/quality?check=no_wikidata_id">← Quality</a></p>
    <h1>Linked ${done.length} ${done.length === 1 ? 'entry' : 'entries'}</h1>
    ${done.length ? html`<div class="table-wrap"><table><tbody>${done.map((d) => html`<tr><td><a href="/${d.t.folder}/${d.slug}">${d.name}</a></td>
      <td><span class="tag">${d.qid}</span></td><td><a class="button secondary" href="/${d.t.folder}/${d.slug}/enrich">Enrich…</a></td></tr>`)}</tbody></table></div>` : ''}
    ${failed.length ? html`<div class="flash error">Not linked:<ul>${failed.map((f) => html`<li><a href="/${f.t.folder}/${f.slug}">${f.slug}</a> → ${f.qid}: ${f.why}</li>`)}</ul></div>` : ''}
    <p class="actions"><a class="button" href="/quality/batch/wikidata?${type ? `type=${type}&` : ''}p=${pageOf(req)}">Next entries</a>
      <a class="button secondary" href="/quality?check=no_wikidata_id">Back to the list</a></p>` });
});

// ---------------------------------------------------------------------------------------------------------------
// Weakly sourced entries with a GND or SIKART number: the values the record agrees with, cited in one go.
// ---------------------------------------------------------------------------------------------------------------
async function weakWithNumbers(type) {
  const rows = await quality.issues(adminPool, { check: 'weakly_sourced', type: BY_TYPE[type] ? type : undefined });
  if (!rows.length) return [];
  const { rows: ids } = await adminPool.query(`SELECT e.type::text AS type, e.slug, array_agg(i.authority ORDER BY i.authority) AS codes
    FROM entry_identifiers i JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id)
    WHERE i.authority IN ('gnd', 'sikart') GROUP BY 1, 2`);
  const codes = new Map(ids.map((x) => [`${x.type}/${x.slug}`, x.codes]));
  return rows.filter((r) => codes.has(keyOf(r))).map((r) => ({ ...r, codes: codes.get(keyOf(r)) }));
}
// an entry's agreeing values per source → [{ code, plan, keys }] (or an error)
async function agreements(r) {
  const t = BY_TYPE[r.type];
  const e = await findEntity(t, r.slug);
  if (!e) return { e: null, list: [] };
  const list = [];
  for (const code of r.codes) {
    const { plan, error } = await authority.plan(t, e, code);
    if (error) list.push({ code, error });
    else if (plan) list.push({ code, plan, keys: plan.rows.filter((x) => x.status === 'same').map((x) => x.key) });
  }
  return { e, list };
}
router.get('/quality/batch/cite', async (req, res) => {
  await quality.current(adminPool);
  const type = BY_TYPE[req.query.type] ? req.query.type : '';
  const all = await weakWithNumbers(type);
  const p = pageOf(req);
  const rows = all.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
  const found = await inBatches(rows, 3, agreements);
  const base = `/quality/batch/cite?${type ? `type=${type}&` : ''}`;
  send(req, res, { title: 'Cite agreeing values', body: html`<p class="muted"><a href="/quality?check=weakly_sourced">← Quality</a></p>
    <h1>Cite where the GND or SIKART agrees</h1>
    <p class="muted">Weakly sourced entries that have a GND or SIKART number: the values the record gives exactly as you have them.
      Ticked values are cited with that record (the GND counts as an institution’s source, SIKART as scholarly). Everything else —
      differing or new values — is for <b>Enrich…</b>.</p>
    ${!all.length ? html`<p class="flash ok">No weakly sourced entry with a GND or SIKART number.</p>` : html`
    <form method="post" action="/quality/batch/cite" class="wd-form batch-form"><input type="hidden" name="type" value="${type}"><input type="hidden" name="p" value="${p}">
      <div class="table-wrap"><table class="diff wd-table"><thead><tr><th>Entry</th><th>Weak</th><th>The record agrees</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr data-entry="${keyOf(r)}"><td><a href="/${BY_TYPE[r.type].folder}/${r.slug}" target="_blank">${r.name}</a> <span class="tag">${r.type}</span></td>
        <td class="small">${r.detail}</td><td>
        ${found[i].list.map((x) => (x.error ? html`<div class="flash error inline">${x.error}</div>`
          : html`<div><b>${authority.SOURCES[x.code].short}:</b> ${x.keys.length ? x.keys.map((k) => html`<label class="choice"><input type="checkbox" name="c.${keyOf(r)}.${x.code}" value="${k}" checked> ${fieldLabel(r.type, k)}</label> `)
            : html`<span class="muted">nothing the same</span>`}</div>`))}</td>
        <td><a class="button secondary" href="/${BY_TYPE[r.type].folder}/${r.slug}/enrich" target="_blank">Enrich…</a></td></tr>`)}
      </tbody></table></div>
      <div class="actions sticky-actions"><button>Cite the ticked values</button></div>
    </form>${pager(base, p, all.length)}`}` });
});
router.post('/quality/batch/cite', async (req, res) => {
  // c.<type>/<slug>.<code> = [field, …]
  const wanted = new Map();
  for (const [k, v] of Object.entries(req.body)) {
    const m = /^c\.([a-z]+\/[a-z0-9-]+)\.(gnd|sikart)$/.exec(k);
    if (m) wanted.set(`${m[1]}|${m[2]}`, [].concat(v).map(String));
  }
  let n = 0;
  await withTx(req.user, async (db) => {
    for (const [key, fields] of wanted) {
      const [entry, code] = key.split('|');
      const ref = fromKey(entry);
      const e = ref && await findEntity(ref.t, ref.slug);
      if (!e) continue;
      // checked again: only values the record (still) agrees with
      const { plan } = await authority.plan(ref.t, e, code);
      if (!plan) continue;
      const keys = plan.rows.filter((x) => x.status === 'same' && fields.includes(x.key)).map((x) => x.key);
      if (!keys.length) continue;
      await authority.SOURCES[code].opts.ensure(db);
      await citations.citeAgreeingSource(db, ref.t.type, e.id, authority.SOURCES[code].source, plan.url, keys, req.user.id);
      n += keys.length;
    }
  }, { source: 'enrich' });
  const type = BY_TYPE[req.body.type] ? req.body.type : '';
  res.redirect(303, `/quality/batch/cite?${type ? `type=${type}&` : ''}p=${pageOf(req)}&done=cited&n=${n}`);
});

module.exports = router;
