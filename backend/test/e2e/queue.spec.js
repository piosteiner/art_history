// The Quality queue (src/admin/quality.js, routes/queue.js): info groups folded, "Work through these" → the entry with
// a queue bar → "Next issue"; batch pages: find Wikidata items, cite what the GND agrees with.
const { test, expect, sql } = require('./helpers');

const cleanup = () => sql(`DELETE FROM people WHERE slug IN ('charles-gleyre-q', 'zz-queue-person');
  DELETE FROM entry_identifiers WHERE value = '118583123'; DELETE FROM artists WHERE slug = 'claude-monet-q';
  DELETE FROM citations WHERE source_id = entity_id('source', 'gnd'); DELETE FROM bibliography WHERE slug = 'gnd'`);
test.afterAll(cleanup);

test('the queue: info folded, work through a check entry by entry, then back to the list', async ({ userA }) => {
  cleanup();
  sql("INSERT INTO people (slug, name) VALUES ('charles-gleyre-q', 'Charles Gleyre'), ('zz-queue-person', 'Zz Queue Person')");
  await userA.goto('/quality');
  const folded = userA.locator('details.qa-folded', { hasText: 'No Wikidata id' });
  await expect(folded).not.toHaveAttribute('open', '');
  await folded.locator('summary').click();
  await expect(folded.locator('a:has-text("Find Wikidata items for these…")')).toBeVisible();

  await userA.goto('/quality?check=no_wikidata_id&type=person');
  await Promise.all([userA.waitForNavigation(), userA.click('a:has-text("Work through these →")')]);
  const bar = userA.locator('.queue-bar');
  await expect(bar).toContainText('No Wikidata id · person · No. 1');
  const first = new URL(userA.url()).pathname;
  await Promise.all([userA.waitForNavigation(), bar.locator('a:has-text("Next issue →")').click()]);
  await expect(userA.locator('.queue-bar')).toContainText('No. 2');
  expect(new URL(userA.url()).pathname).not.toBe(first);
  // to the end: then the list says so
  for (let i = 0; i < 5 && await userA.locator('.queue-bar').count(); i += 1) {
    await Promise.all([userA.waitForNavigation(), userA.locator('.queue-bar a:has-text("Next issue →")').click()]);
  }
  await expect(userA).toHaveURL(/\/quality\?.*done=queue-done/);
  await expect(userA.locator('.flash.ok')).toContainText('That was the last one of this list.');
});

test('batch: find Wikidata items — an exact name pre-selected, linked, then Enrich offered', async ({ userA }) => {
  sql("INSERT INTO people (slug, name) VALUES ('charles-gleyre-q', 'Charles Gleyre') ON CONFLICT DO NOTHING");
  await userA.goto('/quality/batch/wikidata?type=person');
  const row = userA.locator('tr[data-entry="person/charles-gleyre-q"]');
  await expect(row.locator('input[value=Q103]')).toBeChecked();                  // "Charles Gleyre" = Q103's label
  await Promise.all([userA.waitForNavigation(), userA.click('.batch-form .sticky-actions button')]);
  await expect(userA.locator('h1')).toContainText('Linked 1 entry');
  await expect(userA.locator('a[href="/people/charles-gleyre-q/enrich"]')).toBeVisible();
  expect(sql("SELECT wikidata_id FROM people WHERE slug = 'charles-gleyre-q'")).toBe('Q103');
});

test('batch: cite where the GND agrees — weakly sourced birth cited with the GND', async ({ userA }) => {
  sql(`INSERT INTO artists (slug, name, birth, birth_label) VALUES ('claude-monet-q', 'Claude Monet', '[1840-11-14,1840-11-15)', '14 November 1840');
       INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'claude-monet-q'), 'gnd', '118583123')`);
  await userA.goto('/quality/batch/cite?type=artist');
  const row = userA.locator('tr[data-entry="artist/claude-monet-q"]');
  await expect(row.locator('input[value=birth]')).toBeChecked();
  await Promise.all([userA.waitForNavigation(), userA.click('.batch-form .sticky-actions button')]);
  await expect(userA.locator('.flash.ok').first()).toContainText('Cited. (1 value)');
  expect(sql(`SELECT string_agg(c.field || ' ' || b.slug, ', ') FROM citations c JOIN bibliography b ON b.id = c.source_id
    WHERE c.entity_type = 'artist' AND c.entity_id = entity_id('artist', 'claude-monet-q')`)).toBe('birth gnd');
  // no longer weak there: off this batch page
  await expect(userA.locator('tr[data-entry="artist/claude-monet-q"] input[value=birth]')).toHaveCount(0);
});
