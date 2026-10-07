// The city of an exact location, found and if needed created when saving (placefinder.cityAt, saveEntity → cityFor):
// Nominatim fixtures (wikidata-fixtures.js: the reverse lookup gives a district, the address names Kamakura).
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

async function newInstitution(page, name, [lon, lat]) {
  await page.goto('/institutions/new');
  await page.fill('#f-name', name);
  await page.click('summary:has-text("Exact location on the map")');
  await page.fill('input[name="f.location_lon"]', String(lon));
  await page.fill('input[name="f.location_lat"]', String(lat));
  await submitForm(page);
}

test.afterAll(() => {
  sql(`DELETE FROM relationships WHERE subject_type = 'artwork' AND subject_id = entity_id('artwork', 'test-great-buddha-hall');
       DELETE FROM artworks WHERE slug = 'test-great-buddha-hall';
       DELETE FROM institutions WHERE slug IN ('test-kamakura-museum', 'test-kamakura-library', 'test-arctic-station');
       DELETE FROM places WHERE slug = 'kamakura'`);
});

test('an institution with an exact location gets its city — created the first time, then found', async ({ userA, request }) => {
  await newInstitution(userA, 'Test Kamakura Museum', [139.5560, 35.3260]);
  await expect(userA).toHaveURL(/\/institutions\/test-kamakura-museum\?done=created&city=1&places=1/);
  await expect(userA.locator('.flash.ok')).toContainText('Its city was set from the location — 1 new place created');
  await expect(userA.locator('dl.fields')).toContainText('kamakura');
  // the new city: Kamakura (the city, not the district), its names, Wikidata id, point, parent found by the map, not "to complete"
  expect(sql(`SELECT p.name || ' ' || p.kind || ' ' || p.wikidata_id || ' ' || ST_AsText(p.location) || ' in ' || par.slug
              FROM places p JOIN places par ON par.id = p.parent_id WHERE p.slug = 'kamakura'`)).toBe('Kamakura settlement Q200250 POINT(139.5467 35.3192) in japan');
  expect(sql("SELECT names::text FROM places WHERE slug = 'kamakura'")).toContain('鎌倉市');
  expect(sql("SELECT count(*) FROM auto_created WHERE entity_type = 'place' AND entity_id = entity_id('place', 'kamakura')")).toBe('0');
  expect((await api(request, '/institutions/test-kamakura-museum')).place).toMatchObject({ slug: 'kamakura' });

  // a second institution there: the same city, nothing created
  await newInstitution(userA, 'Test Kamakura Library', [139.5500, 35.3200]);
  await expect(userA).toHaveURL(/\/institutions\/test-kamakura-library\?done=created&city=1$/);
  expect(sql("SELECT count(*) FROM places WHERE name = 'Kamakura'")).toBe('1');
  expect(sql("SELECT p.slug FROM institutions i JOIN places p ON p.id = i.place_id WHERE i.slug = 'test-kamakura-library'")).toBe('kamakura');
});

test('a work that doesn\'t move gets "created in" its city, dated like the work', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Great Buddha Hall');
  await userA.fill('#f-created', '1252');
  await userA.click('summary:has-text("Where it stands")');
  await userA.fill('input[name="f.location_lon"]', '139.5357');
  await userA.fill('input[name="f.location_lat"]', '35.3167');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-great-buddha-hall\?done=created&city=1/);
  expect(sql(`SELECT o.slug || ' ' || r.period_label FROM relationships r JOIN places o ON o.id = r.object_id
              WHERE r.subject_type = 'artwork' AND r.subject_id = entity_id('artwork', 'test-great-buddha-hall') AND r.relationship_type = 'created_in'`))
    .toBe('kamakura 1252');
});

test('nothing found (or no network): saved without a city, the quality hint stays', async ({ userA }) => {
  await newInstitution(userA, 'Test Arctic Station', [15.0, 85.0]);
  await expect(userA).toHaveURL(/\/institutions\/test-arctic-station\?done=created$/);
  expect(sql("SELECT place_id IS NULL FROM institutions WHERE slug = 'test-arctic-station'")).toBe('t');
  await userA.goto('/quality?check=institution_without_place');
  await expect(userA.locator('main')).toContainText('Test Arctic Station');
});
