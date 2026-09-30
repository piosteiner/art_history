// Data quality: contradictions are found (view quality_issues), shown on /quality and on the entry, and can be
// marked as OK (remembered, hidden, shown again on request, undoable).
const { test, expect, adminChange } = require('./helpers');

test('a contradiction appears on /quality and on the entry; "Mark as OK" hides it until undone', async ({ userA }) => {
  adminChange("UPDATE artworks SET created = year_range(1895), created_label = '1895' WHERE slug = 'sunflowers-national-gallery'");
  await userA.goto('/quality?severity=error');
  const group = userA.locator('.qa-group', { hasText: 'Artwork dated outside its creator' });
  await expect(group).toContainText('created 1895, but Vincent van Gogh died 29 July 1890');
  await expect(userA.locator('.card.qa-error b')).not.toHaveText('0');

  await userA.goto('/artworks/sunflowers-national-gallery');
  const box = userA.locator('.qa-box');
  await expect(box).toHaveClass(/has-error/);
  await expect(box).toContainText('created 1895');
  await box.locator('input[name=note]').first().fill('test: deliberate');
  await Promise.all([userA.waitForNavigation(), box.locator('button', { hasText: 'Mark as OK' }).first().click()]);
  await expect(userA).toHaveURL(/\/artworks\/sunflowers-national-gallery$/);  // back where it was clicked
  await expect(userA.locator('.qa-box')).not.toContainText('created 1895');

  await userA.goto('/quality?severity=error&acked=1');
  const row = userA.locator('tr', { hasText: 'created 1895' });
  await expect(row).toContainText('OK’d by tester');
  await expect(row).toContainText('test: deliberate');
  await Promise.all([userA.waitForNavigation(), row.locator('button', { hasText: 'undo' }).click()]);
  await userA.goto('/quality?severity=error');
  await expect(userA.locator('tr', { hasText: 'created 1895' })).toHaveCount(1);
});

test('range checks: never alive together, presence after death', async ({ userA }) => {
  adminChange(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label)
    VALUES ('artist', entity_id('artist', 'utagawa-hiroshige'), 'visited', 'place', entity_id('place', 'london'), year_range(1900), '1900'),
           ('artist', entity_id('artist', 'katsushika-hokusai'), 'student_of', 'artist', entity_id('artist', 'vincent-van-gogh'), NULL, NULL)`);  // Hokusai †1849, Van Gogh *1853
  await userA.goto('/quality?severity=error');
  await expect(userA.locator('.qa-group', { hasText: 'outside the lifespan' })).toContainText('visited London (1900)');
  await expect(userA.locator('.qa-group', { hasText: 'never lived at the same time' })).toContainText('student of Vincent van Gogh');
  await userA.goto('/quality?check=never_alive_together');
  await expect(userA.locator('.qa-group')).toHaveCount(1);
});
