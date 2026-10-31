// src/admin/http.js: requests to outside services — one User-Agent, a 429 waited out once, a 404 as asked
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getJson, UA } = require('../src/admin/http');

// a stand-in service: /busy answers 429 once (Retry-After: 1), then 200; /never always 429 with a long wait;
// /gone 404; /ok echoes the User-Agent and Accept it received
function service() {
  let busy = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/busy' && busy++ === 0) { res.writeHead(429, { 'Retry-After': '1' }); return res.end(); }
    if (req.url === '/never') { res.writeHead(429, { 'Retry-After': '3600' }); return res.end(); }
    if (req.url === '/gone') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ua: req.headers['user-agent'], accept: req.headers.accept, busy }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('getJson: our User-Agent and the format asked for', async () => {
  const s = await service();
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    assert.deepEqual(await getJson(`${base}/ok`, { accept: 'application/ld+json' }), { ua: UA, accept: 'application/ld+json', busy: 0 });
  } finally { s.close(); }
});

test('getJson: a 429 with a short Retry-After is waited out once; a long one is an error naming the service', async () => {
  const s = await service();
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    const t0 = Date.now();
    assert.equal((await getJson(`${base}/busy`)).busy, 2);   // the second request went through
    assert.ok(Date.now() - t0 >= 900);
    await assert.rejects(getJson(`${base}/never`, { name: 'Test Service' }), /Test Service answered 429/);
  } finally { s.close(); }
});

test('getJson: a 404 gives what `missing` says — a value, or its own error', async () => {
  const s = await service();
  try {
    const base = `http://127.0.0.1:${s.address().port}`;
    assert.equal(await getJson(`${base}/gone`, { missing: null }), null);
    await assert.rejects(getJson(`${base}/gone`, { missing: () => { throw new Error('X 1 was not found'); } }), /X 1 was not found/);
    await assert.rejects(getJson(`${base}/gone`), /127\.0\.0\.1:\d+ answered 404/);
  } finally { s.close(); }
});
