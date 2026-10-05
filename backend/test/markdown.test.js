const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../src/markdown');

test('glossary links: [[slug]] with the term name, [[slug|words]], missing terms marked, code untouched', () => {
  const terms = new Map([['contrapposto', 'Contrapposto'], ['ukiyo-e', 'Ukiyo-e']]);
  const used = new Set();
  const out = renderMarkdown('In [[contrapposto]], like [[ukiyo-e|the prints]]; [[nope]]; `[[code]]`.', { terms, used });
  assert.match(out, /<a href="\/glossary\/contrapposto" class="glossary-link" data-term="contrapposto">Contrapposto<\/a>/);
  assert.match(out, /<a href="\/glossary\/ukiyo-e" class="glossary-link" data-term="ukiyo-e">the prints<\/a>/);
  assert.match(out, /class="glossary-link missing" data-term="nope">nope<\/a>/);
  assert.match(out, /<code>\[\[code\]\]<\/code>/);
  assert.deepEqual([...used].sort(), ['contrapposto', 'nope', 'ukiyo-e']);
  assert.doesNotMatch(renderMarkdown('[[Not A Slug]] <script>x</script>'), /<a|<script/);
});
