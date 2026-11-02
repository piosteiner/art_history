// Private reference images (migration 184): the account that uploads an image is the only one that sees it — on the
// work's page and at its address; another login gets nothing, and the public API role may not read the table.
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { test, expect, sql, BASE } = require('./helpers');
const { DB } = require('./env');

const cleanup = () => sql("DELETE FROM artworks WHERE slug = 'test-private-images'");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('a reference image is seen by its uploader only', async ({ userA, userB }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-private-images', 'Test Private Images')");
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 180, g: 70, b: 43 } } }).png().toBuffer();

  await userA.goto('/artworks/test-private-images');
  const box = userA.locator('.private-images');
  await expect(box).toContainText('Only you see these');
  await box.locator('[name="pi-locator"]').fill('p. 33, fig. 29');
  await box.locator('[name="pi-file"]').setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: png });
  await expect(box.locator('.image-item img')).toHaveCount(1);
  await expect(box.locator('.image-item')).toContainText('p. 33, fig. 29');
  const src = await box.locator('.image-item img').getAttribute('src');
  const own = await userA.request.get(src);
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toBe('image/webp');
  expect(own.headers()['cache-control']).toContain('no-store');

  // another login: the section is empty, the image's address answers 404, deleting it too
  await userB.goto('/artworks/test-private-images');
  await expect(userB.locator('.private-images .image-item')).toHaveCount(0);
  expect((await userB.request.get(src)).status()).toBe(404);
  expect([403, 404]).toContain((await userB.request.post(`${src}/delete`)).status());   // the origin check or not found: nothing deleted
  expect(sql("SELECT count(*) FROM private_images i JOIN artworks a ON a.id = i.artwork_id WHERE a.slug = 'test-private-images'")).toBe('1');

  // the public API's database role may not read the table at all
  let denied = '';
  try {
    execFileSync('psql', ['-X', '-h', 'localhost', '-U', 'arthistory_api', '-d', DB, '-Atc', 'SELECT count(*) FROM private_images'], { stdio: 'pipe' });
  } catch (err) { denied = String(err.stderr); }
  expect(denied).toContain('permission denied');

  // the uploader deletes it
  await userA.goto('/artworks/test-private-images');
  await userA.locator('.private-images .image-item button', { hasText: 'delete' }).click();
  await expect(userA.locator('.private-images .image-item')).toHaveCount(0);
});

// The public site's login (routes/site-account.js): "Log in" there is the CMS login with ?next=, and the site then
// asks the admin host — with the session cookie, CORS for its own origin only — for this account's images.
test('the site sees its own account’s reference images, nobody else’s', async ({ userA, userB, request }) => {
  const SITE = 'https://arthistory.piogino.ch';   // config.corsOrigin's default (the test servers set none)
  sql("INSERT INTO artworks (slug, title) VALUES ('test-private-images', 'Test Private Images')");
  sql(`INSERT INTO private_images (artwork_id, owner_id, locator, bytes, width, height, original_bytes)
       SELECT a.id, u.id, 'p. 7, fig. 3', '\\x00'::bytea, 40, 30, 1 FROM artworks a, admin_users u
        WHERE a.slug = 'test-private-images' AND u.username = 'tester'`);

  const asSite = { headers: { Origin: SITE } };
  const me = await userA.request.get('/site/me', asSite);
  expect(await me.json()).toEqual({ username: 'tester' });
  expect(me.headers()['access-control-allow-origin']).toBe(SITE);
  expect(me.headers()['access-control-allow-credentials']).toBe('true');
  const own = await (await userA.request.get('/site/artworks/test-private-images/private-images', asSite)).json();
  expect(own.images).toHaveLength(1);
  expect(own.images[0]).toMatchObject({ locator: 'p. 7, fig. 3', width: 40 });
  expect(own.images[0].url).toMatch(/\/private-images\/\d+$/);
  expect((await (await userB.request.get('/site/artworks/test-private-images/private-images', asSite)).json()).images).toEqual([]);
  // previews on the site (2026-11-02): works with only this account's images, and a small rendition
  const thumbs = (await (await userA.request.get('/site/thumbs', asSite)).json()).images;
  expect(thumbs['test-private-images']).toBe(own.images[0].url);
  expect((await (await userB.request.get('/site/thumbs', asSite)).json()).images['test-private-images']).toBeUndefined();
  expect((await request.get('/site/thumbs', asSite)).status()).toBe(401);
  // the picture quiz of this account (src/routes/quiz.js): the work with its private image; not another account's
  const quiz = (await (await userA.request.get('/site/quiz/image?n=20&mine=only', asSite)).json()).data;
  expect(quiz.find((r) => r.slug === 'test-private-images')).toEqual(expect.objectContaining({ image_url: own.images[0].url, own: true }));
  expect((await (await userB.request.get('/site/quiz/image?n=20&mine=only', asSite)).json()).data.map((r) => r.slug)).not.toContain('test-private-images');

  // another origin gets no CORS permission; without a session: 401
  expect((await userA.request.get('/site/me', { headers: { Origin: 'https://evil.example' } })).headers()['access-control-allow-origin']).toBeUndefined();
  expect((await request.get('/site/me', asSite)).status()).toBe(401);
  expect((await request.get('/site/artworks/test-private-images/private-images', asSite)).status()).toBe(401);
  expect((await request.get('/site/quiz/image', asSite)).status()).toBe(401);

  // the login sends the browser back to the site only — any other address goes to the dashboard
  const page = await userA.request.get(`/login?next=${encodeURIComponent(`${SITE}/artworks/1/x?login=1`)}`, { maxRedirects: 0 });
  expect(page.headers().location).toBe(`${SITE}/artworks/1/x?login=1`);
  expect((await userA.request.get('/login?next=https%3A%2F%2Fevil.example%2F', { maxRedirects: 0 })).headers().location).toBe('/');

  // logging out from the site: only from its origin
  expect((await userB.request.post('/site/logout', { headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
});

// From another website (188, fetch-image.js): an image's link is stored at once, with where it came from; a page offers
// its pictures (one per picture, logos left out); the server never fetches its own or a private network's addresses.
test('a reference image from a link: an image, a page’s pictures to choose from, no private addresses', async ({ userA }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-private-images', 'Test Private Images')");
  const post = (data) => userA.request.post('/artworks/test-private-images/private-images/from-link', { data, headers: { Origin: BASE } });
  const direct = await post({ url: 'https://museum.test/painting.png', locator: 'object 12' });
  expect(direct.status()).toBe(201);
  expect(sql("SELECT width || 'x' || height || ' ' || source_url FROM private_images i JOIN artworks a ON a.id = i.artwork_id WHERE a.slug = 'test-private-images'"))
    .toBe('600x400 https://museum.test/painting.png');
  const page = await (await post({ url: 'https://museum.test/object.html' })).json();
  expect(page.page).toBe('https://museum.test/object.html');
  expect(page.pictures).toEqual(['https://museum.test/painting.png']);   // the same picture once, not the logo
  const fromPage = await post({ url: page.pictures[0], page: page.page });
  expect(fromPage.status()).toBe(201);
  expect(sql("SELECT count(*) FROM private_images i JOIN artworks a ON a.id = i.artwork_id WHERE a.slug = 'test-private-images' AND i.source_url = 'https://museum.test/object.html'")).toBe('1');
  // the page shows where it came from; the chooser's preview works
  await userA.goto('/artworks/test-private-images');
  await expect(userA.locator('.private-images .image-item a', { hasText: 'museum.test' }).first()).toBeVisible();
  expect((await userA.request.get(`/private-images/preview?url=${encodeURIComponent('https://museum.test/painting.png')}`)).headers()['content-type']).toBe('image/webp');
  // never our own server or a private network
  for (const url of ['http://127.0.0.1:3004/v1/health', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'file:///etc/passwd']) {
    const r = await post({ url });
    expect(r.status()).toBe(422);
    expect((await r.json()).error).toMatch(/public web address|only http/);
  }
});
