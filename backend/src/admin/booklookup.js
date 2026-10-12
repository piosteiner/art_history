// ---------------------------------------------------------------------------------------------------------------
// A new bibliography entry from its ISBN (Open Library, public domain data) or DOI (Crossref, metadata free to use):
// kind, title, subtitle, authors / editors ("Surname, Given" — the form the citations use, src/bibliography.js),
// journal or book it appears in, volume, issue, pages, place, publisher, year. It fills the new-entry form; check it
// and press Create. Base URLs configurable (OPENLIBRARY_BASE, CROSSREF_BASE) for the end-to-end tests.
// ---------------------------------------------------------------------------------------------------------------
const { memo } = require('./remember');

const OPENLIBRARY = process.env.OPENLIBRARY_BASE || 'https://openlibrary.org';
const CROSSREF = process.env.CROSSREF_BASE || 'https://api.crossref.org';
const UA = 'arthistory.piogino.ch admin (research database; +https://arthistory.piogino.ch)';
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
  return remember(url, async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
  });
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

// → { doc, source } | null (not found) — throws on a bad number or a failed request
async function lookup(text) {
  const isbn = isbnOf(text);
  const doi = !isbn && doiOf(text);
  if (!isbn && !doi) throw new Error('That is neither an ISBN (10 or 13 digits) nor a DOI (10.…/…).');
  const r = isbn ? await byIsbn(isbn) : await byDoi(doi);
  if (!r) return null;
  const { source, ...doc } = r;
  for (const k of Object.keys(doc)) if (doc[k] === '' || (Array.isArray(doc[k]) && !doc[k].length)) delete doc[k];
  return { doc, source, key: isbn ? { isbn } : { doi } };
}

module.exports = { lookup, isbnOf, doiOf, inverted };
