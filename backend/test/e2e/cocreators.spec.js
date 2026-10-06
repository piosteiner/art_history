// Several creators (migration 028): the main creator stays the creator field, further ones are co_creator
// relationships artwork → artist; the API lists all in `creators`, the artist page and ?creator= include co-created works.
const { test, expect, sql } = require('./helpers');

const API = 'http://127.0.0.1:3006/v1';
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a co-creator added on the artwork page appears in creators, on the artist and in the creator filter', async ({ userA, request }) => {
  sql(`INSERT INTO artists (slug, name) VALUES ('test-rubens', 'Test Rubens'), ('test-brueghel', 'Test Brueghel');
       INSERT INTO artworks (slug, title, creator_id) VALUES ('test-garden-of-eden', 'Test Garden of Eden', entity_id('artist', 'test-rubens'))`);
  await userA.goto('/artworks/test-garden-of-eden');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'co_creator');
  await userA.fill('#r-to', 'artist/test-brueghel');
  await userA.keyboard.press('Escape');
  await userA.fill('#r-label', 'landscape');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await userA.goto('/artists/test-brueghel');
  await expect(userA.locator('tr', { hasText: 'Test Garden of Eden' })).toContainText('co-creator of');

  const w = await api(request, '/artworks/test-garden-of-eden');
  expect(w.creator).toMatchObject({ slug: 'test-rubens' });
  expect(w.creators).toEqual([
    { slug: 'test-rubens', name: 'Test Rubens', main: true, role: null, certainty: 'attested' },
    { slug: 'test-brueghel', name: 'Test Brueghel', main: false, role: 'landscape', certainty: 'attested' },
  ]);
  const b = await api(request, '/artists/test-brueghel');
  expect(b.artworks).toEqual([expect.objectContaining({ slug: 'test-garden-of-eden', co_creator: true, role: 'landscape' })]);
  expect((await api(request, '/artists/test-rubens')).artworks[0]).toMatchObject({ co_creator: false, role: null });
  for (const slug of ['test-rubens', 'test-brueghel']) {
    expect((await api(request, `/artworks?creator=${slug}`)).data.map((x) => x.slug)).toEqual(['test-garden-of-eden']);
  }
  sql("DELETE FROM artworks WHERE slug = 'test-garden-of-eden'; DELETE FROM artists WHERE slug IN ('test-rubens', 'test-brueghel')");
});
