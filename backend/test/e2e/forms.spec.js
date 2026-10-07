// Form details: the slug follows the title and is cleaned as you type — also with a draft banner on the page (its
// hidden "slug" input once caught the script); the series fields behind a button; an artwork's web page (migrations 038, 039).
const { test, expect, sql, submitForm, liveReady } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test('slug: follows the title and is cleaned while a draft banner is shown', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await liveReady(userA);
  await userA.locator('#f-title').pressSequentially('Draft Wörk', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('draft-work');
  await expect.poll(() => sql("SELECT count(*) FROM admin_drafts WHERE entity_type = 'artwork' AND entity_id IS NULL")).not.toBe('0');  // saved as a draft
  await userA.goto('/artworks/new');                       // fresh form, the draft offered in a banner (hidden input "slug")
  await expect(userA.locator('.flash.draft input[name=slug]')).toHaveCount(1);
  await liveReady(userA);
  await userA.locator('#f-title').pressSequentially('Second Title', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('second-title');
  await userA.locator('#f-slug').fill('');
  await userA.locator('#f-slug').pressSequentially('Mein Bild Ä', { delay: 20 });
  await expect(userA.locator('#f-slug')).toHaveValue('mein-bild-a');
  await userA.click('.flash.draft button:has-text("Discard")');
});

test('series fields are behind "Part of a series…" — open when one of them has a value', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await expect(userA.locator('#group-parent')).not.toHaveAttribute('open', '');
  await expect(userA.locator('#f-parent')).toBeHidden();
  await userA.click('summary:has-text("Part of a series")');
  await expect(userA.locator('#f-parent')).toBeVisible();
  await expect(userA.locator('#f-part_number')).toBeVisible();
  await expect(userA.locator('#f-parts_count')).toBeVisible();
  await userA.goto('/artworks/plum-park-in-kameido/edit');  // not part of anything: closed
  await expect(userA.locator('#group-parent')).not.toHaveAttribute('open', '');
});

test('an artwork\'s web page: saved, checked, in the API; the images section points to it', async ({ userA, request }) => {
  sql("UPDATE artworks SET web_url = NULL WHERE slug = 'plum-park-in-kameido'; DELETE FROM images WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')");
  await userA.goto('/artworks/plum-park-in-kameido');
  await expect(userA.locator('#images ~ p.muted').first()).toContainText('No free image? Add the work\'s page at its museum as Web page');
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await liveReady(userA);
  await userA.fill('#f-web_url', 'not a link');
  await submitForm(userA);
  await expect(userA.locator('.flash.error, ul.errors')).toContainText('Web page: a link starting with https://');
  await userA.fill('#f-web_url', 'https://www.brooklynmuseum.org/opencollection/objects/121664');
  await submitForm(userA);
  await expect(userA.locator('dl.fields')).toContainText('https://www.brooklynmuseum.org/opencollection/objects/121664');
  await expect(userA.locator('#images ~ p.muted').first()).toContainText('the site links the work\'s web page instead');
  const w = await api(request, '/artworks/plum-park-in-kameido');
  expect(w.web_url).toBe('https://www.brooklynmuseum.org/opencollection/objects/121664');
  // the day the link was added, set by the database (migration 039) — kept when the entry is saved again unchanged
  const today = sql('SELECT current_date::text');
  expect(w.web_url_accessed).toBe(today);
  await expect(userA.locator('dl.fields')).toContainText(`added ${sql("SELECT to_char(current_date, 'FMDD FMMonth YYYY')")}`);
  sql("UPDATE artworks SET web_url_accessed = '2001-02-03' WHERE slug = 'plum-park-in-kameido'");  // refused: kept by the trigger
  expect(sql("SELECT web_url_accessed::text FROM artworks WHERE slug = 'plum-park-in-kameido'")).toBe(today);
  sql("UPDATE artworks SET web_url = NULL WHERE slug = 'plum-park-in-kameido'");
});

test('forms in sections: titles and jump links, short fields in pairs, every field once, hints stay visible', async ({ userA }) => {
  await userA.setViewportSize({ width: 1280, height: 900 });
  await userA.goto('/artworks/new');
  await expect(userA.locator('.form-section-title')).toHaveText(['Title and names', 'Who and when', 'Object', 'Where it is', 'Description', 'Identifiers']);
  await expect(userA.locator('.form-nav a')).toHaveCount(6);
  // creator and attribution side by side
  const [a, b] = await Promise.all(['#f-creator', '#f-attribution_label'].map((s) => userA.locator(s).boundingBox()));
  expect(Math.abs(a.y - b.y)).toBeLessThan(5);
  expect(b.x).toBeGreaterThan(a.x + 200);
  // the hints are shown without clicking anything
  await expect(userA.locator('.field', { has: userA.locator('#f-medium') }).locator('.hint')).toBeVisible();
  // the slug right before the title it is made from (owner, 2026-10-07)
  await expect(userA.locator('#sec-names #f-slug')).toHaveCount(1);
  // no field twice, none lost
  const names = await userA.locator('form.form [name^="f."]').evaluateAll((els) => els.map((e) => e.name).filter((n) => !/_(lon|lat|label|lang|h|w|d)$/.test(n)));
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual(expect.arrayContaining(['f.title', 'f.creator', 'f.web_url', 'f.parent', 'f.area', 'f.metadata', 'f.wikidata_id']));
});

test('a map in a closed group works once it is opened (Leaflet measures again)', async ({ userA }) => {
  await userA.setViewportSize({ width: 1280, height: 900 });
  await userA.goto('/artworks/new');
  await userA.click('summary:has-text("Where it stands")');
  const map = userA.locator('#group-location .leaflet-container');
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box.width).toBeGreaterThan(300);
  await expect.poll(() => map.evaluate((el) => el.querySelectorAll('.leaflet-tile-loaded, .leaflet-tile').length)).toBeGreaterThan(0);
  await userA.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(userA.locator('input[name="f.location_lon"]')).not.toHaveValue('');
});

test('bibliography: a section whose fields the kind of source doesn\'t use is hidden, title and all', async ({ userA }) => {
  await userA.goto('/bibliography/new');
  await userA.selectOption('#f-kind', 'archival');
  await expect(userA.locator('#sec-container')).toBeHidden();          // "Appeared in": nothing for an archival source
  await expect(userA.locator('#sec-online')).toBeVisible();            // archive, shelfmark
  await userA.selectOption('#f-kind', 'article');
  await expect(userA.locator('#sec-container')).toBeVisible();
});
