// Places without hand-made geometry (migration 032): boundaries from Natural Earth (fixtures: rectangles), markers
// derived in the view place_geo, the place finder (Nominatim fixtures), parents found and created automatically.
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a country needs only its code: outline and marker come from the boundary', async ({ userA, request }) => {
  await userA.goto('/places/new');
  await userA.fill('#f-name', 'Italy');
  await userA.selectOption('#f-kind', 'country');
  await userA.fill('#f-country_code', 'IT');
  await submitForm(userA);                                                   // no point, no drawing
  await expect(userA).toHaveURL(/\/places\/italy\?done=created/);
  await expect(userA.locator('dl.fields')).toContainText('IT — Italy (outline and marker from Natural Earth)');
  const p = await api(request, '/places/italy');
  expect(p.boundary_code).toBe('IT');                                        // set by the trigger from the country code
  expect(p.location).toEqual({ type: 'Point', coordinates: [12.5, 42.8] });  // the boundary's label point
  expect(p.area.type).toBe('MultiPolygon');
  expect(p.geometry_source).toEqual({ location: 'derived', area: 'boundary' });
  expect((await api(request, '/map/places')).features.some((f) => f.properties.slug === 'italy')).toBe(true);

  // a region by its code; an unknown code is refused with a readable message
  await userA.goto('/places/new');
  await userA.fill('#f-name', 'Somewhere');
  await userA.selectOption('#f-kind', 'region');
  await userA.fill('#f-boundary_code', 'XX-99');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors, .flash.error').first()).toContainText('Unknown boundary code');
  sql("DELETE FROM places WHERE slug = 'italy'");
});

test('place finder: a city with its point from Wikidata, names, and the parent found by the map', async ({ userA, request }) => {
  await userA.goto('/places');
  await userA.click('a:has-text("+ find a place…")');
  await userA.fill('main input[name=q]', 'Kyoto');
  await Promise.all([userA.waitForNavigation(), userA.click('main button:has-text("Search")')]);
  await expect(userA.locator('.place-hits tr')).toHaveCount(2);
  await Promise.all([userA.waitForNavigation(), userA.locator('.place-hits tr', { hasText: 'Kyoto, Kyoto Prefecture' }).locator('button').click()]);
  await expect(userA).toHaveURL(/\/places\/new\?draft=1$/);
  await expect(userA.locator('#f-name')).toHaveValue('Kyoto');
  await expect(userA.locator('#f-slug')).toHaveValue('kyoto');
  await expect(userA.locator('#f-kind')).toHaveValue('settlement');
  await expect(userA.locator('input[name="f.location_lat"]')).toHaveValue('35.0117');  // Wikidata's (CC0), not OSM's
  await expect(userA.locator('#f-parent')).toHaveValue('japan');                      // our Japan's outline contains it
  await expect(userA.locator('#f-names')).toHaveValue('京都市 | ja | original\nKyōto | fr | translation');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/places\/kyoto\?done=created/);
  expect((await api(request, '/places/kyoto')).wikidata_id).toBe('Q34600');
});

test('a city that is its own region (Oslo, Berlin): not put into the same-named region, but into the country', async ({ userA }) => {
  sql("INSERT INTO places (slug, name, kind, boundary_code, country_code) VALUES ('kyoto-region-test', 'Kyoto', 'region', 'JP-26', 'JP')");
  await userA.goto('/places/new/find?q=Kyoto');
  await Promise.all([userA.waitForNavigation(), userA.locator('.place-hits tr', { hasText: 'Kyoto, Kyoto Prefecture' }).locator('button').click()]);
  await expect(userA.locator('#f-parent')).toHaveValue('japan');   // not kyoto-region-test, although its outline is smaller
  sql("DELETE FROM places WHERE slug = 'kyoto-region-test'");
});

test('place finder: a prefecture gets its outline; a parent region typed by name is created with its outline', async ({ userA, request }) => {
  await userA.goto('/places/new/find?q=Kyoto+Prefecture');
  await Promise.all([userA.waitForNavigation(), userA.locator('.place-hits button').first().click()]);
  await expect(userA.locator('#f-kind')).toHaveValue('region');
  await expect(userA.locator('#f-boundary_code')).toHaveValue('JP-26');
  await expect(userA.locator('input[name="f.location_lat"]')).toHaveValue('');         // the outline is enough
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/places\/kyoto-prefecture\?done=created/);

  // typed as a parent: "Kanagawa" isn't a place of ours, but a Natural Earth region → created with it
  await userA.goto('/places/new');
  await userA.fill('#f-name', 'Hakone');
  await userA.selectOption('#f-kind', 'settlement');
  await userA.fill('input[name="f.location_lon"]', '139.1');
  await userA.fill('input[name="f.location_lat"]', '35.23');
  await userA.fill('#f-parent', 'Kanagawa');
  await userA.keyboard.press('Escape');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/places\/hakone\?done=created&auto=1/);
  expect(sql("SELECT kind || ' ' || boundary_code || ' ' || country_code FROM places WHERE slug = 'kanagawa'")).toBe('region JP-14 JP');
  expect(sql("SELECT p.slug FROM places c JOIN places p ON p.id = c.parent_id WHERE c.slug = 'hakone'")).toBe('kanagawa');
  expect(sql("SELECT p.slug FROM places c JOIN places p ON p.id = c.parent_id WHERE c.slug = 'kanagawa'")).toBe('japan');  // the region in its country

  // the quality page suggests parents from the map (for a region without one)
  sql("UPDATE places SET parent_id = NULL WHERE slug = 'kanagawa'");
  await userA.goto('/quality?check=parent_suggestion');
  await expect(userA.locator('main')).toContainText('lies inside');
  sql("DELETE FROM places WHERE slug IN ('hakone', 'kyoto', 'kyoto-prefecture'); DELETE FROM places WHERE slug = 'kanagawa'");
});
