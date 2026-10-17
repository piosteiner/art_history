// Names that sound alike (092: fuzzystrmatch — Double Metaphone + Levenshtein) in the duplicate check, which now
// weighs only candidate pairs from the materialized dup_name_keys (093).
const { test, expect, sql } = require('./helpers');

const cleanup = () => sql("DELETE FROM people WHERE slug IN ('test-rochlitz', 'test-rochlits', 'test-schmidt', 'test-smith')");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('spellings that sound alike are possible duplicates; similar keys alone are not', async ({ userA }) => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-rochlitz', 'Gustav Rochlitz'), ('test-rochlits', 'Gustave Rochlits'),
         ('test-schmidt', 'Hermann Schmidtke'), ('test-smith', 'Herman Smith')`);
  expect(sql("SELECT name_sound_key('Gustav Rochlitz') = name_sound_key('Gustave Rochlits')")).toBe('t');
  sql('SELECT refresh_quality()');
  const found = sql(`SELECT detail FROM quality_issues WHERE check_id = 'possible_duplicate'
    AND entity_id = entity_id('person', 'test-rochlitz') AND entity_type = 'person'`);
  expect(found).toContain('probably the same as Gustave Rochlits');
  expect(found).toContain('names sound alike');
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'possible_duplicate'
    AND entity_id IN (entity_id('person', 'test-schmidt'), entity_id('person', 'test-smith'))`)).toBe('0');
  // the candidates come from the stored names (refreshed with the checks)
  expect(sql(`SELECT count(*) FROM dup_candidate_pairs WHERE type = 'person' AND a_id = entity_id('person', 'test-rochlitz')
    AND b_id = entity_id('person', 'test-rochlits')`)).toBe('1');
  // the live check while creating an entry says so too
  expect(sql("SELECT array_to_string(reasons, ', ') FROM duplicate_candidates('person', entity_id('person', 'test-rochlits')) WHERE slug = 'test-rochlitz'"))
    .toContain('names sound alike');
  // and the quality page lists it
  await userA.goto('/quality?check=possible_duplicate');
  await expect(userA.locator('main')).toContainText('Gustave Rochlits');
});
