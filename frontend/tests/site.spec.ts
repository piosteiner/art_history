// Smoke tests against the live, curated content (via the dev proxy). They check behaviour, not exact numbers,
// so adding entries in the admin panel doesn't break them. Fixed points: Van Gogh, The Great Wave, woodblock prints.
import { expect, test, type Page } from '@playwright/test';

const noErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('explore: map, pickers, timeline; a typed window filters the map', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('details.pick')).toHaveCount(5);
  await expect(page.locator('.row-label').first()).toBeVisible();
  await expect(page.locator('#map-status')).toContainText('places');

  await page.fill('input[name=from]', '1888');
  await page.fill('input[name=to]', '1889');
  await page.press('input[name=to]', 'Enter');
  await expect(page.locator('#map-status')).toContainText('in 1888–1889');
  await expect(page).toHaveURL(/from=1888&to=1889/);
  expect(errors).toEqual([]);
});

test('timeline zooms and pans without changing the window', async ({ page }) => {
  await page.goto('/?from=1880&to=1890');
  const view = page.locator('.timeline-view');
  await page.locator('.timeline-svg').focus();
  await page.keyboard.press('+');
  await expect(view).toContainText('showing');
  await page.click('[data-zoom=fit]');
  await expect(view).toHaveText('');
  await expect(page.locator('input[name=from]')).toHaveValue('1880');
});

test('pickers: search explains matches, ticking every entry means "all", by chosen artists', async ({ page }) => {
  await page.goto('/');
  const artworks = page.locator('details[data-group=artwork]');
  await artworks.locator('summary').click();
  await artworks.locator('.pick-search').fill('wood');
  await expect(artworks.locator('.pick-item').first()).toBeVisible();
  await expect(artworks.locator('.pick-why').first()).toContainText('Type:');
  await expect(artworks.locator('.pick-why mark').first()).toHaveText(/wood/i);

  await artworks.locator('.pick-search').fill('');
  await artworks.locator('[data-act=none]').click();
  await expect(artworks.locator('.pick-count')).toHaveText('none');
  for (const cb of await artworks.locator('.pick-list input[type=checkbox]').all()) await cb.check();
  await expect(artworks.locator('.pick-count')).toHaveText('all');

  await artworks.locator('[data-act=by-artists]').click();
  await expect(artworks.locator('.pick-count')).toHaveText('by chosen artists');
  await expect(page).toHaveURL(/artworks=by-artists/);
});

test('picker names: click ticks, Ctrl+click opens the entry in a new tab', async ({ page, context }) => {
  await page.goto('/');
  const artists = page.locator('details[data-group=artist]');
  await artists.locator('summary').click();
  const vg = artists.locator('.pick-item', { hasText: 'Vincent van Gogh' });
  await vg.locator('.pick-link').click();
  await expect(vg.locator('input')).not.toBeChecked();
  const [tab] = await Promise.all([context.waitForEvent('page'), vg.locator('.pick-link').click({ modifiers: ['ControlOrMeta'] })]);
  await expect(tab).toHaveURL(/\/artists\/vincent-van-gogh$/);
});

test('artist detail: facts, relationships, map, links to explore and network', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/artists/vincent-van-gogh');
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  await expect(page.locator('.facts')).toContainText('Born');
  await expect(page.locator('.rel-presence')).toContainText('lived in');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.click('text=Show on the map and timeline');
  await expect(page).toHaveURL(/\/\?artists=vincent-van-gogh/);
  await expect(page.locator('#map-status')).toContainText('chosen entries on the map');
  expect(errors).toEqual([]);
});

test('artwork detail: image with credit opens large', async ({ page }) => {
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(page.locator('.figure .credit')).not.toBeEmpty();
  await page.click('.figure img');
  await expect(page.locator('dialog.lightbox[open] img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.lightbox')).toHaveCount(0);
});

test('list page: same field search as the pickers, typos as similar names', async ({ page }) => {
  await page.goto('/artworks');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.fill('.filter', 'wood');
  await expect(page.locator('#count')).toContainText('match');
  await expect(page.locator('.card mark').first()).toHaveText(/wood/i);

  await page.goto('/artists');
  await page.fill('.filter', 'hokusia');
  await expect(page.locator('.cards-heading-similar')).toBeVisible();
  await expect(page.locator('#items')).toContainText('Hokusai');
});

test('header search finds fields and typos', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('.search-form input');
  await input.fill('zundert');
  await expect(page.locator('.search-results')).toContainText('Born in');
  await input.fill('hokusia');
  await expect(page.locator('.search-results')).toContainText('Hokusai');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/(artists|artworks)\//);
});

test('network graph: nodes, details on click, filters in the URL', async ({ page }) => {
  const errors = noErrors(page);
  await page.goto('/graph/artists/vincent-van-gogh?depth=2');
  await expect(page.locator('.node.root')).toHaveCount(1);
  expect(await page.locator('.node').count()).toBeGreaterThan(2);
  await page.locator('.node.root circle').click({ force: true });
  await expect(page.locator('.graph-info h2')).toHaveText('Vincent van Gogh');
  await page.locator('.graph-cats input[value=influence]').uncheck();
  await expect(page).toHaveURL(/categories=/);
  expect(errors).toEqual([]);
});

test('theme toggle switches to dark and back', async ({ page }) => {
  await page.goto('/artists');
  const toggle = page.locator('.theme-toggle');
  await toggle.click(); // light
  await toggle.click(); // dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await toggle.click(); // auto
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('unknown entries show "Not found"', async ({ page }) => {
  await page.goto('/artists/no-such-artist');
  await expect(page.locator('h1')).toHaveText('Not found');
});

test('old #/ addresses still work and become paths', async ({ page }) => {
  await page.goto('/#/artists/vincent-van-gogh');
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  await expect(page).toHaveURL(/\/artists\/vincent-van-gogh$/);
});

test('links navigate without reloading; back returns', async ({ page }) => {
  await page.goto('/artists');
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await page.locator('.card-link', { hasText: 'Vincent van Gogh' }).click();
  await expect(page.locator('h1')).toHaveText('Vincent van Gogh');
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1); // same page, no reload
  await page.goBack();
  await expect(page.locator('h1')).toHaveText('Artists');
});
