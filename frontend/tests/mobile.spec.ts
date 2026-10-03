// Phone layout: nothing wider than the screen, the timeline window can be typed instead of dragged.
import { expect, test } from '@playwright/test';

for (const path of ['/#/', '/#/artists/vincent-van-gogh', '/#/artworks', '/#/graph/artists/vincent-van-gogh?depth=2']) {
  test(`no sideways scrolling on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(scroll).toBeLessThanOrEqual(width);
  });
}

test('time window by typing on a phone', async ({ page }) => {
  await page.goto('/#/');
  await page.fill('input[name=from]', '1830');
  await page.fill('input[name=to]', '1850');
  await page.locator('.timeline-form button[type=submit]').tap();
  await expect(page.locator('#map-status')).toContainText('1830–1850');
});

test('pickers fit on the screen', async ({ page }) => {
  await page.goto('/#/');
  await page.locator('details[data-group=artwork] summary').tap();
  const panel = await page.locator('details[data-group=artwork] .pick-panel').boundingBox();
  const width = page.viewportSize()!.width;
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
});
