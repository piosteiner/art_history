// A credit for a Commons image whose description page has no machine-readable author (extmetadata Artist empty —
// Commons' category "Files with no machine-readable author"). The page usually still names someone: read its wikitext.
// Order: author/artist/photographer field → "Photographer: …" / "Foto: …" / "© …" lines → {{PD-user…|User}} →
// own work / *-self licence = the uploader → {{Institution:…}} (a museum's open-access photo) → a public-domain licence
// with nobody named = "Unknown author" (not when the work is described only by its Wikidata item). Nothing found (a CC licence without a name) → null: the Quality page asks.
// Owner 2026-11-13 (19 images had been left without credit).
const { getJson } = require('./http');

const COMMONS = process.env.COMMONS_BASE || 'https://commons.wikimedia.org';  // the e2e tests' fixture server

// [[User:X|Name]] → Name, [[Page]] → Page, [url label] → label, templates and markup out
function plain(s) {
  return String(s || '')
    .replace(/\{\{\s*Creator\s*:\s*([^}|]+)\}\}/gi, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/[^\]]*\]/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '').replace(/<[^>]*>/g, '').replace(/'{2,}/g, '')
    .replace(/^[\s*:,;-]+|[\s,;.-]+$/g, '').replace(/\s+/g, ' ').trim();
}
const unknown = (s) => /^(unknown|unbekannt|inconnu|anonymous|anonym|not provided)\b/i.test(s) || /\{\{\s*(unknown|anonymous)/i.test(s);
const user = (s) => String(s || '').replace(/~\w+wiki$/, '').trim() || null;
const PD = /\{\{\s*(PD|Cc-zero|CC0|Licence ouverte|Public domain)/i;

function creditFromWikitext(wikitext, uploader = null) {
  const wt = String(wikitext || '');
  // 1. a field of the information/artwork template
  for (const key of ['author', 'artist', 'photographer', 'creator']) {
    const m = new RegExp(`^[ \\t]*\\|[ \\t]*${key}[ \\t]*=([^\\n]*)`, 'im').exec(wt);
    if (!m) continue;
    if (unknown(m[1])) return 'Unknown author';
    if (/\{\{\s*own\s*\}\}/i.test(m[1])) return user(uploader);
    const v = plain(m[1]);
    if (v) return v;
  }
  // 2. a free line naming the photographer
  const line = /^[ \t*|]*(?:Photographer|Photograph|Foto|Photo|Fotograf(?:in)?|Author|Autor)[ \t]*(?::|©)[ \t]*©?[ \t]*(.+)$/im.exec(wt);
  if (line) {
    const v = plain(line[1].replace(/\{\{\s*#if:[^}]*\}\}/g, '').replace(/,?\s*\d{1,2}[./]\s?\d{1,2}[./]\s?\d{2,4}.*$/, ''));
    if (v && !unknown(v)) return v;
  }
  // 3. released by a Wikipedia user
  const pdUser = /\{\{\s*PD-user(?:-\w+)?\s*\|(?:[^|}]*\|)*([^|}]+)\}\}/i.exec(wt);
  if (pdUser) return plain(pdUser[1]);
  // 4. the uploader's own work
  if (/\{\{\s*own\s*\}\}|own (work|pictures?|photo)|selbst fotografiert|eigenes Werk|-self\s*[|}]/i.test(wt) && uploader) return user(uploader);
  // 5. a museum's photo of its object
  const inst = /\{\{\s*Institution\s*:\s*([^}|]+)\}\}/i.exec(wt);
  if (inst) return inst[1].trim();
  // 6. free by age and nobody named — unless the page describes the work only through its Wikidata item ({{Art Photo
  //    |wikidata = Q…}}): the maker is known there, "Unknown author" would be wrong
  if (PD.test(wt) && !/^[ \t]*\|[ \t]*wikidata[ \t]*=[ \t]*Q\d+/im.test(wt)) return 'Unknown author';
  return null;
}

// The description page (https://commons.wikimedia.org/wiki/File:…) → a credit, or null. Never throws.
async function commonsCredit(sourceUrl) {
  const m = /^https:\/\/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(String(sourceUrl || ''));
  if (!m || process.env.NODE_ENV === 'test') return null;  // tests never call Commons (the parser has unit tests)
  try {
    const title = decodeURIComponent(m[1]);
    const data = await getJson(`${COMMONS}/w/api.php?${new URLSearchParams({ action: 'query', titles: title, prop: 'revisions|imageinfo',
      rvprop: 'content', rvslots: 'main', iiprop: 'user', format: 'json', formatversion: '2' })}`);
    const page = data && data.query && data.query.pages && data.query.pages[0];
    const wt = page && page.revisions && page.revisions[0] && page.revisions[0].slots.main.content;
    const up = page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].user;
    const c = creditFromWikitext(wt, up);
    return c ? c.slice(0, 500) : null;
  } catch {
    return null;
  }
}

// images.fromForm() values (url, source_url, license, credit, caption): an empty credit of a Commons image filled in.
async function fillCredit(values) {
  if (values[3] || !values[1]) return values;
  const c = await commonsCredit(values[1]);
  return c ? [values[0], values[1], values[2], c, values[4]] : values;
}

module.exports = { creditFromWikitext, commonsCredit, fillCredit };
