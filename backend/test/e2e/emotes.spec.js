// Emotes in the chats (migration 240, src/admin/routes/emotes.js, src/admin/emotes.js): admins see the 7TV sources and
// their emotes in the CMS; editors don't; the site reads name → picture from /site/emotes. 7TV itself isn't asked
// here (no outside requests in tests): the row is written as a fetch leaves it.
const { request: pw } = require('@playwright/test');
const { test, expect, sql } = require('./helpers');
const { BASE } = require('./env');

let before = '';
test.beforeAll(() => { before = sql("SELECT row_to_json(e)::text FROM chat_emotes e WHERE id = 1").trim(); });
test.afterAll(() => {
  if (!before) return;
  sql(`UPDATE chat_emotes e SET sources = r.sources, emotes = r.emotes, fetched_at = r.fetched_at
    FROM json_populate_record(NULL::chat_emotes, '${before.replace(/'/g, "''")}') r WHERE e.id = 1`);
});

test('the chats\' emotes: the sources and emotes in the CMS (admins only), name → picture for the site', async ({ userA, userB }) => {
  sql(`UPDATE chat_emotes SET sources = '[{"type": "user", "name": "piogino", "setId": "01TEST", "setName": "set1", "count": 2}]',
    emotes = '{"catJAM": {"url": "https://cdn.7tv.app/emote/01A/2x.webp", "w": 28, "h": 28, "animated": true, "from": "piogino"},
               "peepoHey": {"url": "https://cdn.7tv.app/emote/01B/2x.webp", "w": 32, "h": 28, "animated": false, "from": "piogino"}}',
    fetched_at = now() WHERE id = 1`);
  expect((await userB.goto('/emotes')).status()).toBe(403);
  await userA.goto('/emotes');
  await expect(userA.locator('nav a[href="/emotes"]')).toBeVisible();
  await expect(userA.locator('.emote-sources li')).toContainText(['👤 piogino']);
  await expect(userA.locator('.emote-sources li')).toContainText(['set “set1” · 2 emotes']);
  await expect(userA.locator('.emote-grid figcaption')).toHaveText(['catJAM', 'peepoHey']);
  await expect(userA.locator('h2', { hasText: 'emotes' })).toHaveText('2 emotes');

  // the site: no login needed, only what a picture needs
  const http = await pw.newContext({ baseURL: BASE });
  const res = await http.get('/site/emotes');
  expect(res.status()).toBe(200);
  // the pictures come from our own server (2026-11-10, emote-images.js), never from cdn.7tv.app
  expect(await res.json()).toEqual({ emotes: { catJAM: { url: 'https://admin.localhost/site/emotes/img/01A.webp', w: 28, h: 28 }, peepoHey: { url: 'https://admin.localhost/site/emotes/img/01B.webp', w: 32, h: 28 } } });
  await http.dispose();
});
