// Japan Search on the Enrich page of an artwork with a Japanese title (src/admin/japansearch.js): the impressions in
// Japanese collections listed, the reading offered as furigana for our title.
const { test, expect, sql, submitForm } = require('./helpers');

// its names as the fixtures have them — put back afterwards
let before = null;
const restore = () => {
  if (before !== null) sql(`UPDATE artworks SET names = '${before.replace(/'/g, "''")}' WHERE slug = 'plum-park-in-kameido'`);
  sql("DELETE FROM live_docs WHERE entity_type = 'artwork'");
};
test.afterAll(restore);

test('Japan Search: other impressions listed; the reading added to our Japanese title', async ({ userA }) => {
  before = sql("SELECT names FROM artworks WHERE slug = 'plum-park-in-kameido'");
  sql(`UPDATE artworks SET names = '[{"text": "名所江戸百景 亀戸梅屋舗", "lang": "ja", "role": "original"}]' WHERE slug = 'plum-park-in-kameido'`);
  await userA.goto('/artworks/plum-park-in-kameido/enrich');
  const rows = userA.locator('.jp-records tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Tokyo National Museum');
  const reading = userA.locator('input[name="jp:reading"]');
  await expect(reading).toBeChecked();
  await expect(userA.locator('label:has(input[name="jp:reading"])')).toContainText('{名所江戸百景|めいしょえどひゃっけい} {亀戸梅屋舗|かめいどうめやしき}');
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/plum-park-in-kameido\/edit\?done=enrich/);
  await expect(userA.locator('#f-names')).toHaveValue(/\{名所江戸百景\|めいしょえどひゃっけい\} \{亀戸梅屋舗\|かめいどうめやしき\} \| ja \| original/);
  await submitForm(userA);
  expect(sql("SELECT names -> 0 ->> 'text' FROM artworks WHERE slug = 'plum-park-in-kameido'")).toBe('{名所江戸百景|めいしょえどひゃっけい} {亀戸梅屋舗|かめいどうめやしき}');
});
