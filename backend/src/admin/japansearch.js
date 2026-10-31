// ---------------------------------------------------------------------------------------------------------------
// Japan Search (jpsearch.go.jp, the national portal) on the Enrich page of an artwork with a Japanese title: the same
// title in Japanese collections — prints exist in many impressions, so each record is another museum's copy: listed
// with its holder, rights and link, never taken as ours. What it can give us: the reading (titleYomi) as furigana when
// our Japanese title has none — {名所江戸百景|めいしょえどひゃっけい} {亀戸梅屋舗|かめいどうめやしき}.
// English titles find nothing useful there, so no Japanese title, no section.
// Base URL configurable (JAPANSEARCH_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const { html } = require('./html');
const names = require('../names');
const { getJson } = require('./http');

const BASE = process.env.JAPANSEARCH_BASE || 'https://jpsearch.go.jp';
const RIGHTS = { pdm: 'public domain', cc0: 'CC0', ccby: 'CC BY', ccbysa: 'CC BY-SA', ccbync: 'CC BY-NC', ccbyncsa: 'CC BY-NC-SA', ccbynd: 'CC BY-ND', ccbyncnd: 'CC BY-NC-ND', incr: 'in copyright' };
const remember = memo();
// Japan Search names its providers by code
const HOLDERS = { ndl: 'National Diet Library', edo_tokyo_museum: 'Edo-Tokyo Museum', tnm: 'Tokyo National Museum', colbase: 'ColBase',
  arc_ritsumeikan: 'Ritsumeikan University Art Research Center', NPMoA: 'National Museum of Modern Art, Tokyo', kyohaku: 'Kyoto National Museum',
  nihu_irc: 'International Research Center for Japanese Studies', tokyo_metro_library: 'Tokyo Metropolitan Library' };
const holder = (code) => HOLDERS[code] || code || '';
const squash = (s) => String(s || '').replace(/[\s　]+/g, '');

async function search(keyword) {
  return remember(keyword, async () => {
    const answer = await getJson(`${BASE}/api/item/search/jps-cross?${new URLSearchParams({ keyword, size: '12' })}`,
      { name: 'Japan Search', timeout: 20000 });
    return (answer.list || []).map((it) => {
      const c = it.common || {};
      return { id: it.id, title: c.title || '', yomi: c.titleYomi || '', holder: holder(c.provider || c.ownerOrg), rights: RIGHTS[c.contentsRightsType] || '',
        url: c.linkUrl || `https://jpsearch.go.jp/item/${it.id}`, by: (c.contributor || [])[0] || '', date: (c.temporal || [])[0] || '' };
    });
  });
}

// title "名所江戸百景　亀戸梅屋舗" + reading "めいしょえどひゃっけい かめいどうめやしき" → furigana word by word; null if they don't pair
function rubyOf(title, yomi) {
  const words = String(title).trim().split(/[\s　]+/);
  const reads = String(yomi).trim().split(/[\s　]+/);
  if (!yomi || words.length !== reads.length) return null;
  const text = words.map((w, i) => `{${w}|${reads[i]}}`).join(' ');
  return names.rubyError && names.rubyError(text) ? null : text;
}

// → null (no section) | { records, ours: {line, index}, reading } | { error }
async function find(t, ours) {
  if (t.type !== 'artwork') return null;
  const lines = String(ours['f.names'] || '').split('\n');
  const index = lines.findIndex((l) => { const [, lang] = names.splitLine(l); return /^ja(-Jpan)?$/i.test(lang || ''); });
  if (index < 0) return null;
  const [text] = names.splitLine(lines[index]);
  const plain = names.plain(text);
  let records;
  try { records = await search(plain); } catch (err) { return { error: err.message }; }
  const same = records.filter((r) => squash(r.title).endsWith(squash(plain)));
  // the reading of a record with exactly our title (no series name around it)
  const exact = names.hasRuby(text) ? null : same.find((r) => squash(r.title) === squash(plain) && r.yomi);
  const reading = exact ? rubyOf(text, exact.yomi) : null;
  return { records: same.length ? same : records.slice(0, 5), matched: same.length > 0, ours: { line: lines[index], index, text }, reading };
}

function section(jp) {
  if (!jp) return '';
  if (jp.error) return html`<h2>Japan Search</h2><p class="flash error">Japan Search could not be searched: ${jp.error}</p>`;
  return html`<h2>Japan Search</h2>
    <p class="muted small">${jp.matched ? 'This title in Japanese collections' : 'Nothing with exactly this title — the closest records'}: other impressions or
      copies, each its museum's own — linked, not taken as ours.</p>
    ${jp.reading ? html`<p><label class="choice"><input type="checkbox" name="jp:reading" value="take" checked> add the reading to our Japanese title:
      <b>${jp.reading}</b></label></p>` : ''}
    <div class="table-wrap"><table class="diff wd-table jp-records"><tbody>${jp.records.map((r) => html`<tr>
      <td><a href="${r.url}" target="_blank" rel="noopener">${r.title} ↗</a>${r.yomi ? html`<div class="muted small">${r.yomi}</div>` : ''}</td>
      <td>${r.holder}</td><td class="small">${[r.by, r.date].filter(Boolean).join(', ')}</td><td><span class="tag">${r.rights || '?'}</span></td></tr>`)}
    </tbody></table></div>`;
}

// the ticked reading → the names text with our Japanese title's line rewritten (namesText: ours, or what Wikidata's
// names made of it in the same Apply) — null when not ticked
function apply(jp, body, namesText) {
  if (!jp || !jp.reading || body['jp:reading'] !== 'take') return null;
  return String(namesText || '').split('\n').map((l) => {
    if (l.trim() !== jp.ours.line.trim()) return l;
    const parts = names.splitLine(l);
    parts[0] = jp.reading;
    return parts.join(' | ');
  }).join('\n');
}

module.exports = { find, section, apply, rubyOf, search, holder };
