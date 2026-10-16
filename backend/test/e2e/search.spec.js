// Search boxes: typo-tolerant names, alternative names, full text with stemming, relationships.
const { test, expect } = require('./helpers');

const topSearch = async (page, q) => {
  await page.fill('.top-search input', q);
  await Promise.all([page.waitForNavigation(), page.press('.top-search input', 'Enter')]);
};

test('top-bar search: typo, alternative name, word forms, relationship label', async ({ userA }) => {
  await userA.goto('/');  // the search bar is in the header of every page
  await topSearch(userA, 'hokusia');
  await expect(userA.locator('.search-hit a').first()).toHaveText('Katsushika Hokusai');

  await topSearch(userA, 'anvers');
  await expect(userA.locator('.search-hit').filter({ hasText: 'Antwerp' })).toContainText('Anvers');

  await topSearch(userA, 'painted');  // stems to "paint": finds "paintings" in texts
  await expect(userA.locator('.search-hit mark').first()).toBeVisible();

  await topSearch(userA, 'yellow house');
  await expect(userA.locator('#r-relationships')).toBeVisible();
});

test('list page search is typo-tolerant and ranks the best match first', async ({ userA }) => {
  await userA.goto('/artworks?q=starry+nite');
  await expect(userA.locator('main table tbody tr td a').first()).toHaveText('The Starry Night');
  await userA.goto('/places?q=%25');  // a literal %, not a wildcard
  await expect(userA.locator('main')).toContainText('Nothing found.');
});

test('artworks list: works whose title matches first, then the works of a matching artist (A–Z), each with its creator', async ({ userA }) => {
  await userA.goto('/artworks?q=hiroshige');
  const rows = userA.locator('main table tbody tr');
  await expect(rows.locator('td:nth-child(2) > a')).toHaveText(['Bridge in the Rain (after Hiroshige)', 'Flowering Plum Orchard (after Hiroshige)',
    'Plum Park in Kameido', 'Sudden Shower over Shin-Ōhashi Bridge and Atake']);
  await expect(rows.nth(2)).toHaveText('Works by a matching artist');           // the heading between the two groups
  await expect(rows.nth(0)).toContainText('Vincent van Gogh');                   // the creator under each title
  await expect(rows.nth(3)).toContainText('Utagawa Hiroshige');
  await userA.goto('/artworks?q=hirosige');                                      // a typo in the artist's name too
  await expect(userA.locator('main table tbody tr', { hasText: 'Plum Park in Kameido' })).toBeVisible();
});
