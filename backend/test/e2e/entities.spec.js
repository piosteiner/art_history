// Creating, editing, deleting entities; relationships (incl. reverse types); pickers.
const { test, expect, sql, submitForm } = require('./helpers');

test('the browser refuses an invalid slug (pattern) — typed ones are cleaned first; the server checks it too', async ({ userA }) => {
  await userA.goto('/artists/new');
  await userA.locator('#f-slug').evaluate((el) => { el.value = 'Bad Slug'; });  // set by a script: not cleaned
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
  await userA.click('summary:has-text("Metadata")');  // behind a button (forms.js SECTIONS)
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
  await userA.click('summary:has-text("+ Add relationship")');
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
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'lived_in');
  await userA.fill('#r-to', 'artist/vincent-van-gogh');
  await userA.keyboard.press('Escape');  // close the "no match" suggestions, as a user would
  await userA.click('form[action$="/relationships"] button:has-text("Add")');
  await expect(userA.locator('.flash.error')).toHaveText(/"lived in" needs a place or an institution as target, not an artist/);
});

test('pickers: typo-tolerant, keyboard selection, filtered by relationship type', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.locator('#f-creator').pressSequentially('hokusia', { delay: 20 });
  await expect(userA.locator('.ac-list:not([hidden]) .ac-item b').first()).toHaveText('Katsushika Hokusai');
  await userA.keyboard.press('Enter');
  await expect(userA.locator('#f-creator')).toHaveValue('katsushika-hokusai');
  await expect(userA).toHaveURL(/\/artworks\/new$/);  // Enter picked, did not submit

  await userA.goto('/artists/paul-gauguin');
  await userA.click('summary:has-text("+ Add relationship")');
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
  await expect(userA.locator('.errors')).toContainText('dimensions: numbers in cm — height alone, height × width, or height × width × depth');
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

test('a sculpture with only a height: a hint in the form, "(height)" on the page and in the API', async ({ userA, request }) => {
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  const hint = userA.locator('.dims-height-only');
  await expect(hint).toBeHidden();
  await userA.fill('input[name="f.dimensions_h"]', '50');
  await expect(hint).toBeVisible();                                  // only the height filled in
  await userA.fill('input[name="f.dimensions_w"]', '20');
  await expect(hint).toBeHidden();
  await userA.fill('input[name="f.dimensions_w"]', '');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('50 cm (height)');
  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/plum-park-in-kameido', { headers: { Host: 'api.localhost' } })).json();
  expect(api.dimensions).toMatchObject({ height_cm: 50, width_cm: null, depth_cm: null, label: '50 cm (height)' });
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await expect(userA.locator('input[name="f.dimensions_h"]')).toHaveValue('50');
  await userA.fill('input[name="f.dimensions_h"]', '');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
});

test('dates by century: "13th century", "late 13th century" — kept as written, a range in the API', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-slug', 'test-reliquary');
  await userA.fill('#f-title', 'Test reliquary');
  await userA.fill('#f-created', 'late 13th century');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-reliquary\?done=created/);
  await expect(userA.locator('dl.fields')).toContainText('late 13th century');
  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/test-reliquary', { headers: { Host: 'api.localhost' } })).json();
  expect(api.created).toEqual({ label: 'late 13th century', from: '1267-01-01', to: '1300-12-31', from_year: 1267, to_year: 1300 });
  await userA.goto('/artworks/test-reliquary/edit');
  await expect(userA.locator('#f-created')).toHaveValue('late 13th century');  // shown as written, not 1267/1300
  sql("DELETE FROM artworks WHERE slug = 'test-reliquary'");
});

test('a new artist / institution typed into an artwork is created and marked "to complete"', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-slug', 'test-melencolia');
  await userA.fill('#f-title', 'Melencolia I');
  await userA.fill('#f-creator', 'Albrecht Dürer');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-institution', 'Kupferstichkabinett Berlin');
  await userA.keyboard.press('Escape');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-melencolia\?done=created&auto=2/);
  await expect(userA.locator('.flash.ok')).toContainText('2 new entries were created');
  expect(sql("SELECT a.slug || ' ' || i.slug FROM artworks w JOIN artists a ON a.id = w.creator_id JOIN institutions i ON i.id = w.current_institution_id WHERE w.slug = 'test-melencolia'"))
    .toBe('albrecht-durer kupferstichkabinett-berlin');

  await userA.goto('/artists');
  await expect(userA.locator('tr', { hasText: 'Albrecht Dürer' }).locator('.tag.warn')).toHaveText('to complete');
  await userA.goto('/artists/albrecht-durer');
  await expect(userA.locator('.auto-banner')).toContainText('while adding Melencolia I');
  await userA.goto('/quality?check=auto_created');
  await expect(userA.locator('main')).toContainText('Albrecht Dürer');

  // Publishing the artist removes the mark; the institution is marked complete by hand.
  await userA.goto('/artists/albrecht-durer/edit');
  await userA.fill('#f-birth', '1471-05-21');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('.auto-banner')).toHaveCount(0);
  await userA.goto('/institutions/kupferstichkabinett-berlin');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("remove the mark")')]);
  await expect(userA.locator('.flash.ok')).toHaveText('Marked as complete.');
  expect(sql('SELECT count(*) FROM auto_created')).toBe('0');
});

test('typing a name: an exact name links the existing artist, a near miss asks first', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-slug', 'test-print');
  await userA.fill('#f-title', 'Test print');
  await userA.fill('#f-creator', 'utagawa hiroshige');               // the exact name (case doesn't matter)
  await userA.keyboard.press('Escape');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-print\?done=created$/);  // nothing new created
  expect(sql("SELECT a.slug FROM artworks w JOIN artists a ON a.id = w.creator_id WHERE w.slug = 'test-print'")).toBe('utagawa-hiroshige');

  await userA.goto('/artworks/new');
  await userA.fill('#f-slug', 'test-print-2');
  await userA.fill('#f-title', 'Test print 2');
  await userA.fill('#f-creator', 'Katsushika Hokusa');               // a typo of an existing artist
  await userA.keyboard.press('Escape');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('did you mean Katsushika Hokusai (katsushika-hokusai)?');
  expect(sql("SELECT count(*) FROM artists WHERE name = 'Katsushika Hokusa'")).toBe('0');
  await userA.check('input[name="new.creator"]');                     // really a different person: create anyway
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/done=created&auto=1/);
  sql("DELETE FROM artworks WHERE slug IN ('test-print', 'test-print-2'); DELETE FROM artists WHERE name = 'Katsushika Hokusa'");
});

// Types at the end of a field (Playwright puts the caret at the start when it focuses a filled input again).
async function typeAtEnd(page, selector, text) {
  await page.locator(selector).focus();
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 10 });
}

test('slug: typed text is cleaned as you type; a new entry\'s slug follows the title until edited', async ({ userA }) => {
  await userA.goto('/artworks/new');
  const slug = userA.locator('#f-slug');
  await typeAtEnd(userA, '#f-title', 'Pine Trees in the Snow');
  await expect(slug).toHaveValue('pine-trees-in-the-snow');
  await typeAtEnd(userA, '#f-title', ' — Dürer!');
  await expect(slug).toHaveValue('pine-trees-in-the-snow-durer');

  await slug.fill('');
  await slug.pressSequentially('My Own Slug', { delay: 10 });         // typed by hand: cleaned, and kept
  await expect(slug).toHaveValue('my-own-slug');
  await typeAtEnd(userA, '#f-title', ' again');
  await expect(slug).toHaveValue('my-own-slug');
  await slug.fill('');                                                // cleared: follows the title again
  await typeAtEnd(userA, '#f-title', '!');
  await expect(slug).toHaveValue('pine-trees-in-the-snow-durer-again');

  await typeAtEnd(userA, '#f-slug', '-');                 // a trailing hyphen is dropped when leaving the field
  await userA.locator('#f-kind').focus();
  await expect(slug).toHaveValue('pine-trees-in-the-snow-durer-again');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/pine-trees-in-the-snow-durer-again\?done=created/);

  await userA.goto('/artworks/pine-trees-in-the-snow-durer-again/edit');  // existing entry: slug no longer follows
  await typeAtEnd(userA, '#f-title', ' x');
  await expect(slug).toHaveValue('pine-trees-in-the-snow-durer-again');
  await typeAtEnd(userA, '#f-slug', ' Two');               // …but is still cleaned
  await expect(slug).toHaveValue('pine-trees-in-the-snow-durer-again-two');
  sql("DELETE FROM artworks WHERE slug = 'pine-trees-in-the-snow-durer-again'");
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
});

test('object type, medium and materials are named and explained; materials in use are listed', async ({ userA }) => {
  sql("UPDATE artworks SET kind = 'woodblock print', materials = '{ink,paper}' WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/the-starry-night/edit');
  const field = (id) => userA.locator('.field', { has: userA.locator(`#${id}`) });
  await expect(field('f-kind').locator('label')).toHaveText('Object type');
  await expect(field('f-kind')).toContainText('What sort of object it is');
  await expect(field('f-medium')).toContainText('worded like a museum label');
  await expect(field('f-materials')).toContainText('no techniques');
  const usedBefore = field('f-materials').locator('.chips', { hasText: 'Used before' });
  await expect(usedBefore.locator('button.chip', { hasText: /^\+ ink$/ })).toHaveCount(1);
  await expect(usedBefore.locator('button.chip', { hasText: /^\+ paper$/ })).toHaveCount(1);
  await userA.goto('/places/arles/edit');
  await expect(userA.locator('label[for="f-kind"]')).toHaveText('Kind of place');
  await userA.goto('/artworks/plum-park-in-kameido');
  await expect(userA.locator('dl.fields dt', { hasText: 'Object type' })).toBeVisible();
  sql("UPDATE artworks SET materials = '{}' WHERE slug = 'plum-park-in-kameido'");
});

test('materials: suggested from the medium and from terms used before, added with a click; typing still works', async ({ userA }) => {
  sql("UPDATE artworks SET materials = '{bronze}' WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/the-starry-night/edit');
  const ta = userA.locator('#f-materials');
  const suggested = userA.locator('.chips', { hasText: 'From the medium' }).locator('button.chip');
  await userA.fill('#f-medium', 'Ink and colour on silk, gilt frame');
  await expect(suggested).toHaveText(['+ ink', '+ silk', '+ gold leaf']);   // colour is not a material; gilt → gold leaf
  await userA.fill('#f-medium', 'Oil on canvas');
  await expect(suggested).toHaveText(['+ oil paint', '+ canvas']);
  await suggested.first().click();
  await expect(ta).toHaveValue('oil paint');
  await expect(suggested).toHaveText(['+ canvas']);                           // what is in the list isn't offered again
  await userA.locator('.chips', { hasText: 'Used before' }).locator('button.chip', { hasText: 'bronze' }).click();
  await ta.press('End');
  await ta.pressSequentially('\nwood', { delay: 10 });                         // typed by hand
  await expect(ta).toHaveValue('oil paint\nbronze\nwood');
  await userA.goto('/artworks/the-starry-night/discard-changes');
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
  sql("UPDATE artworks SET materials = '{}' WHERE slug = 'plum-park-in-kameido'");
});

test('circa dates: "ca. 1755" is c. 1755 = 1750–1760, kept as written', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test circa');
  await userA.fill('#f-created', 'ca. 1755');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-circa\?done=created/);
  await expect(userA.locator('dl.fields')).toContainText('c. 1755');
  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/test-circa', { headers: { Host: 'api.localhost' } })).json();
  expect(api.created).toEqual({ label: 'c. 1755', from: '1750-01-01', to: '1760-12-31', from_year: 1750, to_year: 1760 });
  await userA.goto('/artworks/test-circa/edit');
  await expect(userA.locator('#f-created')).toHaveValue('c. 1755');
  sql("DELETE FROM artworks WHERE slug = 'test-circa'");
});

test('dimensions: a pasted line fills the boxes; inches and mm are converted with a notice', async ({ userA }) => {
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  const box = (x) => userA.locator(`input[name="f.dimensions_${x}"]`);
  const paste = (x, text) => box(x).evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await paste('h', '139.38 × 85.09');
  await expect(box('h')).toHaveValue('139.38');
  await expect(box('w')).toHaveValue('85.09');
  await expect(userA.locator('.dims-notice')).toBeHidden();               // centimetres: nothing to say
  await paste('h', '139.4 × 85.1 cm (54 7/8 × 33 1/2 in.)');              // the metric part is taken
  await expect(box('w')).toHaveValue('85.1');
  await paste('w', '54 7/8 × 33 1/2 in.');
  await expect(box('h')).toHaveValue('139.38');
  await expect(box('w')).toHaveValue('85.09');
  await expect(userA.locator('.dims-notice')).toContainText('Converted from inches: 54 7/8 × 33 1/2 in. → 139.38 × 85.09 cm');
  await userA.click('text=Keep the original in the note');
  await expect(userA.locator('#f-dimensions_note')).toHaveValue('54 7/8 × 33 1/2 in.');
  await box('d').fill('2 in');                                              // typed with a unit: converted on leaving
  await box('d').blur();
  await expect(box('d')).toHaveValue('5.08');
  await paste('h', '1394 × 851 mm');
  await expect(box('h')).toHaveValue('139.4');
  await expect(box('d')).toHaveValue('');                                    // a whole line replaces all three
  await userA.goto('/artworks/plum-park-in-kameido/discard-changes');
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
});

test('further measurements (mount, frame): rows with paste and conversion, on the page and in the API', async ({ userA, request }) => {
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await userA.click('text=+ Add a measurement');
  const row = userA.locator('.dimset-row').first();
  await row.locator('.d-part').fill('mount');
  await row.locator('.d-num').first().evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', '70 7/8 × 37 5/8 in.');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(row.locator('.d-num').nth(0)).toHaveValue('180.02');
  await expect(row.locator('.d-num').nth(1)).toHaveValue('95.57');
  await expect(row.locator('.dims-notice')).toContainText('Converted from inches');
  await userA.click('text=+ Add a measurement');
  const frame = userA.locator('.dimset-row').nth(1);
  await frame.locator('.d-part').fill('frame');
  await frame.locator('.d-num').nth(0).fill('190');
  await frame.locator('.d-num').nth(1).fill('105,5');
  await frame.locator('.d-num').nth(2).fill('6');
  await expect(userA.locator('#f-other_dimensions')).toHaveValue('mount | 180.02 × 95.57\nframe | 190 × 105,5 × 6');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('dl.fields')).toContainText('mount: 180.02 × 95.57 cm');
  await expect(userA.locator('dl.fields')).toContainText('frame: 190 × 105.5 × 6 cm');
  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/plum-park-in-kameido', { headers: { Host: 'api.localhost' } })).json();
  expect(api.other_dimensions).toEqual([
    { part: 'mount', height_cm: 180.02, width_cm: 95.57, depth_cm: null, label: '180.02 × 95.57 cm' },
    { part: 'frame', height_cm: 190, width_cm: 105.5, depth_cm: 6, label: '190 × 105.5 × 6 cm' }]);

  // checked like the main dimensions: a part is needed
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  await expect(userA.locator('.dimset-row')).toHaveCount(2);                  // drawn again from the saved lines
  await userA.locator('.dimset-row').nth(1).locator('.d-part').fill('');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('needs a part');
  sql("UPDATE artworks SET other_dimensions = '[]' WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/plum-park-in-kameido/discard-changes');
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
});

test('an existing entry: an emptied slug follows the title; the old address redirects (admin and API)', async ({ userA, request }) => {
  await userA.goto('/artworks/plum-park-in-kameido/edit');
  const slug = userA.locator('#f-slug');
  await typeAtEnd(userA, '#f-title', ' Test');
  await expect(slug).toHaveValue('plum-park-in-kameido');                    // not touched: stays (public address)
  await slug.fill('');                                                       // emptied on purpose: now it follows
  await typeAtEnd(userA, '#f-title', 's');
  await expect(slug).toHaveValue('plum-park-in-kameido-tests');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/plum-park-in-kameido-tests\?done=published/);

  // a working copy whose slug was emptied earlier: on opening the page, it follows the title right away
  await userA.goto('/artworks/plum-park-in-kameido-tests/edit');
  await userA.locator('#f-slug').fill('');
  await userA.goto('/artworks/plum-park-in-kameido-tests/edit');
  await expect(userA.locator('#f-slug')).toHaveValue('');
  await typeAtEnd(userA, '#f-title', '!');
  await expect(userA.locator('#f-slug')).toHaveValue('plum-park-in-kameido-tests');
  await userA.goto('/artworks/plum-park-in-kameido-tests/discard-changes');
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);

  await userA.goto('/artworks/plum-park-in-kameido/history');               // old address, any page below it
  await expect(userA).toHaveURL(/\/artworks\/plum-park-in-kameido-tests\/history$/);
  const old = await request.get('http://127.0.0.1:3006/v1/artworks/plum-park-in-kameido', { headers: { Host: 'api.localhost' }, maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe('/v1/artworks/plum-park-in-kameido-tests');

  // back to the old slug: it is the entry's own again, nothing redirects in a circle
  sql(`UPDATE artworks SET slug = 'plum-park-in-kameido', title = 'Plum Park in Kameido' WHERE slug = 'plum-park-in-kameido-tests'`);
  expect(sql(`SELECT string_agg(old_slug, ',') FROM slug_history WHERE entity_type = 'artwork'`)).toBe('plum-park-in-kameido-tests');
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
});

test('a renamed slug: [[links]] in every text follow it; a stale text saved later is corrected', async ({ userA }) => {
  const before = sql(`SELECT translate(encode(convert_to(description_md, 'UTF8'), 'base64'), E'\\n', '') FROM movements WHERE slug = 'post-impressionism'`);  // exact, trailing newline too
  sql(`UPDATE movements SET description_md = 'Seen in [[artwork/the-starry-night|the Night]] and [[artwork/the-starry-night]].' WHERE slug = 'post-impressionism'`);
  await userA.goto('/artworks/the-starry-night/edit');
  await userA.locator('#f-slug').fill('starry-night');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/starry-night\?done=published/);
  expect(sql(`SELECT description_md FROM movements WHERE slug = 'post-impressionism'`))
    .toBe('Seen in [[artwork/starry-night|the Night]] and [[artwork/starry-night]].');
  await userA.goto('/movements/post-impressionism/history');                 // its own change, by the same person
  await expect(userA.locator('.tag', { hasText: 'slug rename' })).toHaveCount(1);

  // a working copy from before the rename, published afterwards: the old slug doesn't come back
  sql(`UPDATE movements SET description_md = 'Again [[artwork/the-starry-night]].' WHERE slug = 'post-impressionism'`);
  expect(sql(`SELECT description_md FROM movements WHERE slug = 'post-impressionism'`)).toBe('Again [[artwork/starry-night]].');

  sql(`UPDATE artworks SET slug = 'the-starry-night' WHERE slug = 'starry-night'`);
  sql(`UPDATE movements SET description_md = convert_from(decode('${before}', 'base64'), 'UTF8') WHERE slug = 'post-impressionism'`);
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
});
