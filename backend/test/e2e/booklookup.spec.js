// New bibliography entries from an ISBN (Open Library) or a DOI (Crossref) — src/admin/booklookup.js
const { test, expect, sql, submitForm } = require('./helpers');

const cleanup = () => sql("DELETE FROM bibliography WHERE slug IN ('batschmann-2008', 'lawrence-1945'); DELETE FROM admin_drafts WHERE entity_type = 'source'");
test.afterAll(cleanup);

test('an ISBN fills the form: authors as "Surname, Given", place, publisher, year; the same ISBN again leads to it', async ({ userA }) => {
  cleanup();
  await userA.goto('/bibliography/new');
  await userA.fill('#lookup input[name=id]', 'ISBN 978-3-7757-2310-7');
  await Promise.all([userA.waitForNavigation(), userA.click('#lookup button')]);
  await expect(userA).toHaveURL(/\/bibliography\/new\?draft=1/);
  await expect(userA.locator('.flash.ok')).toContainText('Filled in from the record');
  await expect(userA.locator('#f-name')).toHaveValue('Ferdinand Hodler');
  await expect(userA.locator('#f-authors')).toHaveValue('Bätschmann, Oskar\nMüller, Paul');
  await expect(userA.locator('#f-publisher')).toHaveValue('Hatje Cantz');
  await expect(userA.locator('#f-year')).toHaveValue('2008');
  await expect(userA.locator('form.form input[name=slug]')).toHaveValue('batschmann-2008');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/bibliography\/batschmann-2008/);
  expect(sql("SELECT kind || ' ' || isbn || ' ' || place FROM bibliography WHERE slug = 'batschmann-2008'")).toBe('book 9783775723107 Ostfildern');

  await userA.goto('/bibliography/new/lookup?id=978-3775723107');
  await expect(userA).toHaveURL(/\/bibliography\/batschmann-2008\?done=source-exists/);
});

test('a DOI fills an article: journal, volume, issue, pages; unknown ones say so', async ({ userA }) => {
  await userA.goto('/bibliography/new/lookup?id=https://doi.org/10.2307/3046992');
  await expect(userA.locator('#f-kind')).toHaveValue('article');
  await expect(userA.locator('#f-container')).toHaveValue('The Art Bulletin');
  await expect(userA.locator('#f-pages')).toHaveValue('123–140');
  await expect(userA.locator('#f-authors')).toHaveValue('Lawrence, Marion');
  await userA.goto('/bibliography/new/lookup?id=10.9999/nothing');
  await expect(userA.locator('.flash.error')).toContainText('Nothing found for 10.9999/nothing');
  await userA.goto('/bibliography/new/lookup?id=hello');
  await expect(userA.locator('.flash.error')).toContainText('neither an ISBN');
});
