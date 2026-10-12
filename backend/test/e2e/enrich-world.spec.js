// Enrich with KulturNav (Nordic museums), the National Library of Korea (names offered) and ArCo (the Italian
// catalogue, information only) — src/admin/kulturnav.js, nlk.js, arco.js
const { test, expect, sql, submitForm } = require('./helpers');

const cleanup = () => sql(`DELETE FROM artists WHERE slug IN ('edvard-munch-kn', 'kim-hong-do-nlk', 'antonio-canova-arco');
  DELETE FROM places WHERE slug = 'oslo-kn'; DELETE FROM live_docs WHERE entity_type = 'artist';
  DELETE FROM entry_identifiers WHERE value IN ('fad5b908-b64d-4feb-ac06-c175ea1f5128', 'KAC200207547', '61624802', '500032949', 'n79006348', '122299485')`);
test.afterAll(cleanup);

test('KulturNav: dates by the day, died in our Oslo ("Oslo (fylke)"), its VIAF / ULAN / LC numbers', async ({ userA }) => {
  cleanup();
  sql(`INSERT INTO places (slug, name, kind, location) VALUES ('oslo-kn', 'Oslo', 'settlement', 'POINT(10.75 59.91)');
       INSERT INTO artists (slug, name) VALUES ('edvard-munch-kn', 'Edvard Munch');
       INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'edvard-munch-kn'), 'kulturnav', 'fad5b908-b64d-4feb-ac06-c175ea1f5128')`);
  await userA.goto('/artists/edvard-munch-kn/enrich');
  await expect(userA.locator('.enrich-sources')).toContainText('KulturNav');
  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  await expect(row('Birth').locator('input[value=take]')).toBeChecked();
  await expect(row('died in')).toContainText('Oslo');
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA.locator('#f-birth')).toHaveValue('1863-12-12');
  await expect(userA.locator('#f-death')).toHaveValue('1944-01-23');
  await submitForm(userA);
  expect(sql(`SELECT string_agg(b.slug || ' ' || r.relationship_type || ' ' || o.slug, ', ') FROM relationships r JOIN places o ON o.id = r.object_id
    JOIN citations c ON c.relationship_id = r.id JOIN bibliography b ON b.id = c.source_id
    WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'edvard-munch-kn')`)).toBe('kulturnav died_in oslo-kn');
  expect(sql(`SELECT string_agg(authority, ', ' ORDER BY authority) FROM entry_identifiers WHERE entity_type = 'artist'
    AND entity_id = entity_id('artist', 'edvard-munch-kn')`)).toBe('kulturnav, lc, ulan, viaf');
});

test('National Library of Korea: the year of birth, the Korean name ticked, a hanja form added by choice', async ({ userA }) => {
  sql(`INSERT INTO artists (slug, name) VALUES ('kim-hong-do-nlk', 'Kim Hong-do');
       INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'kim-hong-do-nlk'), 'nlk', 'KAC200207547')`);
  await userA.goto('/artists/kim-hong-do-nlk/enrich');
  const names = userA.locator('.wd-names');
  await expect(names.locator('tr', { hasText: '김홍도' }).locator('input')).toBeChecked();
  await expect(names.locator('tr', { hasText: '金弘道' }).locator('input')).not.toBeChecked();
  await expect(names).not.toContainText('Kim, Hongdo');                           // Latin forms left out
  await names.locator('tr', { hasText: '金弘道' }).locator('input').check();
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA.locator('#f-birth')).toHaveValue('1745');
  await expect(userA.locator('#f-names')).toHaveValue('김홍도 | ko | original\n金弘道 | ko-Hani | alternative');
  await submitForm(userA);
  expect(sql("SELECT string_agg(n ->> 'text' || ' ' || (n ->> 'lang'), ', ') FROM artists, jsonb_array_elements(names) n WHERE slug = 'kim-hong-do-nlk'"))
    .toBe('김홍도 ko, 金弘道 ko-Hani');
});

test('ArCo: the works in the Italian catalogue, found through the Wikidata item', async ({ userA }) => {
  sql("INSERT INTO artists (slug, name, wikidata_id) VALUES ('antonio-canova-arco', 'Antonio Canova', 'Q5547')");
  await userA.goto('/artists/antonio-canova-arco/enrich');
  await expect(userA.locator('.enrich-form')).toContainText('180 works in Italian public collections');
  const works = userA.locator('.arco-works li');
  await expect(works).toHaveCount(2);
  await expect(works.first()).toContainText("Maria Luigia d'Asburgo in veste di Concordia (scultura) by Canova Antonio");   // the English label
  await expect(works.first().locator('a')).toHaveAttribute('href', 'https://catalogo.beniculturali.it/detail/HistoricOrArtisticProperty/0800404054');
});
