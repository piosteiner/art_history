// ---------------------------------------------------------------------------------------------------------------
// Japan's heritage databases on the Enrich page of an artwork with a Japanese title (roadmap 2026-10-28: "japanische
// Quellen über eine API"), both read through Japan Search, which is the only one of them with an API:
//   - ColBase (database "cobas"): the collections of the four national museums (Tokyo, Kyoto, Nara, Kyushu) — the
//     museum's inventory number, the heritage designation (国宝 National Treasure, 重要文化財 Important Cultural
//     Property …), title, format, material, dimensions, date, maker and an image under CC BY;
//   - Cultural Heritage Online (database "bunka", 文化遺産オンライン of the Agency for Cultural Affairs): every
//     designated cultural property in Japan, also those of temples and shrines, with the owner and the dates of its
//     designations (重文指定年月日 19200415, 国宝指定年月日 19930610); its images are not under a free licence.
// The record that is this work can give: its page as our web page (ColBase's, else the Agency's), the museum and its
// inventory number (ColBase, where the museum is ours or empty), its designations as relationships "designated" to the
// glossary terms (166) — dated when the record has the date — cited with the record, and its CC BY image (ColBase).
// Only empty fields are filled; form values go into the working copy with the source pending, like the GND's.
// Base URL as Japan Search's (JAPANSEARCH_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const { html } = require('./html');
const names = require('../names');
const images = require('./images');
const { parseFuzzyDate } = require('../fuzzy-date');

const BASE = process.env.JAPANSEARCH_BASE || 'https://jpsearch.go.jp';
const remember = memo();
const squash = (s) => String(s || '').replace(/[\s　]+/g, '');
// designations → our glossary terms (166): ColBase names them in English, the Agency by the date fields' names
const DESIGNATION = { 'National Treasure': 'national-treasure-japan', 'Important Cultural Property': 'important-cultural-property-japan',
  'Important Art Object': 'important-art-object-japan' };
const TERM_LABEL = { 'national-treasure-japan': 'National Treasure', 'important-cultural-property-japan': 'Important Cultural Property',
  'important-art-object-japan': 'Important Art Object' };
const DATE_FIELD = { 重文指定年月日: 'important-cultural-property-japan', 国宝指定年月日: 'national-treasure-japan' };

// a Japan Search item → the record ({…, designations: [{term, since}]}); null when it isn't a work's record
const RECORD = {
  // photographs of a work (Tobunken's glass plates) are not the work
  colbase(it) {
    const f = (n) => it[`cobas-${n}-s`] || null;
    const c = it.common || {};
    if (f(19) === 'tobunken') return null;
    return { id: it.id, url: it['cobas-1-u'] || c.linkUrl || `https://jpsearch.go.jp/item/${it.id}`, number: f(2),
      designations: DESIGNATION[f(30)] ? [{ term: DESIGNATION[f(30)], since: null }] : [], designationText: [f(30), f(3) && `(${f(3)})`].filter(Boolean).join(' '),
      title: f(5) || c.title || '', reading: f(6), titleEn: f(32), format: f(7),
      by: f(34) || f(8), date: f(37) || f(11), material: f(38) || f(12), dimensions: f(13), holder: f(42) || f(16),
      image: it['cobas-18-u'] || (c.contentsUrl || [])[0] || null, rights: c.contentsRightsType || null };
  },
  // "重文指定年月日:19200415\n国宝指定年月日:19930610\n登録年月日:" → the designations with their dates
  bunka(it) {
    const f = (n) => it[`bunka-${n}-s`] || null;
    const c = it.common || {};
    const designations = [];
    for (const line of String(f(15) || '').split('\n')) {
      const [key, value] = line.split(':');
      const d = /^(\d{4})(\d{2})(\d{2})$/.exec((value || '').trim());
      if (DATE_FIELD[key] && d) designations.push({ term: DATE_FIELD[key], since: `${d[1]}-${d[2]}-${d[3]}` });
    }
    return { id: it.id, url: it['bunka-12-u'] || c.linkUrl || `https://jpsearch.go.jp/item/${it.id}`, number: null, designations,
      designationText: [f(11), ...designations.map((x) => `${TERM_LABEL[x.term]} since ${x.since}`)].filter(Boolean).join(' · '),
      title: f(1) || c.title || '', reading: f(2), titleEn: null, format: f(3), by: f(7), date: [f(9), f(8)].filter(Boolean).join(', '),
      material: null, dimensions: null, holder: f(14), image: null, rights: null };
  },
};

const SOURCES = {
  colbase: { db: 'cobas', key: 'cb', name: 'ColBase (Japan\'s national museums)', source: 'colbase',
    intro: 'Records of the Tokyo, Kyoto, Nara and Kyushu National Museums with this title (through Japan Search).' },
  bunka: { db: 'bunka', key: 'bk', name: 'Cultural Heritage Online (designated cultural properties)', source: 'bunka-online',
    intro: 'Japan\'s designated cultural properties with this title, also those of temples and shrines — with the dates of their designations (the Agency for Cultural Affairs, through Japan Search).' },
};

async function ensureSources(db) {
  await db.query(`INSERT INTO bibliography (slug, kind, name, siglum, url, reliability, container) VALUES
    ('colbase', 'web', 'ColBase: Integrated Collections Database of the National Institutes for Cultural Heritage', 'ColBase',
     'https://colbase.nich.go.jp/', 'institution', 'National Institutes for Cultural Heritage (NICH), Japan'),
    ('bunka-online', 'web', 'Cultural Heritage Online', 'Bunka Isan Online', 'https://online.bunka.go.jp/', 'institution', 'Agency for Cultural Affairs, Japan')
    ON CONFLICT (slug) DO NOTHING`);
}

async function search(code, keyword) {
  const src = SOURCES[code];
  return remember(`${code}:${keyword}`, async () => {
    const res = await fetch(`${BASE}/api/item/search/jps-cross?${new URLSearchParams({ keyword, size: '20', 'f-db': src.db })}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'arthistory.piogino.ch admin (research database)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Japan Search answered ${res.status}`);
    return ((await res.json()).list || []).map(RECORD[code]).filter(Boolean);
  });
}

// our Japanese title: the Japanese name, else the title when it is Japanese
function japaneseTitle(ours) {
  const line = String(ours['f.names'] || '').split('\n').find((l) => /^ja(-Jpan)?$/i.test(names.splitLine(l)[1] || ''));
  return line ? names.plain(names.splitLine(line)[0]) : /^ja/i.test(ours['f.title_lang'] || '') ? names.plain(ours['f.title'] || '') : null;
}

// → null (no section: not an artwork, no Japanese title, nothing found) | { code, records, holders, ours, pick, elsewhere } | { error }
async function find(db, t, ours, code = 'colbase') {
  if (t.type !== 'artwork') return null;
  const title = japaneseTitle(ours);
  if (!title) return null;
  // a common title (大日如来坐像: dozens of statues) with the Japanese name of the place it is in (円成寺) first
  const { rows: here } = ours['f.institution'] ? await db.query(`SELECT n->>'text' AS name FROM institutions i, jsonb_array_elements(i.names) n
    WHERE i.slug = $1 AND n->>'lang' LIKE 'ja%'`, [ours['f.institution']]) : { rows: [] };
  let found = [];
  try {
    for (const h of here) found = found.concat(await search(code, `${title} ${names.plain(h.name)}`));
    if (!found.length) found = await search(code, title);
  } catch (err) { return { code, error: err.message }; }
  // the same title first; then titles around ours (the Agency writes 木造大日如来坐像〈運慶作／〉 for 大日如来坐像)
  const records = found.filter((r) => squash(r.title) === squash(title)).concat(found.filter((r) => squash(r.title) !== squash(title)
    && (squash(r.title).includes(squash(title)) || squash(title).includes(squash(r.title))))).slice(0, 6);
  if (!records.length) return null;
  // the holders among ours (by any of their names: 円成寺 is the Enjō-ji Temple)
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
  return { code, records, title, holders, ours: mine, pick: pick ? pick.id : null, elsewhere: !!mine.institution && !records.some(atOurs) };
}

// what a record can give us, each only where ours is empty (and the number only where the museum is ours)
function offers(found, r) {
  const museum = found.holders[r.holder] || null;
  const sameMuseum = museum && (!found.ours.institution || found.ours.institution === museum.slug);
  return {
    web: !found.ours.web_url && r.url ? r.url : null,
    institution: !found.ours.institution && museum ? museum : null,
    number: sameMuseum && !found.ours.inventory_number && r.number ? r.number : null,
    designation: r.designations.length ? r.designations : null,
    image: r.image && /^ccby|^pdm|^cc0/.test(r.rights || '') ? r.image : null,
  };
}

function section(found) {
  if (!found) return '';
  const src = SOURCES[found.code];
  if (found.error) return html`<h2>${src.name}</h2><p class="flash error">${src.name} could not be searched: ${found.error}</p>`;
  const k = src.key;
  return html`<h2>${src.name}</h2>
    <p class="muted small">${src.intro} Pick the one that is this work: what it gives is taken only where ours is empty, with it as the source.</p>
    ${found.elsewhere ? html`<p class="flash">None of these is at the place this work is in — probably other works of the same title. Pick one only if it is this work.</p>` : ''}
    <div class="table-wrap"><table class="diff wd-table ${found.code}-records"><tbody>${found.records.map((r) => {
      const o = offers(found, r);
      const box = (what, label) => html`<label class="choice"><input type="checkbox" name="${k}:${r.id}:${what}" value="take" checked> ${label}</label>`;
      return html`<tr>
      <td><label class="choice"><input type="radio" name="${k}:pick" value="${r.id}"${r.id === found.pick ? ' checked' : ''}>
        <b>${r.title}</b></label>${r.titleEn ? html`<div class="muted small">${r.titleEn}</div>` : ''}
        <div class="small"><a href="${r.url}" target="_blank" rel="noopener">${r.holder || src.name}${r.number ? `, ${r.number}` : ''} ↗</a></div></td>
      <td class="small">${[r.by, r.date, r.format, r.material, r.dimensions].filter(Boolean).join(' · ')}
        ${r.designationText ? html`<div><span class="tag">${r.designationText}</span></div>` : ''}</td>
      <td class="small">${o.web ? box('web', 'its page as our web page') : ''}
        ${o.institution ? box('institution', html`held by ${o.institution.name}`) : ''}
        ${o.number ? box('number', html`inventory number ${o.number}`) : ''}
        ${o.designation ? box('designation', html`designated: ${o.designation.map((x) => `${TERM_LABEL[x.term]}${x.since ? ` since ${x.since}` : ''}`).join(', ')}`) : ''}
        ${o.image ? box('image', html`its image (${r.rights === 'ccby' ? 'CC BY' : r.rights})`) : ''}
        ${!o.web && !o.institution && !o.number && !o.designation && !o.image ? html`<span class="muted">nothing ours lacks</span>` : ''}</td></tr>`;
    })}</tbody></table></div>`;
}

// the picked record → { form: {f.key: value}, cites: [{field, form}], relationships, images, url, source } — form values
// for the working copy (cited when it is published); the designations and the image written now
async function apply(db, t, e, found, body, already = {}) {
  const out = { form: {}, cites: [], relationships: 0, images: 0, url: null, source: found && SOURCES[found.code] ? SOURCES[found.code].source : null };
  if (!found || found.error) return out;
  const k = SOURCES[found.code].key;
  const r = found.records.find((x) => x.id === body[`${k}:pick`]);
  if (!r) return out;
  const o = offers(found, r);
  const take = (what) => o[what] && body[`${k}:${r.id}:${what}`] === 'take';
  await ensureSources(db);
  out.url = r.url;
  // the same field from two sources in one Apply: the first (ColBase) wins
  if (take('web') && !already['f.web_url']) out.form['f.web_url'] = o.web;
  if (take('institution') && !already['f.institution']) { out.form['f.institution'] = o.institution.slug; out.cites.push({ field: 'institution', form: { 'f.institution': o.institution.slug } }); }
  if (take('number') && !already['f.inventory_number']) { out.form['f.inventory_number'] = o.number; out.cites.push({ field: 'inventory_number', form: { 'f.inventory_number': o.number } }); }
  if (take('designation')) {
    for (const d of o.designation) {
      const p = d.since ? parseFuzzyDate(`${d.since}/`, { openEnd: true }) : null;
      // one designation per term: a dated one from the Agency completes an undated one from ColBase
      const { rows: have } = await db.query(`SELECT r.id, r.period FROM relationships r JOIN glossary g ON g.id = r.object_id
        WHERE r.subject_type = 'artwork' AND r.subject_id = $1 AND r.relationship_type = 'designated_as' AND r.object_type = 'term' AND g.slug = $2`, [e.id, d.term]);
      let id = have.length ? have[0].id : null;
      if (!id) {
        const ins = await db.query(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label, notes_md)
          SELECT 'artwork', $1, 'designated_as', 'term', g.id, $3::daterange, $4, $5 FROM glossary g WHERE g.slug = $2 RETURNING id`,
        [e.id, d.term, p ? p.range : null, p ? p.label : null, r.holder ? `${r.holder}` : null]);
        if (!ins.rows.length) continue;
        id = ins.rows[0].id;
        out.relationships += 1;
      } else if (p && !have[0].period) {
        await db.query('UPDATE relationships SET period = $2::daterange, period_label = $3 WHERE id = $1', [id, p.range, p.label]);
      }
      await db.query(`INSERT INTO citations (relationship_id, source_id, url, accessed)
        SELECT $1, b.id, $2, current_date FROM bibliography b WHERE b.slug = $3
        AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.relationship_id = $1 AND c.source_id = b.id)`, [id, r.url, SOURCES[found.code].source]);
    }
  }
  if (take('image')) {
    const have = await db.query('SELECT 1 FROM images WHERE artwork_id = $1 AND url = $2', [e.id, o.image]);
    if (!have.rows.length) {
      await images.add(db, 'artwork', e.id, [o.image, r.url, r.rights === 'ccby' ? 'CC BY 4.0' : r.rights, `${r.holder || 'National Institutes for Cultural Heritage'}, ColBase`, null]);
      out.images += 1;
    }
  }
  return out;
}

module.exports = { find, section, apply, search, RECORD, SOURCES, ensureSources, DESIGNATION };
