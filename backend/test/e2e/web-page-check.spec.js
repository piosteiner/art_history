// Every artwork should have its web page (migration 124): the Quality page lists works without one, with the fix and
// the way to Enrich; once the web page is set, the finding is gone.
const { test, expect, sql } = require('./helpers');

const cleanup = () => sql("DELETE FROM artworks WHERE slug IN ('test-no-web-page', 'test-with-web-page')");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('artworks without a web page are listed, and leave the list when it is set', async ({ userA }) => {
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-no-web-page', 'Test Without Web Page');
       INSERT INTO artworks (slug, title, web_url) VALUES ('test-with-web-page', 'Test With Web Page', 'https://example.org/collection/1');
       SELECT refresh_quality();`);
  await userA.goto('/quality?check=artwork_without_web_page');
  const main = userA.locator('main');
  await expect(main).toContainText('Artwork without a web page');
  await expect(main).toContainText('Test Without Web Page');
  await expect(main).not.toContainText('Test With Web Page');
  await expect(main.locator('a[href*="enrich"]').first()).toBeVisible();

  sql("UPDATE artworks SET web_url = 'https://example.org/collection/2' WHERE slug = 'test-no-web-page'; SELECT refresh_quality();");
  await userA.goto('/quality?check=artwork_without_web_page');
  await expect(main).not.toContainText('Test Without Web Page');
});
