// Finding freely licensed images for an entry without a Wikidata item (src/admin/imagesearch.js), against fixtures
// standing in for Wikimedia Commons, the Met, the Art Institute of Chicago and Cleveland (wikidata-fixtures.js).
const { test, expect, sql, API } = require('./helpers');

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

  const api = await (await request.get(`${API}/artworks/plum-park-in-kameido`, { headers: { Host: 'api.localhost' } })).json();
  expect(api.images.map((i) => [i.url, i.license, i.credit])).toEqual([
    ['https://upload.wikimedia.org/test/plum-park.jpg', 'Public domain', 'Hiroshige'],
    ['https://images.metmuseum.org/test/web-large.jpg', 'Public domain (CC0)', 'The Metropolitan Museum of Art']]);
  expect(api.images[1].source_url).toBe('https://www.metmuseum.org/art/collection/search/1');
  sql("DELETE FROM images WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')");
});

test('find images: Rijksmuseum, Europeana, Smithsonian, Japan Search — only free records', async ({ userA }) => {
  await userA.goto('/artworks/plum-park-in-kameido/images/find?q=Kameido&source=rijks');
  const items = userA.locator('.find-item');
  await expect(items).toHaveCount(1);                                         // the one not "downloadbaar" left out
  await expect(items.locator('img')).toHaveAttribute('src', 'https://iiif.micr.io/TEST/full/400,/0/default.jpg');
  await expect(items).toContainText('Rijksmuseum, Amsterdam');
  await userA.click('.source-tabs a:has-text("Europeana")');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Museum für Asiatische Kunst · CC BY-SA 4.0');
  await userA.click('.source-tabs a:has-text("Smithsonian")');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Freer Gallery of Art · Public domain (CC0)');
  await userA.click('.source-tabs a:has-text("Japan Search")');
  await expect(items).toHaveCount(1);                                         // the CC BY-NC-SA one left out
  await expect(items).toContainText('Tokyo National Museum · Public domain (PDM)');
  await expect(items).toContainText('名所江戸百景 亀戸梅屋舗');
});

test('find images: SMK and DigitaltMuseum — only public-domain / free-licence records', async ({ userA }) => {
  await userA.goto('/artworks/plum-park-in-kameido/images/find?q=Hammershoi&source=smk');
  const items = userA.locator('.find-item');
  await expect(items).toHaveCount(1);
  await expect(items.locator('img')).toHaveAttribute('src', 'https://iip.smk.dk/iiif/jp2/TEST.jp2/full/400,/0/default.jpg');
  await expect(items).toContainText('SMK – Statens Museum for Kunst · Public domain (PDM)');
  await userA.click('.source-tabs a:has-text("DigitaltMuseum")');
  await expect(items).toHaveCount(1);                                         // no NC licence, no record without one
  await expect(items).toContainText('Munchmuseet · CC BY-SA');
});
