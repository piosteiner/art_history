// Phone layout: nothing wider than the screen, the timeline window can be typed instead of dragged.
import { expect, test } from './fixtures';

for (const path of ['/', '/artists/vincent-van-gogh', '/artworks', '/graph/artists/vincent-van-gogh?depth=2', '/privacy']) {
  test(`no sideways scrolling on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll).toBeLessThanOrEqual(width);
  });
}

test('time window by typing on a phone', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[name=from]', '1830');
  await page.fill('input[name=to]', '1850');
  await page.locator('.timeline-form button[type=submit]').tap();
  await expect(page.locator('#map-status')).toContainText('1830–1850');
});

test('pickers fit on the screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('details[data-group=artwork] summary').tap();
  const panel = await page.locator('details[data-group=artwork] .pick-panel').boundingBox();
  const width = page.viewportSize()!.width;
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
});

test('an artwork without a free image: the link to its museum page is near the top, above the map', async ({ page }) => {
  await page.route(/\/v1\/artworks\/the-great-wave-off-kanagawa$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    Object.assign(body, { web_url: 'https://www.metmuseum.org/art/collection/search/45434', web_url_accessed: '2026-10-07', images: [], image_url: null });
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/artworks/the-great-wave-off-kanagawa');
  const top = page.locator('.detail-actions a.web-link');
  await expect(top).toBeVisible();
  await expect(top).toBeInViewport();
  await expect(page.locator('.detail-actions .web-accessed')).toHaveText('link accessed 7 October 2026');
});
