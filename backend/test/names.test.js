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
