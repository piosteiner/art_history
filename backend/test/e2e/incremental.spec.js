// Derived data kept up to date incrementally (migration 125): a change queues the entries it affects (derived_queue),
// the worker computes only those again — their search fields, findings and duplicate pairs — and the nightly full
// run corrects (and logs as drift) what the incremental path missed.
const { test, expect, adminChange, sql, settled, API } = require('./helpers');

const cleanup = () => sql(`DELETE FROM artists WHERE slug IN ('test-inc-twin-a', 'test-inc-twin-b');
  DELETE FROM artworks WHERE slug = 'test-inc-made-in-arles';
  DELETE FROM glossary WHERE slug = 'test-inc-washi';
  UPDATE artists SET name = 'Vincent van Gogh' WHERE slug = 'vincent-van-gogh';
  UPDATE places SET name = 'France' WHERE slug = 'france';
  DELETE FROM derived_drift;`);
test.beforeEach(cleanup);
test.afterAll(cleanup);


test('a change queues the entry and what depends on it; only those are computed again', async () => {
  sql('SELECT refresh_quality()');
  // renaming an artist: queued as changed (spread) — its works follow as neighbours, their "Artist" field with it
  adminChange("UPDATE artists SET name = 'Vincent van Gogh (test)' WHERE slug = 'vincent-van-gogh'");
  await settled();
  expect(sql(`SELECT text FROM entry_search_fields_stored WHERE type = 'artwork' AND id = entity_id('artwork', 'sunflowers-national-gallery') AND label = 'Artist'`))
    .toBe('Vincent van Gogh (test)');
  // the global part (graph, words) follows at its own pace; refresh_quality() waits for everything
  sql('SELECT refresh_quality()');
  expect(sql('SELECT quality_fresh()')).toBe('t');
});

test('a link seconds old counts: renaming the country right after reaches a work made in one of its towns', async () => {
  // the stored graph is rebuilt by the global part (up to half a minute later) — the neighbours come from the
  // relationships as they are too, and a place stands for every place inside it
  adminChange(`INSERT INTO artworks (slug, title) VALUES ('test-inc-made-in-arles', 'Test Made in Arles');
    INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
      VALUES ('artwork', entity_id('artwork', 'test-inc-made-in-arles'), 'created_in', 'place', entity_id('place', 'arles'))`);
  await settled();
  const madeIn = () => sql(`SELECT text FROM entry_search_fields_stored WHERE type = 'artwork' AND id = entity_id('artwork', 'test-inc-made-in-arles') AND label = 'Made in'`);
  expect(madeIn()).toBe('Arles, France');
  adminChange("UPDATE places SET name = 'France (test)' WHERE slug = 'france'");
  await settled();
  expect(madeIn()).toBe('Arles, France (test)');
});

test('a new material reaches the works whose medium names it — linked by text, not by a key', async () => {
  // the search field "Type" lists the names of materials found in the medium (artwork_term_names, 071)
  const typeMatch = () => sql(`SELECT match FROM entry_search_fields_stored WHERE type = 'artwork' AND id = entity_id('artwork', 'sudden-shower-over-shin-ohashi-bridge-and-atake') AND label = 'Type'`);
  await settled();
  expect(typeMatch()).not.toContain('Washi-Test');
  adminChange(`INSERT INTO glossary (slug, name, category, names) VALUES ('test-inc-washi', 'paper', 'material', '[{"text": "Washi-Test", "lang": "de"}]')`);
  await settled();
  expect(typeMatch()).toContain('Washi-Test');
  adminChange("DELETE FROM glossary WHERE slug = 'test-inc-washi'");
  await settled();
  expect(typeMatch()).not.toContain('Washi-Test');
});

test('the API reads the stored graph: a new relationship is in it once the worker has caught up', async ({ request }) => {
  adminChange(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
    VALUES ('artist', entity_id('artist', 'vincent-van-gogh'), 'visited', 'place', entity_id('place', 'edo'))`);
  await settled();
  const g = await (await request.get(`${API}/artists/vincent-van-gogh`, { headers: { Host: 'api.localhost' } })).json();
  expect(g.relationships.map((r) => r.entity.slug)).toContain('edo');
  adminChange("DELETE FROM relationships WHERE relationship_type = 'visited' AND object_id = entity_id('place', 'edo') AND subject_id = entity_id('artist', 'vincent-van-gogh')");
  await settled();
  const h = await (await request.get(`${API}/artists/vincent-van-gogh`, { headers: { Host: 'api.localhost' } })).json();
  expect(h.relationships.map((r) => r.entity.slug)).not.toContain('edo');
});

test('the lists serve stored rows (127): a renamed artist reaches the works\' rows; an entry not stored is computed', async ({ request }) => {
  const list = async () => (await (await request.get(`${API}/artworks?limit=500`, { headers: { Host: 'api.localhost' } })).json()).data;
  await settled();
  adminChange("UPDATE artists SET name = 'Vincent van Gogh (listed)' WHERE slug = 'vincent-van-gogh'");
  await settled();
  expect(sql("SELECT row->'creator'->>'name' FROM entry_list_rows WHERE type = 'artwork' AND id = entity_id('artwork', 'sunflowers-national-gallery')"))
    .toBe('Vincent van Gogh (listed)');
  expect((await list()).find((w) => w.slug === 'sunflowers-national-gallery').creator.name).toBe('Vincent van Gogh (listed)');
  // not stored (yet — created a moment ago): computed by the endpoint itself
  adminChange("INSERT INTO artworks (slug, title) VALUES ('test-inc-made-in-arles', 'Test Listed At Once')");
  await settled();
  sql("DELETE FROM entry_list_rows WHERE type = 'artwork' AND id = entity_id('artwork', 'test-inc-made-in-arles')");
  expect((await list()).find((w) => w.slug === 'test-inc-made-in-arles')).toMatchObject({ title: 'Test Listed At Once', public_id: expect.anything() });
});

test('duplicates: a new twin is weighed against its candidates only; a rename away removes the pair on both sides', async ({ userA }) => {
  adminChange(`INSERT INTO artists (slug, name, birth, birth_label) VALUES ('test-inc-twin-a', 'Test Incremental Twin', year_range(1801), '1801'),
                                                                          ('test-inc-twin-b', 'Test Incremental Twin', year_range(1801), '1801')`);
  await settled();
  const pairs = () => sql(`SELECT count(*) FROM dup_pairs WHERE type = 'artist' AND a_id IN (entity_id('artist', 'test-inc-twin-a'), entity_id('artist', 'test-inc-twin-b'))`);
  expect(pairs()).toBe('2');   // each way round
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'possible_duplicate' AND entity_type = 'artist'
    AND entity_id IN (entity_id('artist', 'test-inc-twin-a'), entity_id('artist', 'test-inc-twin-b'))`)).toBe('2');
  // the fingerprint of an unchanged entry stays: a change to something else doesn't weigh it again
  const fp = sql("SELECT fp FROM dup_entries WHERE type = 'artist' AND id = entity_id('artist', 'test-inc-twin-a')");
  adminChange("UPDATE artists SET name = 'Somebody Else Entirely' WHERE slug = 'test-inc-twin-b'");
  await settled();
  expect(sql("SELECT fp FROM dup_entries WHERE type = 'artist' AND id = entity_id('artist', 'test-inc-twin-a')")).toBe(fp);
  expect(pairs()).toBe('0');
  // the partner's finding went too (it was queued as a partner)
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'possible_duplicate' AND entity_type = 'artist'
    AND entity_id = entity_id('artist', 'test-inc-twin-a')`)).toBe('0');
  // the box on the new-entry form uses the same keys
  expect(sql("SELECT count(*) FROM duplicate_candidates('artist', entity_id('artist', 'test-inc-twin-a'))")).toBe('0');
  await userA.goto('/quality?check=possible_duplicate');
  await expect(userA.locator('main')).not.toContainText('Test Incremental Twin');
});

test('the nightly full run corrects what the triggers missed and shows it as drift; a page never computes live', async ({ userA }) => {
  sql('SELECT refresh_quality()');
  // a full run over unchanged data changes nothing
  sql('SELECT refresh_quality_full(); SELECT refresh_quality();');
  expect(sql("SELECT string_agg(d.type || ' ' || coalesce(e.slug, d.id::text) || ': ' || d.what, '; ') FROM derived_drift d LEFT JOIN entity_index e ON e.type = d.type AND e.id = d.id")).toBe('');
  // a change the triggers don't see (as if a dependency were unknown)
  sql(`ALTER TABLE artists DISABLE TRIGGER derived_touch;
       UPDATE artists SET name = 'Vincent van Gogh (unseen)' WHERE slug = 'vincent-van-gogh';
       ALTER TABLE artists ENABLE TRIGGER derived_touch;`);
  sql('SELECT refresh_quality()');
  expect(sql(`SELECT text FROM entry_search_fields_stored WHERE type = 'artwork' AND id = entity_id('artwork', 'sunflowers-national-gallery') AND label = 'Artist'`))
    .toBe('Vincent van Gogh');   // stale: nothing was queued
  sql('SELECT refresh_quality_full(); SELECT refresh_quality();');
  expect(sql(`SELECT text FROM entry_search_fields_stored WHERE type = 'artwork' AND id = entity_id('artwork', 'sunflowers-national-gallery') AND label = 'Artist'`))
    .toBe('Vincent van Gogh (unseen)');
  expect(sql("SELECT count(*) FROM derived_drift WHERE what = 'search fields' AND type = 'artwork' AND id = entity_id('artwork', 'sunflowers-national-gallery')")).toBe('1');
  await userA.goto('/quality');
  await expect(userA.locator('.qa-drift')).toContainText('by the nightly full check');
  await expect(userA.locator('.qa-drift')).toContainText('Sunflowers');
  await expect(userA.locator('.qa-status')).toContainText('Up to date');
});
