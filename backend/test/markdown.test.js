const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, previewText } = require('../src/markdown');

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

test('previewText: first paragraph as plain text, links as names, no footnotes, cut after a sentence', () => {
  const names = new Map([['artist/katsushika-hokusai', 'Katsushika Hokusai']]);
  assert.equal(previewText('## Life\n\n- a list\n\nBorn in *Edo*, [[artist/katsushika-hokusai|he]] met [[artist/katsushika-hokusai]] ^[A note.] [[source/clark-2017|45]]. Then more.', { names }),
    'Born in Edo, he met Katsushika Hokusai. Then more.');
  assert.equal(previewText('Wave & boats <b>x</b>.'), 'Wave & boats <b>x</b>.');  // plain text, unescaped (the frontend escapes)
  const first = 'The first sentence is long enough to be kept on its own, so the excerpt ends right after it.';
  assert.equal(previewText(`${first} ${'word '.repeat(80)}`), first);
  const words = previewText('A. ' + 'word '.repeat(100));  // the only sentence end comes too early: cut at a word
  assert.match(words, /^A\. word( word)* …$/);
  assert.ok(words.length <= 302);
  assert.equal(previewText(null), null);
  assert.equal(previewText('# Only a heading'), null);
});
