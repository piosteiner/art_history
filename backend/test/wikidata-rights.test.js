// src/admin/wikidata.js: a Commons "public domain" file is only free for the site when the work itself is public
// domain (the documentation's Commons rule: every creator dead for more than 70 years)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pdLike, workRights } = require('../src/admin/wikidata');

test('licences that only restate the work\'s status', () => {
  for (const l of ['Public domain', 'public domain', 'PD-Art', 'CC0', 'No restrictions', 'No known copyright restrictions', 'Copyrighted free use']) assert.ok(pdLike(l), l);
  for (const l of ['CC BY-SA 4.0', 'CC BY 2.0', 'FAL', 'GFDL', null, '']) assert.ok(!pdLike(l), String(l));
});

test('the work is free 70 years after the last creator\'s death', () => {
  const year = 2026;
  assert.deepEqual(workRights({ deaths: [1938], year }), { pd: true });                       // Kirchner
  assert.equal(workRights({ deaths: [1955], year }).pd, true);                                 // 71 years ago
  assert.equal(workRights({ deaths: [1956], year }).pd, false);                                // 70 years: not yet
  assert.match(workRights({ deaths: [1961], year }).reason, /died 1961.*until 2032/);          // Sironi
  assert.equal(workRights({ deaths: [1890, 1973], year }).pd, false);                          // a co-creator still protected
  assert.equal(workRights({ deaths: [1890], unknownDeaths: 1, year }).pd, false);              // one creator without a date
  assert.equal(workRights({ created: 1750, year }).pd, true);                                  // anonymous, old
  assert.equal(workRights({ created: 1938, year }).pd, false);                                 // anonymous poster
  assert.equal(workRights({ year }).pd, false);                                                // nothing known
});
