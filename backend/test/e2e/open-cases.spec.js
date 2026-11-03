// Open cases (migration 198, src/admin/routes/open-cases.js): a finding that takes longer is moved out of the Quality
// page with a description and where to look; it is followed up in the list (grouped by the source to consult), shown
// on the entry's page, closed with a result — and its finding, still there, is back on the Quality page.
const { test, expect, sql, settled, submitForm } = require('./helpers');

const cleanup = () => sql(`DELETE FROM open_cases WHERE entity_type = 'artwork' AND entity_id IN (SELECT id FROM artworks WHERE slug LIKE 'test-case-%');
  DELETE FROM artworks WHERE slug LIKE 'test-case-%'; DELETE FROM bibliography WHERE slug = 'test-case-catalogue'`);
test.beforeAll(cleanup);
test.afterAll(cleanup);

const QUALITY = '/quality?check=artwork_without_web_page&type=artwork';
const md = async (page, text) => {   // the Markdown editor of the form (CodeMirror over the textarea)
  await page.locator('.md-editor .cm-content').first().click();
  await page.keyboard.insertText(text);
};

test('a finding moved to an open case: described, grouped by where to look, closed with a result, back on Quality', async ({ userA }) => {
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-case-berck', 'Test Case Berck');
       INSERT INTO bibliography (slug, kind, name, shelfmark, archive) VALUES ('test-case-catalogue', 'book', 'Catalogue raisonné for the test', 'UZB 42 A 7', 'UZH Library')`);
  await settled();
  await userA.goto(QUALITY);
  const row = userA.locator('tr', { hasText: 'Test Case Berck' });
  await expect(row).toBeVisible();

  // moved out: the form shows the finding; a description, a source to consult and a link
  await row.locator('a.qa-case').click();
  await expect(userA.locator('.oc-form')).toContainText('Finding moved here');
  await md(userA, 'Compare the provenance with the **catalogue** at the library.');
  await userA.fill('#oc-source', 'test-case-catalogue');
  await userA.fill('#oc-url', 'https://uzb.swisscovery.ch/permalink/41SLSP_UZB/g8duei/alma990097582650205508');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/quality\?check=artwork_without_web_page&type=artwork&done=case-opened/);
  await expect(userA.locator('tr', { hasText: 'Test Case Berck' })).toHaveCount(0);           // parked: not on Quality
  await expect(userA.locator('.qa-open-cases')).toContainText('open case');

  // the list: under the source with its shelfmark; the description rendered
  await userA.goto('/open-cases');
  const group = userA.locator('.oc-group', { hasText: 'Catalogue raisonné for the test' });
  await expect(group.locator('h2')).toContainText('UZH Library, UZB 42 A 7');
  const item = group.locator('.oc-case', { hasText: 'Test Case Berck' });
  await expect(item.locator('.oc-text strong')).toHaveText('catalogue');
  await expect(item.locator('a[href^="https://uzb.swisscovery.ch/"]')).toBeVisible();
  await expect(item.locator('.oc-check')).toHaveText('Artwork without a web page');          // the parked finding's check

  // on the entry's page
  await userA.goto('/artworks/test-case-berck');
  await expect(userA.locator('.oc-box .oc-case')).toContainText('Compare the provenance');

  // edited: the description changes, the link stays
  await userA.goto('/open-cases');
  await userA.locator('.oc-case', { hasText: 'Test Case Berck' }).locator('a:has-text("Edit")').click();
  await expect(userA.locator('#oc-source')).toHaveValue('test-case-catalogue');
  await md(userA, ' Vol. 2.');
  await submitForm(userA);
  await expect(userA.locator('.oc-case', { hasText: 'Test Case Berck' })).toContainText('Vol. 2.');

  // closed with a result: the finding (still true) is back on Quality; the case under "Closed"
  const open = userA.locator('.oc-group .oc-case', { hasText: 'Test Case Berck' });
  await open.locator('.oc-close summary').click();
  await open.locator('.md-editor .cm-content').click();                                    // the result's Markdown editor
  await userA.keyboard.insertText('Checked: the catalogue gives no web page either.');
  await open.locator('button:has-text("Close the case")').click();
  await expect(userA).toHaveURL(/done=case-closed/);
  await expect(userA.locator('.oc-group .oc-case', { hasText: 'Test Case Berck' })).toHaveCount(0);
  await userA.locator('.oc-closed summary').click();
  await expect(userA.locator('.oc-closed .oc-case', { hasText: 'Test Case Berck' })).toContainText('Checked: the catalogue gives no web page either.');
  await userA.goto(QUALITY);
  await expect(userA.locator('tr', { hasText: 'Test Case Berck' })).toBeVisible();

  // reopened: parked again
  await userA.goto('/open-cases');
  await userA.locator('.oc-closed summary').click();
  await userA.locator('.oc-closed .oc-case', { hasText: 'Test Case Berck' }).locator('button:has-text("reopen")').click();
  await expect(userA.locator('.oc-group .oc-case', { hasText: 'Test Case Berck' })).toBeVisible();
  await userA.goto(QUALITY);
  await expect(userA.locator('tr', { hasText: 'Test Case Berck' })).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM audit_log WHERE table_name = 'open_cases'
              AND (coalesce(new_row, old_row)->>'entity_id')::bigint = entity_id('artwork', 'test-case-berck')`)).not.toBe('0');
});

test('a case opened from an entry, without a finding; a wrong source is refused', async ({ userA }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-case-plain', 'Test Case Plain')");
  await userA.goto('/artworks/test-case-plain');
  await userA.locator('.oc-box a:has-text("Open a case")').click();
  await expect(userA.locator('.oc-form')).not.toContainText('Finding moved here');
  await md(userA, 'Ask the museum about the date.');
  await userA.fill('#oc-source', 'no-such-source');
  await submitForm(userA);
  await expect(userA.locator('.flash')).toContainText('no source “no-such-source”');
  await userA.fill('#oc-source', '');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-case-plain\?done=case-opened/);
  await expect(userA.locator('.oc-box .oc-case')).toContainText('Ask the museum about the date.');
  await userA.goto('/open-cases');
  await expect(userA.locator('.oc-group', { hasText: 'No place given' })).toContainText('Test Case Plain');
});
