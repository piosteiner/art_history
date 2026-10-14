const test = require('node:test');
const assert = require('node:assert/strict');
const { guessLang } = require('../src/textlang');

test('English and German descriptions are recognised', () => {
  assert.equal(guessLang('The print belongs to the series Thirty-six Views of Mount Fuji. It was published by Nishimuraya Yohachi around 1831.'), 'en');
  assert.equal(guessLang('Das Blatt gehört zur Serie der 36 Ansichten des Berges Fuji. Es wurde um 1831 von Nishimuraya Yohachi verlegt und ist eines der bekanntesten Werke.'), 'de');
  assert.equal(guessLang('Monet malte die Seerosen in seinem Garten in Giverny, wo er bis zu seinem Tod lebte.'), 'de');
});

test('links, citations and names in the other language do not decide it', () => {
  assert.equal(guessLang('In [[artist/katsushika-hokusai|der Welle]] the sea and the mountain are seen from a boat [[source/busch-1993|55]].'), 'en');
  assert.equal(guessLang('Dürer, Grünewald und Holbein — die Meister der deutschen Renaissance.'), 'de');
});

test('short or mixed texts stay undecided', () => {
  assert.equal(guessLang(''), null);
  assert.equal(guessLang('Oil on canvas.'), null);
  assert.equal(guessLang('Ein Titel: The Great Wave.'), null);
});
