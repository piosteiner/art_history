// Creators from Wikidata (2026-11-13): the best rank only, and attributions are no creators. The case: the Città ideale
// (Q1113938) — "unknown value" preferred, Piero della Francesca and Luciano Laurana as normal-rank attributions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldsFor, relsFor } = require('../src/admin/wikidata');
const { BY_TYPE } = require('../src/content');

const T = BY_TYPE.artwork;
const item = (id) => ({ datavalue: { value: { 'entity-type': 'item', id } } });
const p170 = (rank, id, qual) => ({ rank, mainsnak: id ? { snaktype: 'value', ...item(id) } : { snaktype: 'somevalue' },
  ...(qual ? { qualifiers: { P1480: [item(qual)] } } : {}) });
const entity = (claims) => ({ id: 'Q1', labels: { en: { value: 'Test' } }, claims: { P170: claims } });
const creator = (e) => (fieldsFor(T, e).creator || {}).ref?.qid || null;
const co = (e) => relsFor(T, e).filter((r) => r.type === 'co_creator').map((r) => r.qid);

test('"unknown value" preferred: no creator, no co-creators — not the attributions of normal rank', () => {
  const e = entity([p170('normal', 'Q5822', 'Q230768'), p170('normal', 'Q712650', 'Q230768'), p170('preferred')]);
  assert.equal(creator(e), null);
  assert.deepEqual(co(e), []);
});

test('an attribution is no creator, even as the only statement', () => {
  assert.equal(creator(entity([p170('normal', 'Q5822', 'Q230768')])), null);
  assert.equal(creator(entity([p170('normal', 'Q5822', 'Q56644435')])), null);   // "probably"
});

test('creators as before: the first, the others co-creators; a preferred one wins over normal ones', () => {
  const e = entity([p170('normal', 'Q100'), p170('normal', 'Q200')]);
  assert.equal(creator(e), 'Q100');
  assert.deepEqual(co(e), ['Q200']);
  assert.equal(creator(entity([p170('normal', 'Q100'), p170('preferred', 'Q300')])), 'Q300');
  // a certain creator beside an attributed one: the certain one, the attribution left out
  const mixed = entity([p170('normal', 'Q100'), p170('normal', 'Q200', 'Q230768')]);
  assert.equal(creator(mixed), 'Q100');
  assert.deepEqual(co(mixed), []);
});
