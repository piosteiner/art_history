const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../src/names');

test('furigana markup: plain text, reading, escaped ruby HTML', () => {
  const t = '{神奈川|かながわ}沖{浪裏|なみうら}';
  assert.equal(n.plain(t), '神奈川沖浪裏');
  assert.equal(n.reading(t), 'かながわ沖なみうら');
  assert.equal(n.rubyHtml('{<b>|x}'), '<ruby>&lt;b&gt;<rp>(</rp><rt>x</rt><rp>)</rp></ruby>');
  assert.equal(n.rubyHtml('Plain'), null);
  assert.equal(n.rubyError('{神奈川'), 'furigana must be written as {kanji|reading}, e.g. {神奈川|かながわ}');
  assert.equal(n.rubyError('A | B'), null);
});

test('language tags are normalized and checked', () => {
  assert.equal(n.normLang('JA-latn'), 'ja-Latn');
  assert.equal(n.normLang('zh_hant_tw'), 'zh-Hant-TW');
  assert.equal(n.normLang('zh-latn-PINYIN'), 'zh-Latn-pinyin');
  assert.ok(n.langOk('pt-BR') && n.langOk('es-419') && !n.langOk('english'));
});

test('name lines ↔ names, readings with "|" inside braces stay intact', () => {
  const list = n.linesToNames('{北斎|ほくさい} | ja | original\nKanagawa-oki nami ura | ja-Latn | romanization\nHokusai\nGreat Wave | | translation');
  assert.deepEqual(list, [{ text: '{北斎|ほくさい}', lang: 'ja', role: 'original' },
    { text: 'Kanagawa-oki nami ura', lang: 'ja-Latn', role: 'romanization' },
    { text: 'Hokusai', role: 'alternative' }, { text: 'Great Wave', role: 'translation' }]);
  assert.equal(n.namesToLines(list), '{北斎|ほくさい} | ja | original\nKanagawa-oki nami ura | ja-Latn | romanization\nHokusai\nGreat Wave |  | translation');
  assert.deepEqual(n.linesToNames(n.namesToLines(list)), list);
  assert.throws(() => n.linesToNames('X | en | nickname'), /role "nickname"/);
});

test('a translation is official, common (the default, not stored) or own — written after the role', () => {
  const list = n.linesToNames('The Great Wave off Kanagawa | en | translation, official\nDie große Welle | de | translation, common\n[Under the wave] | en | translation, own');
  assert.deepEqual(list, [
    { text: 'The Great Wave off Kanagawa', lang: 'en', role: 'translation', status: 'official' },
    { text: 'Die große Welle', lang: 'de', role: 'translation' },
    { text: '[Under the wave]', lang: 'en', role: 'translation', status: 'own' }]);
  assert.equal(n.namesToLines(list), 'The Great Wave off Kanagawa | en | translation, official\nDie große Welle | de | translation\n[Under the wave] | en | translation, own');
  assert.deepEqual(n.normName({ text: 'X', role: 'translation', status: 'own' }), { text: 'X', role: 'translation', status: 'own' });
  assert.throws(() => n.linesToNames('X | ja | original, own'), /only a translation/);
  assert.throws(() => n.linesToNames('X | en | translation, mine'), /official, common or own/);
});

test('a former name (139): its own role, kept through lines ↔ names', () => {
  const list = n.linesToNames('Königliche Museen zu Berlin | de | former\nSMB');
  assert.deepEqual(list, [{ text: 'Königliche Museen zu Berlin', lang: 'de', role: 'former' }, { text: 'SMB', role: 'alternative' }]);
  assert.deepEqual(n.linesToNames(n.namesToLines(list)), list);
});

test('a name in context (152): when it was in use and a note, kept through lines ↔ names and the stored form', () => {
  const list = n.linesToNames('Direction des musées nationaux | fr | former | until 1945 | renamed Direction des musées de France in 1945\n'
    + 'Galerie de Boer |  |  | 1961');
  assert.deepEqual(list, [
    { text: 'Direction des musées nationaux', lang: 'fr', role: 'former', period: '(,1946-01-01)', period_label: 'until 1945',
      note: 'renamed Direction des musées de France in 1945' },
    { text: 'Galerie de Boer', role: 'alternative', period: '[1961-01-01,1962-01-01)', period_label: '1961' }]);
  assert.deepEqual(n.linesToNames(n.namesToLines(list)), list);
  // the stored form (range + label) reads back the same — the label is what counts
  assert.deepEqual(n.normName(list[0]), list[0]);
  // a note may contain " | "
  assert.equal(n.linesToNames('X | en | former | 1912–1940 | a | b')[0].note, 'a | b');
  assert.throws(() => n.linesToNames('X | en | former | sometime'), /period/);
  assert.throws(() => n.normName({ text: 'X', period: '(,1946-01-01)' }), /needs its label/);
});

test('the kind of name (153): after the role in form lines, stored as `kind`, read back', () => {
  const list = n.linesToNames('Paula Becker | de | former, birth | until 1901 | before her marriage\nShunrō | ja-Latn | former, art name | 1779–1794\n'
    + 'Le Douanier | fr | alternative, nickname\nSMB | de | alternative, abbreviation');
  assert.deepEqual(list.map((x) => [x.text, x.role, x.kind]), [['Paula Becker', 'former', 'birth'], ['Shunrō', 'former', 'art_name'],
    ['Le Douanier', 'alternative', 'nickname'], ['SMB', 'alternative', 'abbreviation']]);
  assert.equal(n.namesToLines([list[0]]), 'Paula Becker | de | former, birth | until 1901 | before her marriage');
  assert.deepEqual(n.linesToNames(n.namesToLines(list)), list);
  assert.deepEqual(n.normName({ text: 'X', role: 'translation', status: 'own', kind: 'pseudonym' }), { text: 'X', role: 'translation', status: 'own', kind: 'pseudonym' });
  assert.equal(n.linesToNames('X | en | translation, own, pseudonym')[0].kind, 'pseudonym');
  assert.throws(() => n.linesToNames('X | en | alternative, stage'), /kind of name "stage"/);
});
