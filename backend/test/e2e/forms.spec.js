// Form details: the slug follows the title and is cleaned as you type — also with a draft banner on the page (its
// hidden "slug" input once caught the script); the series fields behind a button; an artwork's web page (migration 038).
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
  expect((await api(request, '/artworks/plum-park-in-kameido')).web_url).toBe('https://www.brooklynmuseum.org/opencollection/objects/121664');
  sql("UPDATE artworks SET web_url = NULL WHERE slug = 'plum-park-in-kameido'");
});
