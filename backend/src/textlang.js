// Which language a text is written in — English or German, the two the descriptions use. Shared by the admin's browser
// bundle (editor: the spell check language) and the server (tests). Counts very common function words — they make up
// a large share of any running text and differ completely between the two languages — plus ä ö ü ß as a German hint.
// Undecided (null) for short or mixed texts: the caller keeps what it had.
const DE = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber ist sind war waren wird wurde wurden '
  + 'hat hatte haben nicht mit von zu zum zur im in auf aus bei nach über unter für durch sich auch als wie noch nur sein seine '
  + 'ihr ihre ihren seinem seiner es er sie wir dass daß dieser diese dieses jedoch sowie bis vom am beim um wenn so schon').split(' '));
const EN = new Set(('the a an and or but is are was were be been being has have had not with of to in on at from by for as '
  + 'his her its their this that these those which who whom also only into after before about than then there it he she they '
  + 'we was were would could while when where so').split(' '));
// words that are function words in both (in, so, was …) count for neither
for (const w of [...DE]) if (EN.has(w)) { DE.delete(w); EN.delete(w); }

function guessLang(text) {
  const plainText = String(text || '')
    .replace(/\[\[[^\]]*\]\]/g, ' ')           // [[artist/…|words]] links and citations
    .replace(/\]\([^)]*\)/g, ' ')              // Markdown link targets
    .replace(/`[^`]*`/g, ' ');                 // code
  const words = plainText.toLowerCase().match(/[a-zäöüß]+/g) || [];
  let de = 0;
  let en = 0;
  for (const w of words) {
    if (DE.has(w)) de += 1;
    else if (EN.has(w)) en += 1;
  }
  de += Math.min(3, (plainText.match(/[äöüßÄÖÜ]/g) || []).length / 2);  // umlauts: a hint, capped (names like Dürer)
  if (de + en < 3) return null;                // too little text to tell
  if (de >= en * 2) return 'de';
  if (en >= de * 2) return 'en';
  return null;                                 // mixed (a quotation, a title in the other language)
}

module.exports = { guessLang };
