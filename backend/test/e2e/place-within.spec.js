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
