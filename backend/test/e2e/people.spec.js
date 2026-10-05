// People (migration 024): everyone relevant who isn't an artist; patron is a role from relationships; depictions;
// birth/death and occupations; old /patrons addresses redirect.
const { test, expect, sql, submitForm } = require('./helpers');

const API = 'http://127.0.0.1:3006/v1';
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a person with life dates and occupations, depicted in an artwork; roles in the API', async ({ userA, request }) => {
  await userA.goto('/people/new');
  await userA.fill('#f-name', 'Hagiwara Sakutarō');
  await expect(userA.locator('#f-slug')).toHaveValue('hagiwara-sakutaro');
  await userA.fill('#f-kind', 'person');
  await userA.fill('#f-occupations', 'poet\nessayist');
  await userA.fill('#f-birth', '1886-11-01');
  await userA.fill('#f-death', '1942-05-11');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/people\/hagiwara-sakutaro\?done=created/);

  // the portrait depicts him: a relationship from the artwork
  sql("INSERT INTO artworks (slug, title, created, created_label) VALUES ('test-portrait-hagiwara', 'Portrait of Hagiwara Sakutarō', year_range(1943), '1943')");
  await userA.goto('/artworks/test-portrait-hagiwara');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'depicts_person');
  await userA.fill('#r-to', 'person/hagiwara-sakutaro');
  await userA.keyboard.press('Escape');
  await userA.fill('#r-label', 'portrait');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await userA.goto('/people/hagiwara-sakutaro');
  await expect(userA.locator('tr', { hasText: 'Portrait of Hagiwara' })).toContainText('depicted in');

  const p = await api(request, '/people/hagiwara-sakutaro');
  expect(p.type).toBe('person');
  expect(p.occupations).toEqual(['poet', 'essayist']);
  expect(p.birth.label).toBe('1 November 1886');
  expect(p.roles).toEqual(['depicted']);
  expect(p.relationships[0]).toMatchObject({ type: 'depicts_person', label: 'depicted in', category: 'depiction', note: 'portrait' });
  expect((await api(request, '/people?role=depicted')).data.map((x) => x.slug)).toEqual(['hagiwara-sakutaro']);
  expect((await api(request, '/people?occupation=poet')).data.map((x) => x.slug)).toEqual(['hagiwara-sakutaro']);
  expect((await api(request, '/people?from=1900&to=1910')).data.map((x) => x.slug)).toContain('hagiwara-sakutaro');  // lifespan
  const g = await api(request, '/graph/artworks/test-portrait-hagiwara?depth=1');
  expect(g.nodes.map((n) => n.id)).toContain('person/hagiwara-sakutaro');           // depictions are in the graph
  sql("DELETE FROM artworks WHERE slug = 'test-portrait-hagiwara'; DELETE FROM people WHERE slug = 'hagiwara-sakutaro'");
});

test('a patron is a person with patronage relationships; old /patrons addresses redirect', async ({ userA, request }) => {
  expect((await api(request, '/people?role=patron')).data.map((x) => x.slug)).toEqual(['theo-van-gogh']);  // patron of Vincent
  const old = await request.get(`${API}/patrons/theo-van-gogh?x=1`, { headers: { Host: 'api.localhost' }, maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe('/v1/people/theo-van-gogh?x=1');
  expect((await api(request, '/patrons')).data.map((x) => x.slug)).toEqual(['theo-van-gogh']);       // followed
  expect((await api(request, '/map/presence?from=1857&to=1857&types=patron')).features.length).toBeGreaterThan(0);
  await userA.goto('/patrons/theo-van-gogh');
  await expect(userA).toHaveURL(/\/people\/theo-van-gogh$/);
  await expect(userA.locator('dl.fields')).toContainText('Art dealer in Paris');      // notes_md → description_md
});
