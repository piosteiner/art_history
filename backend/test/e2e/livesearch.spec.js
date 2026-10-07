// Live search (src/admin/editor/livesearch.js): results follow the typing without a page load; the header dropdown.
const { test, expect } = require('./helpers');

// a marker on the page survives only if no new page was loaded
const mark = (page) => page.evaluate(() => { window.__same = true; });
const same = (page) => page.evaluate(() => window.__same === true);

test('list pages, the search page and the quality filters update as you type / choose', async ({ userA }) => {
  await userA.goto('/artists');
  await mark(userA);
  await userA.locator('main input[name=q]').pressSequentially('hokusia', { delay: 30 });  // with a typo
  await expect(userA.locator('[data-live-results="list"] tbody tr')).toHaveCount(1);
  await expect(userA.locator('[data-live-results="list"]')).toContainText('Katsushika Hokusai');
  await expect(userA).toHaveURL(/\/artists\?q=hokusia$/);                  // the address follows
  expect(await same(userA)).toBe(true);
  await expect(userA.locator('main input[name=q]')).toBeFocused();

  await userA.goto('/search');
  await mark(userA);
  await userA.locator('main input[name=q]').pressSequentially('arles', { delay: 30 });
  await expect(userA.locator('[data-live-results="search"]')).toContainText('Arles');
  expect(await same(userA)).toBe(true);

  await userA.goto('/quality');
  await mark(userA);
  await userA.selectOption('main select[name=type]', 'place');
  await expect(userA).toHaveURL(/\/quality\?type=place$/);
  await expect(userA.locator('[data-live-results="quality"] .tag', { hasText: /^artist$/ })).toHaveCount(0);
  expect(await same(userA)).toBe(true);
});

test('Wikidata search is live too', async ({ userA }) => {
  await userA.goto('/artists/new/wikidata');
  await mark(userA);
  await userA.locator('main input[name=search]').pressSequentially('monet', { delay: 30 });
  await expect(userA.locator('[data-live-results="wikidata"] .search-hit')).toContainText(['Claude Monet']);
  expect(await same(userA)).toBe(true);
});

test('the header search: a dropdown of matches, keyboard, Enter on nothing = the full page', async ({ userA }) => {
  await userA.goto('/');
  const box = userA.locator('.top-search input');
  await box.pressSequentially('gaug', { delay: 30 });
  const list = userA.locator('.top-search-list');
  await expect(list.locator('a').first()).toContainText('Paul Gauguin');
  await expect(list.locator('a.all')).toHaveText('All results for “gaug” →');
  await box.press('ArrowDown');
  await Promise.all([userA.waitForNavigation(), box.press('Enter')]);
  await expect(userA).toHaveURL(/\/artists\/paul-gauguin$/);

  await userA.locator('.top-search input').fill('arles');
  await Promise.all([userA.waitForNavigation(), userA.locator('.top-search input').press('Enter')]);
  await expect(userA).toHaveURL(/\/search\?q=arles$/);
});
