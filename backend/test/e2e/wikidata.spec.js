// Wikidata: nothing without review, own values first, remembered decisions, relationship suggestions, new entries.
// Runs against the fixture server (wikidata-fixtures.js): Q100 "Claude Monet", Q104 "Impression, Sunrise" …
const { test, expect, sql, submitForm } = require('./helpers');

const apply = (page) => Promise.all([page.waitForNavigation(), page.click('.wd-form .sticky-actions button')]);
const row = (page, text) => page.locator('.wd-table tbody tr', { hasText: text }).first();

test('a new artist from Wikidata: search, review (empty fields pre-ticked), then the form is prefilled', async ({ userA }) => {
  await userA.goto('/artists/new/wikidata?search=monet');
  await Promise.all([userA.waitForNavigation(), userA.click('.search-hit a:has-text("Claude Monet")')]);
  await expect(row(userA, 'Birth').locator('input[value=take]')).toBeChecked();  // empty field: pre-selected
  await expect(userA.locator('input[name="alt.alt_names"][value="Oscar-Claude Monet"]')).not.toBeChecked();  // names: opt-in
  await userA.check('input[name="alt.alt_names"][value="Oscar-Claude Monet"]');
  await apply(userA);
  await expect(userA).toHaveURL(/\/artists\/new\?draft=1$/);
  await expect(userA.locator('#f-name')).toHaveValue('Claude Monet');
  await expect(userA.locator('#f-birth')).toHaveValue('1840-11-14');
  await expect(userA.locator('#f-wikidata_id')).toHaveValue('Q100');
  await expect(userA.locator('#f-metadata')).toHaveValue(/Wikidata Q100 \(retrieved/);
  await expect(userA.locator('#f-alt_names')).toHaveValue('Oscar-Claude Monet');  // only the ticked name
  await expect(userA.locator('#f-image_license')).toHaveValue('Public domain');      // the portrait from Commons (P18)
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/claude-monet\?done=created/);
});

test('relationship suggestions: link by name, create a missing place, skip — and it is remembered', async ({ userA }) => {
  await userA.goto('/artists/claude-monet/wikidata');  // has Q100 now: goes straight to the comparison
  // Nothing is decided for you: every suggestion starts at "decide later".
  await expect(row(userA, 'born in').locator('input[value=later]')).toBeChecked();
  await expect(row(userA, 'Giverny').locator('input[value=later]')).toBeChecked();
  await userA.click('[data-wd-set=link]');                                               // quick action: link existing
  await expect(row(userA, 'born in').locator('input[value=link]')).toBeChecked();       // our Paris, same name
  await expect(row(userA, 'Giverny').locator('input[value=later]')).toBeChecked();      // no entry of ours: unchanged
  await row(userA, 'Giverny').locator('input[value=create]').check();
  await row(userA, 'Charles Gleyre').locator('input[value=skip]').check();              // an explicit, remembered skip
  await apply(userA);
  await expect(userA.locator('.flash.ok')).toContainText('created');
  expect(sql("SELECT wikidata_id || ' ' || ST_AsText(location) FROM places WHERE slug = 'giverny'")).toBe('Q101 POINT(1.5339 49.0758)');
  expect(sql("SELECT wikidata_id FROM places WHERE slug = 'paris'")).toBe('Q90');  // linked by name → gets the Q-id
  // (Impressionism may exist already, depending on which specs ran before — then it is linked too.)
  const rels = sql(`SELECT string_agg(relationship_type, ',') FROM relationships
                    WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'claude-monet')`).split(',');
  expect(rels).toEqual(expect.arrayContaining(['born_in', 'died_in', 'worked_in']));
  expect(rels).not.toContain('student_of');  // Gleyre was skipped
  expect(sql("SELECT source FROM audit_log WHERE table_name = 'places' ORDER BY id DESC LIMIT 1")).toBe('wikidata');

  await userA.goto('/artists/claude-monet/wikidata');
  await expect(row(userA, 'born in')).toContainText('already there');
  await userA.click('details summary:has-text("skipped before")');
  await expect(userA.locator('details', { hasText: 'skipped before' })).toContainText('Charles Gleyre');  // remembered
});

test('own values win: never pre-selected; "decide later" records nothing, "keep mine" is remembered', async ({ userA }) => {
  sql("UPDATE artists SET death = '[1926-12-01,1927-01-01)', death_label = 'December 1926' WHERE slug = 'claude-monet'");  // ours
  await userA.goto('/artists/claude-monet/wikidata');
  await expect(row(userA, 'Death').locator('input[value=later]')).toBeChecked();
  await apply(userA);  // left at "decide later"
  expect(sql("SELECT count(*) FROM wikidata_reviews WHERE item = 'death'")).toBe('0');
  await userA.goto('/artists/claude-monet/wikidata');
  await expect(row(userA, 'Death')).not.toContainText('you kept yours');
  await row(userA, 'Death').locator('input[value=keep]').check();  // an explicit check of our own value
  await apply(userA);
  await expect.poll(() => sql("SELECT death_label FROM artists WHERE slug = 'claude-monet'")).toBe('December 1926');
  await userA.goto('/artists/claude-monet/wikidata');
  await expect(row(userA, 'Death')).toContainText('you kept yours');
  await expect(row(userA, 'Death').locator('input[value=keep]')).toBeChecked();
});

test('an artwork: creator and collection by name or new, Commons image with license', async ({ userA }) => {
  await userA.goto('/artworks/new/wikidata?q=Q104');
  await expect(row(userA, 'Creator').locator('input[value=link]')).toBeChecked();  // our Claude Monet (by Q-id)
  await expect(row(userA, 'Institution').locator('input[value=create]')).toBeVisible();
  await expect(userA.locator('.wd-image')).toContainText('Public domain');
  await expect(userA.locator('input[name=image][value=take]')).toBeChecked();  // no image yet: pre-selected
  await row(userA, 'Institution').locator('input[value=create]').check();
  await expect(row(userA, 'Dimensions')).toContainText('48 × 63 cm');               // 630 mm converted
  await expect(row(userA, 'Inventory number')).toContainText('4014 — in the collection of Musée Marmottan Monet');
  await userA.check('input[name="alt.materials"][value="canvas"]');                   // materials: opt-in like names
  await apply(userA);
  await expect(userA.locator('input[name="f.dimensions_h"]')).toHaveValue('48');
  await expect(userA.locator('input[name="f.dimensions_w"]')).toHaveValue('63');
  await expect(userA.locator('#f-materials')).toHaveValue('canvas');
  await expect(userA.locator('#f-creator')).toHaveValue('claude-monet');
  await expect(userA.locator('#f-institution')).toHaveValue(/^musee-marmottan-monet/);
  await expect(userA.locator('#f-image_license')).toHaveValue('Public domain');
  await expect(userA.locator('#f-image_credit')).toHaveValue('Claude Monet');
  expect(sql("SELECT wikidata_id FROM institutions WHERE slug LIKE 'musee-marmottan-monet%'")).toBe('Q105');
});
