// Sources for facts (migration 049, src/admin/citations.js): Wikidata cites itself, sources are added at the value,
// a changed value shows its citations as outdated, the quality page lists what has no good source.
const { test, expect, sql, submitForm } = require('./helpers');

const apply = (page) => Promise.all([page.waitForNavigation(), page.click('.wd-form .sticky-actions button')]);
const row = (page, text) => page.locator('.wd-table tbody tr', { hasText: text }).first();
const cites = (type, slug) => sql(`SELECT string_agg(field || ':' || coalesce(wikidata_item, 'src') || ':' || (pending IS NOT NULL)::text, ' ' ORDER BY field)
  FROM citations WHERE entity_type = '${type}' AND entity_id = entity_id('${type}', '${slug}')`);

test.afterAll(() => {
  sql(`DELETE FROM artists WHERE slug IN ('claude-monet-cite', 'claude-monet');
       DELETE FROM citations WHERE source_id = entity_id('source', 'van-gogh-museum-website-test');
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
  await expect(userA.locator('dt:has-text("Death") + dd summary .cite-badge.cite-none')).toHaveText('+');
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'weakly_sourced' AND entity_type = 'artist' AND entity_id = entity_id('artist', 'claude-monet')`))
    .toBe('no source: death · only Wikidata / databases: birth');

  // the museum's website as a source for the death date: an institution (M); the field is then well sourced
  sql(`INSERT INTO bibliography (slug, kind, name, url) VALUES ('van-gogh-museum-website-test', 'web', 'Van Gogh Museum: Collection', 'https://www.vangoghmuseum.nl/')`);
  await userA.locator('dt:has-text("Death") + dd details.cite > summary').click();
  const form = userA.locator('dt:has-text("Death") + dd .cite-add');
  await form.locator('input[name=source]').fill('van-gogh-museum-website-test');
  await form.locator('.cite-more summary').click();
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

test('values Wikidata agrees with are cited when comparing — nothing to take, but now with a source', async ({ userA }) => {
  sql(`DELETE FROM artists WHERE slug IN ('claude-monet', 'claude-monet-cite');
       INSERT INTO artists (slug, name, wikidata_id, birth, birth_label) VALUES ('claude-monet-cite', 'Claude Monet', 'Q100', '[1840-11-14,1840-11-15)', '14 November 1840')`);
  await userA.goto('/artists/claude-monet-cite/wikidata');
  await apply(userA);
  // birth: the same as ours → cited and settled at once; death (empty here, taken) waits for Publish
  expect(cites('artist', 'claude-monet-cite')).toBe('birth:Q100:false death:Q100:true');
  sql("DELETE FROM live_docs WHERE entity_type = 'artist'");
});

test('free-text sources are citations (T); the API gives every fact its sources, with the full reference', async ({ userA, request }) => {
  const api = async (path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();
  // the "Sources" box of a relationship: lines → free-text citations
  const relId = sql(`SELECT r.id FROM relationships r WHERE r.subject_type = 'artist' AND r.subject_id = entity_id('artist', 'vincent-van-gogh')
                     AND r.relationship_type = 'lived_in' ORDER BY r.id LIMIT 1`);
  await userA.goto(`/relationships/${relId}/edit`);
  await userA.fill('#r-src', 'Letter 577\nNaifeh/Smith 2011');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form button:has-text("Save")')]);
  expect(sql(`SELECT string_agg(text, ' | ' ORDER BY id) FROM citations WHERE relationship_id = ${relId}`)).toBe('Letter 577 | Naifeh/Smith 2011');
  await userA.goto(`/relationships/${relId}/edit`);
  await expect(userA.locator('#r-src')).toHaveValue('Letter 577\nNaifeh/Smith 2011');
  await userA.fill('#r-src', 'Letter 577');                               // a line removed: its citation goes
  await Promise.all([userA.waitForNavigation(), userA.click('form.form button:has-text("Save")')]);
  expect(sql(`SELECT string_agg(text, ' | ') FROM citations WHERE relationship_id = ${relId}`)).toBe('Letter 577');

  // a bibliography source with the exact page, for a field
  sql(`INSERT INTO bibliography (slug, kind, name, siglum, url) VALUES ('van-gogh-museum-website-test', 'web', 'Collection', 'Van Gogh Museum, Collection', 'https://www.vangoghmuseum.nl/')
         ON CONFLICT (slug) DO UPDATE SET siglum = EXCLUDED.siglum;
       INSERT INTO citations (entity_type, entity_id, field, source_id, url, accessed, cited_value)
       SELECT 'artist', a.id, 'birth', entity_id('source', 'van-gogh-museum-website-test'), 'https://www.vangoghmuseum.nl/en/about/knowledge-and-research',
              '2026-10-08', field_value(to_jsonb(a), '{birth,birth_label}') FROM artists a WHERE a.slug = 'vincent-van-gogh'`);
  const v = await api('/artists/vincent-van-gogh');
  expect(v.sources.birth).toEqual([{ kind: 'source', reliability: 'institution', text: 'Van Gogh Museum, Collection',
    source: { slug: 'van-gogh-museum-website-test', siglum: 'Van Gogh Museum, Collection' }, locator: null,
    url: 'https://www.vangoghmuseum.nl/en/about/knowledge-and-research', accessed: '2026-10-08', note: null, outdated: false }]);
  expect(v.bibliography['van-gogh-museum-website-test'].citation).toContain('Collection');
  const lived = v.relationships.find((r) => r.type === 'lived_in' && r.sources.length);
  expect(lived.sources).toEqual([{ kind: 'text', reliability: null, text: 'Letter 577', locator: null, url: null, accessed: null, note: null, outdated: false }]);
  sql(`DELETE FROM citations WHERE relationship_id = ${relId} OR source_id = entity_id('source', 'van-gogh-museum-website-test')`);
});

test('paste a link: the website becomes a source (once), the page and today are recorded; the dialog is not cut off', async ({ userA }) => {
  sql("DELETE FROM bibliography WHERE slug = 'collection-test-museum'");
  await userA.goto('/artists/vincent-van-gogh');
  const birth = userA.locator('dt:has-text("Birth") + dd');
  await birth.locator('details.cite > summary').click();
  const dialog = birth.locator('.cite-panel');
  await expect(dialog).toBeInViewport({ ratio: 1 });                         // fixed in the middle, whole
  await expect(dialog).toContainText('Sources of “Birth”');
  await dialog.locator('input[name=url]').fill('https://www.test-museum.org/collection/item/1');
  await dialog.locator('.cite-more summary').click();
  await dialog.locator('input[name=site]').fill('Collection Test Museum');
  await Promise.all([userA.waitForNavigation(), dialog.locator('button:has-text("Add source")').click()]);
  await expect(userA).toHaveURL(/done=cite-added/);
  expect(sql(`SELECT kind || ' ' || reliability || ' ' || url FROM bibliography WHERE slug = 'collection-test-museum'`))
    .toBe('web institution https://www.test-museum.org/');
  expect(sql(`SELECT url || ' ' || (accessed = current_date) FROM citations WHERE source_id = entity_id('source', 'collection-test-museum')`))
    .toBe('https://www.test-museum.org/collection/item/1 true');
  await expect(birth.locator('details.cite > summary .cite-badge.cite-institution')).toHaveText('M');

  // another page of the same site (without www): the same source, no second one
  const death = userA.locator('dt:has-text("Death") + dd');
  await death.locator('details.cite > summary').click();
  await death.locator('.cite-panel input[name=url]').fill('https://test-museum.org/collection/item/2');
  await Promise.all([userA.waitForNavigation(), death.locator('.cite-panel button:has-text("Add source")').click()]);
  expect(sql(`SELECT count(*) FROM bibliography WHERE url LIKE '%test-museum.org%'`)).toBe('1');
  expect(sql(`SELECT count(*) FROM citations WHERE source_id = entity_id('source', 'collection-test-museum')`)).toBe('2');

  // in the relationships table too: whole and on top
  const rel = userA.locator('#relationships + .table-wrap details.cite').first();
  await rel.locator(':scope > summary').click();
  await expect(rel.locator('.cite-panel')).toBeInViewport({ ratio: 1 });
  await userA.keyboard.press('Escape');
  await expect(rel.locator('.cite-panel')).toBeHidden();
  sql(`DELETE FROM citations WHERE source_id = entity_id('source', 'collection-test-museum'); DELETE FROM bibliography WHERE slug = 'collection-test-museum'`);
});
