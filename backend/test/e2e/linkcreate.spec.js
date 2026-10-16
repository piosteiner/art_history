// A new entry from a [[link]] being typed (editor.js "+ Create …", POST /lookup/create): with the type chosen in a
// small box, or straight away when the type is typed ([[artist/…); minimal and marked "to complete".
const { test, expect, sql, liveReady } = require('./helpers');

test.afterAll(() => sql(`DELETE FROM auto_created WHERE entity_type IN ('person', 'artist') AND entity_id IN
  (SELECT id FROM people WHERE slug = 'zz-test-cook' UNION ALL SELECT id FROM artists WHERE slug = 'zz-test-new-artist');
  DELETE FROM people WHERE slug = 'zz-test-cook'; DELETE FROM artists WHERE slug = 'zz-test-new-artist'`));

test('[[ offers to create what doesn\'t exist; the link is written; suggestions readable in the panel\'s colours', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await liveReady(userA);
  const cm = userA.locator('.md-editor .cm-content').first();
  await cm.click();
  // unselected options: the panel's text colour on the panel, not CodeMirror's light default (several hits: "[[pa")
  await userA.keyboard.type('[[pa', { delay: 15 });
  await expect(userA.locator('.cm-tooltip-autocomplete li').nth(1)).toBeVisible();
  const colors = await userA.locator('.cm-tooltip-autocomplete').evaluate((el) => {
    const li = el.querySelector('li:not([aria-selected])');
    return { text: getComputedStyle(li).color, ground: getComputedStyle(el).backgroundColor, panel: getComputedStyle(document.body).getPropertyValue('--panel') };
  });
  expect(colors.text).not.toBe(colors.ground);
  await userA.keyboard.press('Escape');
  await userA.keyboard.press('Control+a');
  await userA.keyboard.press('Backspace');

  await userA.keyboard.type('Am 13. April 1769 erreichte [[Zz Test Cook', { delay: 15 });
  const create = userA.locator('.cm-tooltip-autocomplete li', { hasText: '＋ Create “Zz Test Cook”…' });
  await expect(create).toBeVisible();
  await create.click();
  const box = userA.locator('.link-create');
  await expect(box).toContainText('Create “Zz Test Cook” as');
  await box.locator('select').selectOption('person');
  await box.locator('button:has-text("Create")').click();
  await expect(box).toHaveCount(0);
  await expect.poll(() => userA.evaluate(() => document.querySelector('#f-description_md').value))
    .toBe('Am 13. April 1769 erreichte [[person/zz-test-cook]]');
  expect(sql(`SELECT p.name || ' / ' || (SELECT count(*) FROM auto_created a WHERE a.entity_type = 'person' AND a.entity_id = p.id)
              FROM people p WHERE slug = 'zz-test-cook'`)).toBe('Zz Test Cook / 1');

  // the type typed first: created at once, the name from the slug
  await userA.keyboard.type(' und [[artist/zz-test-new-artist', { delay: 15 });
  await userA.locator('.cm-tooltip-autocomplete li', { hasText: '＋ Create artist “Zz Test New Artist”' }).click();
  await expect.poll(() => userA.evaluate(() => document.querySelector('#f-description_md').value)).toContain('und [[artist/zz-test-new-artist]]');
  expect(sql("SELECT name FROM artists WHERE slug = 'zz-test-new-artist'")).toBe('Zz Test New Artist');
});
