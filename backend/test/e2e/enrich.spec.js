// Enrich (src/admin/enrich.js): Wikidata and the GND on one page — a date both give is one row, taken once and cited by
// both; a relationship both suggest is created once and cited by both; the sources without a number say how to find one.
const { test, expect, sql, submitForm } = require('./helpers');

const me = "entity_type = 'artist' AND entity_id = entity_id('artist', 'claude-monet-enrich')";
const cleanup = () => sql(`DELETE FROM entry_identifiers WHERE value IN ('118583123', '500018666', '118583174');
  DELETE FROM artists WHERE slug = 'claude-monet-enrich'; DELETE FROM live_docs WHERE entity_type = 'artist';
  DELETE FROM wikidata_reviews WHERE entity_type = 'artist'; DELETE FROM bibliography WHERE slug = 'gnd'`);

test.afterAll(cleanup);

test('Enrich: one row per date for Wikidata and the GND, cited by both; one relationship cited by both', async ({ userA }) => {
  cleanup();
  sql(`INSERT INTO artists (slug, name, wikidata_id) VALUES ('claude-monet-enrich', 'Claude Monet', 'Q100');
       INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'claude-monet-enrich'), 'gnd', '118583123')`);
  await userA.goto('/artists/claude-monet-enrich');
  await Promise.all([userA.waitForNavigation(), userA.click('a:has-text("Enrich…")')]);
  await expect(userA.locator('h1')).toHaveText('Enrich Claude Monet');
  const sources = userA.locator('.enrich-sources');
  await expect(sources).toContainText('Q100');
  await expect(sources).toContainText('GND 118583123');
  await expect(sources.locator('a:has-text("Find in SIKART…")')).toBeVisible();

  // birth and death: offered by both, the same — one row each, picked by default (our fields are empty)
  const birth = userA.locator('tr[data-merged="birth"]');
  await expect(birth.locator('input[name="pick.birth"]:checked')).toHaveCount(1);
  await expect(birth.locator('label:has(input[name="pick.birth"]:checked)')).toContainText('Wikidata, GND');
  await expect(userA.locator('tr[data-merged="death"] label:has(input:checked)')).toContainText('Wikidata, GND');
  // and not again in the sources' own tables
  await expect(userA.locator('.enrich-form h2:has-text("GND") + .table-wrap')).toHaveCount(0);

  // born in Paris: Wikidata suggests it (link ours), the GND too (ticked)
  await userA.locator('.wd-table tbody tr', { hasText: 'Paris' }).filter({ has: userA.locator('input[value=link]') }).first()
    .locator('input[value=link]').check();
  await expect(userA.locator('input[name^="gnd:rel."]').first()).toBeChecked();
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA).toHaveURL(/\/artists\/claude-monet-enrich\/edit\?done=enrich/);
  await expect(userA.locator('#f-birth')).toHaveValue('1840-11-14');
  await expect(userA.locator('#f-death')).toHaveValue('1926-12-05');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet-enrich\?done=published/);

  // birth: cited by Wikidata (the item) and the GND (the source) — the value taken once
  expect(sql(`SELECT string_agg(coalesce(b.slug, c.wikidata_item), ', ' ORDER BY coalesce(b.slug, c.wikidata_item)) FROM citations c
    LEFT JOIN bibliography b ON b.id = c.source_id WHERE c.field = 'birth' AND c.pending IS NULL AND c.${me.replace(' AND ', ' AND c.')}`)).toBe('Q100, gnd');
  // one "born in Paris", cited by both
  expect(sql(`SELECT count(*) FROM relationships WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'claude-monet-enrich')
    AND relationship_type = 'born_in' AND object_id = entity_id('place', 'paris')`)).toBe('1');
  expect(sql(`SELECT string_agg(coalesce(b.slug, c.wikidata_item), ', ' ORDER BY coalesce(b.slug, c.wikidata_item)) FROM citations c
    JOIN relationships r ON r.id = c.relationship_id LEFT JOIN bibliography b ON b.id = c.source_id
    WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'claude-monet-enrich') AND r.relationship_type = 'born_in'`)).toBe('Q100, gnd');
});

test('Enrich without any number: says where to start', async ({ userA }) => {
  sql("INSERT INTO people (slug, name) VALUES ('nobody-enrich', 'Nobody Enrich') ON CONFLICT DO NOTHING");
  await userA.goto('/people/nobody-enrich/enrich');
  await expect(userA.locator('.flash.warn')).toContainText('No source to compare with yet');
  await expect(userA.locator('.enrich-sources a:has-text("Find on Wikidata…")')).toBeVisible();
  sql("DELETE FROM people WHERE slug = 'nobody-enrich'");
});
