// SIKART (SIK-ISEA, migration 057; src/admin/sikart.js): find the person by name, take the number, compare —
// dates from the biographical note, places by name, its GND and VIAF numbers as reference records.
const { test, expect, sql, submitForm } = require('./helpers');

test.afterAll(() => {
  sql(`DELETE FROM artists WHERE slug = 'ferdinand-hodler-test'; DELETE FROM places WHERE slug = 'bern-test'; DELETE FROM entry_identifiers;
       DELETE FROM citations WHERE source_id = entity_id('source', 'sikart'); DELETE FROM live_docs WHERE entity_type = 'artist';
       DELETE FROM bibliography WHERE slug = 'sikart'`);
});

test('SIKART: search by name, "this one", then the comparison: dates cited or taken, Bern found, GND and VIAF added', async ({ userA }) => {
  sql(`DELETE FROM entry_identifiers; DELETE FROM artists WHERE slug = 'ferdinand-hodler-test'; DELETE FROM places WHERE slug = 'bern-test';
       INSERT INTO places (slug, name, kind, location) VALUES ('bern-test', 'Bern', 'settlement', 'POINT(7.45 46.95)');
       INSERT INTO artists (slug, name, birth, birth_label) VALUES ('ferdinand-hodler-test', 'Ferdinand Hodler', '[1853-03-14,1853-03-15)', '14 March 1853')`);
  await userA.goto('/artists/ferdinand-hodler-test');
  await Promise.all([userA.waitForNavigation(), userA.click('a:has-text("Find in SIKART…")')]);
  const hits = userA.locator('.sikart-hits tbody tr');
  await expect(hits).toHaveCount(2);
  await expect(hits.first()).toContainText('14.3.1853 Bern');
  await Promise.all([userA.waitForNavigation(), hits.first().locator('button:has-text("This one")').click()]);
  await expect(userA).toHaveURL(/\/artists\/ferdinand-hodler-test\/sikart$/);
  await expect(userA.locator('h1')).toHaveText('Compare with SIKART');

  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  await expect(row('Birth')).toContainText('the same — cited');
  await expect(row('Death').locator('input[value=take]')).toBeChecked();
  await expect(row('born in')).toContainText('Bern');
  await expect(row('died in')).toContainText('not in our database');                 // Genf: not one of ours
  await expect(userA.locator('.wd-ids input[name="idf.gnd"]')).toBeChecked();
  await expect(userA.locator('form.wd-form')).toContainText('Heimatort: Gurzelen (BE)');
  await row('born in').locator('input[value=add]').check();
  await Promise.all([userA.waitForNavigation(), userA.click('.wd-form .sticky-actions button')]);
  await expect(userA).toHaveURL(/\/artists\/ferdinand-hodler-test\/edit\?done=gnd/);
  await expect(userA.locator('#f-death')).toHaveValue('1918-05-19');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/ferdinand-hodler-test\?done=published/);

  const me = "entity_type = 'artist' AND entity_id = entity_id('artist', 'ferdinand-hodler-test')";
  expect(sql(`SELECT string_agg(authority || ' ' || value, ', ' ORDER BY authority) FROM entry_identifiers WHERE ${me}`))
    .toBe('gnd 118551884, sikart 4000055, viaf 59113932');
  expect(sql(`SELECT string_agg(c.field || ' ' || b.slug || ' ' || b.reliability || ' ' || c.url, ', ' ORDER BY c.field)
    FROM citations c JOIN bibliography b ON b.id = c.source_id WHERE c.entity_type = 'artist' AND c.entity_id = entity_id('artist', 'ferdinand-hodler-test') AND c.pending IS NULL AND c.field IS NOT NULL`))
    .toBe('birth sikart scholarly https://recherche.sik-isea.ch/sik:person-4000055/in/sikart, death sikart scholarly https://recherche.sik-isea.ch/sik:person-4000055/in/sikart');
  expect(sql(`SELECT r.relationship_type || ' ' || b.slug FROM relationships r JOIN citations c ON c.relationship_id = r.id
    JOIN bibliography b ON b.id = c.source_id WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'ferdinand-hodler-test')`))
    .toBe('born_in sikart');
  // the record's link on the page now goes to the research portal
  await expect(userA.locator('#reference-records a[href="https://recherche.sik-isea.ch/sik:person-4000055/in/sikart"]')).toBeVisible();
  await expect(userA.locator('#reference-records a:has-text("Compare with SIKART…")')).toBeVisible();
});
