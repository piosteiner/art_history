// Source files and reading notes (253): admins only, private until published; then the API (and site) show them.
const fs = require('fs');
const path = require('path');
const { test, expect, sql, API } = require('./helpers');

const DIR = path.join(__dirname, '.source-files');
test.beforeEach(() => {
  fs.mkdirSync(path.join(DIR, 'test-notes'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'test-notes', 'reading.pdf'), '%PDF-1.4 test');
  sql(`INSERT INTO bibliography (slug, kind, name, authors, year) VALUES ('test-notes-book', 'book', 'Test Notes Book', '{"Testauthor, Anna"}', '2001');
       INSERT INTO source_files (source_id, path, label, pages, bytes) VALUES (entity_id('source', 'test-notes-book'), 'test-notes/reading.pdf', 'Test chapter', 12, 13);
       INSERT INTO source_notes (source_id, lang, toc, summary_md, chapters, toc_basis, generated_by) VALUES (entity_id('source', 'test-notes-book'), 'en-GB',
         '[{"title": "Introduction", "page": 1, "level": 1}, {"title": "Colour", "page": 7, "level": 2}]', 'A test summary of the colour of things.',
         '[{"title": "Introduction", "pages": "pp. 1–6", "summary_md": "What the book sets out to do."}]', 'outline', 'test')`);
});
test.afterEach(() => sql(`DELETE FROM bibliography WHERE slug = 'test-notes-book'`));

test('reading notes: admins only and private until published; the file only for admins', async ({ userA, userB, request }) => {
  await userA.goto('/bibliography/test-notes-book');
  const box = userA.locator('#reading-notes');
  await expect(box).toContainText('private · not proofread');
  await expect(box).toContainText('A test summary of the colour of things.');
  await expect(box.locator('.source-toc li')).toHaveCount(2);
  // the file opens for the admin …
  const href = await box.locator('a', { hasText: 'Test chapter' }).getAttribute('href');
  expect((await userA.request.get(href)).status()).toBe(200);
  // … not for an editor, who sees no notes either
  await userB.goto('/bibliography/test-notes-book');
  await expect(userB.locator('#reading-notes')).toHaveCount(0);
  expect((await userB.request.get(href)).status()).toBe(404);
  // not in the API before publishing
  expect((await (await request.get(`${API}/bibliography/test-notes-book`)).json()).notes).toBeNull();
  // edit and publish
  await userA.goto('/bibliography/test-notes-book/notes/edit');
  await userA.fill('#summary_md', 'A proofread summary.');
  await userA.click('button:has-text("Save")');
  await userA.click('button:has-text("Proofread — publish")');
  await expect(userA.locator('#reading-notes')).toContainText('published');
  const notes = (await (await request.get(`${API}/bibliography/test-notes-book`)).json()).notes;
  expect(notes.summary_html).toContain('A proofread summary.');
  expect(notes.toc.map((t) => t.title)).toEqual(['Introduction', 'Colour']);
  expect(notes.chapters[0]).toMatchObject({ title: 'Introduction', pages: 'pp. 1–6' });
  // the API role never reads the files or the unpublished notes
  expect(sql(`SELECT has_table_privilege('arthistory_api', 'source_files', 'SELECT')::text || has_table_privilege('arthistory_api', 'source_notes', 'SELECT')::text`)).toBe('falsefalse');
});
