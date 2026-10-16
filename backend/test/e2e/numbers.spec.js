// Further numbers of an artwork and loans (migration 048, src/admin/numbers.js).
const { test, expect, sql, submitForm, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const addNumber = async (page, slug, { number, institution = '', source = '', label = '' }) => {
  await page.goto(`/artworks/${slug}/edit`);
  await page.click('#numbers summary:has-text("+ Add a number")');
  await page.fill('#n-number', number);
  if (institution) { await page.fill('#n-institution', institution); await page.keyboard.press('Escape'); }
  if (source) { await page.fill('#n-source', source); await page.keyboard.press('Escape'); }
  if (label) await page.fill('#n-label', label);
  await Promise.all([page.waitForNavigation(), page.click('#numbers .actions button:has-text("Add")')]);
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

  // entered on the edit page, under the inventory number; its own forms, not part of the shared working copy
  await expect(userA).toHaveURL(/\/artworks\/sunflowers-national-gallery\/edit\?done=num-added#numbers/);
  await expect(userA.locator('#sec-where #numbers')).toBeVisible();
  expect(await userA.evaluate(() => [...document.querySelector('form[data-collab]').elements].some((el) => el.id === 'n-number'))).toBe(false);
  // the artwork's page lists them and links to the edit page
  await userA.goto('/artworks/sunflowers-national-gallery');
  await expect(userA.locator('#numbers table')).toContainText('F 454');
  await expect(userA.locator('#numbers button[formaction]')).toHaveCount(0);  // removed on the edit page only
  await expect(userA.locator('#numbers a', { hasText: 'edit page' })).toHaveAttribute('href', '/artworks/sunflowers-national-gallery/edit#numbers');
  // removed on the edit page, back there
  sql("INSERT INTO artwork_numbers (artwork_id, number, label) VALUES (entity_id('artwork', 'sunflowers-national-gallery'), 'X 1', 'to remove')");
  await userA.goto('/artworks/sunflowers-national-gallery/edit');
  await Promise.all([userA.waitForNavigation(), userA.locator('#numbers tr', { hasText: 'X 1' }).locator('button:has-text("remove")').click()]);
  await expect(userA).toHaveURL(/\/edit\?done=num-deleted#numbers/);
  await expect(userA.locator('#numbers table')).not.toContainText('X 1');

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
    { number: '99', label: null, institution: { slug: 'van-gogh-museum', name: 'Van Gogh Museum' }, source: null, sources: [] },
    { number: 'F 454', label: null, institution: null, source: { slug: 'catalogue-raisonne-test', name: 'Catalogue raisonné' }, sources: [] }]);
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
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'loan_owner' AND entity_id = entity_id('artwork', 'sunflowers-national-gallery')`))
    .toContain('the provenance names no owner');
  // the lender as the last owner: no question left, and "the last owner isn't the holder" is not raised for a loan
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, acquired, acquired_label)
       VALUES (entity_id('artwork', 'sunflowers-national-gallery'), 99, 'Lender Test', '[1960-01-01,1961-01-01)', '1960')`);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id IN ('loan_owner', 'provenance_last_owner')
              AND entity_id = entity_id('artwork', 'sunflowers-national-gallery')`)).toBe('0');
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
});

test('a further number has its own sources: a marker on the artwork page, a button on the edit page; in the API and the YAML', async ({ userA, request }) => {
  sql("INSERT INTO artwork_numbers (artwork_id, number, label) VALUES (entity_id('artwork', 'the-starry-night'), 'L 1234', 'Lugt')");
  // the edit page: a button with the badges in the number's row opens its dialog (after the entry's form)
  await userA.goto('/artworks/the-starry-night/edit');
  const button = userA.locator('#numbers tr', { hasText: 'L 1234' }).locator('.cite-trigger');
  await expect(button.locator('.cite-none')).toHaveText('+');
  await button.click();
  const dialog = userA.locator('details.cite[open]');
  await expect(dialog.locator('.cite-head')).toContainText('Sources of number L 1234');
  await dialog.locator('input[name=text]').evaluate((el) => { el.closest('details.cite-more').open = true; });
  await dialog.locator('input[name=text]').fill('Lugt, Marques de collections');
  await dialog.locator('.cite-submit').click();
  await expect(userA.locator('details.cite[open] .cite-status')).toHaveText(/Source added/);   // in place, no reload
  await userA.keyboard.press('Escape');
  await expect(button.locator('.cite-text')).toHaveText('T');                                 // the button shows it at once
  expect(sql("SELECT count(*) FROM citations c JOIN artwork_numbers n ON n.id = c.number_id WHERE n.number = 'L 1234'")).toBe('1');
  // the artwork's page: a marker after the number
  await userA.goto('/artworks/the-starry-night');
  await expect(userA.locator('#numbers tr', { hasText: 'L 1234' }).locator('details.cite > summary .cite-text')).toHaveText('T');
  // the API: the number's sources
  const w = await api(request, '/artworks/the-starry-night');
  expect(w.numbers.find((n) => n.number === 'L 1234').sources.map((c) => c.text)).toEqual(['Lugt, Marques de collections']);
  expect(w.numbers.find((n) => n.number === 'L 1234')._num_id).toBeUndefined();
  // the YAML snapshot: sources under the number; removing the number removes them
  expect(sql("SELECT number_citation_docs(id)::text FROM artwork_numbers WHERE number = 'L 1234'")).toBe('["Lugt, Marques de collections"]');
  sql("DELETE FROM artwork_numbers WHERE number = 'L 1234'");
  expect(sql("SELECT count(*) FROM citations WHERE text = 'Lugt, Marques de collections'")).toBe('0');
});
