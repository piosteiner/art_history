// Citations after the guide of the Kunsthistorisches Institut, Universität Zürich ("Leitfaden für die Abfassung von
// Seminararbeiten", 2021, §§ 8–9): short references (siglum = authors' surnames + year, "Kat. Paris 2007" for
// exhibition catalogues, a/b for equal sigla) in the notes, resolved in a list of full entries:
//   Busch 1993: Werner Busch, Das sentimentalische Bild. Die Krise der Kunst im 18. Jahrhundert …, München 1993.
// Shared by the Markdown renderer (src/markdown.js), the API and the admin.
//
// CITATION_LANG: 'de' (the guide's abbreviations, default) or 'en' (the same pattern with English abbreviations).
const LANG = process.env.CITATION_LANG === 'en' ? 'en' : 'de';
const TERMS = {
  de: { and: 'und', etal: 'u. a.', ed: 'hrsg. von', comp: 'bearb. von', Comp: 'Bearb.', exh: 'Ausst.-Kat.', cat: 'Kat.',
    vols: 'Bde.', vol: 'Bd.', no: 'Nr.', p: 'S.', col: 'Sp.', in: 'in:', accessed: 'zuletzt abgerufen am', ibid: 'ebd.',
    catno: 'Kat.-Nr.', anon: 'Anon.', here: 'hier:', literature: 'Literatur', sources: 'Quellen', nd: 'o. J.', upload: 'upload' },
  en: { and: 'and', etal: 'et al.', ed: 'ed. by', comp: 'comp. by', Comp: 'Comp.', exh: 'exh. cat.', cat: 'Cat.',
    vols: 'vols.', vol: 'vol.', no: 'no.', p: 'p.', col: 'col.', in: 'in:', accessed: 'last accessed', ibid: 'ibid.',
    catno: 'cat. no.', anon: 'Anon.', here: 'here:', literature: 'Bibliography', sources: 'Sources', nd: 'n.d.', upload: 'upload' },
};
const T = TERMS[LANG];
const KINDS = ['book', 'catalogue', 'chapter', 'article', 'lexicon_entry', 'catalogue_entry', 'web', 'video', 'archival', 'other'];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const it = (s) => (s ? `<i>${esc(s)}</i>` : '');
const has = (s) => s !== null && s !== undefined && String(s).trim() !== '';

// names are stored "Surname, Given names" (or a single name: an institution, "Anon.")
const surname = (n) => String(n).split(',')[0].trim();
const fullName = (n) => { const [last, first] = String(n).split(',').map((s) => s.trim()); return first ? `${first} ${last}` : last; };
function joinNames(names, fmt) {
  const list = (names || []).filter(has);
  if (!list.length) return '';
  if (list.length > 3) return `${fmt(list[0])} ${T.etal}`;  // "mehr als drei … deren erster, gefolgt von u. a."
  if (list.length === 1) return fmt(list[0]);
  return `${list.slice(0, -1).map(fmt).join(', ')} ${T.and} ${fmt(list[list.length - 1])}`;
}

// "Titel. Untertitel" (the guide's punctuation); a title ending in ? or ! takes no extra point
const titleOf = (s) => (has(s.subtitle) ? `${s.name}${/[.?!]$/.test(s.name) ? '' : '.'} ${s.subtitle}` : s.name);
// "Diss. masch. Hamburg 1924" · "München 1993" · "Paris: Gallimard 1990" · "1920"
function imprint(s) {
  const where = [s.thesis, s.place].filter(has).join(' ');
  const at = has(s.publisher) ? `${where}${where ? ': ' : ''}${s.publisher}` : where;
  return [at, has(s.year) ? s.year : ''].filter(has).join(' ');
}
const pages = (s) => (has(s.pages) ? `${s.pages_are_columns ? T.col : T.p} ${s.pages}` : '');
function dateDe(d) {  // '2020-04-24' → 24.4.2020 / 24 April 2020
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return String(d || '');
  if (LANG === 'de') return `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const accessed = (s) => (has(s.accessed) ? ` (${T.accessed} ${dateDe(s.accessed)})` : '');
const finish = (parts) => {
  const text = parts.filter((x) => typeof x === 'string' && x.trim()).join(', ').replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(text.replace(/<[^>]+>/g, '')) ? text : `${text}.`;
};

// The full entry (HTML: titles of independent publications in italics), without the siglum.
function full(s) {
  const authors = joinNames(s.authors, fullName);
  const editors = joinNames(s.editors, fullName);
  const compilers = joinNames(s.compilers, fullName);
  const cEditors = joinNames(s.container_editors, fullName);
  const orig = has(s.original_year) ? ` [${esc(s.original_year)}]` : '';
  const series = has(s.series) ? ` (${esc(s.series)})` : '';
  switch (s.kind) {
    case 'catalogue':
      return finish([esc(authors), it(titleOf(s)) + orig, compilers && `${T.Comp} ${esc(compilers)}`, editors && `${T.ed} ${esc(editors)}`,
        has(s.exhibition) && `${T.exh} ${esc(s.exhibition)}`, esc(imprint(s))]);
    case 'chapter':
      return finish([esc(authors), esc(titleOf(s)) + orig, `${T.in} ${it(s.container)}`, cEditors && `${T.ed} ${esc(cEditors)}`,
        esc(imprint(s)), pages(s)]);
    case 'article': {
      const when = has(s.issue_date) ? s.issue_date : s.year;
      return finish([esc(authors), esc(titleOf(s)),
        `${T.in} ${it(s.container)}${has(s.volume) ? ` ${esc(s.volume)}` : ''}${has(when) ? ` (${esc(when)})` : ''}`,
        has(s.issue) && `${T.no} ${esc(s.issue)}`, pages(s)]);
    }
    case 'lexicon_entry':
      return finish([esc(authors || T.anon), esc(titleOf(s)), `${T.in} ${it(s.container)}`, cEditors && `${T.ed} ${esc(cEditors)}`,
        has(s.volumes_total) && `${esc(s.volumes_total)} ${T.vols}`, has(s.volume) && `${T.vol} ${esc(s.volume)}`, esc(imprint(s)), pages(s)]);
    case 'catalogue_entry':
      return finish([esc(authors), has(s.catalogue_number) ? `${T.catno} ${esc(s.catalogue_number)}${has(s.name) ? ` (${esc(titleOf(s))})` : ''}` : esc(titleOf(s)),
        `${T.in} ${it(s.container)}`, compilers && `${T.Comp} ${esc(compilers)}`, has(s.exhibition) && `${T.exh} ${esc(s.exhibition)}`,
        esc(imprint(s)), pages(s)]);
    case 'web':
      return finish([esc(authors), esc(titleOf(s)),
        has(s.container) && `${T.in} ${it(s.container)}${has(s.volume) ? `, ${esc(s.volume)}` : ''}${has(s.year) ? ` (${esc(s.year)})` : ''}`,
        !has(s.container) && has(s.year) && esc(s.year), pages(s), has(s.url) && `${esc(s.url)}${accessed(s)}`]);
    case 'video':
      return finish([esc(authors), it(titleOf(s)), has(s.container) && esc(s.container), has(s.place) && esc(s.place),
        has(s.date_text) ? esc(s.date_text) : has(s.year) && esc(s.year),
        has(s.url) && `${esc(s.url)}${has(s.uploader) || has(s.uploaded) ? ` (${T.upload}: ${esc([s.uploader, has(s.uploaded) ? dateDe(s.uploaded) : ''].filter(has).join(', '))})` : ''}${accessed(s)}`]);
    case 'archival':
      return finish([esc(titleOf(s)), has(s.date_text) && esc(s.date_text), has(s.archive) && esc(s.archive), has(s.shelfmark) && esc(s.shelfmark)]);
    default:  // book, other
      return finish([esc(authors), it(titleOf(s)) + orig, has(s.edition) && esc(s.edition), editors && `${T.ed} ${esc(editors)}${series}`,
        compilers && `${T.comp} ${esc(compilers)}`, !editors && series.trim(), has(s.volumes_total) && `${esc(s.volumes_total)} ${T.vols}`,
        esc(imprint(s))]);
  }
}

// The siglum before disambiguation: "Busch 1993", "Kimpel und Suckale 1995", "Laffitte u. a. 2007", "Kat. Paris 2007"
function baseSiglum(s) {
  if (has(s.siglum)) return s.siglum.trim();
  const year = has(s.year) ? s.year : T.nd;
  const people = (s.authors || []).filter(has).length ? s.authors : null;
  if (!people && s.kind === 'catalogue') {
    const city = String(s.exhibition || s.place || '').split(/[:,]/)[0].trim();
    return `${T.cat}${city ? ` ${city}` : ''} ${year}`;
  }
  const names = people || ((s.editors || []).filter(has).length ? s.editors : null);
  if (!names) return s.kind === 'archival' ? `${s.name}` : `${T.anon} ${year}`;
  return `${joinNames(names, surname)} ${year}`;
}

// sources: all bibliography rows → Map slug → { siglum, full, kind, primary } — equal sigla get a, b … (by title):
// "Jacobsen 1992a", "Jacobsen 1992b".
function catalogue(sources) {
  const groups = new Map();
  for (const s of sources) {
    const base = baseSiglum(s);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(s);
  }
  const out = new Map();
  for (const [base, list] of groups) {
    list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    list.forEach((s, i) => {
      const siglum = list.length > 1 && !has(s.siglum) ? `${base}${String.fromCharCode(97 + i)}` : base;
      out.set(s.slug, { siglum, full: full(s), kind: s.kind, primary: !!s.primary_source });
    });
  }
  return out;
}

// The locator after | : "45" → "S. 45", "45–47" → "S. 45–47"; a video time "06:44–08:21" → "hier: 06:44–08:21 min";
// anything else as written ("bes. S. 55", "Abb. 32", "S. 45–47 mit Abb. 32").
function locator(text, kind) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^\d+([–-]\d+)?$/.test(t)) return `${T.p} ${t.replace('-', '–')}`;
  if (kind === 'video' && /^\d{1,2}:\d{2}(:\d{2})?([–-]\d{1,2}:\d{2}(:\d{2})?)?$/.test(t)) return `${T.here} ${t} min`;
  return t;
}

async function loadCatalogue(db) {
  const { rows } = await db.query('SELECT * FROM bibliography');
  return catalogue(rows);
}

module.exports = { LANG, T, KINDS, full, baseSiglum, catalogue, locator, loadCatalogue, esc };
