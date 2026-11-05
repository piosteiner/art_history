// Event names are written like English titles (migration 231, owner 2026-11-05): a lowercase major word is a Quality
// warning; small words, particles of other languages, suffixes after a hyphen and non-English names are not.
const { test, expect, sql } = require('./helpers');

const cleanup = () => sql("DELETE FROM events WHERE slug LIKE 'test-title-%'");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('an event name not written like a title is listed on the Quality page', async ({ userA }) => {
  sql(`INSERT INTO events (slug, name, name_lang, names) VALUES
         ('test-title-wrong', 'surrender of Testland', NULL, '[{"text": "the testing of Testland"}]'),
         ('test-title-right', 'Appointment of Testo no Testmaro as Shōgun against the Test-ji', NULL, '[]'),
         ('test-title-german', 'Testbrand im Testbunker', 'de', '[]');
       SELECT refresh_quality();`);
  expect(sql("SELECT title_case_slip('Closing of Japan (sakoku)')")).toBe('(sakoku)');
  await userA.goto('/quality?check=event_name_not_title_case');
  const main = userA.locator('main');
  await expect(main).toContainText('Event name not written like a title');
  await expect(main).toContainText('“surrender” should be capitalised');
  await expect(main).toContainText('“the testing of Testland”: “the” should be capitalised');   // an other name too; the first word always
  await expect(main).not.toContainText('Testo no Testmaro');
  await expect(main).not.toContainText('Testbrand');

  sql(`UPDATE events SET name = 'Surrender of Testland', names = '[{"text": "The Testing of Testland"}]' WHERE slug = 'test-title-wrong'; SELECT refresh_quality();`);
  await userA.goto('/quality?check=event_name_not_title_case');
  await expect(main).not.toContainText('Testland');
});
