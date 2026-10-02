// Markdown editor (live styling, shortcuts, server preview) and the map picker (without depending on OSM).
const { test, expect, liveReady } = require('./helpers');

// 1×1 transparent PNG — stands in for OpenStreetMap tiles, so the test needs no internet and never loads OSM.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('Markdown: shortcuts, live styling, and a preview rendered like the website', async ({ userA }) => {
  await userA.goto('/patrons/theo-van-gogh/edit');
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
  await expect(userA.locator('#f-notes_md')).toHaveValue(/Test: \*\*bold\*\* <script>x<\/script>$/);
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
  require('./helpers').sql(`UPDATE artworks SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg',
    image_license = 'Public domain', image_credit = 'Katsushika Hokusai' WHERE slug = 'the-great-wave-off-kanagawa'`);
  await userA.goto('/artworks');
  const row = userA.locator('tr', { hasText: 'The Great Wave off Kanagawa' });
  await expect(row.locator('td.thumb img')).toHaveAttribute('src', /\/thumb\/b\/b5\/Great_Wave\.jpg\/120px-Great_Wave\.jpg$/);
  await expect(userA.locator('tr', { hasText: 'Plum Park in Kameido' }).locator('.thumb-empty')).toHaveCount(1);  // no image
  await userA.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(userA.locator('.artwork-preview img')).toHaveAttribute('src', /500px-Great_Wave\.jpg$/);
  await expect(userA.locator('.artwork-preview figcaption')).toHaveText('Katsushika Hokusai · Public domain');
  expect(requested).toEqual(expect.arrayContaining(['120px-Great_Wave.jpg', '500px-Great_Wave.jpg']));
});
