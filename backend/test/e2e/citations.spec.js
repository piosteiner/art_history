// Sources for facts (migration 049, src/admin/citations.js): Wikidata cites itself, sources are added at the value,
// a changed value shows its citations as outdated, the quality page lists what has no good source.
const { test, expect, sql, submitForm } = require('./helpers');

const apply = (page) => Promise.all([page.waitForNavigation(), page.click('.wd-form .sticky-actions button')]);
const row = (page, text) => page.locator('.wd-table tbody tr', { hasText: text }).first();
const cites = (type, slug) => sql(`SELECT string_agg(field || ':' || coalesce(wikidata_item, 'src') || ':' || (pending IS NOT NULL)::text, ' ' ORDER BY field)
  FROM citations WHERE entity_type = '${type}' AND entity_id = entity_id('${type}', '${slug}')`);

test.afterAll(() => {
  sql(`DELETE FROM artists WHERE slug IN ('claude-monet-cite', 'claude-monet');
       DELETE FROM bibliography WHERE slug = 'van-gogh-museum-website-test';
       DELETE FROM places WHERE wikidata_id IN ('Q101') AND slug LIKE 'giverny%'`);
});

test('a new entry from Wikidata: its values are cited (W); a museum source added by hand (M); a change makes them outdated', async ({ userA }) => {
  sql("DELETE FROM artists WHERE slug = 'claude-monet'");
  await userA.goto('/artists/new/wikidata?q=Q100');
  await expect(row(userA, 'Birth').locator('input[value=take]')).toBeChecked();
  await apply(userA);
  await userA.fill('#f-death', '1926');      // changed before Create: not Wikidata's value any more → no citation
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet\?done=created/);
  expect(cites('artist', 'claude-monet')).toBe('birth:Q100:false');
  const birth = userA.locator('dt:has-text("Birth") + dd');
  await expect(birth.locator('summary .cite-badge.cite-database')).toHaveText('W');
  await expect(userA.locator('dt:has-text("Death") + dd summary .cite-badge.cite-none')).toHaveText('?');
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'weakly_sourced' AND entity_type = 'artist' AND entity_id = entity_id('artist', 'claude-monet')`))
    .toBe('no source: death · only Wikidata / databases: birth');

  // the museum's website as a source for the death date: an institution (M); the field is then well sourced
  sql(`INSERT INTO bibliography (slug, kind, name, url) VALUES ('van-gogh-museum-website-test', 'web', 'Van Gogh Museum: Collection', 'https://www.vangoghmuseum.nl/')`);
  await userA.locator('dt:has-text("Death") + dd details.cite summary').click();
  const form = userA.locator('dt:has-text("Death") + dd .cite-add');
  await form.locator('input[name=source]').fill('van-gogh-museum-website-test');
  await userA.keyboard.press('Escape');
  await form.locator('input[name=accessed]').fill('2026-10-08');
  await Promise.all([userA.waitForNavigation(), form.locator('button').click()]);
  await expect(userA).toHaveURL(/done=cite-added/);
  await expect(userA.locator('dt:has-text("Death") + dd summary .cite-badge.cite-institution')).toHaveText('M');
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'weakly_sourced' AND entity_type = 'artist' AND entity_id = entity_id('artist', 'claude-monet')`))
    .toBe('only Wikidata / databases: birth');

  // the birth date changes: Wikidata's citation no longer matches it
  sql("UPDATE artists SET birth = '[1840-01-01,1841-01-01)', birth_label = '1840' WHERE slug = 'claude-monet'");
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'citation_outdated' AND entity_type = 'artist' AND entity_id = entity_id('artist', 'claude-monet')`))
    .toBe('birth changed since it was cited (Wikidata Q100, P569)');
  await userA.reload();
  await expect(userA.locator('dt:has-text("Birth") + dd summary .cite-badge.cite-outdated')).toBeVisible();
});

test('an existing entry compared with Wikidata: pending in the working copy, cited when published; relationships cited at once', async ({ userA }) => {
  sql(`DELETE FROM artists WHERE slug = 'claude-monet';
       INSERT INTO artists (slug, name, wikidata_id) VALUES ('claude-monet-cite', 'Claude Monet', 'Q100')`);
  await userA.goto('/artists/claude-monet-cite/wikidata');
  await expect(row(userA, 'Birth').locator('input[value=take]')).toBeChecked();
  await row(userA, 'born in').locator('input[value=link]').check();             // our Paris, same name
  await apply(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet-cite\/edit\?done=wikidata/);
  expect(cites('artist', 'claude-monet-cite')).toContain('birth:Q100:true');  // pending: only in the working copy
  expect(sql(`SELECT c.wikidata_item || ' ' || c.wikidata_property FROM citations c JOIN relationships r ON r.id = c.relationship_id
              WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'claude-monet-cite') AND r.relationship_type = 'born_in'`)).toBe('Q100 P19');
  await submitForm(userA);                                                       // Publish
  await expect(userA).toHaveURL(/\/artists\/claude-monet-cite\?done=/);
  expect(cites('artist', 'claude-monet-cite')).toContain('birth:Q100:false');   // settled
  await expect(userA.locator('#relationships + .table-wrap summary .cite-badge.cite-database').first()).toHaveText('W');
  sql("DELETE FROM live_docs WHERE entity_type = 'artist'");
});
