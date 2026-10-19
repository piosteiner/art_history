// Search words (migration 102, src/admin/routes/search-words.js): groups of equivalent words edited in the admin; the
// public full-text search uses a change at once; "Try a word" and shared words; the History names the group.
const { test, expect, sql, API } = require('./helpers');

const search = async (request, q) => (await (await request.get(`${API}/search/text?q=${encodeURIComponent(q)}`,
  { headers: { Host: 'api.localhost' } })).json()).data.map((h) => h.slug);
const cleanup = () => sql(`DELETE FROM search_synonyms WHERE label LIKE 'test %'; DELETE FROM artworks WHERE slug = 'test-sw-work'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO artworks (slug, title, description_md) VALUES ('test-sw-work', 'Test Sw Work', 'Kept in a lighthouse by the sea.')`);
});
test.afterEach(cleanup);

test('search words: create a group, the search uses it at once; shared words, try a word, delete', async ({ userA, request }) => {
  expect(await search(request, 'leuchtturm')).not.toContain('test-sw-work');
  await userA.goto('/search-words');
  await expect(userA.locator('.search-words-list')).toContainText('beschlagnahmt');   // the starting list (102)
  await userA.click('a:has-text("+ New group")');
  await userA.fill('#sw-label', 'test lighthouse');
  await userA.fill('#sw-terms', 'Leuchtturm\nlighthouse, phare\nleuchtturm');           // lines and commas; a repeat dropped
  await Promise.all([userA.waitForNavigation(), userA.click('.search-words-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/\/search-words\/\d+\/edit\?done=created/);
  await expect(userA.locator('#sw-terms')).toHaveValue('Leuchtturm\nlighthouse\nphare');
  expect(await search(request, 'leuchtturm')).toContain('test-sw-work');

  // too few words: refused with the form kept
  await userA.fill('#sw-terms', 'lighthouse');
  await userA.click('.search-words-form button:has-text("Save")');
  await expect(userA.locator('.flash.error')).toContainText('at least two words');

  // a second group with a word of the first: both warned about it
  sql(`INSERT INTO search_synonyms (label, terms) VALUES ('test beacon', '{phare,beacon}')`);
  await userA.goto('/search-words');
  await userA.click('a:has-text("test lighthouse")');
  await expect(userA.locator('.search-words-shared')).toContainText('test beacon');

  // try a word: its forms count ("Leuchttürme" is not listed, "leuchtturm" is)
  await userA.goto('/search-words?try=leuchtturm');
  await expect(userA.locator('.search-words-result')).toContainText('test lighthouse');
  await userA.goto('/search-words?try=zzzunknown');
  await expect(userA.locator('.search-words-result')).toContainText('is in no group');

  // the History names the change and links the group
  await userA.goto('/history');
  await expect(userA.locator('a', { hasText: 'search words: test lighthouse' }).first()).toHaveAttribute('href', /^\/search-words\/\d+\/edit$/);

  // deleted: the word finds only itself again
  await userA.goto('/search-words');
  await userA.click('a:has-text("test lighthouse")');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Delete this group")')]);
  await expect(userA).toHaveURL(/\/search-words\?done=deleted/);
  expect(await search(request, 'leuchtturm')).not.toContain('test-sw-work');
});
