// Several creators (migration 028): the main creator stays the creator field, further ones are co_creator
// relationships artwork → artist; the API lists all in `creators`, the artist page and ?creator= include co-created works.
// Both are edges in the graph; the main creator's are derived (migration 029).
const { test, expect, sql } = require('./helpers');

const API = 'http://127.0.0.1:3006/v1';
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a co-creator added on the artwork page appears in creators, on the artist and in the creator filter', async ({ userA, request }) => {
  sql(`INSERT INTO artists (slug, name) VALUES ('test-rubens', 'Test Rubens'), ('test-brueghel', 'Test Brueghel');
       INSERT INTO artworks (slug, title, creator_id) VALUES ('test-garden-of-eden', 'Test Garden of Eden', entity_id('artist', 'test-rubens'))`);
  // added next to the creator, shown there (not among the relationships), named under the creator field when editing
  await userA.goto('/artworks/test-garden-of-eden');
  await userA.click('summary:has-text("+ Add co-creator")');
  await userA.fill('#cc-to', 'Test Brue');
  await userA.locator('.ac-list li', { hasText: 'Test Brueghel' }).click();
  await expect(userA.locator('#cc-to')).toHaveValue('artist/test-brueghel');
  await userA.fill('#cc-label', 'landscape');
  await Promise.all([userA.waitForNavigation(), userA.click('.add-co-creator button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added#creators/);
  await expect(userA.locator('dd.creators')).toContainText('Test Rubens');
  await expect(userA.locator('dd.creators')).toContainText('+ Test Brueghel landscape');
  await expect(userA.locator('#relationships ~ .table-wrap')).toHaveCount(0);  // nothing else is linked
  await userA.goto('/artworks/test-garden-of-eden/edit');
  await expect(userA.locator('.field', { has: userA.locator('#f-creator') })).toContainText('Co-creators: Test Brueghel (landscape)');
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
  // the graph has both: the main creator (derived from the column, migration 029) and the co-creator
  const g = await api(request, '/graph/artworks/test-garden-of-eden?depth=1');
  expect(g.edges.map((e) => [e.type, e.target]).sort()).toEqual([['co_creator', 'artist/test-brueghel'], ['creator', 'artist/test-rubens']]);
  const fromArtist = await api(request, '/graph/artists/test-rubens?depth=1&types=creator');
  expect(fromArtist.nodes.map((n) => n.id)).toContain('artwork/test-garden-of-eden');
  // …but "creator" is not a relationship one can enter
  await userA.goto('/artworks/test-garden-of-eden');
  await expect(userA.locator('#r-type option[value="creator"]')).toHaveCount(0);
  expect(() => sql(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
    VALUES ('artwork', entity_id('artwork', 'test-garden-of-eden'), 'creator', 'artist', entity_id('artist', 'test-brueghel'))`)).toThrow(/derived/);

  sql("DELETE FROM artworks WHERE slug = 'test-garden-of-eden'; DELETE FROM artists WHERE slug IN ('test-rubens', 'test-brueghel')");
});
