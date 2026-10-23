// src/pages.js: [[#Heading]] links resolved through the whole page's headings (pageHeadings)
const test = require('node:test');
const assert = require('node:assert');
const { renderPage, pageHeadings } = require('../src/pages');

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
