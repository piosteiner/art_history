// src/ratelimit.js: a token bucket per address — the burst passes, the next is refused with Retry-After, time refills
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/ratelimit');

const call = (limit, ip) => new Promise((resolve) => {
  const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
  limit({ ip }, res, () => resolve({ code: 200 }));
});

test('the burst passes, the request after it is refused, another address is not affected', async () => {
  const limit = rateLimit({ perMinute: 60, burst: 3, name: 'test' });
  for (let i = 0; i < 3; i++) assert.equal((await call(limit, '10.0.0.1')).code, 200);
  const refused = await call(limit, '10.0.0.1');
  assert.equal(refused.code, 429);
  assert.equal(refused.body.error, 'too_many_requests');
  assert.ok(Number(refused.headers['Retry-After']) >= 1);
  assert.equal((await call(limit, '10.0.0.2')).code, 200);
});

test('time refills the bucket (a clock of its own — the real one made the test depend on the machine\'s load)', async () => {
  let t = 1000;
  const limit = rateLimit({ perMinute: 60, burst: 1, now: () => t });   // one a second
  assert.equal((await call(limit, 'a')).code, 200);
  assert.equal((await call(limit, 'a')).code, 429);
  t += 400;
  assert.equal((await call(limit, 'a')).code, 429);   // not yet
  t += 700;
  assert.equal((await call(limit, 'a')).code, 200);   // a second has passed
});
