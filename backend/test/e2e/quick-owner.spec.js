// A provenance step's owner that doesn't exist yet (142): "+ New person “…”" in the owner's suggestions creates it with
// the step — just the name, flagged as created from the artwork (via provenance), a high-priority ("error") finding
// on the Quality page until it is completed. An exact name of an existing entry is offered as itself, not as new.
const { test, expect, sql, settled } = require('./helpers');

test.beforeEach(() => sql(`INSERT INTO artworks (slug, title) VALUES ('test-wintergarten', 'Test Im Wintergarten');
  INSERT INTO people (slug, name) VALUES ('test-faure', 'Test Jean-Baptiste Faure')`));
test.afterEach(() => sql(`DELETE FROM artworks WHERE slug = 'test-wintergarten';
  DELETE FROM people WHERE slug IN ('test-faure') OR name = 'Test Hugo von Tschudi';
  DELETE FROM institutions WHERE name = 'Test Galerie Durand-Ruel'`));

test('provenance: an owner added on the fly — person and joint institution — flagged and high priority', async ({ userA }) => {
  await userA.goto('/artworks/test-wintergarten');
  await userA.click('summary:has-text("+ Add provenance step")');
  // an existing name: the entry itself, no "+ New person" for it (only the other types)
  await userA.fill('#pv-owner', 'Test Jean-Baptiste Faure');
  await expect(userA.locator('.ac-list li', { hasText: 'Test Jean-Baptiste Faure' }).first()).toBeVisible();
  await expect(userA.locator('.ac-list li.ac-new', { hasText: 'New person' })).toHaveCount(0);
  // a new name: "+ New person …" — picked, the field holds the request, the hint says what will happen
  await userA.fill('#pv-owner', 'Test Hugo von Tschudi');
  await userA.locator('.ac-list li.ac-new', { hasText: 'New person “Test Hugo von Tschudi”' }).click();
  await expect(userA.locator('#pv-owner')).toHaveValue('new:person:Test Hugo von Tschudi');
  await expect(userA.locator('.ac:has(#pv-owner) .ac-chosen')).toContainText('new person “Test Hugo von Tschudi” — created when you save');
  // a joint owner too, as a new institution
  await userA.fill('input[name="co_owner_1"]', 'Test Galerie Durand-Ruel');
  await userA.locator('.ac-list li.ac-new', { hasText: 'New institution “Test Galerie Durand-Ruel”' }).click();
  await userA.fill('#pv-acquired', '1896');
  await userA.selectOption('#pv-method', 'purchase');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=prov-added#provenance/);

  // created with the step, flagged from the artwork, via provenance; the step points to them
  expect(sql(`SELECT ac.via || ' ' || ac.created_from_type FROM auto_created ac JOIN people p ON ac.entity_type = 'person' AND ac.entity_id = p.id
    WHERE p.name = 'Test Hugo von Tschudi'`)).toBe('provenance artwork');
  expect(sql(`SELECT count(*) FROM provenance s JOIN people p ON p.id = s.owner_person_id JOIN provenance_co_owners c ON c.provenance_id = s.id
    JOIN institutions i ON i.id = c.owner_institution_id WHERE p.name = 'Test Hugo von Tschudi' AND i.name = 'Test Galerie Durand-Ruel'`)).toBe('1');
  // high priority on the Quality page
  await settled();
  expect(sql(`SELECT string_agg(q.severity, ',' ORDER BY q.entity_type) FROM quality_issues q JOIN auto_created ac ON (ac.entity_type, ac.entity_id) = (q.entity_type, q.entity_id)
    WHERE q.check_id = 'auto_created' AND ac.via = 'provenance'`)).toBe('error,error');
});

test('provenance: a quick-added owner with a refused step is not created', async ({ userA }) => {
  await userA.goto('/artworks/test-wintergarten');
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner', 'Test Hugo von Tschudi');
  await userA.locator('.ac-list li.ac-new', { hasText: 'New person' }).click();
  await userA.fill('#pv-acquired', 'not a date at all');
  await userA.click('.provenance-form button:has-text("Add")');
  await expect(userA.locator('.flash.error')).toBeVisible();
  expect(sql("SELECT count(*) FROM people WHERE name = 'Test Hugo von Tschudi'")).toBe('0');
  // the form comes back with the request, still explained
  await expect(userA.locator('#pv-owner')).toHaveValue('new:person:Test Hugo von Tschudi');
  await expect(userA.locator('.ac:has(#pv-owner) .ac-chosen')).toContainText('new person “Test Hugo von Tschudi”');
});
