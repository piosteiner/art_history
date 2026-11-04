// ---------------------------------------------------------------------------------------------------------------
// A new bibliography entry from its ISBN (Open Library, public domain data) or DOI (Crossref, metadata free to use):
// kind, title, subtitle, authors / editors ("Surname, Given" — the form the citations use, src/bibliography.js),
// journal or book it appears in, volume, issue, pages, place, publisher, year. It fills the new-entry form; check it
// and press Create. Base URLs configurable (OPENLIBRARY_BASE, CROSSREF_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');
const http = require('./http');

const OPENLIBRARY = process.env.OPENLIBRARY_BASE || 'https://openlibrary.org';
const CROSSREF = process.env.CROSSREF_BASE || 'https://api.crossref.org';
const remember = memo();

// "978-3-7757-2310-0", "ISBN 3775723102" → digits (+X); a DOI from "doi:10.…" or "https://doi.org/10.…"
const isbnOf = (text) => { const d = String(text || '').replace(/^\s*isbn[:\s]*/i, '').replace(/[\s-]/g, '').toUpperCase(); return /^(\d{9}[\dX]|\d{13})$/.test(d) ? d : null; };
const doiOf = (text) => { const m = /(10\.\d{4,9}\/\S+)/.exec(decodeURIComponent(String(text || '').trim())); return m ? m[1].replace(/[.,;]$/, '') : null; };

// "Oskar Bätschmann" → "Bätschmann, Oskar" (already "Surname, Given": kept)
const inverted = (name) => {
  const s = String(name || '').trim();
  if (!s || s.includes(',')) return s;
  const parts = s.split(/\s+/);
  // particles stay with the surname: "Vincent van Gogh" → "van Gogh, Vincent"
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|de|der|den|di|da|du|del|la|le|ten|ter|zu)$/i.test(parts[i - 1])) i -= 1;
  return parts.length > 1 ? `${parts.slice(i).join(' ')}, ${parts.slice(0, i).join(' ')}` : s;
};
const yearOf = (text) => (String(text || '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1] || '';

async function getJson(url) {
  return remember(url, () => http.getJson(url, { missing: null }));
}

async function byIsbn(isbn) {
  const d = await getJson(`${OPENLIBRARY}/api/books?${new URLSearchParams({ bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'data' })}`);
  const b = d && d[`ISBN:${isbn}`];
  if (!b) return null;
  const names = (list) => (list || []).map((x) => x.name).filter(Boolean);
  return {
    kind: 'book', name: b.title || '', subtitle: b.subtitle || '', authors: names(b.authors).map(inverted),
    place: names(b.publish_places).join(', '), publisher: names(b.publishers).join(', '), year: yearOf(b.publish_date), isbn,
    // (its Open Library page is where the data came from — metadata — not the book's address)
    source: { name: 'Open Library', url: b.url || `https://openlibrary.org/isbn/${isbn}` },
  };
}

const KINDS = { 'journal-article': 'article', 'book-chapter': 'chapter', 'book-section': 'chapter', 'book-part': 'chapter',
  book: 'book', monograph: 'book', 'edited-book': 'book', 'reference-entry': 'lexicon_entry', 'proceedings-article': 'chapter' };
async function byDoi(doi) {
  const d = await getJson(`${CROSSREF}/works/${encodeURIComponent(doi)}`);
  const w = d && d.message;
  if (!w) return null;
  const person = (p) => (p.family ? `${p.family}${p.given ? `, ${p.given}` : ''}` : p.name || '');
  const parts = ((w.issued || w.published || {})['date-parts'] || [[]])[0];
  const kind = KINDS[w.type] || 'other';
  const container = (w['container-title'] || [])[0] || '';
  return {
    kind, name: (w.title || [])[0] || '', subtitle: (w.subtitle || [])[0] || '',
    authors: (w.author || []).map(person).filter(Boolean),
    [kind === 'book' ? 'editors' : 'container_editors']: (w.editor || []).map(person).filter(Boolean),
    container: kind === 'book' ? '' : container, volume: w.volume || '', issue: w.issue || '', pages: (w.page || '').replace('-', '–'),
    publisher: kind === 'article' ? '' : w.publisher || '', place: kind === 'article' ? '' : w['publisher-location'] || '',
    year: parts[0] ? String(parts[0]) : '', doi, isbn: kind === 'book' && (w.ISBN || [])[0] ? String(w.ISBN[0]).replace(/-/g, '') : '',
    url: '', source: { name: 'Crossref', url: `https://doi.org/${doi}` },
  };
}

// ---- a web page (owner 2026-11-04: most sources are museum pages): what the page says about itself — the tags
// Google Scholar reads (citation_*), Open Graph (og:*), Dublin Core, <title> — as a web source (or, with a journal
// title, an article). Fetched like the private images' pages (fetch-image.js: public addresses only, no bot checks).
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', szlig: 'ß', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', copy: '©' };
// the accented letters by their names: "uuml" → ü, "Eacute" → É
const MARKS = { uml: '\u0308', acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', cedil: '\u0327', ring: '\u030A' };
const named = (e) => {
  if (ENTITIES[e]) return ENTITIES[e];
  const m = /^([a-zA-Z])(uml|acute|grave|circ|tilde|cedil|ring)$/.exec(e);
  return m ? (m[1] + MARKS[m[2]]).normalize('NFC') : null;
};
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : named(e) ?? m))
  .replace(/\s+/g, ' ').trim();
/** html → Map name → [contents] of its <meta> tags (name, property or itemprop, lower-cased) */
function metaTags(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5];
    const key = (attrs.name || attrs.property || attrs.itemprop || '').toLowerCase();
    if (!key || attrs.content === undefined) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(decode(attrs.content));
  }
  return out;
}
function fromPage(html, url) {
  const meta = metaTags(html);
  const one = (...keys) => { for (const k of keys) { const v = (meta.get(k) || []).find(Boolean); if (v) return v; } return ''; };
  const all = (k) => (meta.get(k) || []).filter(Boolean);
  const site = one('og:site_name', 'citation_publisher', 'dc.publisher', 'application-name');
  const journal = one('citation_journal_title', 'prism.publicationname');
  let title = one('citation_title', 'dc.title', 'og:title', 'twitter:title') || decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
  // "Water Lilies | Musée de l'Orangerie" → "Water Lilies" when the rest is the site's name
  if (site) title = title.replace(new RegExp(`\\s*[|–—·-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim();
  const people = [...all('citation_author'), ...all('dc.creator')];
  const author = one('author', 'article:author');
  if (!people.length && author && !/^https?:/.test(author) && author !== site) people.push(author);
  const first = one('citation_firstpage');
  const last = one('citation_lastpage');
  const doc = {
    kind: journal ? 'article' : 'web', name: title, authors: [...new Set(people.map(inverted))],
    container: journal || site, volume: one('citation_volume'), issue: one('citation_issue'),
    pages: first ? (last && last !== first ? `${first}–${last}` : first) : '',
    year: yearOf(one('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'article:published_time', 'datepublished')),
    doi: doiOf(one('citation_doi', 'dc.identifier')) || '', url, accessed: new Date().toISOString().slice(0, 10),
  };
  return doc;
}
async function byPage(address) {
  const { fetchPublic } = require('./fetch-image');   // lazy: only the page lookup needs it
  const r = await fetchPublic(address);
  if (!/html/.test(r.type)) throw new Error(`That address is not a web page (${r.type || 'unknown type'}).`);
  const doc = fromPage(r.body.toString('utf8'), String(address).trim());
  if (!doc.name) return null;
  return { ...doc, source: { name: 'the page itself', url: r.url } };
}

// → { doc, source } | null (not found) — throws on a bad number or a failed request
async function lookup(text) {
  const isbn = isbnOf(text);
  const doi = !isbn && doiOf(text);
  if (!isbn && !doi && /^https?:\/\//i.test(String(text).trim())) {
    let r;
    try { r = await byPage(text); } catch (err) { throw new Error(`Could not read the page: ${err.message}`); }
    if (!r) return null;
    const { source, ...doc } = r;
    for (const k of Object.keys(doc)) if (doc[k] === '' || (Array.isArray(doc[k]) && !doc[k].length)) delete doc[k];
    return { doc, source, key: { url: doc.url } };
  }
  if (!isbn && !doi) throw new Error('That is neither a web address (https://…), an ISBN (10 or 13 digits) nor a DOI (10.…/…).');
  const r = isbn ? await byIsbn(isbn) : await byDoi(doi);
  if (!r) return null;
  const { source, ...doc } = r;
  for (const k of Object.keys(doc)) if (doc[k] === '' || (Array.isArray(doc[k]) && !doc[k].length)) delete doc[k];
  return { doc, source, key: isbn ? { isbn } : { doi } };
}

module.exports = { lookup, isbnOf, doiOf, inverted, fromPage, metaTags };
