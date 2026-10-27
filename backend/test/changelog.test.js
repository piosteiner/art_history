// src/changelog.js: the CMS's "Kind: text" lines ⇄ bullets
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItems, itemsToText } = require('../src/changelog');

test('lines with and without a kind, continued lines, list markers', () => {
  const items = parseItems('Neu: Eins\n\nbehoben : Zwei\n  weiter\n- Verbessert: Drei\nOhne: Doppelpunkt-Art\n* Technik: Vier');
  assert.deepEqual(items, [
    { kind: 'neu', area: null, text: 'Eins' },
    { kind: 'behoben', area: null, text: 'Zwei\nweiter' },
    { kind: 'verbessert', area: null, text: 'Drei' },
    { kind: 'neu', area: null, text: 'Ohne: Doppelpunkt-Art' },
    { kind: 'technik', area: null, text: 'Vier' },
  ]);
});

test('round trip', () => {
  const text = 'Neu: Eins\nBehoben: Zwei\n  weiter\nInhalt: [[artist/x|X]]';
  assert.equal(itemsToText(parseItems(text)), text);
  assert.deepEqual(parseItems(itemsToText(parseItems(text))), parseItems(text));
});

test('topics in brackets after the kind (137), a [[link]] after the colon is text', () => {
  assert.deepEqual(parseItems('Neu [Karte]: Historische Karten\nVerbessert [ Suche ] : Tippfehler\nInhalt: [[artist/x|X]] neu'), [
    { kind: 'neu', area: 'Karte', text: 'Historische Karten' },
    { kind: 'verbessert', area: 'Suche', text: 'Tippfehler' },
    { kind: 'inhalt', area: null, text: '[[artist/x|X]] neu' },
  ]);
  const text = 'Neu [Karte]: Eins\nBehoben: Zwei';
  assert.equal(itemsToText(parseItems(text)), text);
});
