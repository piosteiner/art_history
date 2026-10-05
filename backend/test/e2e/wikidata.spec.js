// Wikidata: nothing without review, own values first, remembered decisions, relationship suggestions, new entries.
// Runs against the fixture server (wikidata-fixtures.js): Q100 "Claude Monet", Q104 "Impression, Sunrise" …
const { test, expect, sql, submitForm } = require('./helpers');

const apply = (page) => Promise.all([page.waitForNavigation(), page.click('.wd-form .sticky-actions button')]);
const row = (page, text) => page.locator('.wd-table tbody tr', { hasText: text }).first();

test('a new artist from Wikidata: search, review (empty fields pre-ticked), then the form is prefilled', async ({ userA }) => {
  await userA.goto('/artists/new/wikidata?search=monet');
  await Promise.all([userA.waitForNavigation(), userA.click('.search-hit a:has-text("Claude Monet")')]);
  await expect(row(userA, 'Birth').locator('input[value=take]')).toBeChecked();  // empty field: pre-selected
  await expect(userA.locator('input[name="alt.names"][value="Oscar-Claude Monet"]')).not.toBeChecked();  // names: opt-in
  await expect(userA.locator('main')).toContainText('1 image on Commons — create the entry first');  // images: rows, added later
  await expect(userA.locator('input[name="alt.names"][value="クロード・モネ | ja | translation"]')).toBeVisible();  // labels: with language
  await userA.check('input[name="alt.names"][value="Oscar-Claude Monet"]');
  await apply(userA);
  await expect(userA).toHaveURL(/\/artists\/new\?draft=1$/);
  await expect(userA.locator('#f-name')).toHaveValue('Claude Monet');
  await expect(userA.locator('#f-birth')).toHaveValue('1840-11-14');
  await expect(userA.locator('#f-wikidata_id')).toHaveValue('Q100');
  await expect(userA.locator('#f-metadata')).toHaveValue(/Wikidata Q100 \(retrieved/);
  await expect(userA.locator('#f-names')).toHaveValue('Oscar-Claude Monet');  // only the ticked name
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
  await expect(userA.locator('input[name="img.0"][value=add]')).toBeChecked();          // no image yet: the portrait is pre-selected
  await apply(userA);
  expect(sql("SELECT license || ' / ' || credit FROM images WHERE artist_id = entity_id('artist', 'claude-monet')")).toBe('Public domain / Claude Monet');
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
  await expect(userA.locator('.wd-image')).toContainText('Already one of ours');
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

test('an artwork: creator and collection by name or new; then its Commons images one by one', async ({ userA, request }) => {
  await userA.goto('/artworks/new/wikidata?q=Q104');
  await expect(row(userA, 'Creator').locator('input[value=link]')).toBeChecked();  // our Claude Monet (by Q-id)
  await expect(row(userA, 'Institution').locator('input[value=create]')).toBeVisible();
  await expect(userA.locator('main')).toContainText('2 images on Commons — create the entry first');
  await row(userA, 'Institution').locator('input[value=create]').check();
  await expect(row(userA, 'Dimensions')).toContainText('48 × 63 cm');               // 630 mm converted
  await expect(row(userA, 'Inventory number')).toContainText('4014 — in the collection of Musée Marmottan Monet');
  await userA.check('input[name="alt.materials"][value="canvas"]');                   // materials: opt-in like names
  // the original-language title (P1476) is the title; the English label is offered as a translation
  await expect(row(userA, 'Title')).toContainText('Impression, soleil levant');
  await userA.check('input[name="alt.names"][value="Impression, Sunrise | en | translation"]');
  await apply(userA);
  await expect(userA.locator('input[name="f.dimensions_h"]')).toHaveValue('48');
  await expect(userA.locator('input[name="f.dimensions_w"]')).toHaveValue('63');
  await expect(userA.locator('#f-materials')).toHaveValue('canvas');
  await expect(userA.locator('#f-title')).toHaveValue('Impression, soleil levant');
  await expect(userA.locator('input[name="f.title_lang"]')).toHaveValue('fr');
  await expect(userA.locator('#f-names')).toHaveValue('Impression, Sunrise | en | translation');
  await expect(userA.locator('#f-creator')).toHaveValue('claude-monet');
  await expect(userA.locator('#f-institution')).toHaveValue(/^musee-marmottan-monet/);
  expect(sql("SELECT wikidata_id FROM institutions WHERE slug LIKE 'musee-marmottan-monet%'")).toBe('Q105');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/impression-sunrise\?done=created/);

  // Now the images: each one offered on its own — the first pre-selected (no image yet), the other up to you.
  await userA.goto('/artworks/impression-sunrise/wikidata');
  await expect(userA.locator('.wd-image')).toHaveCount(2);
  await expect(userA.locator('input[name="img.0"][value=add]')).toBeChecked();
  await expect(userA.locator('input[name="img.1"][value=later]')).toBeChecked();
  await userA.check('input[name="img.1"][value=add]');
  await apply(userA);
  await expect(userA.locator('.flash.ok')).toContainText('2 images added');
  const api = await (await request.get('http://127.0.0.1:3006/v1/artworks/impression-sunrise', { headers: { Host: 'api.localhost' } })).json();
  expect(api.images.map((i) => i.url)).toEqual(['https://upload.wikimedia.org/test/Monet_-_Impression%2C_Sunrise.jpg',
    'https://upload.wikimedia.org/test/Impression_Sunrise_back.jpg']);  // Wikidata's order; the first is the main image
  expect(api.image_url).toBe(api.images[0].url);
  await userA.goto('/artworks/impression-sunrise/wikidata');
  await expect(userA.locator('.wd-image', { hasText: 'Already one of ours' })).toHaveCount(2);
});

test('nationality from Wikidata (P27): the polity is created on request, with its ISO code', async ({ userA }) => {
  await userA.goto('/artists/claude-monet/wikidata');
  await expect(row(userA, 'nationality').locator('input[value=later]')).toBeChecked();
  await row(userA, 'nationality').locator('input[value=create]').check();
  await apply(userA);
  expect(sql("SELECT name || ' ' || array_to_string(country_codes, ',') || ' ' || wikidata_id || ' ' || lower(period)::text FROM polities WHERE slug = 'france'"))
    .toBe('France FR Q108 1792-09-21');
  expect(sql(`SELECT count(*) FROM relationships WHERE relationship_type = 'nationality'
              AND subject_id = entity_id('artist', 'claude-monet') AND object_id = entity_id('polity', 'france')`)).toBe('1');
});

test('a Japanese original title stays among the other names; the English label is the title', async ({ userA }) => {
  await userA.goto('/artworks/new/wikidata?q=Q109');
  await expect(row(userA, 'Title')).toContainText('The Great Wave');
  await expect(userA.locator('input[name="alt.names"][value="神奈川沖浪裏 | ja | original"]')).toBeVisible();
  await expect(userA.locator('input[name="alt.names"][value="Kanagawa-oki nami ura | ja-Latn | romanization"]')).toBeVisible();
});
