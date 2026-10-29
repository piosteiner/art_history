// The relationship picker (core.js pickerOptions): types with the same label are one choice — the target decides the
// type ("depicts" a person → depicts_person, an artwork → depicts); A–Z; housed_at not offered. Depicted artworks and
// events are depictions in the graph (routes/graph.js); depicted places stay map material.
const { test, expect, sql, settled, API } = require('./helpers');

const openForm = (page) => page.locator('details:has(> summary:has-text("+ Add relationship"))').evaluate((d) => { d.open = true; });
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => {
  sql(`DELETE FROM relationships WHERE subject_type = 'artwork' AND subject_id = entity_id('artwork', 'test-copy-picker');
       DELETE FROM artworks WHERE slug = 'test-copy-picker'`);
});

test('one "depicts" for people, places, artworks and events; options A–Z; housed_at hidden; depicted works in the graph', async ({ userA, request }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-copy-picker', 'Test Picture of Pictures')");
  await userA.goto('/artworks/test-copy-picker');
  await userA.click('summary:has-text("+ Add relationship")');
  const from = userA.locator('#r-type optgroup[label="From this artwork"] option');
  const labels = await from.allTextContents();
  expect(labels.filter((l) => l.startsWith('depicts '))).toEqual(['depicts (place, artwork, event, person, artist)']);
  expect(labels.filter((l) => l.startsWith('created in '))).toHaveLength(1);
  expect(labels.some((l) => l.startsWith('housed at'))).toBe(false);
  expect(labels.find((l) => l.startsWith('houses'))).toContain('as its building');
  const names = labels.map((l) => l.replace(/ \(.*$/, ''));
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));

  // the same choice for a person and for another artwork: each gets its type
  for (const to of ['artist/vincent-van-gogh', 'artwork/the-starry-night']) {
    await openForm(userA);
    await userA.selectOption('#r-type', 'depicts');
    await userA.fill('#r-to', to);
    await userA.keyboard.press('Escape');
    await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
    await expect(userA).toHaveURL(/done=rel-added/);
  }
  expect(sql(`SELECT string_agg(relationship_type || '→' || object_type, ' ' ORDER BY relationship_type) FROM relationships
              WHERE subject_type = 'artwork' AND subject_id = entity_id('artwork', 'test-copy-picker')`)).toBe('depicts→artwork depicts_person→artist');

  // a wrong kind of target names every kind the choice takes
  await openForm(userA);
  await userA.selectOption('#r-type', 'depicts');
  await userA.evaluate(() => { document.querySelector('#r-to').value = 'movement/impressionism'; });
  await userA.click('form[action$="/relationships"] button:has-text("Add")');
  await expect(userA.locator('main')).toContainText('needs a place or an artwork or an event or a person or an artist');

  // the graph: the depicted artwork is a depiction, like the portrait — read from graph_links, a moment behind (126)
  await settled();
  const g = await api(request, '/graph/artworks/test-copy-picker?depth=1');
  const edges = g.edges.filter((e) => e.source === 'artwork/test-copy-picker').map((e) => `${e.type}:${e.category}→${e.target}`).sort();
  expect(edges).toEqual(['depicts:depiction→artwork/the-starry-night', 'depicts_person:depiction→artist/vincent-van-gogh']);
  // on the entry too: listed with the depictions, not the associations
  const w = await api(request, '/artworks/test-copy-picker');
  expect(w.relationships.find((r) => r.entity.slug === 'the-starry-night')).toMatchObject({ type: 'depicts', category: 'depiction' });
  // switched off together with the depictions of people
  const onlyInfluence = await api(request, '/graph/artworks/test-copy-picker?depth=1&types=influenced_by');
  expect(onlyInfluence.edges).toEqual([]);
});
