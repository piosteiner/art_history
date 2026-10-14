// Endless lists (src/admin/editor/infinite.js): the next page loads as you scroll; the links stay for a reload.
const { test, expect, sql } = require('./helpers');

test.afterAll(() => sql("DELETE FROM places WHERE slug LIKE 'zz-scroll-%'"));

test('a list longer than a page: scrolling loads the rest, without page links in between', async ({ userA }) => {
  sql(`INSERT INTO places (slug, name, kind, location) SELECT 'zz-scroll-' || n, 'Zz Scroll ' || lpad(n::text, 3, '0'), 'settlement', 'POINT(8 47)'
       FROM generate_series(1, 60) n`);
  const total = Number(sql('SELECT count(*) FROM places'));
  await userA.goto('/places');
  const rows = userA.locator('main table tbody tr');
  await expect(rows).toHaveCount(50);
  await expect(userA.locator('.pager a[rel=next]')).toHaveText('more →');      // the link for a reload / no scripts
  for (let i = 0; i < 5 && (await rows.count()) < total; i += 1) {
    await userA.locator('.pager').last().scrollIntoViewIfNeeded();
    await userA.waitForTimeout(300);
  }
  await expect(rows).toHaveCount(total);
  await expect(userA.locator('main table tbody tr', { hasText: 'Zz Scroll 060' })).toBeVisible();
  await expect(userA.locator('.pager a')).toHaveCount(0);                      // the end: no more link, no "previous"
  expect(new URL(userA.url()).search).toBe('');                               // the address stays the list's
});
