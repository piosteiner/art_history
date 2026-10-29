// Places know their country and first-level division from their point (migration 155: within_code from the Natural Earth
// outlines, place_country() with a code by hand first); checks place_outside_country / place_without_parent.
const { test, expect, sql, settled, API } = require('./helpers');

test.afterAll(() => sql("DELETE FROM places WHERE slug IN ('test-kyoto-within', 'test-kanagawa-region')"));

test('a place with a point: its division and country follow; a different code by hand is reported', async ({ request }) => {
  sql(`INSERT INTO places (slug, name, kind, location) VALUES ('test-kyoto-within', 'Test Kyoto', 'settlement', ST_GeogFromText('POINT(135.5 35.3)'))`);
  expect(sql("SELECT within_code FROM places WHERE slug = 'test-kyoto-within'")).toBe('JP-26');
  expect(sql("SELECT place_country(entity_id('place', 'test-kyoto-within'))->>'code'")).toBe('JP');
  const body = await (await request.get(`${API}/places/test-kyoto-within`, { headers: { Host: 'api.localhost' } })).json();
  expect(body.country_code).toBe('JP');
  expect(body.within).toEqual({ code: 'JP-26', name: 'Kyoto' });
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'place_without_parent' AND entity_id = entity_id('place', 'test-kyoto-within')`)).toBe('1');
  // a code by hand wins (an exclave), and is reported when the point lies elsewhere
  sql("UPDATE places SET country_code = 'ES' WHERE slug = 'test-kyoto-within'");
  expect(sql("SELECT place_country(entity_id('place', 'test-kyoto-within'))->>'code'")).toBe('ES');
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'place_outside_country' AND entity_id = entity_id('place', 'test-kyoto-within')`))
    .toMatch(/country ES by hand, but the point lies in JP/);
  // moving the point moves the division
  sql("UPDATE places SET location = ST_GeogFromText('POINT(2.2 46.2)'), country_code = NULL WHERE slug = 'test-kyoto-within'");
  expect(sql("SELECT within_code FROM places WHERE slug = 'test-kyoto-within'")).toBe('FR');
  // a region with its own boundary code and no point (156): its country is the code's
  sql("INSERT INTO places (slug, name, kind, boundary_code) VALUES ('test-kanagawa-region', 'Test Kanagawa', 'region', 'JP-14')");
  expect(sql("SELECT place_country(entity_id('place', 'test-kanagawa-region'))->>'code'")).toBe('JP');
  await settled();
});

// 157/158: finer kinds and the designation, in the form and the API
test('a street with its designation: the new kinds and the designation field', async ({ userA, request }) => {
  await userA.goto('/places/new');
  await userA.fill('#f-name', 'Test Rue du Bac');
  await userA.fill('#f-slug', 'test-rue-du-bac');
  await userA.selectOption('#f-kind', 'street');   // the options are the enum's values (157)
  await userA.fill('#f-designation', 'street in Paris');
  await userA.fill('input[name="f.location_lon"]', '2.2');
  await userA.fill('input[name="f.location_lat"]', '46.2');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/places\/test-rue-du-bac\?done=created/);
  const body = await (await request.get(`${API}/places/test-rue-du-bac`, { headers: { Host: 'api.localhost' } })).json();
  expect(body).toEqual(expect.objectContaining({ kind: 'street', designation: 'street in Paris', country_code: 'FR' }));
  sql("DELETE FROM places WHERE slug = 'test-rue-du-bac'");
});

// 159: a place in time — when it existed; a relationship shows the name it had then; one dated outside is reported
test('a place in time: its former name on a dated relationship, its existence, a relationship outside it', async ({ request }) => {
  sql(`INSERT INTO places (slug, name, kind, location, names, existed, existed_label) VALUES ('test-tokyo-time', 'Test Tokyo', 'settlement',
         ST_GeogFromText('POINT(139.35 35.4)'), '[{"text": "Test Edo", "lang": "ja-Latn", "role": "former", "period": "(,1868-09-03)", "period_label": "until 2 September 1868"}]',
         '[1457-01-01,1943-07-01)', '1457–30 June 1943');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label) VALUES
         ('artist', entity_id('artist', 'katsushika-hokusai'), 'lived_in', 'place', entity_id('place', 'test-tokyo-time'), '[1830-01-01,1831-01-01)', '1830'),
         ('artist', entity_id('artist', 'vincent-van-gogh'), 'visited', 'place', entity_id('place', 'test-tokyo-time'), '[1950-01-01,1951-01-01)', '1950')`);
  await settled();
  const hokusai = await (await request.get(`${API}/artists/katsushika-hokusai`, { headers: { Host: 'api.localhost' } })).json();
  const rel = hokusai.relationships.find((r) => r.entity.slug === 'test-tokyo-time');
  expect(rel.entity.name_then).toEqual(expect.objectContaining({ text: 'Test Edo' }));
  const place = await (await request.get(`${API}/places/test-tokyo-time`, { headers: { Host: 'api.localhost' } })).json();
  expect(place.existed).toEqual(expect.objectContaining({ label: '1457–30 June 1943', to_year: 1943 }));
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'place_used_outside_existence' AND entity_id = entity_id('artist', 'vincent-van-gogh')`))
    .toBe('visited Test Tokyo (1950), but Test Tokyo existed 1457–30 June 1943');
  sql("DELETE FROM places WHERE slug = 'test-tokyo-time'");
});
