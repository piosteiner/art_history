// Creating, editing, deleting entities; relationships (incl. reverse types); pickers.
const { test, expect, sql, submitForm } = require('./helpers');

test('the browser itself refuses an invalid slug; the server checks it too', async ({ userA }) => {
  await userA.goto('/artists/new');
  await userA.fill('#f-slug', 'Bad Slug');
  await userA.click('form.form > .actions button');
  await expect(userA).toHaveURL(/\/artists\/new$/);  // not submitted (pattern attribute)
  expect(await userA.locator('#f-slug').evaluate((el) => el.validity.patternMismatch)).toBe(true);
  // Without the browser's check (e.g. a script posting directly), the server refuses it as well.
  const res = await userA.request.post('/artists', { headers: { Origin: 'http://admin.localhost:3006' }, form: { slug: 'Bad Slug', 'f.name': 'X' } });
  expect(res.status()).toBe(422);
  expect(await res.text()).toContain('slug: lowercase letters, digits and single hyphens only');
});

test('create with validation errors, then correctly', async ({ userA }) => {
  await userA.goto('/artists/new');
  await userA.fill('#f-slug', 'claude-monet');
  await userA.fill('#f-birth', '1840-13');
  await userA.fill('#f-metadata', '{broken');
  await submitForm(userA);
  const errors = userA.locator('.errors li');
  await expect(errors.filter({ hasText: 'metadata: not valid JSON' })).toHaveCount(1);
  await expect(errors.filter({ hasText: 'birth: bad month' })).toHaveCount(1);
  await expect(errors.filter({ hasText: 'name: required' })).toHaveCount(1);
  await expect(userA.locator('#f-birth')).toHaveValue('1840-13');  // what was typed stays

  await userA.fill('#f-name', 'Claude Monet');
  await userA.fill('#f-birth', '1840-11-14');
  await userA.fill('#f-metadata', '');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet\?done=created/);
  await expect(userA.locator('dl.fields')).toContainText('14 November 1840');
  expect(sql("SELECT source || ' ' || action FROM audit_log WHERE table_name = 'artists' ORDER BY id DESC LIMIT 1")).toBe('admin insert');
});

test('a taken slug is refused', async ({ userA }) => {
  await userA.goto('/artists/new');
  await userA.fill('#f-slug', 'vincent-van-gogh');
  await userA.fill('#f-name', 'Duplicate');
  await submitForm(userA);
  await expect(userA.locator('.errors')).toContainText('That slug is already taken.');
});

test('publish an edit (shared working copy)', async ({ userA }) => {
  await userA.goto('/places/antwerp/edit');
  await expect(userA.locator('form.form > .actions button')).toHaveText('Publish');
  await userA.fill('#f-country_code', 'BE');
  await userA.fill('#f-name', 'Antwerp (Antwerpen)');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/places\/antwerp\?done=published/);
  expect(sql("SELECT name FROM places WHERE slug = 'antwerp'")).toBe('Antwerp (Antwerpen)');
});

test('delete: the confirmation lists relationships; a referenced entity is protected', async ({ userA }) => {
  await userA.goto('/artists/katsushika-hokusai/delete');
  await expect(userA.locator('main table tr').first()).toBeVisible();  // its relationships are listed
  await userA.click('button.danger');
  await expect(userA.locator('.flash.error')).toContainText('Still used by artworks');  // it has artworks

  await userA.goto('/artists/claude-monet/delete');
  await userA.click('button.danger');
  await expect(userA).toHaveURL(/\/artists\?done=deleted/);
  expect(sql("SELECT count(*) FROM artists WHERE slug = 'claude-monet'")).toBe('0');
});

test('a reverse relationship ("commissioned by") is stored in canonical direction', async ({ userA }) => {
  await userA.goto('/artworks/the-starry-night');
  await userA.click('details summary');
  await userA.selectOption('#r-type', '~commissioned');
  await userA.fill('#r-to', 'place/paris');
  await userA.fill('#r-period', '1889');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  expect(sql(`SELECT subject_type || '→' || object_type FROM relationships WHERE relationship_type = 'commissioned'
              AND object_id = entity_id('artwork', 'the-starry-night')`)).toBe('place→artwork');
});

test('a relationship with a wrong target type gets a readable message', async ({ userA }) => {
  await userA.goto('/artists/paul-gauguin');
  await userA.click('details summary');
  await userA.selectOption('#r-type', 'lived_in');
  await userA.fill('#r-to', 'artist/vincent-van-gogh');
  await userA.keyboard.press('Escape');  // close the "no match" suggestions, as a user would
  await userA.click('form[action$="/relationships"] button:has-text("Add")');
  await expect(userA.locator('.flash.error')).toHaveText(/"lived in" needs a place as target, not an artist/);
});

test('pickers: typo-tolerant, keyboard selection, filtered by relationship type', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.locator('#f-creator').pressSequentially('hokusia', { delay: 20 });
  await expect(userA.locator('.ac-list:not([hidden]) .ac-item b').first()).toHaveText('Katsushika Hokusai');
  await userA.keyboard.press('Enter');
  await expect(userA.locator('#f-creator')).toHaveValue('katsushika-hokusai');
  await expect(userA).toHaveURL(/\/artworks\/new$/);  // Enter picked, did not submit

  await userA.goto('/artists/paul-gauguin');
  await userA.click('details summary');
  await userA.selectOption('#r-type', 'lived_in');
  await userA.locator('#r-to').pressSequentially('pari', { delay: 20 });
  const items = userA.locator('.ac-list:not([hidden]) .ac-item');
  await expect(items.first()).toContainText('Paris');
  await expect(items.filter({ hasText: 'artist' })).toHaveCount(0);  // only places for "lived in"
});

test('artwork dimensions (2D and 3D) and materials: form, page, public API with material filter', async ({ userA, request }) => {
  await userA.goto('/artworks/the-great-wave-off-kanagawa/edit');
  await userA.fill('input[name="f.dimensions_h"]', '25,7');           // decimal comma is fine
  await userA.fill('input[name="f.dimensions_d"]', '3');              // depth without width → refused
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('dimensions: height and width (and optional depth) must be numbers in cm');
  await userA.fill('input[name="f.dimensions_w"]', '37.9');
  await userA.fill('input[name="f.dimensions_d"]', '');
  await userA.fill('#f-materials', 'ink\nwoodblock\npaper');
  await userA.fill('#f-dimensions_note', 'sheet');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('25.7 × 37.9 cm (sheet)');
  await expect(userA.locator('dl.fields')).toContainText('ink · woodblock · paper');

  const api = (path) => request.get(`http://127.0.0.1:3006/v1/${path}`, { headers: { Host: 'api.localhost' } }).then((r) => r.json());
  const wave = await api('artworks/the-great-wave-off-kanagawa');
  expect(wave.dimensions).toMatchObject({ height_cm: 25.7, width_cm: 37.9, depth_cm: null, note: 'sheet', label: '25.7 × 37.9 cm' });
  expect(wave.materials).toEqual(['ink', 'woodblock', 'paper']);
  expect((await api('artworks?material=woodblock')).data.map((a) => a.slug)).toEqual(['the-great-wave-off-kanagawa']);

  await userA.goto('/artworks/the-great-wave-off-kanagawa/edit');                // 3D: all three
  await userA.fill('input[name="f.dimensions_d"]', '2.5');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('25.7 × 37.9 × 2.5 cm');
});

test('an inventory number needs the institution (readable message, hint in the form)', async ({ userA }) => {
  await userA.goto('/artworks/plum-park-in-kameido/edit');  // has no institution
  await expect(userA.locator('#f-inventory_number').locator('..')).toContainText('Only together with the institution');
  await userA.fill('#f-inventory_number', 'JP 1234');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('An inventory number belongs to a collection: set the institution');
  await userA.fill('#f-institution', 'van-gogh-museum');
  await userA.keyboard.press('Escape');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('JP 1234');
});
