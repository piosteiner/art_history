// The bibliography (migration 036): sources typed in once, cited with [[source/slug|page]] — footnotes with short
// references, "ebd.", a list of full entries after the KHIST guide; reading status; the public API.
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a source: the form shows the fields of its kind; the citation is generated', async ({ userA }) => {
  await userA.goto('/bibliography/new');
  await userA.selectOption('#f-kind', 'book');
  await expect(userA.locator('#f-pages')).toBeHidden();                 // a book has no page range of its own
  await userA.selectOption('#f-kind', 'article');
  await expect(userA.locator('#f-pages')).toBeVisible();
  await expect(userA.locator('#f-issue')).toBeVisible();
  await userA.selectOption('#f-kind', 'book');
  await userA.fill('#f-name', 'Das sentimentalische Bild');
  await expect(userA.locator('#f-slug')).toHaveValue('das-sentimentalische-bild');
  await userA.fill('#f-slug', 'busch-1993');
  await userA.fill('#f-subtitle', 'Die Krise der Kunst im 18. Jahrhundert und die Geburt der Moderne');
  await userA.fill('#f-authors', 'Busch, Werner');
  await userA.fill('#f-place', 'München');
  await userA.fill('#f-year', '1993');
  await userA.selectOption('#f-reading_status', 'read');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/bibliography\/busch-1993\?done=created/);
  await expect(userA.locator('.citation')).toHaveText('Busch 1993: Werner Busch, Das sentimentalische Bild. Die Krise der Kunst im 18. Jahrhundert und die Geburt der Moderne, München 1993.');
  await userA.goto('/bibliography');
  await expect(userA.locator('main')).toContainText('1 sources — 1 read');
});

test('citations in a description: footnotes, ebd., combined notes, the list of sources; the API', async ({ userA, request }) => {
  sql(`INSERT INTO bibliography (slug, kind, name, authors, place, year) VALUES
         ('dittscheid-1987', 'book', 'Kassel-Wilhelmshöhe und die Krise des Schlossbaues', '{"Dittscheid, Hans-Christoph"}', 'Worms', '1987');
       UPDATE artworks SET description_md = 'Erstens [[source/busch-1993|43]]. Zweitens.[[source/busch-1993|55]] [[source/dittscheid-1987|205]] Drittens^[Vgl. [[source/nope-2000]].]'
       WHERE slug = 'plum-park-in-kameido'`);
  await userA.goto('/artworks/plum-park-in-kameido');
  const notes = userA.locator('.md section.footnotes li');
  await expect(notes).toHaveCount(3);
  await expect(notes.nth(0)).toContainText('Busch 1993, S. 43.');
  await expect(notes.nth(1)).toContainText('Ebd., S. 55, und Dittscheid 1987, S. 205.');
  await expect(notes.nth(2).locator('.missing')).toHaveText('nope-2000');        // not in the bibliography yet
  await expect(userA.locator('.md section.bibliography')).toContainText('Dittscheid 1987: Hans-Christoph Dittscheid, Kassel-Wilhelmshöhe');

  const w = await api(request, '/artworks/plum-park-in-kameido');
  expect(w.description_html).toContain('<sup class="fn-ref"');
  expect(Object.keys(w.bibliography).sort()).toEqual(['busch-1993', 'dittscheid-1987']);
  expect(w.bibliography['busch-1993'].siglum).toBe('Busch 1993');
  const list = await api(request, '/bibliography');
  expect(list.stats).toEqual({ total: 2, read: 1, reading: 0, to_read: 0 });
  expect(list.data.map((s) => s.siglum)).toEqual(['Busch 1993', 'Dittscheid 1987']);
  const src = await api(request, '/bibliography/busch-1993');
  expect(src.citation).toContain('<i>Das sentimentalische Bild. Die Krise');
  expect(src.mentioned_in.map((m) => m.slug)).toEqual(['plum-park-in-kameido']);  // "cited in"
  await userA.goto('/quality?check=broken_link');
  await expect(userA.locator('main')).toContainText('nope-2000');
  sql("UPDATE artworks SET description_md = NULL WHERE slug = 'plum-park-in-kameido'");
});
