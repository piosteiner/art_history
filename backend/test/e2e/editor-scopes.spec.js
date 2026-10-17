// Row-level security (migration 094): an account limited to a collection changes only that collection's artworks
// and their parts — enforced by the database; accounts without a scope are unaffected.
const { execFileSync } = require('child_process');
const { test, expect, sql, liveReady, submitForm } = require('./helpers');

// a statement as the admin panel runs it: the app's role, the account in arthistory.user_id (one transaction)
const asUser = (user, statement) => {
  const id = sql(`SELECT id FROM admin_users WHERE username = '${user}'`);
  const db = sql('SELECT current_database()');
  return execFileSync('psql', ['-X', '-q', '-h', 'localhost', '-U', 'arthistory_admin', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1',
    '-c', `BEGIN; SELECT set_config('arthistory.user_id', '${id}', true); ${statement}; COMMIT;`], { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
};

const cleanup = () => sql(`DELETE FROM editor_scopes; DELETE FROM artworks WHERE slug IN ('test-rls-mine', 'test-rls-other', 'test-rls-new');
  DELETE FROM institutions WHERE slug = 'test-rls-museum'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO institutions (slug, name) VALUES ('test-rls-museum', 'Test Rls Museum');
       INSERT INTO artworks (slug, title, current_institution_id) VALUES ('test-rls-mine', 'Test Rls Mine', entity_id('institution', 'test-rls-museum')),
         ('test-rls-other', 'Test Rls Other', NULL);
       INSERT INTO editor_scopes (user_id, institution_id) SELECT id, entity_id('institution', 'test-rls-museum') FROM admin_users WHERE username = 'tester2'`);
});
test.afterEach(cleanup);

test('a scoped account edits its collection only; the database refuses the rest', async ({ userA, userB }) => {
  // in the database: the other work is invisible to the update, a step for it is refused, the own work is fine
  asUser('tester2', "UPDATE artworks SET title = 'Changed' WHERE slug = 'test-rls-other'");
  expect(sql("SELECT title FROM artworks WHERE slug = 'test-rls-other'")).toBe('Test Rls Other');
  expect(() => asUser('tester2', `INSERT INTO provenance (artwork_id, position, owner_label, method) VALUES (entity_id('artwork', 'test-rls-other'), 0, 'X', 'purchase')`))
    .toThrow(/row-level security/);
  asUser('tester2', `INSERT INTO provenance (artwork_id, position, owner_label, method) VALUES (entity_id('artwork', 'test-rls-mine'), 0, 'X', 'purchase')`);
  expect(sql("SELECT count(*) FROM provenance WHERE artwork_id = entity_id('artwork', 'test-rls-mine')")).toBe('1');
  // not into the own collection either: before and after must be in it
  asUser('tester2', `UPDATE artworks SET current_institution_id = entity_id('institution', 'test-rls-museum') WHERE slug = 'test-rls-other'`);
  expect(sql("SELECT current_institution_id IS NULL FROM artworks WHERE slug = 'test-rls-other'")).toBe('t');
  expect(() => asUser('tester2', "INSERT INTO artworks (slug, title) VALUES ('test-rls-new', 'Test Rls New')")).toThrow(/row-level security/);
  // reading is unaffected, and so is an account without a scope
  expect(asUser('tester2', "SELECT count(*) FROM artworks WHERE slug LIKE 'test-rls-%'")).toContain('2');
  asUser('tester', "UPDATE artworks SET title = 'Test Rls Other (A)' WHERE slug = 'test-rls-other'");
  expect(sql("SELECT title FROM artworks WHERE slug = 'test-rls-other'")).toBe('Test Rls Other (A)');

  // in the admin: saving the other work says why; the own one saves
  await userB.goto('/artworks/test-rls-other/edit');
  await liveReady(userB);
  await userB.fill('#f-title', 'Test Rls Other (B)');
  await submitForm(userB);
  await expect(userB.locator('.flash.error, ul.errors')).toContainText('only artworks of its own collections');
  expect(sql("SELECT title FROM artworks WHERE slug = 'test-rls-other'")).toBe('Test Rls Other (A)');
  await userB.goto('/artworks/test-rls-mine/edit');
  await liveReady(userB);
  await userB.fill('#f-title', 'Test Rls Mine (B)');
  await submitForm(userB);
  await expect(userB.locator('h1')).toContainText('Test Rls Mine (B)');
});
