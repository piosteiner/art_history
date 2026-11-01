// Private reference images (migration 184): the account that uploads an image is the only one that sees it — on the
// work's page and at its address; another login gets nothing, and the public API role may not read the table.
const sharp = require('sharp');
const { execFileSync } = require('child_process');
const { test, expect, sql } = require('./helpers');
const { DB } = require('./env');

const cleanup = () => sql("DELETE FROM artworks WHERE slug = 'test-private-images'");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('a reference image is seen by its uploader only', async ({ userA, userB }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-private-images', 'Test Private Images')");
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 180, g: 70, b: 43 } } }).png().toBuffer();

  await userA.goto('/artworks/test-private-images');
  const box = userA.locator('.private-images');
  await expect(box).toContainText('Only you see these');
  await box.locator('[name="pi-locator"]').fill('p. 33, fig. 29');
  await box.locator('[name="pi-file"]').setInputFiles({ name: 'figure.png', mimeType: 'image/png', buffer: png });
  await expect(box.locator('.image-item img')).toHaveCount(1);
  await expect(box.locator('.image-item')).toContainText('p. 33, fig. 29');
  const src = await box.locator('.image-item img').getAttribute('src');
  const own = await userA.request.get(src);
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toBe('image/webp');
  expect(own.headers()['cache-control']).toContain('no-store');

  // another login: the section is empty, the image's address answers 404, deleting it too
  await userB.goto('/artworks/test-private-images');
  await expect(userB.locator('.private-images .image-item')).toHaveCount(0);
  expect((await userB.request.get(src)).status()).toBe(404);
  expect([403, 404]).toContain((await userB.request.post(`${src}/delete`)).status());   // the origin check or not found: nothing deleted
  expect(sql("SELECT count(*) FROM private_images i JOIN artworks a ON a.id = i.artwork_id WHERE a.slug = 'test-private-images'")).toBe('1');

  // the public API's database role may not read the table at all
  let denied = '';
  try {
    execFileSync('psql', ['-X', '-h', 'localhost', '-U', 'arthistory_api', '-d', DB, '-Atc', 'SELECT count(*) FROM private_images'], { stdio: 'pipe' });
  } catch (err) { denied = String(err.stderr); }
  expect(denied).toContain('permission denied');

  // the uploader deletes it
  await userA.goto('/artworks/test-private-images');
  await userA.locator('.private-images .image-item button', { hasText: 'delete' }).click();
  await expect(userA.locator('.private-images .image-item')).toHaveCount(0);
});
