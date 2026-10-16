const test = require('node:test');
const assert = require('node:assert/strict');
const { fold } = require('../src/fold');

test('searches ignore accents, spelled-out letters, ligatures, typographic apostrophes and dashes', () => {
  const same = [['Irène', 'irene'], ['Ærø', 'aero'], ['Groß', 'gross'], ['Søren', 'soren'], ['Łódź', 'lodz'], ['Œuvre', 'oeuvre'],
    ['Đorđe', 'dorde'], ['ﬁligree', 'filigree'], ['d’Anvers', "d'anvers"], ['Shin–Ōhashi', 'shin-ohashi'], ['ＡＢＣ', 'abc'], ['Kōshō', 'kosho']];
  for (const [a, b] of same) assert.equal(fold(a), fold(b), `${a} = ${b}`);
  assert.notEqual(fold('Müller'), fold('Mueller'));  // German transliteration is not folded (see the CHANGELOG note)
});
