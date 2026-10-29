// ---------------------------------------------------------------------------------------------------------------
// ColBase — the collections of Japan's four national museums (Tokyo, Kyoto, Nara, Kyushu; colbase.nich.go.jp) — on
// the Enrich page of an artwork with a Japanese title (roadmap 2026-10-28: "japanische Quellen über eine API"). ColBase
// has no API of its own; its records are in Japan Search (database "cobas"), each with the museum's inventory number,
// the heritage designation (国宝 National Treasure, 重要文化財 Important Cultural Property …), Japanese and English
// title, format, material, dimensions, date, maker and an image under CC BY. The record that is this work can give:
//   - its page at the museum (web_url) and — where the museum is ours or empty — the museum and inventory number,
//   - its heritage designation: a relationship "designated" to the glossary term (166), cited with the record,
//   - its image (CC BY: credited to the museum and ColBase).
// Only empty fields are filled; the form values go into the working copy with ColBase as their pending source, like
// the GND's. Base URL as Japan Search's (JAPANSEARCH_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const { html } = require('./html');
const names = require('../names');
const images = require('./images');

const BASE = process.env.JAPANSEARCH_BASE || 'https://jpsearch.go.jp';
const remember = memo();
const squash = (s) => String(s || '').replace(/[\s　]+/g, '');
// ColBase's designations (cobas-30, English) → our glossary terms (166)
const DESIGNATION = { 'National Treasure': 'national-treasure-japan', 'Important Cultural Property': 'important-cultural-property-japan',
  'Important Art Object': 'important-art-object-japan' };

async function ensureSource(db) {
  await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container)
    VALUES ('colbase', 'web', 'ColBase: Integrated Collections Database of the National Institutes for Cultural Heritage', 'ColBase',
            'https://colbase.nich.go.jp/', 'institution', 'National Institutes for Cultural Heritage (NICH), Japan')
    ON CONFLICT (slug) DO NOTHING`);
}

// a Japan Search item of ColBase → the record; photographs of a work (Tobunken's glass plates) are not the work
function record(it) {
  const f = (n) => it[`cobas-${n}-s`] || null;
  const c = it.common || {};
  return { id: it.id, url: it['cobas-1-u'] || c.linkUrl || `https://jpsearch.go.jp/item/${it.id}`, number: f(2),
    designation: f(30), designationJa: f(3), title: f(5) || c.title || '', reading: f(6), titleEn: f(32), format: f(7),
    by: f(34) || f(8), date: f(37) || f(11), material: f(38) || f(12), dimensions: f(13), holder: f(42) || f(16), provider: f(19),
    image: it['cobas-18-u'] || (c.contentsUrl || [])[0] || null, rights: c.contentsRightsType || null };
}

async function search(keyword) {
  return remember(keyword, async () => {
    const res = await fetch(`${BASE}/api/item/search/jps-cross?${new URLSearchParams({ keyword, size: '20', 'f-db': 'cobas' })}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Japan Search answered ${res.status}`);
    return ((await res.json()).list || []).map(record).filter((r) => r.provider !== 'tobunken');
  });
}

// → null (no section: not an artwork, no Japanese title) | { records, ours, holders } | { error }
async function find(db, t, ours) {
  if (t.type !== 'artwork') return null;
  const lines = String(ours['f.names'] || '').split('\n');
  const line = lines.find((l) => /^ja(-Jpan)?$/i.test(names.splitLine(l)[1] || ''));
  const title = line ? names.plain(names.splitLine(line)[0]) : /^ja/i.test(ours['f.title_lang'] || '') ? names.plain(ours['f.title'] || '') : null;
  if (!title) return null;
  let found;
  try { found = await search(title); } catch (err) { return { error: err.message }; }
  // the same title first; nothing else that isn't at least close
  const records = found.filter((r) => squash(r.title) === squash(title)).concat(found.filter((r) => squash(r.title) !== squash(title)
    && (squash(r.title).includes(squash(title)) || squash(title).includes(squash(r.title))))).slice(0, 6);
  if (!records.length) return null;
  // the museums among ours (by name), and the designations' terms
  const holders = {};
  for (const h of [...new Set(records.map((r) => r.holder).filter(Boolean))]) {
    const { rows } = await db.query(`SELECT slug, name FROM institutions WHERE f_unaccent(lower(name)) = f_unaccent(lower($1))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(names) n WHERE f_unaccent(lower(n->>'text')) = f_unaccent(lower($1))) LIMIT 1`, [h]);
    if (rows.length) holders[h] = rows[0];
  }
  const mine = { web_url: ours['f.web_url'] || '', institution: ours['f.institution'] || '', inventory_number: ours['f.inventory_number'] || '' };
  // a title like 自画像 ("self-portrait") is many works': the record at our museum is this one; with another museum of
  // ours, none is picked for us — with none, the only record of exactly this title
  const atOurs = (r) => !!mine.institution && (holders[r.holder] || {}).slug === mine.institution;
  records.sort((a, b) => Number(atOurs(b)) - Number(atOurs(a)));
  const exact = records.filter((r) => squash(r.title) === squash(title));
  const pick = records.find(atOurs) || (!mine.institution && exact.length === 1 ? exact[0] : null);
  return { records, title, holders, ours: mine, pick: pick ? pick.id : null, elsewhere: !!mine.institution && !records.some(atOurs) };
}

// what a record can give us, each only where ours is empty (and the number only where the museum is ours)
function offers(cb, r) {
  const museum = cb.holders[r.holder] || null;
  const sameMuseum = museum && (!cb.ours.institution || cb.ours.institution === museum.slug);
  return {
    web: !cb.ours.web_url && r.url ? r.url : null,
    institution: !cb.ours.institution && museum ? museum : null,
    number: sameMuseum && !cb.ours.inventory_number && r.number ? r.number : null,
    designation: DESIGNATION[r.designation] ? r.designation : null,
    image: r.image && /^ccby|^pdm|^cc0/.test(r.rights || '') ? r.image : null,
  };
}

function section(cb) {
  if (!cb) return '';
  if (cb.error) return html`<h2>ColBase (Japan's national museums)</h2><p class="flash error">ColBase could not be searched: ${cb.error}</p>`;
  return html`<h2>ColBase (Japan's national museums)</h2>
    <p class="muted small">Records of the Tokyo, Kyoto, Nara and Kyushu National Museums with this title (through Japan Search). Pick the one that
      is this work: what it gives is taken only where ours is empty, with ColBase as the source.</p>
    ${cb.elsewhere ? html`<p class="flash">None of these is at the museum this work is in — probably other works of the same title. Pick one only if it is this work.</p>` : ''}
    <div class="table-wrap"><table class="diff wd-table colbase-records"><tbody>${cb.records.map((r) => {
      const o = offers(cb, r);
      const box = (k, label) => html`<label class="choice"><input type="checkbox" name="cb:${r.id}:${k}" value="take" checked> ${label}</label>`;
      return html`<tr>
      <td><label class="choice"><input type="radio" name="cb:pick" value="${r.id}"${r.id === cb.pick ? ' checked' : ''}>
        <b>${r.title}</b></label>${r.titleEn ? html`<div class="muted small">${r.titleEn}</div>` : ''}
        <div class="small"><a href="${r.url}" target="_blank" rel="noopener">${r.holder || 'ColBase'}${r.number ? `, ${r.number}` : ''} ↗</a></div></td>
      <td class="small">${[r.by, r.date, r.format, r.material, r.dimensions].filter(Boolean).join(' · ')}
        ${r.designation ? html`<div><span class="tag">${r.designation}${r.designationJa ? ` (${r.designationJa})` : ''}</span></div>` : ''}</td>
      <td class="small">${o.web ? box('web', 'its page as our web page') : ''}
        ${o.institution ? box('institution', html`held by ${o.institution.name}`) : ''}
        ${o.number ? box('number', html`inventory number ${o.number}`) : ''}
        ${o.designation ? box('designation', html`designated: ${o.designation}`) : ''}
        ${o.image ? box('image', html`its image (${r.rights === 'ccby' ? 'CC BY' : r.rights})`) : ''}
        ${!o.web && !o.institution && !o.number && !o.designation && !o.image ? html`<span class="muted">nothing ours lacks</span>` : ''}</td></tr>`;
    })}</tbody></table></div>`;
}

// the picked record → { form: {f.key: value}, cites: [{field, form}], relationships, images, url } — form values for the
// working copy (cited when it is published); the designation and the image written now
async function apply(db, t, e, cb, body) {
  const out = { form: {}, cites: [], relationships: 0, images: 0, url: null };
  if (!cb || cb.error) return out;
  const r = cb.records.find((x) => x.id === body['cb:pick']);
  if (!r) return out;
  const o = offers(cb, r);
  const take = (k) => o[k] && body[`cb:${r.id}:${k}`] === 'take';
  await ensureSource(db);
  out.url = r.url;
  if (take('web')) out.form['f.web_url'] = o.web;
  if (take('institution')) { out.form['f.institution'] = o.institution.slug; out.cites.push({ field: 'institution', form: { 'f.institution': o.institution.slug } }); }
  if (take('number')) { out.form['f.inventory_number'] = o.number; out.cites.push({ field: 'inventory_number', form: { 'f.inventory_number': o.number } }); }
  if (take('designation')) {
    const ins = await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, notes_md)
      SELECT 'artwork', $1, 'designated_as', 'term', g.id, $3 FROM glossary g WHERE g.slug = $2
      ON CONFLICT DO NOTHING RETURNING id`, [e.id, DESIGNATION[r.designation], r.designationJa ? `${r.designationJa} — ${r.holder || 'ColBase'}` : null]);
    if (ins.rows.length) {
      await db.query(`INSERT INTO citations (relationship_id, source_id, url, accessed)
        SELECT $1, id, $2, current_date FROM bibliography WHERE slug = 'colbase'`, [ins.rows[0].id, r.url]);
      out.relationships += 1;
    }
  }
  if (take('image')) {
    const already = await db.query('SELECT 1 FROM images WHERE artwork_id = $1 AND url = $2', [e.id, o.image]);
    if (!already.rows.length) {
      await images.add(db, 'artwork', e.id, [o.image, r.url, r.rights === 'ccby' ? 'CC BY 4.0' : r.rights, `${r.holder || 'National Institutes for Cultural Heritage'}, ColBase`, null]);
      out.images += 1;
    }
  }
  return out;
}

module.exports = { find, section, apply, search, record, ensureSource, DESIGNATION };
