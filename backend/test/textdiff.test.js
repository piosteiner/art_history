const test = require('node:test');
const assert = require('node:assert/strict');
const { wordDiff, isLongText } = require('../src/admin/textdiff');

const bio = 'Dutch painter whose roughly ten-year career produced some 860 oil paintings, most of them in his last two years. '
  + 'In Paris he discovered Impressionism and collected hundreds of Japanese woodblock prints; in Arles and Saint-Rémy '
  + 'he developed the saturated colour and expressive brushwork that made him a founder of modern art.';

test('marks changed words and collapses long unchanged stretches', () => {
  const out = String(wordDiff(bio, bio.replace('some 860', 'about 860')));
  assert.match(out, /<del>some<\/del><ins>about<\/ins>/);
  assert.match(out, /class="wd-gap">…</);
  assert.ok(!out.includes('Japanese'), 'far-away unchanged text is left out');
});

test('escapes HTML in the compared text', () => {
  const out = String(wordDiff('a', 'a <script>x</script>'));
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;script&gt;/);
});

test('long text detection', () => {
  assert.equal(isLongText('biography_md', 'short', 'text'), true);
  assert.equal(isLongText('name', 'Paris', 'Parigi'), false);
  assert.equal(isLongText('label', 'x'.repeat(90), 'y'), true);
  assert.equal(isLongText('location', null, [1, 2]), false);
});

const { merge3 } = require('../src/admin/textdiff');
test('merge3: undoes one edit and keeps a later, separate one', () => {
  const before = 'He collected Japanese woodblock prints. His career was ten years long.';
  const after = 'He collected Japanese woodblock prints. His career was a decade long. He died in 1890.';
  const now = 'He collected Japanese ukiyo-e prints. His career was a decade long. He died in 1890.';
  assert.equal(merge3(after, before, now), 'He collected Japanese ukiyo-e prints. His career was ten years long.');
});
test('merge3: overlapping edits are a conflict (null); identical edits merge once', () => {
  assert.equal(merge3('a b c', 'a X c', 'a Y c'), null);
  assert.equal(merge3('a b c', 'a X c', 'a X c'), 'a X c');
  assert.equal(merge3('a b c', 'a b c', 'a b c Z'), 'a b c Z');
});
