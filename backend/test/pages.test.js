// src/pages.js: [[#Heading]] links resolved through the whole page's headings (pageHeadings)
const test = require('node:test');
const assert = require('node:assert');
const { renderPage, pageHeadings, reorderChapters, splitChapters, searchPage } = require('../src/pages');

const page = 'Intro [[#Zwei|zum zweiten]]\n\n# Eins\n\n## Vertrauliche Daten\n\n# Zwei\n\n## Vertrauliche Daten\n\n'
  + '[[#Vertrauliche Daten]] · [[#Zwei#Vertrauliche Daten]] · [[#vertrauliche daten|klein]] · [[#Fehlt]] · ![[bild.webp]]';
const render = (md) => renderPage(md, { imageBase: '/i/', known: new Set(), headings: pageHeadings(page), linkBase: '/dokumentation' }).html;

test('a heading link: to its chapter and id, any case; the first of two names, or the one under the heading named', () => {
  const html = render(page);
  assert.match(html, /<p>Intro <a href="\/dokumentation\/zwei#zwei">zum zweiten<\/a><\/p>/);
  assert.match(html, /<a href="\/dokumentation\/eins#vertrauliche-daten">Vertrauliche Daten<\/a> · <a href="\/dokumentation\/zwei#vertrauliche-daten-2">Vertrauliche Daten<\/a>/);
  assert.match(html, /<a href="\/dokumentation\/eins#vertrauliche-daten">klein<\/a>/);
  assert.match(html, /<span class="page-link-missing" title="No heading “Fehlt” in this page">Fehlt<\/span>/);
  assert.match(html, /page-image-missing/);   // an image embed is still an image embed
});

test('the ids of the index are those of the rendered chapters', () => {
  const h = pageHeadings(page);
  assert.deepStrictEqual(h.all.map((x) => [x.id, x.chapter]), [['eins', 'eins'], ['vertrauliche-daten', 'eins'], ['zwei', 'zwei'], ['vertrauliche-daten-2', 'zwei']]);
  assert.deepStrictEqual(h.all[3].parents, ['zwei']);
});

test('chapters reordered: the introduction first, each chapter with one blank line, every chapter once or nothing', () => {
  const text = 'Vorwort.\n\n# A\na\n\n# B\nb\n## B2\nx\n\n# C\nc';
  const moved = reorderChapters(text, [3, 1, 2]);
  assert.strictEqual(moved, 'Vorwort.\n\n# C\nc\n\n# A\na\n\n# B\nb\n## B2\nx\n');
  assert.deepStrictEqual(splitChapters(moved).chapters.map((c) => c.title), ['C', 'A', 'B']);
  assert.strictEqual(reorderChapters(text, [1, 1, 2]), null);
  assert.strictEqual(reorderChapters(text, [1, 2]), null);
  assert.strictEqual(reorderChapters(text, [1, 2, 4]), null);
});

test('the documentation searched: every word must begin a word of the paragraph, accents and case alike; the heading above; a passage', () => {
  const text = 'Vorwort über **Zürich**.\n\n# Eins\n## Daten\nDer Abgleich mit [Wikidata](https://www.wikidata.org) im Kunsthaus Zürich.\n\n- Ein Punkt über zurich\n\n# Zwei\nNichts.';
  const r = searchPage(text, 'wiki zurich');
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(r.hits[0].chapter, { id: 'eins', title: 'Eins', index: 1 });
  assert.deepStrictEqual(r.hits[0].heading, { id: 'daten', text: 'Daten' });
  assert.strictEqual(r.hits[0].passage_html, 'Der Abgleich mit <mark>Wikidata</mark> im Kunsthaus <mark>Zürich</mark>.');
  const z = searchPage(text, 'ZURICH');
  assert.deepStrictEqual(z.hits.map((h) => h.chapter && h.chapter.id), [null, 'eins', 'eins']);   // intro, paragraph, list item
  assert.strictEqual(searchPage(text, 'a').total, 0);                                              // too short: no search
  assert.strictEqual(searchPage(text, 'ichts').total, 0);                                          // inside a word: not a beginning
});
