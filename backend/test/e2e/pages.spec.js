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
  await userA.evaluate((t) => { document.querySelector('#pg-body').value = t; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); }, text);
  // the page's own preview: its images from the CMS
  const preview = await userA.evaluate(async (t) => (await fetch('/pages/test-doc/preview', { method: 'POST', body: new URLSearchParams({ text: t }) })).text(), text);
  expect(preview).toContain('src="/pages/test-doc/images/Facharbeit-1.png"');
  expect(preview).toContain('class="page-image-missing"');
  // the text published, the page still hidden: not on the API
  await Promise.all([userA.waitForURL(/done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);
  await expect(userA.locator('.page-images-missing')).toContainText('fehlt.webp');
  expect((await get(request, '/pages/test-doc')).status()).toBe(404);
  // made visible in the page settings
  await userA.click('.page-settings summary');
  await userA.check('input[name=published]');
  await Promise.all([userA.waitForURL(/done=saved/), userA.click('.page-settings button:has-text("Save settings")')]);

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
  await expect(userA.locator('.page-outline-intro')).toContainText('Introduction');
  await expect(userA.locator('.page-outline ol li > a')).toHaveText(['Pitch', 'Projektstart', 'Provenienz']);
  await expect(userA.locator('#pg-body')).toHaveCount(0);                          // nothing chosen: no editor yet
  // chapter 2 alone in the editor; saved back in its place
  await userA.locator('.page-outline a', { hasText: 'Projektstart' }).click();
  await expect(userA.locator('#pg-body')).toHaveValue('# Projektstart\nAlt.\n## Backend\nNode.\n\n');
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Projektstart\nNeu.\n'; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); });
  await Promise.all([userA.waitForURL(/chapter=2&done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('Einleitung.\n\n# Pitch\nVorteil.\n\n# Projektstart\nNeu.\n# Provenienz\nBesitz.');
  // another chapter changed meanwhile: no matter — this one goes in
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Projektstart\nZweite Fassung.\n'; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); });
  sql("UPDATE pages SET body_md = body_md || '\nNachtrag.' WHERE slug = 'test-doc'");
  await Promise.all([userA.waitForURL(/chapter=2&done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toContain('# Projektstart\nZweite Fassung.\n# Provenienz\nBesitz.\n\nNachtrag.');
  // this chapter changed meanwhile: refused, the edited version kept; publishing again puts it in
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Projektstart\nMeine Fassung.\n'; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); });
  sql("UPDATE pages SET body_md = replace(body_md, 'Zweite Fassung.', 'Anderswo geändert.') WHERE slug = 'test-doc'");
  await userA.click('.page-form button:has-text("Publish changes")');
  await expect(userA.locator('.flash.error')).toContainText('was changed on the site since you began');
  await expect(userA.locator('#pg-body')).toHaveValue('# Projektstart\nMeine Fassung.\n');
  await expect(userA.locator('[data-page-changes] del')).toContainText('Anderswo geändert');   // what would be replaced
  // published only when asked for explicitly
  await userA.click('.page-form button:has-text("Publish changes")');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toContain('Anderswo geändert.');
  await userA.check('input[name=overwrite]');
  await Promise.all([userA.waitForURL(/done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);
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
  await expect(userA.locator('.page-outline ol li > a')).toHaveText(['Eins', 'Zwei']);

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
  await expect(userA.locator('[data-autosave-status]')).toContainText('Saved as draft', { timeout: 10000 });
  expect(sql("SELECT count(*) FROM page_drafts p JOIN pages g ON g.id = p.page_id WHERE g.slug = 'test-doc' AND p.part = '1'")).toBe('1');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nText.');
  // left and opened again: restored
  await userA.goto('/pages/test-doc/edit?chapter=1');
  await expect(userA.locator('.page-draft')).toContainText('Your unpublished changes');
  await expect(body).toHaveValue(/==wichtig==/);
  // discarded: gone
  userA.once('dialog', (d) => d.accept());
  await Promise.all([userA.waitForURL(/chapter=1&done=page-discarded/), userA.click('.page-form button:has-text("Discard changes")')]);
  await expect(userA.locator('.page-form button:has-text("Discard changes")')).toBeHidden();
  await expect(userA.locator('.page-draft')).toHaveCount(0);
  await expect(body).toHaveValue('# Eins\nText.\n');
  // typed again, saved: on the page, the draft gone
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type('Mehr.');
  await expect(userA.locator('[data-autosave-status]')).toContainText('Saved as draft', { timeout: 10000 });
  await Promise.all([userA.waitForURL(/done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);
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
  await Promise.all([userA.waitForURL(/done=page-published/), userA.click('.page-form button:has-text("Publish changes")')]);

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
  await userA.locator('.page-change button:has-text("Discard")').click();
  await expect(userA.locator('main')).toContainText('No unpublished changes');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).not.toContain('Ein neuer Satz');   // the site's text untouched
});

test('publishing from the review page: all parts at once; a part changed on the site meanwhile stays a draft', async ({ userA }) => {
  const text = '# Eins\nA.\n\n# Zwei\nB.\n\n# Drei\nC.\n';
  sql(`INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', '${text}', true)`);
  // three drafts as the editor's autosave writes them: based on their part as it was on the site
  const draft = (part, live, mine) => userA.evaluate(async ([pt, l, m]) => {
    const enc = new TextEncoder().encode(l);
    const base = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return (await fetch('/pages/test-doc/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter: pt, base, body: m }) })).status;
  }, [part, live, mine]);
  await userA.goto('/pages/test-doc/edit');
  expect(await draft('1', '# Eins\nA.\n\n', '# Eins\nA neu.\n\n')).toBe(200);
  expect(await draft('2', '# Zwei\nB.\n\n', '# Zwei\nB neu.\n\n')).toBe(200);
  expect(await draft('3', '# Drei\nC.\n', '# Drei\nC neu.\n')).toBe(200);
  // chapter 3 changed on the site meanwhile: its draft can't be published from here
  sql("UPDATE pages SET body_md = replace(body_md, 'C.', 'C anders.') WHERE slug = 'test-doc'");

  await userA.goto('/pages/test-doc/changes');
  await expect(userA.locator('.page-change')).toHaveCount(3);
  await expect(userA.locator('.page-change', { hasText: 'Drei' })).toContainText('this part changed on the site since');
  await expect(userA.locator('.page-change', { hasText: 'Drei' }).locator('button:text-is("Publish")')).toHaveCount(0);
  // all at once: Eins and Zwei go in, Drei stays a draft — said so
  userA.once('dialog', (d) => d.accept());
  await userA.click('button:has-text("Publish all (2)")');
  await expect(userA.locator('.flash')).toContainText('Published 2 parts');
  await expect(userA.locator('.flash')).toContainText('1 kept as draft');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nA neu.\n\n# Zwei\nB neu.\n\n# Drei\nC anders.');
  await expect(userA.locator('.page-change')).toHaveCount(1);
  await expect(userA.locator('.page-change h2')).toHaveText('Chapter 3: Drei');
});

test('chapters moved in the outline: by keyboard and by dragging; the text one, the drafts and the open chapter move along', async ({ userA }) => {
  sql("INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', 'Vorwort.\n\n# Eins\nA.\n\n# Zwei\nB.\n\n# Drei\nC.', true)");
  // a draft of Zwei, as the autosave writes it (based on its chapter's text)
  await userA.goto('/pages/test-doc/edit?chapter=2');
  await userA.evaluate(() => { document.querySelector('#pg-body').value = '# Zwei\nB neu.\n\n'; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); });
  await expect(userA.locator('[data-autosave-status]')).toContainText('Saved as draft', { timeout: 10000 });

  // keyboard: Drei up twice — first after the introduction; the open chapter (Zwei, now 3) opened again
  await userA.locator('.page-chapters li', { hasText: 'Drei' }).locator('.drag-handle').focus();
  await userA.keyboard.press('ArrowUp');
  await userA.keyboard.press('ArrowUp');
  await userA.waitForURL(/chapter=3$/);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('Vorwort.\n\n# Drei\nC.\n\n# Eins\nA.\n\n# Zwei\nB.');
  await expect(userA.locator('.page-chapters li > a')).toHaveText(['Drei', 'Eins', 'Zwei']);
  await expect(userA.locator('#pg-body')).toHaveValue('# Zwei\nB neu.\n\n');             // its draft came along, still current
  await expect(userA.locator('.page-draft')).not.toContainText('changed on the site since');
  await expect(userA.locator('.page-chapters li', { hasText: 'Zwei' }).locator('.page-pending')).toBeVisible();

  // dragging: Zwei to the top
  const handle = userA.locator('.page-chapters li', { hasText: 'Zwei' }).locator('.drag-handle');
  const target = await userA.locator('.page-chapters li', { hasText: 'Drei' }).boundingBox();
  const from = await handle.boundingBox();
  await userA.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await userA.mouse.down();
  await userA.mouse.move(from.x + from.width / 2, target.y + 2, { steps: 8 });
  await userA.mouse.up();
  await userA.waitForURL(/chapter=1$/);
  await expect(userA.locator('.page-chapters li > a')).toHaveText(['Zwei', 'Drei', 'Eins']);
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('Vorwort.\n\n# Zwei\nB.\n\n# Drei\nC.\n\n# Eins\nA.');
  expect(sql("SELECT part FROM page_drafts d JOIN pages p ON p.id = d.page_id WHERE p.slug = 'test-doc'")).toBe('1');
  // one change each in the page's history
  expect(Number(sql("SELECT count(*) FROM audit_log WHERE table_name = 'pages' AND row_id = (SELECT id FROM pages WHERE slug = 'test-doc') AND action = 'update'"))).toBe(2);
});

test('drafts follow their chapters when a published draft adds one; a draft of another chapter or an empty text replaces nothing unasked', async ({ userA }) => {
  sql("INSERT INTO pages (slug, title, body_md, published) VALUES ('test-doc', 'Test Doc', '# Eins\nA.\n\n# Zwei\nB.\n\n# Drei\nC.', true)");
  const draft = (part, live, mine) => userA.evaluate(async ([pt, l, m]) => {
    const base = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(l)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return (await fetch('/pages/test-doc/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter: pt, base, body: m }) })).status;
  }, [part, live, mine]);
  await userA.goto('/pages/test-doc/edit');
  // a draft of Drei; then Eins published with a new chapter after it (the case of 2026-10-27)
  expect(await draft('3', '# Drei\nC.', '# Drei\nC neu.\n')).toBe(200);
  expect(await draft('1', '# Eins\nA.\n\n', '# Eins\nA.\n\n# Neu\nN.\n\n')).toBe(200);
  await userA.goto('/pages/test-doc/changes');
  await userA.locator('.page-change', { hasText: 'Eins' }).locator('button:text-is("Publish")').click();
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toBe('# Eins\nA.\n\n# Neu\nN.\n\n# Zwei\nB.\n\n# Drei\nC.');
  // Drei is chapter 4 now — its draft moved with it, still current
  expect(sql("SELECT part FROM page_drafts d JOIN pages p ON p.id = d.page_id WHERE p.slug = 'test-doc'")).toBe('4');
  await expect(userA.locator('.page-change h2')).toHaveText(['Chapter 4: Drei']);
  await expect(userA.locator('.page-change', { hasText: 'Drei' }).locator('button:text-is("Publish")')).toBeVisible();

  // a draft that belongs to another chapter (stored under Zwei's number): shown, refused, named as such
  sql("INSERT INTO page_drafts (page_id, user_id, part, base_sha, body_md) SELECT id, (SELECT id FROM admin_users WHERE username = 'tester'), '3', 'stale', '# Drei\nFalsch.\n' FROM pages WHERE slug = 'test-doc'");
  await userA.goto('/pages/test-doc/edit?chapter=3');
  await userA.click('.page-form button:has-text("Publish changes")');
  await expect(userA.locator('.flash.error')).toContainText('it may be a draft of another chapter');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toContain('# Zwei\nB.');
  // an empty text never replaces a chapter
  await userA.goto('/pages/test-doc/edit?chapter=2');
  await userA.evaluate(() => { document.querySelector('#pg-body').value = ''; document.querySelector('#pg-body').dispatchEvent(new Event('md-change')); });
  await userA.click('.page-form button:has-text("Publish changes")');
  await expect(userA.locator('.flash.error')).toContainText('The text is empty');
  expect(sql("SELECT body_md FROM pages WHERE slug = 'test-doc'")).toContain('# Neu\nN.');
});
