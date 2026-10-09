// The wrong kind of entry (migration 055): noticed while typing, from Wikidata's class, on the quality page — and moved.
const { test, expect, sql, submitForm } = require('./helpers');

const api = (request, path) => request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' }, maxRedirects: 0 });

test.afterAll(() => sql(`DELETE FROM people WHERE slug LIKE 'henry-clay-frick%'; DELETE FROM institutions WHERE slug LIKE 'henry-clay-frick%' OR slug IN ('claude-monet', 'frick-collection-test');
                         DELETE FROM entry_moves`));

test('a person\'s name typed as an institution, a human from Wikidata: warned; created only when confirmed', async ({ userA }) => {
  await userA.goto('/institutions/new');
  await userA.fill('#f-name', 'Henry Clay Frick');
  await expect(userA.locator('.dup-live .type-warning')).toContainText('the name looks like a person');
  await userA.fill('#f-name', 'Gilcrease Museum');
  await expect(userA.locator('.dup-live')).not.toContainText('looks like a person');

  // Wikidata's class: Q100 is a human
  await userA.goto('/institutions/new/wikidata?q=Q100');
  await expect(userA.locator('.type-warning')).toContainText('Wikidata says this is an artist or a person, not an institution');
  await expect(userA.locator('.type-warning a', { hasText: 'a person' })).toHaveAttribute('href', '/people/new/wikidata?q=Q100');
  // created by hand with that item: asked first
  await userA.goto('/institutions/new');
  await userA.fill('#f-name', 'Claude Monet');
  await userA.fill('#f-slug', 'claude-monet');
  await userA.fill('#f-wikidata_id', 'Q100');
  await submitForm(userA);
  await expect(userA.locator('.type-check')).toContainText('Wikidata says this is an artist or a person');
  expect(sql("SELECT count(*) FROM institutions WHERE slug = 'claude-monet'")).toBe('0');
  await userA.check('input[name="type.ok"]');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/institutions\/claude-monet\?done=created/);
});

test('change type: an institution becomes a person — preview, relationships and links follow, the old address leads there', async ({ userA, request }) => {
  sql(`INSERT INTO institutions (slug, name, description_md) VALUES ('henry-clay-frick', 'Henry Clay Frick', 'Collector.'), ('frick-collection-test', 'The Frick Collection Test', NULL);
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('institution', entity_id('institution', 'henry-clay-frick'), 'founded', 'institution', entity_id('institution', 'frick-collection-test')),
         ('person', entity_id('person', 'theo-van-gogh'), 'patron_of', 'institution', entity_id('institution', 'henry-clay-frick'));
       UPDATE institutions SET description_md = 'Founded by [[institution/henry-clay-frick|Frick]].' WHERE slug = 'frick-collection-test'`);
  // the quality page has noticed
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'type_doubtful' AND entity_type = 'institution'
              AND entity_id = entity_id('institution', 'henry-clay-frick')`)).toContain('looks like a person');

  await userA.goto('/institutions/henry-clay-frick');
  await Promise.all([userA.waitForNavigation(), userA.click('a:has-text("Change type…")')]);
  await userA.selectOption('#to', 'person');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Preview")')]);
  const summary = userA.locator('.merge-summary');
  await expect(summary).toContainText('patron of Theo van Gogh');                      // a person can't have a patron here: removed
  await expect(summary).toContainText('1 text with [[links]] to it rewritten');
  expect(sql("SELECT count(*) FROM institutions WHERE slug = 'henry-clay-frick'")).toBe('1');   // the preview changed nothing
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
  await expect(userA).toHaveURL(/\/people\/henry-clay-frick\?done=converted/);
  await expect(userA.locator('dl.fields')).toContainText('Collector.');

  expect(sql(`SELECT r.subject_type || ' founded ' || o.slug FROM relationships r JOIN institutions o ON o.id = r.object_id
              WHERE r.relationship_type = 'founded' AND r.subject_id = entity_id('person', 'henry-clay-frick')`)).toBe('person founded frick-collection-test');
  expect(sql("SELECT description_md FROM institutions WHERE slug = 'frick-collection-test'")).toBe('Founded by [[person/henry-clay-frick|Frick]].');
  // the old address: admin and API lead to the person
  await userA.goto('/institutions/henry-clay-frick/history');
  await expect(userA).toHaveURL(/\/people\/henry-clay-frick\/history$/);
  const old = await api(request, '/institutions/henry-clay-frick');
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe('/v1/people/henry-clay-frick');
});
