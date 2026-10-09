// "founded" / "founded by" (migration 054): a person founds an institution; Wikidata's P112 suggests the founders.
const { test, expect, sql } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM relationships WHERE relationship_type = 'founded'; DELETE FROM institutions WHERE slug = 'kunsthaus-founded-test'`));

test('a person founded an institution (co-founder in the label); both directions in the API; Wikidata suggests founders', async ({ userA, request }) => {
  await userA.goto('/people/theo-van-gogh');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'founded');
  await userA.fill('#r-to', 'institution/van-gogh-museum');
  await userA.fill('#r-period', '1973');
  await userA.fill('#r-label', 'co-founder');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  const theo = await api(request, '/people/theo-van-gogh');
  expect(theo.relationships.find((r) => r.type === 'founded')).toMatchObject({ label: 'founded', direction: 'outgoing', note: 'co-founder',
    entity: { slug: 'van-gogh-museum' } });
  const museum = await api(request, '/institutions/van-gogh-museum');
  expect(museum.relationships.find((r) => r.type === 'founded')).toMatchObject({ label: 'founded by', direction: 'incoming', entity: { slug: 'theo-van-gogh' } });

  // an institution's Wikidata item names its founders (P112): suggested as "founded by"
  sql("INSERT INTO institutions (slug, name, wikidata_id) VALUES ('kunsthaus-founded-test', 'Kunsthaus Test', 'Q110')");
  await userA.goto('/institutions/kunsthaus-founded-test/wikidata');
  await expect(userA.locator('.wd-table tbody tr', { hasText: 'founded by' }).first()).toContainText('Claude Monet');
});
