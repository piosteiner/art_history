// Exact locations without extra places (migration 034): institutions with their own point, presence at institutions
// ("same institution" vs "same city"), buildings as artworks that house institutions, immovable artworks on the map,
// "depicts" pointing at an immovable artwork.
const { test, expect, sql, submitForm } = require('./helpers');

const API = (path) => `http://127.0.0.1:3006/v1${path}`;
const api = async (request, path) => (await request.get(API(path), { headers: { Host: 'api.localhost' } })).json();
const addRel = async (page, type, to, period) => {
  await page.click('summary:has-text("+ Add relationship")');
  await page.selectOption('#r-type', type);
  await page.fill('#r-to', to);
  await page.keyboard.press('Escape');
  if (period) await page.fill('#r-period', period);
  await Promise.all([page.waitForNavigation(), page.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(page).toHaveURL(/done=rel-added/);
};

test('an institution with its own point; people present at it; same venue vs. same city on the map', async ({ userA, request }) => {
  sql(`INSERT INTO places (slug, name, kind, country_code, location) VALUES ('zuerich', 'Zürich', 'settlement', 'CH', 'POINT(8.5417 47.3769)');
       INSERT INTO institutions (slug, name, kind, place_id, location, address) VALUES
         ('cabaret-voltaire', 'Cabaret Voltaire', 'cabaret', entity_id('place', 'zuerich'), 'POINT(8.5440 47.3713)', 'Spiegelgasse 1, 8001 Zürich'),
         ('schauspielhaus', 'Schauspielhaus Zürich', 'theatre', entity_id('place', 'zuerich'), NULL, NULL)`);
  await userA.goto('/institutions/cabaret-voltaire/edit');
  await expect(userA.locator('label', { hasText: 'Exact location' })).toBeVisible();
  await expect(userA.locator('#f-address')).toHaveValue('Spiegelgasse 1, 8001 Zürich');

  // presence at institutions (both in 1916): Gauguin at the Cabaret, Hiroshige at the Schauspielhaus (test data)
  await userA.goto('/artists/paul-gauguin');
  await addRel(userA, 'worked_in', 'institution/cabaret-voltaire', '1916');
  await userA.goto('/artists/utagawa-hiroshige');
  await addRel(userA, 'visited', 'institution/schauspielhaus', '1916');

  const presence = (await api(request, '/map/presence?from=1916&to=1916')).features;
  const at = (slug) => presence.find((f) => f.properties.entity.slug === slug);
  expect(at('paul-gauguin').properties.institution).toEqual({ slug: 'cabaret-voltaire', name: 'Cabaret Voltaire' });
  expect(at('paul-gauguin').properties.place).toEqual({ slug: 'zuerich', name: 'Zürich' });
  expect(at('paul-gauguin').geometry.coordinates).toEqual([8.544, 47.3713]);          // the venue's own point
  expect(at('utagawa-hiroshige').properties.place.slug).toBe('zuerich');              // same city …
  expect(at('utagawa-hiroshige').properties.institution.slug).toBe('schauspielhaus');  // … another institution
  expect(at('utagawa-hiroshige').geometry.coordinates).toEqual([8.5417, 47.3769]);    // no own point: the city's
  const route = (await api(request, '/map/artists/paul-gauguin')).features;
  expect(route.some((f) => f.properties.institution && f.properties.institution.slug === 'cabaret-voltaire')).toBe(true);
  const sites = (await api(request, '/map/sites')).features.map((f) => f.properties.slug);
  expect(sites).toContain('cabaret-voltaire');
  expect(sites).not.toContain('schauspielhaus');
  sql(`DELETE FROM institutions WHERE slug IN ('cabaret-voltaire', 'schauspielhaus'); DELETE FROM places WHERE slug = 'zuerich'`);
});

test('a building is an artwork that stands somewhere and houses an institution; a print depicts it', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Honkan');
  await userA.fill('#f-kind', 'building');
  await expect(userA.locator('#group-location')).toHaveAttribute('open', '');  // a building: "Where it stands" opens
  await userA.fill('#f-created', '1937/1938');
  await userA.fill('input[name="f.location_lon"]', '139.7765');
  await userA.fill('input[name="f.location_lat"]', '35.7188');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/honkan\?done=created/);
  await addRel(userA, 'houses', 'institution/metropolitan-museum-of-art', '1938/');
  await userA.goto('/institutions/metropolitan-museum-of-art');
  await expect(userA.locator('tr', { hasText: 'Honkan' })).toContainText('housed in');

  // a print depicts the building (an immovable artwork) — on the print's map at the building's point
  await userA.goto('/artworks/plum-park-in-kameido');
  await addRel(userA, 'depicts', 'artwork/honkan');
  const w = await api(request, '/artworks/honkan');
  expect(w.location).toEqual({ type: 'Point', coordinates: [139.7765, 35.7188] });
  expect(w.relationships.map((r) => r.label)).toEqual(expect.arrayContaining(['houses', 'depicted in']));
  const map = (await api(request, '/map/artworks/plum-park-in-kameido')).features;
  expect(map.find((f) => f.properties.artwork && f.properties.artwork.slug === 'honkan').geometry.coordinates).toEqual([139.7765, 35.7188]);
  expect((await api(request, '/map/sites')).features.map((f) => f.properties.slug)).toContain('honkan');
  sql("DELETE FROM artworks WHERE slug = 'honkan'");
});
