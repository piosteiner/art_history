// What became of an artwork (migration 103): destroyed / partly destroyed / lost, when and how — entered in the admin,
// refused without a fate, delivered by the API in the detail and the list.
const { test, expect, sql, API, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-fate-work'; DELETE FROM events WHERE slug IN ('test-fate-fire', 'test-fate-war');
  DELETE FROM live_docs WHERE entity_type = 'artwork'`);
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

test('fate: its cause is the event that concerns the work at that time, not another one; the admin closes the provenance with it (171)', async ({ userA, request }) => {
  sql(`UPDATE artworks SET fate = 'destroyed', fate_date = '[1945-05-01,1945-06-01)', fate_date_label = 'May 1945' WHERE slug = 'test-fate-work';
       INSERT INTO events (slug, name, period, period_label) VALUES ('test-fate-fire', 'Test Fire', '[1945-05-05,1945-05-19)', '5–18 May 1945'),
         ('test-fate-war', 'Test Earlier Event', '[1939-09-01,1939-09-02)', '1 September 1939');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
       SELECT 'event', id, 'concerns', 'artwork', entity_id('artwork', 'test-fate-work') FROM events WHERE slug IN ('test-fate-fire', 'test-fate-war')`);
  expect((await api(request, '/artworks/test-fate-work')).fate.event).toEqual({ slug: 'test-fate-fire', name: 'Test Fire' });

  // the admin: a closing line after the last step, with the cause — the table ends there
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, method, direct, acquired, acquired_label)
       VALUES (entity_id('artwork', 'test-fate-work'), 0, 'Test Last Owner', 'purchase', true, year_range(1930), '1930')`);
  await userA.goto('/artworks/test-fate-work');
  const end = userA.locator('table.provenance tbody').last();
  await expect(end).toHaveClass(/fate-destroyed/);
  await expect(end).toContainText('Destroyed May 1945');
  await expect(end).toContainText('the end of its provenance');
  await expect(end.locator('a[href="/events/test-fate-fire"]')).toHaveText('Test Fire');
  sql(`DELETE FROM events WHERE slug = 'test-fate-fire'`);
  expect((await api(request, '/artworks/test-fate-work')).fate.event).toBeNull();
});
