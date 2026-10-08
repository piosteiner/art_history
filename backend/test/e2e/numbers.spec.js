// Further numbers of an artwork and loans (migration 048, src/admin/numbers.js).
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();
const addNumber = async (page, slug, { number, institution = '', source = '', label = '' }) => {
  await page.goto(`/artworks/${slug}`);
  await page.click('#numbers summary:has-text("+ Add a number")');
  await page.fill('#n-number', number);
  if (institution) { await page.fill('#n-institution', institution); await page.keyboard.press('Escape'); }
  if (source) { await page.fill('#n-source', source); await page.keyboard.press('Escape'); }
  if (label) await page.fill('#n-label', label);
  await Promise.all([page.waitForNavigation(), page.click('#numbers form.form button:has-text("Add")')]);
};

test.afterAll(() => {
  sql(`DELETE FROM artwork_numbers;
       DELETE FROM provenance WHERE artwork_id = entity_id('artwork', 'sunflowers-national-gallery') AND owner_label = 'Lender Test';
       UPDATE artworks SET on_loan = false, on_loan_since = NULL, on_loan_since_label = NULL, inventory_number = NULL
        WHERE slug IN ('sunflowers-national-gallery', 'the-starry-night');
       DELETE FROM bibliography WHERE slug = 'catalogue-raisonne-test'`);
});

test('further numbers: the owner\'s inventory number and a catalogue number; each one belongs to one work only', async ({ userA, request }) => {
  await addNumber(userA, 'sunflowers-national-gallery', { number: '99', institution: 'van-gogh-museum' });
  await expect(userA).toHaveURL(/done=num-added#numbers/);
  await expect(userA.locator('#numbers table')).toContainText('99');
  await expect(userA.locator('#numbers table')).toContainText('Van Gogh Museum');

  sql("INSERT INTO bibliography (slug, kind, name, authors, year) VALUES ('catalogue-raisonne-test', 'book', 'Catalogue raisonné', '{\"Faille, J.-B. de la\"}', '1970')");
  await addNumber(userA, 'sunflowers-national-gallery', { number: 'F 454', source: 'catalogue-raisonne-test' });
  await expect(userA.locator('#numbers table')).toContainText('F 454');

  // the same number of the same institution for another work: refused — also as a main inventory number
  await addNumber(userA, 'the-starry-night', { number: '99', institution: 'van-gogh-museum' });
  await expect(userA.locator('.flash.error')).toContainText('This number is taken');
  await expect(userA.locator('.flash.error')).toContainText('Sunflowers');
  await addNumber(userA, 'the-starry-night', { number: 'F 454', source: 'catalogue-raisonne-test' });
  await expect(userA.locator('.flash.error')).toContainText('This catalogue already has that number');
  await userA.goto('/artworks/the-starry-night/edit');
  await userA.fill('#f-institution', 'van-gogh-museum');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-inventory_number', '99');
  await submitForm(userA);
  await expect(userA.locator('.errors')).toContainText('already uses it for “Sunflowers');
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");

  // whose it is must be said
  await addNumber(userA, 'the-starry-night', { number: '12' });
  await expect(userA.locator('.flash.error')).toContainText('Say whose number it is');

  const sun = await api(request, '/artworks/sunflowers-national-gallery');
  expect(sun.numbers).toEqual([
    { number: '99', label: null, institution: { slug: 'van-gogh-museum', name: 'Van Gogh Museum' }, source: null },
    { number: 'F 454', label: null, institution: null, source: { slug: 'catalogue-raisonne-test', name: 'Catalogue raisonné' } }]);
});

test('a loan: the owner is someone else on purpose — the quality page asks for the lender, not about the holder', async ({ userA, request }) => {
  await userA.goto('/artworks/sunflowers-national-gallery/edit');
  await userA.selectOption('#f-on_loan', 'yes');
  await userA.fill('#f-on_loan_since', '2021');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/sunflowers-national-gallery\?done=/);
  const sun = await api(request, '/artworks/sunflowers-national-gallery');
  expect(sun.on_loan).toBe(true);
  expect(sun.on_loan_since).toMatchObject({ from_year: 2021 });
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'loan_owner' AND entity_id = entity_id('artwork', 'sunflowers-national-gallery')`))
    .toContain('the provenance names no owner');
  // the lender as the last owner: no question left, and "the last owner isn't the holder" is not raised for a loan
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, acquired, acquired_label)
       VALUES (entity_id('artwork', 'sunflowers-national-gallery'), 99, 'Lender Test', '[1960-01-01,1961-01-01)', '1960')`);
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id IN ('loan_owner', 'provenance_last_owner')
              AND entity_id = entity_id('artwork', 'sunflowers-national-gallery')`)).toBe('0');
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
});
