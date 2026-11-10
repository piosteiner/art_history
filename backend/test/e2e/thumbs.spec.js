// The API's thumbnail service (src/routes/thumbs.js): a museum's image (not Wikimedia's) as a small WebP, fetched once
// and kept; only images of our entries, only the site's widths.
const { test, expect, sql, API } = require('./helpers');

const SRC = 'https://museum.test/painting.png';   // served by the fixture server (env.js THUMB_TEST_SERVER, wikidata-fixtures.js)
const thumb = (request, src, w) => request.get(`${API}/thumb?${new URLSearchParams({ src, w: String(w) })}`, { headers: { Host: 'api.localhost', Origin: 'http://localhost:5173' } });
test.afterAll(() => sql(`DELETE FROM images WHERE url = '${SRC}'`));

test('a museum image as a 250-pixel WebP, cached; nothing that is not an image of ours', async ({ request }) => {
  sql(`DELETE FROM images WHERE url = '${SRC}';
       INSERT INTO images (artwork_id, position, url, license, credit) VALUES (entity_id('artwork', 'the-starry-night'), 9, '${SRC}', 'Public domain', 'test')`);
  const first = await thumb(request, SRC, 250);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe('image/webp');
  expect(first.headers()['cache-control']).toContain('immutable');
  const body = await first.body();
  expect(body.subarray(8, 12).toString()).toBe('WEBP');
  expect(body.length).toBeLessThan(5000);
  expect((await (await thumb(request, SRC, 250)).body()).equals(body)).toBe(true);   // the kept copy
  expect((await thumb(request, 'https://museum.test/other.png', 250)).status()).toBe(404);   // not ours
  expect((await thumb(request, SRC, 333)).status()).toBe(400);                                        // not a width of the site
});

// link previews (og:image, 2026-11-10): the same image as a JPEG, kept apart from the WebP
test('f=jpg: a JPEG of the same image for link previews; another f is refused', async ({ request }) => {
  sql(`DELETE FROM images WHERE url = '${SRC}';
       INSERT INTO images (artwork_id, position, url, license, credit) VALUES (entity_id('artwork', 'the-starry-night'), 9, '${SRC}', 'Public domain', 'test')`);
  const get = (q) => request.get(`${API}/thumb?${new URLSearchParams({ src: SRC, w: '800', ...q })}`, { headers: { Host: 'api.localhost' } });
  const jpg = await get({ f: 'jpg' });
  expect(jpg.status()).toBe(200);
  expect(jpg.headers()['content-type']).toBe('image/jpeg');
  const body = await jpg.body();
  expect(body[0]).toBe(0xff); expect(body[1]).toBe(0xd8);                              // a JPEG's first bytes
  expect((await get({})).headers()['content-type']).toBe('image/webp');               // without f: WebP, as before
  expect((await get({ f: 'gif' })).status()).toBe(400);
});
