// Derived data kept up to date incrementally (migration 125): a change queues the entries it affects (derived_queue),
// the worker computes only those again — their search fields, findings and duplicate pairs — and the nightly full
// run corrects (and logs as drift) what the incremental path missed.
const { test, expect, adminChange, sql } = require('./helpers');

const cleanup = () => sql(`DELETE FROM artists WHERE slug IN ('test-inc-twin-a', 'test-inc-twin-b');
  UPDATE artists SET name = 'Vincent van Gogh' WHERE slug = 'vincent-van-gogh';
  DELETE FROM derived_drift;`);
test.beforeEach(cleanup);
test.afterAll(cleanup);

// the queue empty again (the worker runs half a second after a commit) — then the stored data is current
const settled = () => expect.poll(() => sql('SELECT count(*) FROM derived_queue'), { timeout: 15000 }).toBe('0');

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
