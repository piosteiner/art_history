// The form relevance rules (src/admin/relevance.js) name only fields that exist, and every kind of source keeps the
// fields its citation pattern uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { BY_TYPE } = require('../src/content');
const { RULES, rulesFor, SOURCE_KINDS, OBJECT_FIELDS } = require('../src/admin/relevance');

test('every field a rule names exists on its type', () => {
  for (const [type, r] of Object.entries(RULES)) {
    const fields = Object.keys(BY_TYPE[type].fields);
    const named = new Set([...(r.always?.need || []), ...(r.driver ? [r.driver] : [])]);
    for (const v of Object.values(r.values || {})) for (const k of [...(v.only || []), ...(v.need || [])]) named.add(k);
    for (const c of r.when || []) for (const k of [...(c.need || []), ...(c.show || []), ...(c.allEmpty || []), ...(c.field ? [c.field] : [])]) named.add(k);
    for (const k of named) assert.ok(fields.includes(k), `${type}: no field "${k}"`);
  }
  for (const k of OBJECT_FIELDS) assert.ok(Object.keys(BY_TYPE.artwork.fields).includes(k), `artwork: no field "${k}"`);
});

test('a kind of source needs only fields it uses; a group of works keeps its parts fields', () => {
  for (const [kind, v] of Object.entries(SOURCE_KINDS)) {
    const only = RULES.source.values[kind].only;
    if (only) for (const k of v.need || []) assert.ok(only.includes(k), `source ${kind}: needs "${k}" but hides it`);
  }
  const art = rulesFor('artwork', { groupKinds: ['series', 'cycle'] });
  assert.ok(art.values.series.only.includes('parts_count'));
  assert.ok(!art.values.series.only.includes('inventory_number'));
  assert.equal(rulesFor('nothing'), null);
});
