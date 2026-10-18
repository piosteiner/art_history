// "part of" / "includes" (migration 097): a museum of a museum authority — the Pinakotheken and the Sammlung Schack
// are part of the Bayerische Staatsgemäldesammlungen.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM relationships WHERE relationship_type = 'part_of'; DELETE FROM institutions WHERE slug = 'test-staatsgemaeldesammlungen'`));

test('an institution part of another: both directions on the pages and in the API', async ({ userA, request }) => {
  sql("INSERT INTO institutions (slug, name, kind) VALUES ('test-staatsgemaeldesammlungen', 'Test Staatsgemäldesammlungen', 'museum administration')");
  await userA.goto('/institutions/van-gogh-museum');
  await userA.click('summary:has-text("+ Add relationship")');
  await expect(userA.locator('#r-type option[value="part_of"]')).toHaveCount(1);
  await userA.selectOption('#r-type', 'part_of');
  await userA.fill('#r-to', 'institution/test-staatsgemaeldesammlungen');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await expect(userA.locator('body')).toContainText('part of');
  await userA.goto('/institutions/test-staatsgemaeldesammlungen');
  await expect(userA.locator('body')).toContainText('includes');
  const museum = await api(request, '/institutions/van-gogh-museum');
  expect(museum.relationships.find((r) => r.type === 'part_of')).toMatchObject({ label: 'part of', direction: 'outgoing', entity: { slug: 'test-staatsgemaeldesammlungen' } });
  const roof = await api(request, '/institutions/test-staatsgemaeldesammlungen');
  expect(roof.relationships.find((r) => r.type === 'part_of')).toMatchObject({ label: 'includes', direction: 'incoming', entity: { slug: 'van-gogh-museum' } });
  // an artist cannot be "part of" an institution
  await userA.goto('/artists/vincent-van-gogh');
  await userA.click('summary:has-text("+ Add relationship")');
  await expect(userA.locator('#r-type option[value="part_of"]')).toHaveCount(0);
});
