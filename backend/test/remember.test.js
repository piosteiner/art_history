// Answers of outside services, kept for a while (src/admin/remember.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const { memo } = require('../src/admin/remember');

test('asked once within the time; concurrent askers share the fetch', async () => {
  const remember = memo({ ttl: 1000 });
  let calls = 0;
  const fetch = async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return { n: calls }; };
  const [a, b] = await Promise.all([remember('k', fetch), remember('k', fetch)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.deepEqual(await remember('k', fetch), { n: 1 });
  await remember('other', fetch);
  assert.equal(calls, 2);
});

test('after the time: asked again; failures are not kept; the oldest goes first', async () => {
  const remember = memo({ ttl: 0, max: 2 });
  let calls = 0;
  await remember('k', async () => { calls += 1; });
  await remember('k', async () => { calls += 1; });
  assert.equal(calls, 2);
  const keep = memo({ max: 2 });
  await assert.rejects(keep('bad', async () => { throw new Error('503'); }), /503/);
  assert.equal(await keep('bad', async () => 'ok'), 'ok');
  await keep('b', async () => 'b');
  await keep('c', async () => 'c');                          // 'bad' (the oldest) is dropped
  assert.equal(await keep('bad', async () => 'again'), 'again');
});
