// Stolen and forged (migration 175): stolen derived from an open theft step (not recovered); authenticity entered in the
// admin (disputed / forgery) with a date and note; a forgery's "passed off as" relationship to the claimed artist.
const { test, expect, sql, settled, API, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-auth-work')";
const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-auth-work'; DELETE FROM artists WHERE slug IN ('test-auth-forger', 'test-auth-master');
  DELETE FROM live_docs WHERE entity_type = 'artwork'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO artists (slug, name) VALUES ('test-auth-forger', 'Test Forger'), ('test-auth-master', 'Test Master');
       INSERT INTO artworks (slug, title, creator_id) VALUES ('test-auth-work', 'Test Auth Work', entity_id('artist', 'test-auth-forger'))`);
});
test.afterEach(cleanup);

test('stolen is derived from a theft step without an end; recovered, the mark goes', async ({ request }) => {
  expect((await api(request, '/artworks/test-auth-work')).stolen).toBeNull();
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, role, method, direct, acquired, acquired_label, label)
       VALUES (${W}, 0, 'Test Museum', 'owner', 'purchase', true, year_range(1950), '1950', NULL),
              (${W}, 1, 'thieves', 'possessor', 'theft', true, '[2025-10-19,2025-10-20)', '19 October 2025', 'taken from the gallery')`);
  const w = await api(request, '/artworks/test-auth-work');
  expect(w.stolen).toMatchObject({ note: 'taken from the gallery' });
  expect(w.stolen.date).toMatchObject({ from: '2025-10-19', label: '19 October 2025' });
  sql(`UPDATE provenance SET ended = '[2026-01-05,2026-01-06)', ended_label = '5 January 2026' WHERE artwork_id = ${W} AND method = 'theft'`);
  expect((await api(request, '/artworks/test-auth-work')).stolen).toBeNull();
});

test('authenticity: a forgery entered in the admin, in the API; passed off as the claimed artist; a note without it refused', async ({ userA, request }) => {
  await userA.goto('/artworks/test-auth-work/edit');
  await userA.click('summary:has-text("Disputed or forged")');
  await userA.selectOption('#f-authenticity', 'forgery');
  await userA.fill('#f-authenticity_date', '2010');
  await userA.fill('#f-authenticity_note', 'exposed by pigment analysis');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);
  const w = await api(request, '/artworks/test-auth-work');
  expect(w.authenticity).toMatchObject({ status: 'forgery', label: 'forgery', note: 'exposed by pigment analysis' });
  expect(w.authenticity.date).toMatchObject({ from_year: 2010 });
  expect(() => sql(`UPDATE artworks SET authenticity = NULL WHERE slug = 'test-auth-work'`)).toThrow(/artworks_authenticity_details/);

  sql(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
       VALUES ('artwork', ${W}, 'passed_off_as', 'artist', entity_id('artist', 'test-auth-master'))`);
  await settled();   // relationships come from the derived graph (126)
  const master = await api(request, '/artists/test-auth-master');
  expect(JSON.stringify(master.relationships ?? master)).toContain('test-auth-work');
});
