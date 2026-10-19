// What became of an artwork (migration 103): destroyed / partly destroyed / lost, when and how — entered in the admin,
// refused without a fate, delivered by the API in the detail and the list.
const { test, expect, sql, API, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-fate-work'; DELETE FROM live_docs WHERE entity_type = 'artwork'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-fate-work', 'Test Fate Work')`);
});
test.afterEach(cleanup);

test('fate: destroyed with a date and a note, in the detail and the list; a note without a fate is refused', async ({ userA, request }) => {
  let w = await api(request, '/artworks/test-fate-work');
  expect(w.fate).toBeNull();

  await userA.goto('/artworks/test-fate-work/edit');
  await userA.selectOption('#f-fate', 'destroyed');
  await userA.fill('#f-fate_date', 'May 1945');
  await userA.fill('#f-fate_note', 'Burnt in the Friedrichshain flak tower');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);

  w = await api(request, '/artworks/test-fate-work');
  expect(w.fate).toMatchObject({ status: 'destroyed', label: 'destroyed', note: 'Burnt in the Friedrichshain flak tower' });
  expect(w.fate.date).toMatchObject({ from: '1945-05-01', to: '1945-05-31', label: 'May 1945' });
  expect((await api(request, '/artworks?limit=500')).data.find((a) => a.slug === 'test-fate-work').fate).toBe('destroyed');

  // the admin's page names it; the database refuses details without a fate
  await userA.goto('/artworks/test-fate-work');
  await expect(userA.locator('dd', { hasText: 'destroyed' }).first()).toBeVisible();
  expect(() => sql(`UPDATE artworks SET fate = NULL WHERE slug = 'test-fate-work'`)).toThrow(/artworks_fate_details/);
});
