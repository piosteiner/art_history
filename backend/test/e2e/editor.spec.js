// Markdown editor (live styling, shortcuts, server preview) and the map picker (without depending on OSM).
const { test, expect, liveReady } = require('./helpers');

// 1×1 transparent PNG — stands in for OpenStreetMap tiles, so the test needs no internet and never loads OSM.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('Markdown: shortcuts, live styling, and a preview rendered like the website', async ({ userA }) => {
  await userA.goto('/people/theo-van-gogh/edit');
  await liveReady(userA);
  const cm = userA.locator('.md-editor .cm-content').first();
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('\n\nTest: ');
  await userA.keyboard.press('Control+b');
  await userA.keyboard.type('bold');
  await userA.keyboard.press('ArrowRight'); await userA.keyboard.press('ArrowRight');
  await userA.keyboard.type(' <script>x</script>');
  const boldSpan = userA.locator('.cm-line span', { hasText: /^bold$/ });
  await expect(boldSpan).toHaveCSS('font-weight', '700');
  await expect(userA.locator('#f-description_md')).toHaveValue(/Test: \*\*bold\*\* <script>x<\/script>$/);
  await userA.click('.md-toolbar button:has-text("Preview")');
  await expect(userA.locator('.md-preview strong')).toHaveText('bold');
  await expect(userA.locator('.md-preview')).toContainText('<script>x</script>');  // escaped, shown as text
  await expect(userA.locator('.md-editor .cm-editor')).toBeHidden();
});

test('map picker: tiles carry our origin as Referer, click sets the location, draw an area', async ({ userA }) => {
  const referers = new Set();
  await userA.route('https://tile.openstreetmap.org/**', (route) => {
    referers.add(route.request().headers().referer || '(none)');
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await userA.goto('/places/arles/edit');
  await liveReady(userA);
  const map = userA.locator('.map-canvas');
  const box = await map.boundingBox();
  // Clicks relative to the map element: Playwright scrolls as needed, so no stale page coordinates.
  const at = (dx, dy) => ({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
  const lonBefore = await userA.inputValue('input[name="f.location_lon"]');
  await map.click(at(60, -40));
  await expect(userA.locator('input[name="f.location_lon"]')).not.toHaveValue(lonBefore);
  expect([...referers]).toEqual([expect.stringMatching(/^http:\/\/admin\.localhost:3006\/$/)]);

  await userA.click('.leaflet-pm-icon-polygon');
  // Below the tool's action bar (Finish / Remove last vertex / Cancel), which opens to the right of the button.
  for (const [dx, dy] of [[-60, 20], [140, 20], [140, 150], [-60, 150], [-60, 20]]) {
    await map.click(at(dx, dy));
    await userA.waitForTimeout(150);  // Geoman reads quick successive clicks as a double-click
  }
  await expect(userA.locator('textarea[name="f.area"]')).toHaveValue(/"type":"Polygon"/);
});

test('artwork list shows 120 px thumbnails, the artwork page a larger preview with credit', async ({ userA }) => {
  const requested = [];
  await userA.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => {
    requested.push(route.request().url().replace(/^.*\//, ''));
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  require('./helpers').sql(`INSERT INTO images (artwork_id, url, license, credit) VALUES (entity_id('artwork', 'the-great-wave-off-kanagawa'),
    'https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg', 'Public domain', 'Katsushika Hokusai')`);
  await userA.goto('/artworks');
  const row = userA.locator('tr', { hasText: 'The Great Wave off Kanagawa' });
  await expect(row.locator('td.thumb img')).toHaveAttribute('src', /\/thumb\/b\/b5\/Great_Wave\.jpg\/120px-Great_Wave\.jpg$/);
  await expect(userA.locator('tr', { hasText: 'Plum Park in Kameido' }).locator('.thumb-empty')).toHaveCount(1);  // no image
  await userA.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(userA.locator('.image-preview img')).toHaveAttribute('src', /500px-Great_Wave\.jpg$/);
  await expect(userA.locator('.image-preview figcaption')).toHaveText('Katsushika Hokusai · Public domain');
  expect(requested).toEqual(expect.arrayContaining(['120px-Great_Wave.jpg', '500px-Great_Wave.jpg']));
});

test('several images per entry: add, reorder (first = main image), edit, remove — audited, in the API', async ({ userA, request }) => {
  await userA.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const add = async (fields) => {
    await userA.goto('/institutions/van-gogh-museum');
    await userA.click('summary:has-text("+ Add image by address")');
    for (const [k, v] of Object.entries(fields)) await userA.fill(`#img-${k}`, v);
    await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
    await expect(userA.locator('.flash.ok')).toHaveText('Image added.');
  };
  await add({ url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Van_Gogh_Museum.jpg', license: 'CC BY-SA 4.0', credit: 'Photo: someone' });
  await add({ url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Entrance.jpg', caption: 'Entrance' });
  await expect(userA.locator('.image-item')).toHaveCount(2);
  await expect(userA.locator('.image-item').first()).toContainText('main image');
  await expect(userA.locator('.image-preview figcaption')).toContainText('Photo: someone · CC BY-SA 4.0');

  // the same image twice is refused with a readable message
  await userA.click('summary:has-text("+ Add image by address")');
  await userA.fill('#img-url', 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Entrance.jpg');
  await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
  await expect(userA.locator('.flash.error')).toHaveText("This image is already one of the entry's images.");

  // make the second one the main image → list thumbnail and API follow
  await userA.goto('/institutions/van-gogh-museum');
  await Promise.all([userA.waitForNavigation(), userA.locator('.image-item', { hasText: 'Entrance' }).locator('button:has-text("make main")').click()]);
  await expect(userA.locator('.image-item').first()).toContainText('Entrance');
  await userA.goto('/institutions');
  await expect(userA.locator('tr', { hasText: 'Van Gogh Museum' }).locator('td.thumb img')).toHaveAttribute('src', /120px-Entrance\.jpg$/);
  await userA.goto('/artists');
  await expect(userA.locator('table.thumbs-artist .thumb-empty').first()).toBeVisible();  // artists have the column too
  let api = await (await request.get('http://127.0.0.1:3006/v1/institutions/van-gogh-museum', { headers: { Host: 'api.localhost' } })).json();
  expect(api.images.map((i) => i.caption)).toEqual(['Entrance', null]);
  expect(api.images[1].license).toBe('CC BY-SA 4.0');
  expect(api.image_url).toMatch(/Entrance\.jpg$/);

  // ↓ moves it back; edit the caption; remove it
  await userA.goto('/institutions/van-gogh-museum');
  await Promise.all([userA.waitForNavigation(), userA.locator('.image-item').first().locator('button[title="Move later"]').click()]);
  await expect(userA.locator('.image-item').first()).toContainText('Photo: someone');
  await userA.locator('.image-item', { hasText: 'Entrance' }).locator('a:has-text("edit")').click();
  await userA.fill('#img-caption', 'Main entrance');
  await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
  await expect(userA.locator('.image-item').nth(1)).toContainText('Main entrance');
  await userA.locator('.image-item', { hasText: 'Main entrance' }).locator('a:has-text("edit")').click();
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Remove this image")')]);
  await expect(userA.locator('.flash.ok')).toHaveText('Image removed.');
  await expect(userA.locator('.image-item')).toHaveCount(1);
  api = await (await request.get('http://127.0.0.1:3006/v1/institutions/van-gogh-museum', { headers: { Host: 'api.localhost' } })).json();
  expect(api.images).toHaveLength(1);

  // in the entry's history, and the removal can be reverted
  await userA.goto('/institutions/van-gogh-museum/history');
  await expect(userA.locator('table.diff > tbody > tr').first()).toContainText('image of Van Gogh Museum “Main entrance”');
  await userA.locator('table.diff > tbody > tr').first().locator('a:has-text("revert…")').click();
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Apply")')]);
  await userA.goto('/institutions/van-gogh-museum');
  await expect(userA.locator('.image-item')).toHaveCount(2);
});

test('static files are linked with a content hash, so a deploy is never hidden by the browser cache', async ({ userA }) => {
  await userA.goto('/');
  const src = await userA.locator('script[src*="editor.js"]').getAttribute('src');
  expect(src).toMatch(/^\/static\/editor\.js\?v=[0-9a-f]{10}$/);
  expect(await userA.locator('link[href*="admin.css"]').getAttribute('href')).toMatch(/^\/static\/admin\.css\?v=[0-9a-f]{10}$/);
  expect(await userA.locator('body').getAttribute('data-map-js')).toMatch(/^\/static\/map\.js\?v=[0-9a-f]{10}$/);
  expect((await userA.request.get(src)).status()).toBe(200);
});
