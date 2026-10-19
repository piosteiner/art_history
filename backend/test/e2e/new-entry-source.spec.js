// A source given while creating an entry (the "Source" section of the new-entry form, citations.citeNew): it backs
// every field the entry was created with; an unusable source keeps the form and creates nothing.
const { test, expect, sql, submitForm } = require('./helpers');

const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-new-source', 'test-new-source-bad');
  DELETE FROM bibliography WHERE url = 'https://www.test-new-source-museum.org/'`);
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('new entry with a source: a page link cites every filled field; a bad link creates nothing', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await expect(userA.locator('#sec-source')).toBeVisible();
  await userA.fill('#f-title', 'Test New Source');
  await userA.fill('#f-slug', 'test-new-source');
  await userA.fill('#f-created', '1888');
  await userA.fill('#f-medium', 'Oil on canvas');
  await userA.fill('#cite-url', 'https://www.test-new-source-museum.org/collection/item/7');
  await userA.fill('#cite-locator', 'inv. 7');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-new-source\?done=created/);
  // every filled citable field, one website source, the page and today
  expect(sql(`SELECT string_agg(c.field, ' ' ORDER BY c.field) FROM citations c WHERE c.entity_type = 'artwork' AND c.entity_id = entity_id('artwork', 'test-new-source')`))
    .toBe('created medium title_status');   // title_status: the title (and whether it is a translation)
  expect(sql(`SELECT DISTINCT c.url || ' ' || c.locator || ' ' || (c.accessed = current_date) FROM citations c
    WHERE c.entity_type = 'artwork' AND c.entity_id = entity_id('artwork', 'test-new-source')`)).toBe('https://www.test-new-source-museum.org/collection/item/7 inv. 7 true');
  await expect(userA.locator('dt:has-text("Medium") + dd .cite-badge').first()).toHaveText('M');

  // a source that can't be used: the form comes back with the message, nothing is created
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test New Source Bad');
  await userA.fill('#f-slug', 'test-new-source-bad');
  await userA.fill('#cite-source', 'no-such-source-anywhere');
  await submitForm(userA);
  await expect(userA.locator('.flash.error, .errors').first()).toContainText('no-such-source-anywhere');
  await expect(userA.locator('#cite-source')).toHaveValue('no-such-source-anywhere');
  expect(sql(`SELECT count(*) FROM artworks WHERE slug = 'test-new-source-bad'`)).toBe('0');
});
