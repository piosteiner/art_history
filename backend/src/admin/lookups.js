// ---------------------------------------------------------------------------------------------------------------
// "Search elsewhere" on the Enrich page (owner 2026-10-31): sites we may not read automatically — their terms forbid
// robots (the WPI), they block them, or they need an API key we don't have — opened in the editor's own browser with
// a search for the entry's name. Nothing is fetched by the server; what is found is entered by hand, with the source.
// Searches that can't take the name in the address (Proveana, DoME) are not listed: there the name is typed in.
// ---------------------------------------------------------------------------------------------------------------
const { html } = require('./html');
const names = require('../names');

const q = encodeURIComponent;
const LOOKUPS = [
  { name: 'Wildenstein Plattner Institute', types: ['artwork', 'artist', 'person'],
    title: 'catalogues raisonnés (Gauguin, Monet, Renoir …) and the archives of French dealers and collectors — no robots allowed',
    url: (s) => `https://digitalprojects.wpi.art/search?modeSelect=all&all=${q(s)}` },
  { name: 'Getty ULAN', types: ['artist', 'person', 'institution'],
    title: 'Union List of Artist Names — the Getty\'s API refuses us',
    url: (s) => `https://www.getty.edu/vow/ULANServlet?english=Y&find=${q(s)}&role=&page=1&nation=` },
  { name: 'Europeana', types: ['artwork', 'artist'],
    title: 'Europe\'s museums, libraries and archives (the image search needs a Project key)',
    url: (s) => `https://www.europeana.eu/en/search?query=${q(s)}` },
  { name: 'Paris Musées', types: ['artwork', 'artist'],
    title: 'the collections of the fourteen museums of the City of Paris (API key not applied for)',
    url: (s) => `https://www.parismuseescollections.paris.fr/fr/recherche?keys=${q(s)}` },
  { name: 'DigitaltMuseum', types: ['artwork', 'artist'],
    title: 'Norwegian and Swedish museums (its API keys are for museums only)',
    url: (s) => `https://digitaltmuseum.org/search/?q=${q(s)}` },
  // Korea's national e-museum (all museums of the country) — searched with the Korean name when the entry has one
  { name: 'e-museum (Korea)', types: ['artwork', 'artist'], lang: 'ko',
    title: 'the collections of Korea\'s museums (API key not applied for)',
    url: (s) => `https://www.emuseum.go.kr/headerSearch?category=&rows=9&pageNum=1&radioSearchCheck=unifiedSearch&headerSearch=&keywordHistory=${q(s)}&searchType=&keyword=${q(s)}` },
  { name: 'Smithsonian', types: ['artwork', 'artist'],
    title: 'the Smithsonian\'s collections (API key not applied for)',
    url: (s) => `https://collections.si.edu/search/results.htm?q=${q(s)}` },
];

const forType = (type) => LOOKUPS.filter((l) => l.types.includes(type));

// the entry's name in a language (ko → "ko", "ko-Hang" …), else its name
function nameIn(e, lang) {
  const n = lang && ((e.doc && e.doc.names) || []).find((x) => x && x.text && new RegExp(`^${lang}(-|$)`, 'i').test(x.lang || ''));
  return names.plain(n ? n.text : e.name || '');
}

function section(t, e) {
  const list = forType(t.type);
  const term = nameIn(e);
  if (!list.length || !term) return '';
  return html`<div class="lookups"><b>Search elsewhere</b> <span class="muted small">— opens their site with “${term}” searched; enter what you find by hand, with the source:</span>
    ${list.map((l) => { const s = nameIn(e, l.lang); return html` <a class="button secondary small" href="${l.url(s)}" target="_blank" rel="noopener" title="${l.title}${s !== term ? ` — searched as “${s}”` : ''}">${l.name} ↗</a>`; })}</div>`;
}

module.exports = { LOOKUPS, forType, section, nameIn };
