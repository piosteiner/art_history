// Reference records (authority files) and the comparison with the GND (migration 053; src/admin/identifiers.js, gnd.js).
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();
const apply = (page) => Promise.all([page.waitForNavigation(), page.click('.wd-form .sticky-actions button')]);

test.afterAll(() => {
  sql(`DELETE FROM artists WHERE slug = 'claude-monet-gnd'; DELETE FROM entry_identifiers;
       DELETE FROM citations WHERE source_id = entity_id('source', 'gnd'); DELETE FROM live_docs WHERE entity_type = 'artist';
       DELETE FROM relationships WHERE id IN (SELECT r.id FROM relationships r WHERE 'vincent-van-gogh' IN
         ((SELECT slug FROM artists WHERE id = r.subject_id AND r.subject_type = 'artist'), (SELECT slug FROM artists WHERE id = r.object_id AND r.object_type = 'artist'))
         AND r.relationship_type = 'collaborated_with' AND NOT EXISTS (SELECT 1 FROM artists a WHERE a.slug = 'claude-monet-gnd'));
       DELETE FROM bibliography WHERE slug = 'gnd'`);  // the comparison created it in this (emptied) test database
});

test('reference records: a number or the record\'s link; one number names one entry; links in the API', async ({ userA, request }) => {
  sql("DELETE FROM entry_identifiers");
  await userA.goto('/artists/paul-gauguin');
  const section = userA.locator('#reference-records');
  await section.locator('summary:has-text("+ Add a reference record")').click();
  await section.locator('select[name=authority]').selectOption('gnd');
  await section.locator('input[name=value]').fill('https://portal.dnb.de/opac.htm?method=simpleSearch&cqlMode=true&query=nid%3D118538489');
  await Promise.all([userA.waitForNavigation(), section.locator('button:has-text("Add")').click()]);
  await expect(userA).toHaveURL(/done=id-added/);
  await expect(section.locator('a[href="https://d-nb.info/gnd/118538489"]')).toHaveText('118538489 ↗');   // the number from the link

  // the same number on another entry: refused, naming the entry it belongs to
  await userA.goto('/artists/vincent-van-gogh');
  await userA.locator('#reference-records summary:has-text("+ Add a reference record")').click();
  await userA.locator('#reference-records select[name=authority]').selectOption('gnd');
  await userA.locator('#reference-records input[name=value]').fill('118538489');
  await Promise.all([userA.waitForNavigation(), userA.locator('#reference-records button:has-text("Add")').click()]);
  await expect(userA.locator('.flash.error')).toContainText('is already the number of “Paul Gauguin”');
  // not a ULAN number: refused
  await userA.goto('/artists/vincent-van-gogh');
  await userA.locator('#reference-records summary:has-text("+ Add a reference record")').click();
  await userA.locator('#reference-records select[name=authority]').selectOption('ulan');
  await userA.locator('#reference-records input[name=value]').fill('12345');
  await Promise.all([userA.waitForNavigation(), userA.locator('#reference-records button:has-text("Add")').click()]);
  await expect(userA.locator('.flash.error')).toContainText('12345 is not a Getty ULAN number');

  const g = await api(request, '/artists/paul-gauguin');
  expect(g.identifiers).toEqual([{ authority: 'gnd', name: 'GND (Deutsche Nationalbibliothek)', value: '118538489', url: 'https://d-nb.info/gnd/118538489' }]);
  sql("DELETE FROM entry_identifiers");
});

test('Wikidata brings the numbers; the GND comparison: agreeing values cited, others taken and cited, relationships found by name', async ({ userA }) => {
  sql(`DELETE FROM entry_identifiers; DELETE FROM artists WHERE slug IN ('claude-monet-gnd', 'claude-monet');
       INSERT INTO artists (slug, name, wikidata_id, birth, birth_label) VALUES ('claude-monet-gnd', 'Claude Monet', 'Q100', '[1840-11-14,1840-11-15)', '14 November 1840')`);
  await userA.goto('/artists/claude-monet-gnd/wikidata');
  const ids = userA.locator('.wd-ids');
  await expect(ids).toContainText('GND (Deutsche Nationalbibliothek)');
  await expect(ids.locator('input[name="idf.gnd"]')).toBeChecked();          // we have none: pre-ticked
  await expect(ids.locator('input[name="idf.ulan"]')).toBeChecked();
  await userA.uncheck('input[name="take.death"][value=take]').catch(() => {});
  await userA.locator('.wd-table tbody tr', { hasText: 'Death' }).first().locator('input[value=keep], input[value=later]').first().check();
  await apply(userA);
  expect(sql(`SELECT string_agg(authority || ' ' || value, ', ' ORDER BY authority) FROM entry_identifiers WHERE entity_type = 'artist'
              AND entity_id = entity_id('artist', 'claude-monet-gnd')`)).toBe('gnd 118583123, ulan 500018666');
  sql("DELETE FROM live_docs WHERE entity_type = 'artist'; UPDATE artists SET death = NULL, death_label = NULL WHERE slug = 'claude-monet-gnd'");

  // the GND: birth the same → cited at once; death new → taken; Paris (ours by name) and Vincent van Gogh ("Gogh, Vincent van")
  await userA.goto('/artists/claude-monet-gnd');
  await Promise.all([userA.waitForNavigation(), userA.click('a:has-text("Compare with the GND…")')]);
  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  await expect(row('Birth')).toContainText('the same — cited');
  await expect(row('Death').locator('input[value=take]')).toBeChecked();
  await expect(row('born in')).toContainText('Paris');
  await expect(row('died in')).toContainText('not in our database');                // Giverny: not one of ours
  await row('born in').locator('input[value=add]').check();
  await row('collaborated with').locator('input[value=add]').check();
  await apply(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet-gnd\/edit\?done=gnd/);
  await expect(userA.locator('#f-death')).toHaveValue('1926-12-05');
  await submitForm(userA);                                                          // Publish
  await expect(userA).toHaveURL(/\/artists\/claude-monet-gnd\?done=published/);

  const cited = sql(`SELECT string_agg(c.field || ' ' || b.slug || ' ' || c.url || ' ' || (c.pending IS NULL), ', ' ORDER BY c.field)
    FROM citations c JOIN bibliography b ON b.id = c.source_id WHERE c.entity_type = 'artist' AND c.entity_id = entity_id('artist', 'claude-monet-gnd')`);
  expect(cited).toBe('birth gnd https://d-nb.info/gnd/118583123 true, death gnd https://d-nb.info/gnd/118583123 true');
  // (collaborated_with is symmetric: stored in one direction, either may be the subject)
  const me = "('artist', entity_id('artist', 'claude-monet-gnd'))";
  expect(sql(`SELECT string_agg(r.relationship_type || ' ' || o.slug, ', ' ORDER BY r.relationship_type) FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = CASE WHEN (r.subject_type, r.subject_id) = ${me} THEN (r.object_type, r.object_id) ELSE (r.subject_type, r.subject_id) END
    JOIN citations c ON c.relationship_id = r.id
    WHERE ((r.subject_type, r.subject_id) = ${me} OR (r.object_type, r.object_id) = ${me}) AND c.source_id = entity_id('source', 'gnd')`))
    .toBe('born_in paris, collaborated_with vincent-van-gogh');
  // Van Gogh, found by his name, now has his GND number: the next comparison finds him exactly
  expect(sql("SELECT value FROM entry_identifiers WHERE authority = 'gnd' AND entity_id = entity_id('artist', 'vincent-van-gogh') AND entity_type = 'artist'"))
    .toBe('118583174');
  // GND counts as an institution's source: these fields are no longer "only Wikidata or nothing"
  expect(sql(`SELECT coalesce(detail, '') FROM quality_issues WHERE check_id = 'weakly_sourced' AND entity_type = 'artist'
              AND entity_id = entity_id('artist', 'claude-monet-gnd')`)).toBe('');
});
