// src/changelog.js: the CMS's "Kind: text" lines ⇄ bullets
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItems, itemsToText } = require('../src/changelog');

test('lines with and without a kind, continued lines, list markers', () => {
  const items = parseItems('Neu: Eins\n\nbehoben : Zwei\n  weiter\n- Verbessert: Drei\nOhne: Doppelpunkt-Art\n* Technik: Vier');
  assert.deepEqual(items, [
    { kind: 'neu', text: 'Eins' },
    { kind: 'behoben', text: 'Zwei\nweiter' },
    { kind: 'verbessert', text: 'Drei' },
    { kind: 'neu', text: 'Ohne: Doppelpunkt-Art' },
    { kind: 'technik', text: 'Vier' },
  ]);
});

test('round trip', () => {
  const text = 'Neu: Eins\nBehoben: Zwei\n  weiter\nInhalt: [[artist/x|X]]';
  assert.equal(itemsToText(parseItems(text)), text);
  assert.deepEqual(parseItems(itemsToText(parseItems(text))), parseItems(text));
});
