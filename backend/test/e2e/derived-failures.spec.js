// The worker can't get stuck on one entry (migration 128): a batch that fails is taken one entry at a time; the one
// that fails alone is set aside (derived_failures, shown on the dashboard and the Quality page), the others go on;
// a later success clears it.
const { test, expect, adminChange, sql, settled } = require('./helpers');

const cleanup = () => sql(`DROP TRIGGER IF EXISTS test_poison ON quality_issues; DROP FUNCTION IF EXISTS test_poison();
  DELETE FROM artists WHERE slug IN ('test-poison', 'test-healthy'); DELETE FROM derived_failures;`);
test.beforeEach(cleanup);
test.afterAll(cleanup);

test('an entry whose checks fail is set aside, the rest is checked; fixed, it is checked again', async ({ userA }) => {
  // a bug in a check, for one entry only: storing its findings fails
  sql(`CREATE FUNCTION test_poison() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.entity_type = 'artist' AND NEW.entity_id = (SELECT id FROM artists WHERE slug = 'test-poison') THEN
           RAISE EXCEPTION 'test poison: this entry breaks a check';
         END IF;
         RETURN NEW;
       END $$;
       CREATE TRIGGER test_poison BEFORE INSERT OR UPDATE ON quality_issues FOR EACH ROW EXECUTE FUNCTION test_poison();`);
  adminChange("INSERT INTO artists (slug, name) VALUES ('test-poison', 'Test Poison Painter'), ('test-healthy', 'Test Healthy Painter')");
  await settled();   // the queue is empty: not stuck
  expect(sql("SELECT what || ': ' || error FROM derived_failures WHERE type = 'artist' AND id = entity_id('artist', 'test-poison')"))
    .toContain('derived: test poison: this entry breaks a check');
  // the other one of the same batch was checked
  expect(Number(sql("SELECT count(*) FROM quality_issues WHERE entity_type = 'artist' AND entity_id = entity_id('artist', 'test-healthy')"))).toBeGreaterThan(0);

  await userA.goto('/');
  await expect(userA.locator('.qa-alert')).toContainText('1 entry could not be checked');
  await userA.goto('/quality');
  await expect(userA.locator('.qa-failures')).toContainText('Test Poison Painter');
  await expect(userA.locator('.qa-failures')).toContainText('test poison: this entry breaks a check');

  // the cause fixed, its next change checks it again and clears the record
  sql('DROP TRIGGER test_poison ON quality_issues; DROP FUNCTION test_poison();');
  adminChange("UPDATE artists SET name = 'Test Poison Painter (fixed)' WHERE slug = 'test-poison'");
  await settled();
  expect(sql('SELECT count(*) FROM derived_failures')).toBe('0');
  expect(Number(sql("SELECT count(*) FROM quality_issues WHERE entity_type = 'artist' AND entity_id = entity_id('artist', 'test-poison')"))).toBeGreaterThan(0);
  await userA.goto('/');
  await expect(userA.locator('.qa-alert')).toHaveCount(0);
});
