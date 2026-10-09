// Translations of titles and names: official, common or own (migration 052).
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => {
  sql(`UPDATE artworks SET title_status = NULL, names = '[]', current_institution_id = NULL WHERE slug = 'the-great-wave-off-kanagawa';
       DELETE FROM live_docs WHERE entity_type = 'artwork'`);
});

test('the title as an official translation with its source; other names with their standing; the quality hint', async ({ userA, request }) => {
  sql(`UPDATE artworks SET names = '[]', title_status = NULL, current_institution_id = entity_id('institution', 'metropolitan-museum-of-art')
       WHERE slug = 'the-great-wave-off-kanagawa'`);
  await userA.goto('/artworks/the-great-wave-off-kanagawa/edit');
  await userA.selectOption('#f-title_status', 'common');
  const rows = userA.locator('#sec-names .names-row');
  await rows.nth(0).locator('.n-text').fill('神奈川沖浪裏');
  await rows.nth(0).locator('.n-lang').fill('ja');
  await rows.nth(0).locator('.n-role').selectOption('original');
  await expect(rows.nth(0).locator('.n-status')).toBeHidden();                 // only a translation has a standing
  await userA.click('#sec-names button:has-text("+ Add a name")');
  await rows.nth(1).locator('.n-text').fill('Unter der Welle');
  await rows.nth(1).locator('.n-lang').fill('de');
  await rows.nth(1).locator('.n-role').selectOption('translation');
  await rows.nth(1).locator('.n-status').selectOption('own');
  await expect(userA.locator('#f-names')).toHaveValue('神奈川沖浪裏 | ja | original\nUnter der Welle | de | translation, own');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/the-great-wave-off-kanagawa\?done=/);
  await expect(userA.locator('dl.fields')).toContainText('common translation');
  await expect(userA.locator('dl.fields .names-list')).toContainText('own translation');

  // held by an institution, the title only a common translation: worth looking up the institution's
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'title_translation' AND entity_type = 'artwork'
              AND entity_id = entity_id('artwork', 'the-great-wave-off-kanagawa')`)).toContain('is a common translation — does');
  // made official: then it wants a source (the institution's page) — and the hint is gone
  sql("UPDATE artworks SET title_status = 'official' WHERE slug = 'the-great-wave-off-kanagawa'");
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'title_translation' AND entity_type = 'artwork'
              AND entity_id = entity_id('artwork', 'the-great-wave-off-kanagawa')`)).toBe('0');
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'weakly_sourced' AND entity_type = 'artwork'
              AND entity_id = entity_id('artwork', 'the-great-wave-off-kanagawa')`)).toContain('title_status');
  await userA.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(userA.locator('dt:has-text("Title: original or translation") + dd details.cite > summary .cite-none')).toBeVisible();

  const w = await api(request, '/artworks/the-great-wave-off-kanagawa');
  expect(w.title_status).toBe('official');
  expect(w.names.map(({ text, lang, role, status }) => ({ text, lang, role, status }))).toEqual([
    { text: '神奈川沖浪裏', lang: 'ja', role: 'original', status: null }, { text: 'Unter der Welle', lang: 'de', role: 'translation', status: 'own' }]);
  expect(sql("SELECT names_valid('[{\"text\": \"X\", \"role\": \"original\", \"status\": \"own\"}]')")).toBe('f');  // the database says so too
});

test('menus of optional values have an empty choice: saving doesn\'t set the first value (title status, a source\'s reliability)', async ({ userA }) => {
  sql("UPDATE artworks SET title_status = NULL WHERE slug = 'the-starry-night'");
  await userA.goto('/artworks/the-starry-night/edit');
  await expect(userA.locator('#f-title_status')).toHaveValue('');
  await expect(userA.locator('#f-title_status option:checked')).toHaveText('original — not a translation');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/the-starry-night\?done=/);
  expect(sql("SELECT coalesce(title_status::text, 'NULL') FROM artworks WHERE slug = 'the-starry-night'")).toBe('NULL');

  sql(`INSERT INTO bibliography (slug, kind, name, url) VALUES ('menu-test-site', 'web', 'A site', 'https://example.org/') ON CONFLICT DO NOTHING`);
  await userA.goto('/bibliography/menu-test-site/edit');
  await expect(userA.locator('#f-reliability')).toHaveValue('');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/bibliography\/menu-test-site\?done=/);
  expect(sql("SELECT coalesce(reliability::text, 'NULL') FROM bibliography WHERE slug = 'menu-test-site'")).toBe('NULL');  // derived from the kind
  sql("DELETE FROM bibliography WHERE slug = 'menu-test-site'; DELETE FROM live_docs WHERE entity_type IN ('artwork', 'source')");
});
