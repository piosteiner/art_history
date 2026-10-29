// Branches (migration 154): an institution in several cities at once — "has a branch in" a place, with its period; the
// start map's museums layer shows the branch at its place (/v1/map/sites `branch`).
const { test, expect, sql, settled, API } = require('./helpers');

const openForm = (page) => page.locator('details:has(> summary:has-text("+ Add relationship"))').evaluate((d) => { d.open = true; });

test.afterAll(() => {
  sql("DELETE FROM relationships WHERE relationship_type = 'branch_in' AND subject_id = entity_id('institution', 'van-gogh-museum')");
});

test('a branch: chosen in the relationship form with its period, on the entry, and on the map at its place', async ({ userA, request }) => {
  await userA.goto('/institutions/van-gogh-museum');
  await openForm(userA);
  await userA.selectOption('#r-type', 'branch_in');
  await userA.fill('#r-to', 'place/arles');
  await userA.keyboard.press('Escape');
  await userA.fill('#r-period', '1990/2000');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await expect(userA.locator('main')).toContainText('has a branch in');
  expect(sql(`SELECT o.slug || ' ' || r.period FROM relationships r JOIN places o ON o.id = r.object_id
              WHERE r.relationship_type = 'branch_in' AND r.subject_id = entity_id('institution', 'van-gogh-museum')`)).toBe('arles [1990-01-01,2001-01-01)');
  await settled();
  const sites = await (await request.get(`${API}/map/sites`, { headers: { Host: 'api.localhost' } })).json();
  const branch = sites.features.find((f) => f.properties.slug === 'van-gogh-museum' && f.properties.branch);
  expect(branch.properties).toEqual(expect.objectContaining({ from_year: 1990, to_year: 2000,
    branch: expect.objectContaining({ place: expect.objectContaining({ slug: 'arles' }), period: expect.objectContaining({ label: '1990–2000' }) }) }));
  expect(branch.geometry.type).toBe('Point');
});
