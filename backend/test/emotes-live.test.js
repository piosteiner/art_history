// src/admin/emotes-live.js: the event stream parser, and a set change from a stand-in for 7TV's feed leading to a
// refresh that writes only what changed (a stand-in pool, no database).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

test('eventParser splits server-sent events, also across chunks', () => {
  const { eventParser } = require('../src/admin/emotes-live');
  const got = [];
  const feed = eventParser((name, data) => got.push([name, data]));
  feed('event: hello\r\ndata: {"heartbeat_interval":1000}\r\n\r\nevent: dispa');
  feed('tch\ndata: {"type":"emote_set.update"}\n\n');
  assert.deepStrictEqual(got, [['hello', '{"heartbeat_interval":1000}'], ['dispatch', '{"type":"emote_set.update"}']]);
});

test('a 7TV set change is fetched and written once; an unchanged one is not written', async () => {
  // 7TV stand-ins: the event feed and the emote-set API
  let setEmotes = [{ id: 'E1', name: 'catJAM', data: { animated: true, host: { files: [{ name: '1x.webp', width: 28, height: 28 }] } } }];
  const urls = [];
  const server = http.createServer((req, res) => {
    urls.push(decodeURIComponent(req.url));
    if (req.url.startsWith('/v3/emote-sets/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: 'SET1', name: 'set1', emotes: setEmotes })); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: hello\ndata: {"heartbeat_interval":5000}\n\n');
    setTimeout(() => {
      setEmotes = [...setEmotes, { id: 'E2', name: 'peepoHey', data: { host: { files: [] } } }];
      res.write('event: dispatch\ndata: {"type":"emote_set.update","body":{"id":"SET1"}}\n\n');
    }, 100);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v3`;
  process.env.SEVENTV_EVENTS = base;
  // 7TV's REST API: src/admin/emotes.js asks https://7tv.io/v3 — sent to the stand-in
  const realFetch = global.fetch;
  global.fetch = (url, init) => realFetch(String(url).replace('https://7tv.io/v3', base), init);

  // a pool with one chat_emotes row
  let row = { sources: [{ type: 'set', setId: 'SET1', setName: 'set1', count: 1 }], emotes: { catJAM: { url: 'https://cdn.7tv.app/emote/E1/2x.webp', w: 28, h: 28, animated: true, from: 'set1' } }, fetched_at: null, updated_at: null };
  let writes = 0;
  const sources = [];
  const client = {
    query: async (sql, params) => {
      if (/set_config/.test(sql)) sources.push(sql.match(/'([^']+)', true/)[1]);
      if (/INSERT INTO chat_emotes/.test(sql)) { writes++; row = { ...row, sources: JSON.parse(params[0]), emotes: JSON.parse(params[1]) }; }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { query: async (sql) => (/FROM chat_emotes/.test(sql) ? { rows: [row] } : { rows: [] }), connect: async () => client };

  for (const k of Object.keys(require.cache)) if (k.includes('/src/admin/emotes')) delete require.cache[k];
  const live = require('../src/admin/emotes-live');
  try {
    // nothing changed yet: no write
    assert.deepStrictEqual(await live.refreshNow(pool), { changed: false, count: 1 });
    assert.strictEqual(writes, 0);
    live.start(pool, { logger: { log() {}, error() {} } });
    await new Promise((r) => setTimeout(r, 6500)); // the refresh waits 5 s for further changes
  } finally {
    live.stop();
    global.fetch = realFetch;
    server.closeAllConnections();
    server.close();
  }
  assert.ok(urls.some((u) => u.includes('emote_set.update<object_id=SET1>')), urls.join(' '));
  assert.strictEqual(writes, 1);
  assert.deepStrictEqual(Object.keys(row.emotes).sort(), ['catJAM', 'peepoHey']);
  assert.deepStrictEqual(sources, ['7tv live']);
});
