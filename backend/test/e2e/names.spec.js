// Names in several languages (migration 022): furigana with "Add reading", language tags, other names with roles,
// sorting and search by romanization, the slug from the romanization, the public API.
const { test, expect, sql } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a Japanese title: furigana by "Add reading", language, romanization and translation as rows', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  const title = userA.locator('#f-title');
  await title.fill('神奈川沖浪裏');
  await userA.fill('input[name="f.title_lang"]', 'JA');
  // furigana: select 神奈川, press the button, type the reading
  await title.evaluate((el) => el.setSelectionRange(0, 3));
  userA.once('dialog', (d) => d.accept('かながわ'));
  await userA.click('.name-field .add-reading');
  await expect(title).toHaveValue('{神奈川|かながわ}沖浪裏');
  await expect(userA.locator('.name-field .ruby-preview rt')).toHaveText('かながわ');
  await userA.click('.name-field .add-reading');                      // nothing selected
  await expect(userA.locator('.name-field .reading-note')).toHaveText('Select the kanji first.');

  // other names as rows; the slug follows the romanization (the title has no Latin letters)
  const rows = userA.locator('.names-row');
  await rows.nth(0).locator('.n-text').fill('Kanagawa-oki nami ura');
  await rows.nth(0).locator('.n-lang').fill('ja-Latn');
  await rows.nth(0).locator('.n-role').selectOption('romanization');
  await expect(userA.locator('#f-slug')).toHaveValue('kanagawa-oki-nami-ura');
  await userA.click('text=+ Add a name');
  await rows.nth(1).locator('.n-text').fill('Under the Wave off Kanagawa');
  await rows.nth(1).locator('.n-lang').fill('en');
  await rows.nth(1).locator('.n-role').selectOption('translation');
  await expect(userA.locator('#f-names')).toHaveValue('Kanagawa-oki nami ura | ja-Latn | romanization\nUnder the Wave off Kanagawa | en | translation');
  await userA.fill('#f-slug', 'test-kanagawa');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-kanagawa\?done=created/);

  await expect(userA.locator('h1')).toHaveText('神奈川沖浪裏');                 // plain in headings and lists
  await expect(userA.locator('.main-name rt')).toHaveText('かながわ');
  await expect(userA.locator('.main-name')).toHaveAttribute('lang', 'ja');
  await expect(userA.locator('.names-list')).toContainText('Under the Wave off Kanagawa');
  expect(sql("SELECT title || ' ' || title_ruby || ' ' || title_lang FROM artworks WHERE slug = 'test-kanagawa'"))
    .toBe('神奈川沖浪裏 {神奈川|かながわ}沖浪裏 ja');

  const w = await api(request, '/artworks/test-kanagawa');
  expect(w.title).toBe('神奈川沖浪裏');
  expect(w.title_ruby_html).toBe('<ruby>神奈川<rp>(</rp><rt>かながわ</rt><rp>)</rp></ruby>沖浪裏');
  expect(w.title_reading).toBe('かながわ沖浪裏');
  expect(w.sort_key).toBe('Kanagawa-oki nami ura');
  expect(w.alt_titles).toEqual(['Kanagawa-oki nami ura', 'Under the Wave off Kanagawa']);  // as before, plain
  expect(w.names[1]).toEqual({ text: 'Under the Wave off Kanagawa', lang: 'en', role: 'translation', ruby_html: null, reading: null });
  expect((await api(request, '/artworks?q=kanagawa oki')).data.map((x) => x.slug)).toContain('test-kanagawa');
  expect((await api(request, '/search?q=under the wave')).data.map((x) => x.slug)).toContain('test-kanagawa');

  // admin list: sorted by the romanization, shown under the title; search finds the translation
  await userA.goto('/artworks?q=under+the+wave');
  await expect(userA.locator('tr', { hasText: '神奈川沖浪裏' })).toContainText('Kanagawa-oki nami ura');
  await userA.goto('/quality?check=missing_romanization');
  await expect(userA.locator('main')).not.toContainText('神奈川沖浪裏');       // has one
  sql("DELETE FROM artworks WHERE slug = 'test-kanagawa'");
});

test('names are checked: furigana braces and language codes', async ({ userA }) => {
  await userA.goto('/places/edo/edit');
  await userA.fill('#f-name', '{江戸');
  await userA.locator('.names-row .n-lang').first().fill('english');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('furigana must be written as {kanji|reading}');
  await expect(userA.locator('.errors')).toContainText('"english" is not a language code');
  expect(sql("SELECT name FROM places WHERE slug = 'edo'")).toBe('Edo');  // nothing saved
  await userA.goto('/places/edo/discard-changes');                        // reset the shared working copy
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
});
