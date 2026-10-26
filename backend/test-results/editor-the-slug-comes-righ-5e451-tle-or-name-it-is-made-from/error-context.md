# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor.spec.js >> the slug comes right before the title or name it is made from
- Location: test/e2e/editor.spec.js:138:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/artworks/new
Call log:
  - navigating to "http://admin.localhost:3006/artworks/new", waiting until "load"

```

# Test source

```ts
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
  109 |   await userA.locator('.image-item', { hasText: 'Entrance' }).locator('a:has-text("edit")').click();
  110 |   await userA.fill('#img-caption', 'Main entrance');
  111 |   await Promise.all([userA.waitForNavigation(), userA.click('.image-form button')]);
  112 |   await expect(userA.locator('.image-item').nth(1)).toContainText('Main entrance');
  113 |   await userA.locator('.image-item', { hasText: 'Main entrance' }).locator('a:has-text("edit")').click();
  114 |   await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Remove this image")')]);
  115 |   await expect(userA.locator('.flash.ok')).toHaveText('Image removed.');
  116 |   await expect(userA.locator('.image-item')).toHaveCount(1);
  117 |   api = await (await request.get(`${API}/institutions/van-gogh-museum`, { headers: { Host: 'api.localhost' } })).json();
  118 |   expect(api.images).toHaveLength(1);
  119 | 
  120 |   // in the entry's history, and the removal can be reverted
  121 |   await userA.goto('/institutions/van-gogh-museum/history');
  122 |   await expect(userA.locator('table.diff > tbody > tr').first()).toContainText('image of Van Gogh Museum “Main entrance”');
  123 |   await userA.locator('table.diff > tbody > tr').first().locator('a:has-text("revert…")').click();
  124 |   await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Apply")')]);
  125 |   await userA.goto('/institutions/van-gogh-museum');
  126 |   await expect(userA.locator('.image-item')).toHaveCount(2);
  127 | });
  128 | 
  129 | test('static files are linked with a content hash, so a deploy is never hidden by the browser cache', async ({ userA }) => {
  130 |   await userA.goto('/');
  131 |   const src = await userA.locator('script[src*="editor.js"]').getAttribute('src');
  132 |   expect(src).toMatch(/^\/static\/editor\.js\?v=[0-9a-f]{10}$/);
  133 |   expect(await userA.locator('link[href*="admin.css"]').getAttribute('href')).toMatch(/^\/static\/admin\.css\?v=[0-9a-f]{10}$/);
  134 |   expect(await userA.locator('body').getAttribute('data-map-js')).toMatch(/^\/static\/map\.js\?v=[0-9a-f]{10}$/);
  135 |   expect((await userA.request.get(src)).status()).toBe(200);
  136 | });
  137 | 
  138 | test('the slug comes right before the title or name it is made from', async ({ userA }) => {
  139 |   for (const [url, nameId] of [['/artworks/new', 'f-title'], ['/artists/new', 'f-name'], ['/bibliography/new', 'f-name']]) {
> 140 |     await userA.goto(url);
      |                 ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://admin.localhost:3006/artworks/new
  141 |     const order = await userA.evaluate(() => [...document.querySelectorAll('form.form [id^="f-"]')].map((e) => e.id));
  142 |     expect(order.indexOf('f-slug'), url).toBe(order.indexOf(nameId) - 1);
  143 |   }
  144 | });
  145 | 
```