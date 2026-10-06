const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../src/markdown');

test('glossary links: [[slug]] with the term name, [[slug|words]], missing terms marked, code untouched', () => {
  const names = new Map([['term/contrapposto', 'Contrapposto'], ['term/ukiyo-e', 'Ukiyo-e']]);
  const used = new Set();
  const out = renderMarkdown('In [[contrapposto]], like [[ukiyo-e|the prints]]; [[nope]]; `[[code]]`.', { names, used });
  assert.match(out, /<a href="\/glossary\/contrapposto" class="glossary-link" data-term="contrapposto">Contrapposto<\/a>/);
  assert.match(out, /<a href="\/glossary\/ukiyo-e" class="glossary-link" data-term="ukiyo-e">the prints<\/a>/);
  assert.match(out, /class="glossary-link missing" data-term="nope">nope<\/a>/);
  assert.match(out, /<code>\[\[code\]\]<\/code>/);
  assert.deepEqual([...used].sort(), ['contrapposto', 'nope', 'ukiyo-e']);
  assert.doesNotMatch(renderMarkdown('[[Not A Slug]] <script>x</script>'), /<a|<script/);
});

test('entry links: [[type/slug]] to any entry, own words, missing marked, unknown types stay text', () => {
  const names = new Map([['artist/katsushika-hokusai', 'Katsushika Hokusai'], ['term/ukiyo-e', 'Ukiyo-e']]);
  const used = new Set();
  const out = renderMarkdown('By [[artist/katsushika-hokusai]] ([[artwork/the-great-wave|the Wave]]), [[term/ukiyo-e]], [[artsit/x]].', { names, used });
  assert.match(out, /<a href="\/artists\/katsushika-hokusai" class="entry-link" data-entry="artist\/katsushika-hokusai">Katsushika Hokusai<\/a>/);
  assert.match(out, /<a href="\/artworks\/the-great-wave" class="entry-link missing" data-entry="artwork\/the-great-wave">the Wave<\/a>/);
  assert.match(out, /<a href="\/glossary\/ukiyo-e" class="glossary-link" data-term="ukiyo-e">Ukiyo-e<\/a>/);  // term/ = the short form
  assert.match(out, /\[\[artsit\/x\]\]/);
  assert.deepEqual([...used], ['ukiyo-e']);
  assert.match(renderMarkdown('[[person/hagiwara-sakutaro]] [[polity/ussr]] [[place/paris]]'), /href="\/people\/hagiwara-sakutaro".*href="\/polities\/ussr".*href="\/places\/paris"/);
});
