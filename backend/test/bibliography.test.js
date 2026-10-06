// The full entries and sigla against the examples of the KHIST guide (UZH, 2021, §§ 8–9).
const test = require('node:test');
const assert = require('node:assert/strict');
const { full, catalogue, locator } = require('../src/bibliography');

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const src = (o) => ({ slug: 'x', authors: [], editors: [], compilers: [], container_editors: [], ...o });

test('9.1 monographs, catalogues, editions, theses', () => {
  assert.equal(plain(full(src({ kind: 'book', authors: ['Busch, Werner'], name: 'Das sentimentalische Bild',
    subtitle: 'Die Krise der Kunst im 18. Jahrhundert und die Geburt der Moderne', place: 'München', year: '1993' }))),
  'Werner Busch, Das sentimentalische Bild. Die Krise der Kunst im 18. Jahrhundert und die Geburt der Moderne, München 1993.');
  assert.equal(plain(full(src({ kind: 'book', authors: ['Joray, Marcel'], name: 'La Sculpture moderne en Suisse', volumes_total: '4',
    place: 'Neuchâtel', year: '1955–1989' }))), 'Marcel Joray, La Sculpture moderne en Suisse, 4 Bde., Neuchâtel 1955–1989.');
  assert.equal(plain(full(src({ kind: 'catalogue', name: 'Trésors carolingiens', subtitle: 'Livres manuscrits de Charlemagne à Charles le Chauve',
    compilers: ['Laffitte, Marie-Pierre', 'B, X', 'C, Y', 'D, Z'], exhibition: 'Paris: Bibliothèque Nationale', place: 'Paris', year: '2007' }))),
  'Trésors carolingiens. Livres manuscrits de Charlemagne à Charles le Chauve, Bearb. Marie-Pierre Laffitte u. a., Ausst.-Kat. Paris: Bibliothèque Nationale, Paris 2007.');
  assert.equal(plain(full(src({ kind: 'book', authors: ['Kimpel, Dieter', 'Suckale, Robert'], name: 'Die gotische Architektur in Frankreich 1130–1270',
    original_year: '1985', edition: 'überarb. Ausgabe', place: 'München', year: '1995' }))),
  'Dieter Kimpel und Robert Suckale, Die gotische Architektur in Frankreich 1130–1270 [1985], überarb. Ausgabe, München 1995.');
  assert.equal(plain(full(src({ kind: 'book', authors: ['Vitruvius Pollio, Marcus'], name: 'De architectura libri decem', editors: ['Fensterbusch, Kurt'],
    series: 'Bibliothek klassischer Texte', place: 'Darmstadt', year: '1991' }))),
  'Marcus Vitruvius Pollio, De architectura libri decem, hrsg. von Kurt Fensterbusch (Bibliothek klassischer Texte), Darmstadt 1991.');
  assert.equal(plain(full(src({ kind: 'book', authors: ['Wind, Edgar'], name: 'Ästhetischer und kunstwissenschaftlicher Gegenstand',
    subtitle: 'Ein Beitrag zur Methodologie der Kunstgeschichte', thesis: 'Diss. masch.', place: 'Hamburg', year: '1924' }))),
  'Edgar Wind, Ästhetischer und kunstwissenschaftlicher Gegenstand. Ein Beitrag zur Methodologie der Kunstgeschichte, Diss. masch. Hamburg 1924.');
});

test('9.2–9.4 chapters, articles, lexicon and catalogue entries', () => {
  assert.equal(plain(full(src({ kind: 'chapter', authors: ['Raev, Ada', 'Labuda, Adam'], name: 'Der Mythos Sibirien in der polnischen und russischen Malerei des 19. Jahrhunderts',
    container: 'Kunst, Kontext, Geschichte. Festgabe für Hubert Faensen zum 75. Geburtstag', container_editors: ['Bartsch, Tatjana', 'Meiner, Jörg'],
    place: 'Berlin', year: '2003', pages: '190–221' }))),
  'Ada Raev und Adam Labuda, Der Mythos Sibirien in der polnischen und russischen Malerei des 19. Jahrhunderts, in: Kunst, Kontext, Geschichte. Festgabe für Hubert Faensen zum 75. Geburtstag, hrsg. von Tatjana Bartsch und Jörg Meiner, Berlin 2003, S. 190–221.');
  assert.equal(plain(full(src({ kind: 'article', authors: ['Krauss, Rosalind'], name: 'Richard Serra', subtitle: 'Sculpture Redrawn', container: 'Artforum',
    volume: '10', issue_date: 'Mai 1972', issue: '9', pages: '39–43' }))), 'Rosalind Krauss, Richard Serra. Sculpture Redrawn, in: Artforum 10 (Mai 1972), Nr. 9, S. 39–43.');
  assert.equal(plain(full(src({ kind: 'lexicon_entry', authors: ['Binding, Günther'], name: 'Saalkirche', container: 'Lexikon des Mittelalters',
    volumes_total: '9', volume: '7', place: 'München', year: '1995', pages: '1209–1210', pages_are_columns: true }))),
  'Günther Binding, Saalkirche, in: Lexikon des Mittelalters, 9 Bde., Bd. 7, München 1995, Sp. 1209–1210.');
  assert.equal(plain(full(src({ kind: 'catalogue_entry', authors: ['Denoël, Charlotte'], catalogue_number: '32', name: 'Évangiles de Saint-Martin de Tours',
    container: 'Trésors carolingiens. Livres manuscrits de Charlemagne à Charles le Chauve', compilers: ['Laffitte, Marie‐Pierre', 'A, B', 'C, D', 'E, F'],
    exhibition: 'Paris: Bibliothèque Nationale', year: '2007', pages: '154' }))),
  'Charlotte Denoël, Kat.-Nr. 32 (Évangiles de Saint-Martin de Tours), in: Trésors carolingiens. Livres manuscrits de Charlemagne à Charles le Chauve, Bearb. Marie‐Pierre Laffitte u. a., Ausst.-Kat. Paris: Bibliothèque Nationale, 2007, S. 154.');
});

test('9.5 internet and video, 9.6 archival sources', () => {
  assert.equal(plain(full(src({ kind: 'web', authors: ['Lutz, Maximilian'], name: 'Neue Wohnkunst', container: 'Die Schweizerische Baukunst', volume: '2', year: '1920',
    pages: '13-28', url: 'https://www.e-periodica.ch/digbib/view?pid=sbk-001%3A1920', accessed: '2020-04-24' }))),
  'Maximilian Lutz, Neue Wohnkunst, in: Die Schweizerische Baukunst, 2 (1920), S. 13-28, https://www.e-periodica.ch/digbib/view?pid=sbk-001%3A1920 (zuletzt abgerufen am 24.4.2020).');
  assert.equal(plain(full(src({ kind: 'archival', name: 'Brief von J.E. Wolfensberger an Wilhelm Barth', date_text: '30.09.1913',
    archive: 'Staatsarchiv Basel, Archiv des Basler Kunstvereins', shelfmark: 'PA888 H 2.1 (1)' }))),
  'Brief von J.E. Wolfensberger an Wilhelm Barth, 30.09.1913, Staatsarchiv Basel, Archiv des Basler Kunstvereins, PA888 H 2.1 (1).');
});

test('8.1 sigla: surnames and year, u. a., Kat. Ort Jahr, a/b for equal sigla', () => {
  const c = catalogue([
    src({ slug: 'busch', kind: 'book', authors: ['Busch, Werner'], name: 'B', year: '1993' }),
    src({ slug: 'ks', kind: 'book', authors: ['Kimpel, Dieter', 'Suckale, Robert'], name: 'K', year: '1995' }),
    src({ slug: 'kat', kind: 'catalogue', compilers: ['Laffitte, Marie-Pierre'], name: 'T', exhibition: 'Paris: Bibliothèque Nationale', year: '2007' }),
    src({ slug: 'j1', kind: 'book', authors: ['Jacobsen, W'], name: 'A title', year: '1992' }),
    src({ slug: 'j2', kind: 'article', authors: ['Jacobsen, W'], name: 'B title', year: '1992' }),
    src({ slug: 'many', kind: 'book', authors: ['A, a', 'B, b', 'C, c', 'D, d'], name: 'M', year: '2000' }),
  ]);
  assert.deepEqual(['busch', 'ks', 'kat', 'j1', 'j2', 'many'].map((s) => c.get(s).siglum),
    ['Busch 1993', 'Kimpel und Suckale 1995', 'Kat. Paris 2007', 'Jacobsen 1992a', 'Jacobsen 1992b', 'A u. a. 2000']);
  assert.equal(locator('43'), 'S. 43');
  assert.equal(locator('45-47'), 'S. 45–47');
  assert.equal(locator('bes. S. 55'), 'bes. S. 55');
  assert.equal(locator('06:44–08:21', 'video'), 'hier: 06:44–08:21 min');
});

const { renderMarkdown } = require('../src/markdown');
const { catalogue: cat } = require('../src/bibliography');
test('footnotes: citations in the text, adjacent ones combined, own notes with Vgl., ebd., the list of sources', () => {
  const names = new Map();
  names.sources = cat([
    src({ slug: 'busch-1993', kind: 'book', authors: ['Busch, Werner'], name: 'Das sentimentalische Bild', place: 'München', year: '1993' }),
    src({ slug: 'dittscheid-1987', kind: 'book', authors: ['Dittscheid, Hans-Christoph'], name: 'Kassel-Wilhelmshöhe', place: 'Worms', year: '1987' }),
    src({ slug: 'brief', kind: 'archival', name: 'Brief an Barth', archive: 'Staatsarchiv Basel', primary_source: true }),
  ]);
  const html = renderMarkdown('Erstens [[source/busch-1993|43]]. Zweitens.[[source/busch-1993|55]] [[source/dittscheid-1987|205]] '
    + 'Drittens^[vgl. hierzu [[source/dittscheid-1987|bes. S. 206]].] und viertens [[source/brief]].', { names });
  const notes = [...html.matchAll(/<li id="[^"]+-n\d+">(.*?) <a href="#[^"]+" class="fn-back"/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(notes, ['Busch 1993, S. 43.', 'Ebd., S. 55, und Dittscheid 1987, S. 205.', 'Vgl. hierzu ebd., bes. S. 206.', 'Brief an Barth.']);
  assert.equal((html.match(/class="fn-ref"/g) || []).length, 4);
  assert.match(html, /<h4>Quellen<\/h4><ul class="source-list"><li[^>]*><span class="siglum">Brief an Barth:<\/span>/);
  assert.match(html, /<h4>Literatur<\/h4><ul class="source-list"><li[^>]*><span class="siglum">Busch 1993:<\/span> Werner Busch, <i>Das sentimentalische Bild<\/i>, München 1993\.<\/li><li[^>]*><span class="siglum">Dittscheid 1987:/);
  assert.match(renderMarkdown('No notes here.'), /^<p>No notes here\.<\/p>/);
});
