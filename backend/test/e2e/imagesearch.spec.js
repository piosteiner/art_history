// Finding freely licensed images for an entry without a Wikidata item (src/admin/imagesearch.js), against fixtures
// standing in for Wikimedia Commons, the Met, the Art Institute of Chicago and Cleveland (wikidata-fixtures.js).
const { test, expect, sql } = require('./helpers');

test('find images: four sources, only free ones, one click adds with licence and credit', async ({ userA, request }) => {
  sql("DELETE FROM images WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')");  // other specs add some
  await userA.goto('/artworks/plum-park-in-kameido');
  await userA.click('a:has-text("Find images…")');
  await expect(userA.locator('main input[name=q]')).toHaveValue('Plum Park in Kameido Utagawa Hiroshige');  // title + artist

  // Commons: the file without a licence statement isn't offered; tracking parameters dropped
  await expect(userA.locator('.find-item')).toHaveCount(1);
  await expect(userA.locator('.find-item')).toContainText('Public domain');
  await Promise.all([userA.waitForNavigation(), userA.click('.find-item button:has-text("Add")')]);
  await expect(userA).toHaveURL(/\/images\/find\?source=commons&q=.*&done=img-added/);   // back to the results
  await expect(userA.locator('.find-item .tag')).toHaveText('added ✓');

  // the Met: only public-domain objects, the web-sized image
  await userA.click('.source-tabs a:has-text("Metropolitan Museum")');
  await expect(userA.locator('.find-item')).toHaveCount(1);
  await expect(userA.locator('.find-item')).toContainText('Utagawa Hiroshige, 1857');
  await Promise.all([userA.waitForNavigation(), userA.click('.find-item button:has-text("Add")')]);
  await userA.click('.source-tabs a:has-text("Art Institute of Chicago")');
  await expect(userA.locator('.find-item img')).toHaveAttribute('src', 'https://www.artic.edu/iiif/2/abc/full/400,/0/default.jpg');
  await userA.click('.source-tabs a:has-text("Cleveland Museum of Art")');
  await expect(userA.locator('.find-item')).toContainText('Cleveland Museum of Art · Public domain (CC0)');

  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/plum-park-in-kameido', { headers: { Host: 'api.localhost' } })).json();
  expect(api.images.map((i) => [i.url, i.license, i.credit])).toEqual([
    ['https://upload.wikimedia.org/test/plum-park.jpg', 'Public domain', 'Hiroshige'],
    ['https://images.metmuseum.org/test/web-large.jpg', 'Public domain (CC0)', 'The Metropolitan Museum of Art']]);
  expect(api.images[1].source_url).toBe('https://www.metmuseum.org/art/collection/search/1');
  sql("DELETE FROM images WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')");
});
