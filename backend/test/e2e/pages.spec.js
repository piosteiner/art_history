// Pages (migration 114): a text page written in the CMS — Obsidian's Markdown, images uploaded by name and embedded as
// ![[name]], published to the API (HTML + table of contents, images served by name), revisions in its history.
const { test, expect, sql, API } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const get = (request, path, headers = {}) => request.get(`${API}${path}`, { headers: { Host: 'api.localhost', ...headers } });

test.beforeEach(() => sql("DELETE FROM pages WHERE slug = 'test-doc'"));
test.afterEach(() => sql("DELETE FROM pages WHERE slug = 'test-doc'"));

test('a page: Obsidian Markdown, images by name, published to the API, its history', async ({ userA, request }) => {
  // a new page from the list
  await userA.goto('/pages');
  await expect(userA.locator('main')).toContainText('Projekt Dokumentation');      // the documentation's page is there
  await userA.fill('#pg-title', 'Test Doc');
  await userA.fill('#pg-slug', 'test-doc');
  await Promise.all([userA.waitForURL(/\/pages\/test-doc\/edit/), userA.click('button:has-text("+ New page")')]);
  await expect(userA.locator('.md-editor .cm-content')).toBeVisible();

  // images: several at once, under their own names
  await userA.setInputFiles('#pg-files', [{ name: 'Facharbeit-1.png', mimeType: 'image/png', buffer: PNG }, { name: 'Bild 2.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(userA.locator('[data-image-upload-status]')).toContainText('2 of 2 uploaded');
  await expect(userA.locator('[data-image-list] code', { hasText: 'Facharbeit-1.png' })).toBeVisible();
  // a file the page can't take: refused with a reason
  const refused = await userA.evaluate(async () => (await fetch('/pages/test-doc/images?name=x.svg', { method: 'POST', body: '<svg/>' })).status);
  expect(refused).toBe(422);

  // the text, as pasted from Obsidian (into the form's field; the editor keeps it in sync)
  const text = '# Kapitel Eins\n\nText mit ==Markierung== und <span style="color:rgb(255, 0, 0)">rot</span>.\n\n![[Facharbeit-1.png]]\n![[Bild 2.png|Eine Bildunterschrift]]\n![[fehlt.webp]]\n\n- [x] erledigt\n- [ ] offen\n\n## Räumliche Nähe';
  await userA.evaluate((t) => { document.querySelector('#pg-body').value = t; }, text);
  // the page's own preview: its images from the CMS
  const preview = await userA.evaluate(async (t) => (await fetch('/pages/test-doc/preview', { method: 'POST', body: new URLSearchParams({ text: t }) })).text(), text);
  expect(preview).toContain('src="/pages/test-doc/images/Facharbeit-1.png"');
  expect(preview).toContain('class="page-image-missing"');
  // saved, not yet published: not on the API
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-form button:has-text("Save")')]);
  await expect(userA.locator('.page-images-missing')).toContainText('fehlt.webp');
  expect((await get(request, '/pages/test-doc')).status()).toBe(404);
  await userA.check('input[name=published]');
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-form button:has-text("Save")')]);

  // the API: HTML with the images at its own address, the marks, tasks, ids; the table of contents
  const page = await (await get(request, '/pages/test-doc')).json();
  expect(page).toMatchObject({ slug: 'test-doc', title: 'Test Doc', lang: 'de-CH' });
  expect(page.html).toMatch(/<img src="http:\/\/api\.localhost[^"]*\/v1\/pages\/test-doc\/images\/Facharbeit-1\.png"/);
  expect(page.html).toContain('<span class="page-caption">Eine Bildunterschrift</span>');
  expect(page.html).toContain('<mark>Markierung</mark>');
  expect(page.html).toContain('<span style="color:rgb(255, 0, 0)">rot</span>');
  expect(page.html).toContain('class="task task-done"');
  expect(page.html).toContain('<span class="page-image-missing"');
  expect(page.toc).toEqual([{ level: 1, id: 'kapitel-eins', text: 'Kapitel Eins' }, { level: 2, id: 'raumliche-nahe', text: 'Räumliche Nähe' }]);
  // the image, by name; revalidated by its hash
  const img = await get(request, '/pages/test-doc/images/Facharbeit-1.png');
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');
  expect(Buffer.compare(await img.body(), PNG)).toBe(0);
  expect((await get(request, '/pages/test-doc/images/Facharbeit-1.png', { 'If-None-Match': img.headers().etag })).status()).toBe(304);

  // deleted: the embed shows as missing; the text stays
  await userA.goto('/pages/test-doc/edit');
  userA.once('dialog', (d) => d.accept());
  await userA.locator('[data-image-list] li', { hasText: 'Facharbeit-1.png' }).locator('button[data-image-delete]').click();
  await expect(userA.locator('[data-image-list] code', { hasText: 'Facharbeit-1.png' })).toHaveCount(0);
  expect((await (await get(request, '/pages/test-doc')).json()).html).not.toContain('Facharbeit-1.png"');

  // every revision in its history
  await userA.goto('/pages/test-doc/history');
  await expect(userA.locator('table.diff > tbody > tr')).toHaveCount(3);   // created, saved, published (each with its changes)
});
