// The editor's extra Markdown forms (src/md-extras.js) in both renderers: entries' texts (src/markdown.js) and pages
// (src/pages.js) — highlight, spoiler, tasks, callout boxes; and the pages' chapters (splitChapters / replaceChapter).
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../src/markdown');
const { renderPage, splitChapters, replaceChapter } = require('../src/pages');

const page = (t) => renderPage(t, { imageBase: '', lang: 'de-CH' }).html;

test('highlight, spoiler, underline in both renderers', () => {
  for (const out of [renderMarkdown('a ==b== ||c|| ++d++', {}), page('a ==b== ||c|| ++d++')]) {
    assert.match(out, /<mark>b<\/mark>/);
    assert.match(out, /<span class="spoiler" tabindex="0" title="Click to show">c<\/span>/);
    assert.match(out, /<u>d<\/u>/);
  }
  // a lone marker stays text: C++, a|b, x || y
  assert.match(renderMarkdown('C++ and a|b and x || y', {}), /C\+\+ and a\|b and x \|\| y/);
});

test('tasks and callouts; the callout title in the page language, an own title kept', () => {
  const md = '- [x] done\n- [ ] open\n\n> [!warning] Mind this\n> body\n\n> [!quote]\n> words\n\n> [!unknown]\n> x';
  const entry = renderMarkdown(md, {});
  assert.match(entry, /<li class="task task-done"><span class="task-box" aria-label="done">☑<\/span> done<\/li>/);
  assert.match(entry, /<blockquote class="callout callout-warning">\s*<p class="callout-title">Mind this<\/p>\s*<p>body<\/p>/);
  assert.match(entry, /<p class="callout-title">Quote<\/p>/);
  assert.match(entry, /<blockquote class="callout callout-note">/);          // an unknown type: a note
  assert.match(page(md), /<p class="callout-title">Zitat<\/p>/);             // de-CH
  // raw HTML: escaped in entries' texts; on pages (HTML allowed) an unknown attribute does not survive the sanitizer
  assert.doesNotMatch(renderMarkdown('<span class="evil">x</span>', {}), /<span class="evil"/);
  assert.doesNotMatch(page('<span onclick="x()" class="spoiler">x</span>'), /onclick/);
});

test('chapters: top-level headings outside code, the introduction before them; one replaced, the rest as it was', () => {
  const t = 'Intro\n\n# A\none\n```\n# no\n```\n## sub\n# B\ntwo\n# A\nthree';
  const { intro, chapters } = splitChapters(t);
  assert.equal(intro.md, 'Intro\n\n');
  assert.deepEqual(chapters.map((c) => [c.id, c.title]), [['a', 'A'], ['b', 'B'], ['a-2', 'A']]);
  assert.equal(replaceChapter(t, 2, '# B\nnew'), 'Intro\n\n# A\none\n```\n# no\n```\n## sub\n# B\nnew\n# A\nthree');
  assert.equal(replaceChapter(t, 0, 'New intro\n'), 'New intro\n# A\none\n```\n# no\n```\n## sub\n# B\ntwo\n# A\nthree');
  assert.equal(replaceChapter(t, 9, 'x'), null);
});
