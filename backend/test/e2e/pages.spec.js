// Pages (migration 114): a text page written in the CMS — Obsidian's Markdown, images uploaded by name and embedded as
// ![[name]], published to the API (HTML + table of contents, images served by name), revisions in its history.
const sharp = require('sharp');
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

  // images: several at once, under their own names — stored as WebP (115), a large one at most 1600 px on its longest side
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#88a' } }).png().toBuffer();
  await userA.setInputFiles('#pg-files', [{ name: 'Facharbeit-1.png', mimeType: 'image/png', buffer: big }, { name: 'Bild 2.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(userA.locator('[data-image-upload-status]')).toContainText('2 of 2 uploaded');
  await expect(userA.locator('[data-image-list] li', { hasText: 'Facharbeit-1.png' })).toContainText('WebP (was');
  await expect(userA.locator('[data-image-list] li', { hasText: 'Facharbeit-1.png' })).toContainText('1600 × 1067');
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
  const page = await (await get(request, '/pages/test-doc?full=1')).json();
  expect(page).toMatchObject({ slug: 'test-doc', title: 'Test Doc', lang: 'de-CH' });
  expect(page.html).toMatch(/<img src="http:\/\/api\.localhost[^"]*\/v1\/pages\/test-doc\/images\/Facharbeit-1\.png" alt="" loading="lazy" width="1600" height="1067"/);
  expect(page.html).toContain('<span class="page-caption">Eine Bildunterschrift</span>');
  expect(page.html).toContain('<mark>Markierung</mark>');
  expect(page.html).toContain('<span style="color:rgb(255, 0, 0)">rot</span>');
  expect(page.html).toContain('class="task task-done"');
  expect(page.html).toContain('<span class="page-image-missing"');
  expect(page.toc).toEqual([{ level: 1, id: 'kapitel-eins', text: 'Kapitel Eins' }, { level: 2, id: 'raumliche-nahe', text: 'Räumliche Nähe' }]);
  // the image, by name; revalidated by its hash
  const img = await get(request, '/pages/test-doc/images/Facharbeit-1.png');
  expect(img.status()).toBe(200);
  // the name stays as embedded; the image is WebP now, scaled down
  expect(img.headers()['content-type']).toBe('image/webp');
  expect(await sharp(await img.body()).metadata()).toMatchObject({ format: 'webp', width: 1600, height: 1067 });
  expect((await get(request, '/pages/test-doc/images/Facharbeit-1.png', { 'If-None-Match': img.headers().etag })).status()).toBe(304);

  // deleted: the embed shows as missing; the text stays
  await userA.goto('/pages/test-doc/edit');
  userA.once('dialog', (d) => d.accept());
  await userA.locator('[data-image-list] li', { hasText: 'Facharbeit-1.png' }).locator('button[data-image-delete]').click();
  await expect(userA.locator('[data-image-list] code', { hasText: 'Facharbeit-1.png' })).toHaveCount(0);
  expect((await (await get(request, '/pages/test-doc?full=1')).json()).html).not.toContain('Facharbeit-1.png"');

  // every revision in its history
  await userA.goto('/pages/test-doc/history');
  await expect(userA.locator('table.diff > tbody > tr')).toHaveCount(3);   // created, saved, published (each with its changes)
});

test('a long page: chapters edited one at a time, a stale save refused, .md download and upload, chapters on the API', async ({ userA, request }) => {
  const text = 'Einleitung.\n\n# Pitch\nVorteil.\n\n# Projektstart\nAlt.\n## Backend\nNode.\n\n# Provenienz\nBesitz.\n';
  sql(`INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', '${text.replace(/'/g, "''")}', true)`);
  // the outline: the introduction and three chapters
  await userA.goto('/pages/test-doc/edit');
  await expect(userA.locator('.page-outline ol li')).toHaveText([/^Introduction/, /^Pitch/, /^Projektstart/, /^Provenienz/]);
  await expect(userA.locator('#pg-body')).toHaveCount(0);                          // nothing chosen: no editor yet
  // chapter 2 alone in the editor; saved back in its place
  await userA.locator('.page-outline a', { hasText: 'Projektstart' }).click();
  await expect(userA.locator('#pg-body')).toHaveValue('# Projektstart\nAlt.\n## Backend\nNode.\n\n');
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Projektstart\nNeu.\n'; });
  await Promise.all([userA.waitForURL(/chapter=2&done=saved/), userA.click('.page-form button:has-text("Save")')]);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('Einleitung.\n\n# Pitch\nVorteil.\n\n# Projektstart\nNeu.\n# Provenienz\nBesitz.');
  // changed elsewhere meanwhile: refused, the edited version kept; saving again puts it in
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Projektstart\nMeine Fassung.\n'; });
  sql("UPDATE pages SET body_md = body_md || '\nNachtrag.' WHERE slug = 'test-doc'");
  await userA.click('.page-form button:has-text("Save")');
  await expect(userA.locator('.flash.error')).toContainText('changed since you opened this part');
  await expect(userA.locator('#pg-body')).toHaveValue('# Projektstart\nMeine Fassung.\n');
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-form button:has-text("Save")')]);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toContain('# Projektstart\nMeine Fassung.\n# Provenienz\nBesitz.\n\nNachtrag.');

  // .md: downloaded (remembered), changed in the CMS, then a file uploaded → asked first; confirmed → replaced
  const [download] = await Promise.all([userA.waitForEvent('download'), userA.click('a:has-text("Download .md")')]);
  expect(download.suggestedFilename()).toBe('Test Doc.md');
  await userA.reload();
  await expect(userA.locator('[data-md-sync]')).toContainText('no changes in the CMS since');
  sql("UPDATE pages SET body_md = body_md || '\nIm CMS ergänzt.' WHERE slug = 'test-doc'");
  await userA.goto('/pages/test-doc/edit');     // an address without done=saved, so the wait below waits for the upload
  await expect(userA.locator('[data-md-sync]')).toContainText('changed in the CMS since');
  let asked = '';
  userA.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await Promise.all([userA.waitForURL(/done=saved/), userA.setInputFiles('#pg-md', { name: 'Test Doc.md', mimeType: 'text/markdown', buffer: Buffer.from('# Eins\nA\n\n# Zwei\nB\n') })]);
  expect(asked).toContain('changed in the CMS after your last download');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nA\n\n# Zwei\nB');   // (sql() trims the last newline)
  await expect(userA.locator('.page-outline ol li')).toHaveText([/^Eins/, /^Zwei/]);

  // the API: the chapter list, one chapter with its neighbours, ids as in the whole text
  const all = await (await get(request, '/pages/test-doc')).json();
  expect(all.chapters.map((c) => c.id)).toEqual(['eins', 'zwei']);
  expect(all.html).toBeUndefined();
  const two = (await (await get(request, '/pages/test-doc?chapter=zwei')).json()).chapter;
  expect(two).toMatchObject({ id: 'zwei', index: 2, title: 'Zwei', prev: { id: 'eins', title: 'Eins' }, next: null });
  expect(two.html).toContain('<h1 id="zwei">Zwei</h1>');
  expect((await get(request, '/pages/test-doc?chapter=drei')).status()).toBe(404);
});

test('the editor: the adenai tools, find and replace, autosave as a draft restored after leaving, discarded, published by Save', async ({ userA }) => {
  sql("INSERT INTO pages (slug, title, body_md) VALUES ('test-doc', 'Test Doc', '# Eins\nText.\n')");
  await userA.goto('/pages/test-doc/edit?chapter=1');
  const tools = userA.locator('.md-toolbar button.md-tool');
  for (const t of ['B', 'I', 'U', '[[ ]]', 'Web', 'H', '• List', '1.', '☐', '▍', '◼', '❝', '▣ Box ▾', '⊞', '—', '🔍']) {
    await expect(tools.filter({ hasText: new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first(), t).toBeVisible();
  }
  const cm = userA.locator('.md-editor .cm-content');
  const body = userA.locator('#pg-body');
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('\nwichtig');
  await userA.keyboard.press('Shift+Home');
  await userA.keyboard.press('Control+Shift+h');                                   // highlight
  await expect(body).toHaveValue(/==wichtig==$/);
  await userA.keyboard.press('End');
  await userA.click('.md-toolbar button:has-text("▣ Box ▾")');
  await userA.click('.md-boxlist button:has-text("Warning")');                       // a callout box
  await expect(body).toHaveValue(/\n\n> \[!warning\] \n> \n$/);
  await userA.click('.md-toolbar button:text-is("1.")');
  await userA.click('.md-toolbar button:text-is("⊞")');
  await expect(body).toHaveValue(/\| Column \| Column \|\n\|---\|---\|/);
  // find and replace
  await userA.keyboard.press('Control+f');
  await expect(userA.locator('.md-editor .cm-search')).toBeVisible();
  await userA.keyboard.press('Escape');

  // autosave: a draft, not the page
  await expect(userA.locator('[data-autosave-status]')).toContainText('Draft saved', { timeout: 10000 });
  expect(sql("SELECT count(*) FROM page_drafts p JOIN pages g ON g.id = p.page_id WHERE g.slug = 'test-doc' AND p.part = '1'")).toBe('1');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nText.');
  // left and opened again: restored
  await userA.goto('/pages/test-doc/edit?chapter=1');
  await expect(userA.locator('.page-draft')).toContainText('Restored your unsaved draft');
  await expect(body).toHaveValue(/==wichtig==/);
  // discarded: gone
  await Promise.all([userA.waitForURL(/chapter=1$/), userA.click('.page-draft button:has-text("Discard draft")')]);
  await expect(userA.locator('.page-draft')).toHaveCount(0);
  await expect(body).toHaveValue('# Eins\nText.\n');
  // typed again, saved: on the page, the draft gone
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('Mehr.');
  await expect(userA.locator('[data-autosave-status]')).toContainText('Draft saved', { timeout: 10000 });
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-form button:has-text("Save")')]);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nText.\nMehr.');
  expect(sql("SELECT count(*) FROM page_drafts p JOIN pages g ON g.id = p.page_id WHERE g.slug = 'test-doc'")).toBe('0');
});

test('[[#Heading]]: suggested from every chapter while writing one, linked to the heading in its chapter, two of a name told apart', async ({ userA, request }) => {
  const text = '# Eins\nA.\n## Vertrauliche Daten\nGeheim.\n\n# Zwei\nB.\n## Backend\nX.\n\n# Drei\n## Backend\nY.\n';
  sql(`INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', '${text}', true)`);
  await userA.goto('/pages/test-doc/edit?chapter=2');
  const cm = userA.locator('.md-editor .cm-content');
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('Siehe [[#vertrau');
  const hits = userA.locator('.cm-tooltip-autocomplete li');
  await expect(hits).toHaveCount(1);
  await expect(hits.first()).toContainText('Vertrauliche Daten');
  await expect(hits.first()).toContainText('## · Eins');                         // a heading of another chapter
  await hits.first().click();       // (Enter right after the list opens falls in CodeMirror's interaction delay: a new line)
  await expect(userA.locator('#pg-body')).toHaveValue(/Siehe \[\[#Vertrauliche Daten\]\]$/);
  // a name used twice: written with the heading above it
  await userA.keyboard.type(' und [[#backend');
  await expect(hits).toHaveCount(2);                                               // this chapter's and Drei's
  await hits.filter({ hasText: 'Drei' }).click();
  await expect(userA.locator('#pg-body')).toHaveValue(/und \[\[#Drei#Backend\]\]$/);
  await userA.keyboard.type(' [[#Gibt es nicht]]');
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-form button:has-text("Save")')]);

  // the API: links to the heading's chapter on the site; the second "Backend" by its own id; one not found marked
  const two = (await (await get(request, '/pages/test-doc?chapter=zwei')).json()).chapter;
  expect(two.html).toContain('<a href="/pages/test-doc/eins#vertrauliche-daten">Vertrauliche Daten</a>');
  expect(two.html).toContain('<a href="/pages/test-doc/drei#backend-2">Backend</a>');
  expect(two.html).toMatch(/<span class="page-link-missing"[^>]*>Gibt es nicht<\/span>/);
});

test('unpublished changes: a draft shown as a word diff in the editor, marked in the outline and the list, reviewed and discarded on one page', async ({ userA }) => {
  sql("INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', '# Eins\nDer alte Satz.\n\n# Zwei\nB.\n', true)");
  await userA.goto('/pages/test-doc/edit?chapter=1');
  const panel = userA.locator('[data-page-changes]');
  await expect(panel).toBeHidden();                                                   // nothing unpublished yet
  const cm = userA.locator('.md-editor .cm-content');
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('Ein neuer Satz.');
  await expect(panel).toBeVisible({ timeout: 8000 });                                 // after the autosave
  await expect(panel.locator('ins')).toContainText('Ein neuer Satz.');

  // opened again: the panel, the chapter marked; the list of pages counts it
  await userA.goto('/pages/test-doc/edit?chapter=1');
  await expect(userA.locator('[data-page-changes] ins')).toContainText('Ein neuer Satz.');
  await expect(userA.locator('.page-outline li', { hasText: 'Eins' }).locator('.page-pending')).toBeVisible();
  await expect(userA.locator('.page-outline li', { hasText: 'Zwei' }).locator('.page-pending')).toHaveCount(0);
  await userA.goto('/pages');
  await expect(userA.locator('tr', { hasText: 'Test Doc' })).toContainText('1 unpublished');

  // the review page: every draft as a diff; discarded there, nothing left
  await userA.locator('tr', { hasText: 'Test Doc' }).locator('a.page-pending').click();
  await expect(userA.locator('main h1')).toHaveText('Unpublished changes');
  await expect(userA.locator('.page-change h2')).toHaveText(['Chapter 1: Eins']);
  await expect(userA.locator('.page-change ins')).toContainText('Ein neuer Satz.');
  userA.once('dialog', (d) => d.accept());
  await userA.locator('.page-change button:has-text("Discard draft")').click();
  await expect(userA.locator('main')).toContainText('No unpublished changes');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).not.toContain('Ein neuer Satz');   // the site's text untouched
});
