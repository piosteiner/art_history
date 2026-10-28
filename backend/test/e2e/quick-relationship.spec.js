// A relationship's target that doesn't exist yet (149): "+ New person “…”" in the target's suggestions creates it with
// the relationship — just the name, flagged as created from the entry the form is on (via relationship), a
// high-priority ("error") finding on the Quality page until it is completed. Only the types the chosen relationship
// allows are offered; an exact name of an existing entry is offered as itself; a refused relationship creates nothing.
const { test, expect, sql, settled } = require('./helpers');

test.beforeEach(() => sql(`INSERT INTO artists (slug, name) VALUES ('test-ambrogio', 'Test Ambrogio Lorenzetti');
  INSERT INTO people (slug, name) VALUES ('test-agnolo', 'Test Agnolo di Tura')`));
test.afterEach(() => sql(`DELETE FROM relationships WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'test-ambrogio');
  DELETE FROM artists WHERE slug = 'test-ambrogio' OR name = 'Test Pietro Lorenzetti';
  DELETE FROM people WHERE slug = 'test-agnolo' OR name = 'Test Giovanni Rossi';
  DELETE FROM movements WHERE name = 'Test Sienese School'`));

test('relationship: a target added on the fly — flagged from the entry, high priority', async ({ userA }) => {
  await userA.goto('/artists/test-ambrogio');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'sibling_of');
  // an existing name: the entry itself, no "+ New person" for it
  await userA.fill('#r-to', 'Test Agnolo di Tura');
  await expect(userA.locator('.ac-list li', { hasText: 'Test Agnolo di Tura' }).first()).toBeVisible();
  await expect(userA.locator('.ac-list li.ac-new', { hasText: 'New person' })).toHaveCount(0);
  // a new name: "+ New artist" and "+ New person" (the types "sibling of" allows), not institution or movement
  await userA.fill('#r-to', 'Test Pietro Lorenzetti');
  await expect(userA.locator('.ac-list li.ac-new', { hasText: 'New person' })).toHaveCount(1);
  await expect(userA.locator('.ac-list li.ac-new', { hasText: 'New institution' })).toHaveCount(0);
  await userA.locator('.ac-list li.ac-new', { hasText: 'New artist “Test Pietro Lorenzetti”' }).click();
  await expect(userA.locator('#r-to')).toHaveValue('new:artist:Test Pietro Lorenzetti');
  await expect(userA.locator('.ac:has(#r-to) .ac-chosen')).toContainText('new artist “Test Pietro Lorenzetti” — created when you save');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added#relationships/);

  // created with the relationship, flagged from the artist, via relationship; the relationship points to it
  expect(sql(`SELECT ac.via || ' ' || ac.created_from_type FROM auto_created ac JOIN artists a ON ac.entity_type = 'artist' AND ac.entity_id = a.id
    WHERE a.name = 'Test Pietro Lorenzetti'`)).toBe('relationship artist');
  expect(sql(`SELECT count(*) FROM relationships r JOIN artists a ON r.object_type = 'artist' AND a.id = r.object_id
    WHERE r.relationship_type = 'sibling_of' AND r.subject_id = entity_id('artist', 'test-ambrogio') AND a.name = 'Test Pietro Lorenzetti'`)).toBe('1');
  await settled();
  expect(sql(`SELECT q.severity FROM quality_issues q JOIN auto_created ac ON (ac.entity_type, ac.entity_id) = (q.entity_type, q.entity_id)
    JOIN artists a ON ac.entity_type = 'artist' AND a.id = ac.entity_id WHERE q.check_id = 'auto_created' AND a.name = 'Test Pietro Lorenzetti'`)).toBe('error');

  // a movement as target: "+ New movement" where the type allows it
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'associated_with');
  await userA.fill('#r-to', 'Test Sienese School');
  await userA.locator('.ac-list li.ac-new', { hasText: 'New movement “Test Sienese School”' }).click();
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  expect(sql(`SELECT ac.via FROM auto_created ac JOIN movements m ON ac.entity_type = 'movement' AND ac.entity_id = m.id WHERE m.name = 'Test Sienese School'`)).toBe('relationship');
});

test('relationship: a quick-added target with a refused relationship is not created', async ({ userA }) => {
  await userA.goto('/artists/test-ambrogio');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'student_of');
  await userA.fill('#r-to', 'Test Giovanni Rossi');
  await userA.locator('.ac-list li.ac-new', { hasText: 'New person' }).click();
  await userA.fill('#r-period', 'not a date at all');
  await userA.click('form[action$="/relationships"] button:has-text("Add")');
  await expect(userA.locator('.flash.error')).toBeVisible();
  expect(sql("SELECT count(*) FROM people WHERE name = 'Test Giovanni Rossi'")).toBe('0');
  // the form comes back with the request, still explained
  await expect(userA.locator('#r-to')).toHaveValue('new:person:Test Giovanni Rossi');
  await expect(userA.locator('.ac:has(#r-to) .ac-chosen')).toContainText('new person “Test Giovanni Rossi”');
});
