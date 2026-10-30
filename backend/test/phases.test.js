// A work's building history (migration 169): who took part, written one per line, and the checks before saving.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePeople, peopleText, check, fromDoc } = require('../src/phases');

test('who took part: type/slug | role | patron, the role optional', () => {
  const { people } = parsePeople('artist/andreas-schluter | architect\n\nperson/frederick-i-of-prussia | commissioned it | patron\nperson/joachim-ii | patron');
  assert.deepEqual(people, [
    { type: 'artist', slug: 'andreas-schluter', role: 'architect', patron: false },
    { type: 'person', slug: 'frederick-i-of-prussia', role: 'commissioned it', patron: true },
    { type: 'person', slug: 'joachim-ii', role: null, patron: true }]);
  assert.equal(peopleText(people), 'artist/andreas-schluter | architect\nperson/frederick-i-of-prussia | commissioned it | patron\nperson/joachim-ii | patron');
  assert.match(parsePeople('place/berlin | site').error, /line 1/);
  assert.match(parsePeople('artist/x | architect | builder').error, /only be “patron”/);
});

test('a phase: kind, title and the period as everywhere', () => {
  const { phase } = check({ kind: 'demolition', title: '  Blown  up ', period: '1950-09-07/1950-12-30', people: '' });
  assert.deepEqual([phase.title, phase.period, phase.period_label, phase.part], ['Blown up', '[1950-09-07,1950-12-31)', '7 September–30 December 1950', null]);
  assert.equal(check({ kind: 'alteration', title: 'x', period: '1537/1571', period_label: 'from 1537' }).phase.period_label, 'from 1537');
  assert.match(check({ kind: 'moved', title: 'x' }).error, /kind is one of/);
  assert.match(check({ kind: 'other', title: '' }).error, /needs a title/);
  assert.match(check({ kind: 'other', title: 'x', period: 'whenever' }).error, /^period/);
  // the YAML shape
  assert.deepEqual(check(fromDoc({ kind: 'extension', title: 'Dome', people: [{ who: 'artist/stuler', role: 'architect' }] })).phase.people,
    [{ type: 'artist', slug: 'stuler', role: 'architect', patron: false }]);
});
