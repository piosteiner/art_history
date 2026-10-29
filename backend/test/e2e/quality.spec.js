// Data quality: contradictions are found (view quality_issues_live), shown on /quality and on the entry, and can be
// marked as OK (remembered, hidden, shown again on request, undoable).
const { test, expect, adminChange, sql, settled } = require('./helpers');

test('a contradiction appears on /quality and on the entry; "Mark as OK" hides it until undone', async ({ userA }) => {
  adminChange("UPDATE artworks SET created = year_range(1895), created_label = '1895' WHERE slug = 'sunflowers-national-gallery'");
  await settled();   // the finding comes from the derived-data worker (125) — busy when the whole suite runs
  await userA.goto('/quality?severity=error');
  const group = userA.locator('.qa-group', { hasText: 'Artwork dated outside its creator' });
  await expect(group).toContainText('created 1895, but Vincent van Gogh died 29 July 1890');
  await expect(userA.locator('.card.qa-error b')).not.toHaveText('0');
  // the page brought the stored result (058) up to date before showing it: the finding is in the table
  expect(sql("SELECT quality_fresh()")).toBe('t');
  expect(sql("SELECT count(*) FROM quality_issues WHERE check_id = 'artwork_outside_creator_life' AND detail LIKE 'created 1895%'")).toBe('1');

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

test('a possible duplicate (one finding on two entries) is stored for both — the refresh does not fail (062)', async ({ userA }) => {
  sql(`DELETE FROM artists WHERE slug IN ('test-twin-a', 'test-twin-b');
       INSERT INTO artists (slug, name, birth, birth_label) VALUES ('test-twin-a', 'Test Twin Painter', year_range(1800), '1800'),
                                                               ('test-twin-b', 'Test Twin Painter', year_range(1800), '1800')`);
  await userA.goto('/quality?check=possible_duplicate');
  await expect(userA.locator('.qa-group')).toContainText('Test Twin Painter');
  expect(sql('SELECT quality_fresh()')).toBe('t');
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'possible_duplicate'
    AND entity_id IN (entity_id('artist', 'test-twin-a'), entity_id('artist', 'test-twin-b')) AND entity_type = 'artist'`)).toBe('2');
  sql("DELETE FROM artists WHERE slug IN ('test-twin-a', 'test-twin-b')");
});

test('a check with many findings: the first 100 on the overview, all of them (up to 1,000) when it is chosen', async ({ userA }) => {
  sql(`DELETE FROM artists WHERE slug LIKE 'test-many-%';
       INSERT INTO artists (slug, name) SELECT 'test-many-' || i, 'Test Many ' || i FROM generate_series(1, 105) i`);
  await settled();
  const total = Number(sql("SELECT count(*) FROM quality_issues q LEFT JOIN quality_acks a USING (check_id, issue_key) WHERE q.check_id = 'artist_missing_dates' AND a.check_id IS NULL"));
  expect(total).toBeGreaterThan(100);
  await userA.goto('/quality?severity=warning');
  const group = userA.locator('.qa-group', { hasText: 'Artist without birth or death date' });
  await expect(group.locator('h2')).toContainText(`(${total})`);
  await expect(group.locator('tbody tr')).toHaveCount(100);
  await expect(group.locator('.qa-more')).toContainText(`The first 100 of ${total}`);
  await Promise.all([userA.waitForNavigation(), group.locator('.qa-more a').click()]);
  await expect(userA).toHaveURL(/check=artist_missing_dates/);
  await expect(userA.locator('.qa-group tbody tr')).toHaveCount(total);
  sql("DELETE FROM artists WHERE slug LIKE 'test-many-%'");
});
