# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.js >> Markdown: shortcuts, live styling, and a preview rendered like the website
- Location: test/e2e/editor.spec.js:7:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/people/theo-van-gogh/edit
Call log:
  - navigating to "http://admin.localhost:3006/people/theo-van-gogh/edit", waiting until "load"

```

# Test source

```ts
  1   | // Markdown editor (live styling, shortcuts, server preview) and the map picker (without depending on OSM).
  2   | const { test, expect, liveReady, API, BASE } = require('./helpers');
  3   | 
  4   | // 1×1 transparent PNG — stands in for OpenStreetMap tiles, so the test needs no internet and never loads OSM.
  5   | const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  6   | 
  7   | test('Markdown: shortcuts, live styling, and a preview rendered like the website', async ({ userA }) => {
> 8   |   await userA.goto('/people/theo-van-gogh/edit');
      |               ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/people/theo-van-gogh/edit
  9   |   await liveReady(userA);
  10  |   const cm = userA.locator('.md-editor .cm-content').first();
  11  |   await cm.click();
  12  |   await userA.keyboard.press('Control+End');
  13  |   await userA.keyboard.type('\n\nTest: ');
  14  |   await userA.keyboard.press('Control+b');
  15  |   await userA.keyboard.type('bold');
  16  |   await userA.keyboard.press('ArrowRight'); await userA.keyboard.press('ArrowRight');
  17  |   await userA.keyboard.type(' <script>x</script>');
  18  |   const boldSpan = userA.locator('.cm-line span', { hasText: /^bold$/ });
  19  |   await expect(boldSpan).toHaveCSS('font-weight', '700');
  20  |   await expect(userA.locator('#f-description_md')).toHaveValue(/Test: \*\*bold\*\* <script>x<\/script>$/);
  21  |   await userA.click('.md-toolbar button:has-text("Preview")');
  22  |   await expect(userA.locator('.md-preview strong')).toHaveText('bold');
  23  |   await expect(userA.locator('.md-preview')).toContainText('<script>x</script>');  // escaped, shown as text
  24  |   await expect(userA.locator('.md-editor .cm-editor')).toBeHidden();
  25  | });
  26  | 
  27  | test('map picker: tiles carry our origin as Referer, click sets the location, draw an area', async ({ userA }) => {
  28  |   const referers = new Set();
  29  |   await userA.route('https://tile.openstreetmap.org/**', (route) => {
  30  |     referers.add(route.request().headers().referer || '(none)');
  31  |     route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  32  |   });
  33  |   await userA.goto('/places/arles/edit');
  34  |   await liveReady(userA);
  35  |   const map = userA.locator('.map-canvas');
  36  |   const box = await map.boundingBox();
  37  |   // Clicks relative to the map element: Playwright scrolls as needed, so no stale page coordinates.
  38  |   const at = (dx, dy) => ({ position: { x: box.width / 2 + dx, y: box.height / 2 + dy } });
  39  |   const lonBefore = await userA.inputValue('input[name="f.location_lon"]');
  40  |   await map.click(at(60, -40));
  41  |   await expect(userA.locator('input[name="f.location_lon"]')).not.toHaveValue(lonBefore);
  42  |   expect([...referers]).toEqual([`${BASE}/`]);
  43  | 
  44  |   await userA.click('.leaflet-pm-icon-polygon');
  45  |   // Below the tool's action bar (Finish / Remove last vertex / Cancel), which opens to the right of the button.
  46  |   for (const [dx, dy] of [[-60, 20], [140, 20], [140, 150], [-60, 150], [-60, 20]]) {
  47  |     await map.click(at(dx, dy));
  48  |     await userA.waitForTimeout(150);  // Geoman reads quick successive clicks as a double-click
  49  |   }
  50  |   await expect(userA.locator('textarea[name="f.area"]')).toHaveValue(/"type":"Polygon"/);
  51  | });
  52  | 
  53  | test('artwork list shows 120 px thumbnails, the artwork page a larger preview with credit', async ({ userA }) => {
  54  |   const requested = [];
  55  |   await userA.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => {
  56  |     requested.push(route.request().url().replace(/^.*\//, ''));
  57  |     route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  58  |   });
  59  |   require('./helpers').sql(`INSERT INTO images (artwork_id, url, license, credit) VALUES (entity_id('artwork', 'the-great-wave-off-kanagawa'),
  60  |     'https://upload.wikimedia.org/wikipedia/commons/b/b5/Great_Wave.jpg', 'Public domain', 'Katsushika Hokusai')`);
  61  |   await userA.goto('/artworks');
  62  |   const row = userA.locator('tr', { hasText: 'The Great Wave off Kanagawa' });
  63  |   await expect(row.locator('td.thumb img')).toHaveAttribute('src', /\/thumb\/b\/b5\/Great_Wave\.jpg\/120px-Great_Wave\.jpg$/);
  64  |   await expect(userA.locator('tr', { hasText: 'Plum Park in Kameido' }).locator('.thumb-empty')).toHaveCount(1);  // no image
  65  |   await userA.goto('/artworks/the-great-wave-off-kanagawa');
  66  |   await expect(userA.locator('.image-preview img')).toHaveAttribute('src', /500px-Great_Wave\.jpg$/);
  67  |   await expect(userA.locator('.image-preview figcaption')).toHaveText('Katsushika Hokusai · Public domain');
  68  |   expect(requested).toEqual(expect.arrayContaining(['120px-Great_Wave.jpg', '500px-Great_Wave.jpg']));
  69  | });
  70  | 
  71  | test('several images per entry: add, reorder (first = main image), edit, remove — audited, in the API', async ({ userA, request }) => {
  72  |   await userA.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  73  |   const add = async (fields) => {
  74  |     await userA.goto('/institutions/van-gogh-museum');
  75  |     await userA.click('summary:has-text("+ Add image by address")');
  76  |     for (const [k, v] of Object.entries(fields)) await userA.fill(`#img-${k}`, v);
  77  |     await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
  78  |     await expect(userA.locator('.flash.ok')).toHaveText('Image added.');
  79  |   };
  80  |   await add({ url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Van_Gogh_Museum.jpg', license: 'CC BY-SA 4.0', credit: 'Photo: someone' });
  81  |   await add({ url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Entrance.jpg', caption: 'Entrance' });
  82  |   await expect(userA.locator('.image-item')).toHaveCount(2);
  83  |   await expect(userA.locator('.image-item').first()).toContainText('main image');
  84  |   await expect(userA.locator('.image-preview figcaption')).toContainText('Photo: someone · CC BY-SA 4.0');
  85  | 
  86  |   // the same image twice is refused with a readable message
  87  |   await userA.click('summary:has-text("+ Add image by address")');
  88  |   await userA.fill('#img-url', 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Entrance.jpg');
  89  |   await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
  90  |   await expect(userA.locator('.flash.error')).toHaveText("This image is already one of the entry's images.");
  91  | 
  92  |   // make the second one the main image → list thumbnail and API follow
  93  |   await userA.goto('/institutions/van-gogh-museum');
  94  |   await Promise.all([userA.waitForNavigation(), userA.locator('.image-item', { hasText: 'Entrance' }).locator('button:has-text("make main")').click()]);
  95  |   await expect(userA.locator('.image-item').first()).toContainText('Entrance');
  96  |   await userA.goto('/institutions');
  97  |   await expect(userA.locator('tr', { hasText: 'Van Gogh Museum' }).locator('td.thumb img')).toHaveAttribute('src', /120px-Entrance\.jpg$/);
  98  |   await userA.goto('/artists');
  99  |   await expect(userA.locator('table.thumbs-artist .thumb-empty').first()).toBeVisible();  // artists have the column too
  100 |   let api = await (await request.get(`${API}/institutions/van-gogh-museum`, { headers: { Host: 'api.localhost' } })).json();
  101 |   expect(api.images.map((i) => i.caption)).toEqual(['Entrance', null]);
  102 |   expect(api.images[1].license).toBe('CC BY-SA 4.0');
  103 |   expect(api.image_url).toMatch(/Entrance\.jpg$/);
  104 | 
  105 |   // ↓ moves it back; edit the caption; remove it
  106 |   await userA.goto('/institutions/van-gogh-museum');
  107 |   await Promise.all([userA.waitForNavigation(), userA.locator('.image-item').first().locator('button[title="Move later"]').click()]);
  108 |   await expect(userA.locator('.image-item').first()).toContainText('Photo: someone');
```