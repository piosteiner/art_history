// The glossary (migration 027): terms with a category and short definition, [[links]] in texts with completion in the
// editor, "used in", the public API with definitions for tooltips, and the check for links to missing terms.
const { test, expect, sql, liveReady, settled, submitForm, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a term, linked from a biography with [[ completion; used in; API with the definition', async ({ userA, request }) => {
  await userA.goto('/glossary/new');
  await userA.fill('#f-name', 'Contrapposto');
  await expect(userA.locator('#f-slug')).toHaveValue('contrapposto');
  await userA.selectOption('#f-category', 'technique');
  await userA.fill('#f-definition', 'A standing pose with the weight on one leg, the body turned slightly.');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/glossary\/contrapposto\?done=created/);
  await expect(userA.locator('#used-in + p')).toContainText('No text links it yet');

  // in the editor: "[[contra" lists the term, Enter writes the link
  await userA.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  const cm = userA.locator('.md-editor .cm-content').first();
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type(' Figures in [[contra', { delay: 20 });
  await expect(userA.locator('.cm-tooltip-autocomplete li').first()).toContainText('Contrapposto');
  await userA.waitForTimeout(200);  // CodeMirror ignores Enter for a moment after the list opens (no accidental picks)
  await userA.keyboard.press('Enter');
  await userA.keyboard.type('.');
  await expect.poll(() => userA.evaluate(() => document.querySelector('#f-biography_md').value)).toMatch(/Figures in \[\[contrapposto\]\]\.$/);
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('.md a.glossary-link')).toHaveText('Contrapposto');

  await userA.goto('/glossary/contrapposto');
  await expect(userA.locator('#used-in + ul')).toContainText('Paul Gauguin');
  const artist = await api(request, '/artists/paul-gauguin');
  expect(artist.biography_html).toContain('<a href="/glossary/contrapposto" class="glossary-link" data-term="contrapposto"');
  expect(artist.glossary).toEqual({ contrapposto: { name: 'Contrapposto', category: 'technique', definition: 'A standing pose with the weight on one leg, the body turned slightly.' } });
  const term = await api(request, '/glossary/contrapposto');
  expect(term).toMatchObject({ type: 'term', name: 'Contrapposto', category: 'technique' });
  expect(term.used_in).toEqual([{ type: 'artist', slug: 'paul-gauguin', name: 'Paul Gauguin' }]);
  expect((await api(request, '/glossary?category=technique')).data.map((x) => x.slug)).toEqual(['contrapposto']);
});

test('a link to a missing term is shown as such and reported on the quality page', async ({ userA }) => {
  sql("UPDATE artworks SET description_md = 'Seen as [[mitate-e]].' WHERE slug = 'plum-park-in-kameido'");
  await userA.goto('/artworks/plum-park-in-kameido');
  await expect(userA.locator('.md a.glossary-link.missing')).toHaveText('mitate-e');
  await userA.goto('/quality?check=broken_glossary_link');
  await expect(userA.locator('main')).toContainText('links to the glossary term "mitate-e"');
  sql("UPDATE artworks SET description_md = NULL WHERE slug = 'plum-park-in-kameido'");
});

test.afterAll(() => { sql("DELETE FROM glossary WHERE slug IN ('yoroboshi', 'noh')"); });

test('broader terms: a performing-arts term under another, shown both ways; no loops (145)', async ({ userA, request }) => {
  await userA.goto('/glossary/new');
  await userA.fill('#f-name', 'Noh');
  await userA.selectOption('#f-category', 'performing arts');
  await userA.fill('#f-definition', 'Japanese masked dance-drama.');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/glossary\/noh\?done=created/);

  await userA.goto('/glossary/new');
  await userA.fill('#f-name', 'Yoroboshi');
  await userA.selectOption('#f-category', 'performing arts');
  await expect(userA.locator('label[for="f-parent"]')).toHaveText('Broader term');
  await userA.fill('#f-parent', 'noh');
  await userA.fill('#f-definition', 'Noh play.');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/glossary\/yoroboshi\?done=created/);
  expect(sql("SELECT p.slug FROM glossary g JOIN glossary p ON p.id = g.parent_id WHERE g.slug = 'yoroboshi'")).toBe('noh');

  // the API: broader upwards, narrower downwards
  const play = await api(request, '/glossary/yoroboshi');
  expect(play).toMatchObject({ category: 'performing arts', broader: [{ slug: 'noh', name: 'Noh' }], narrower: [] });
  const genre = await api(request, '/glossary/noh');
  expect(genre.narrower).toEqual([{ slug: 'yoroboshi', name: 'Yoroboshi', category: 'performing arts', definition: 'Noh play.' }]);
  // the list rows name the broader term; a collection (metadata.collection — the calendars) says how many it files
  // and its narrower terms say so (the site lists them under it only, 2026-11-04)
  await settled();
  const listed = async () => (await api(request, '/glossary?limit=500')).data;
  expect((await listed()).find((t) => t.slug === 'yoroboshi').parent).toEqual({ slug: 'noh', name: 'Noh', collection: false });
  sql(`UPDATE glossary SET metadata = '{"collection": true}' WHERE slug = 'noh'`);
  await settled();
  expect((await listed()).find((t) => t.slug === 'noh').collects).toBe(1);
  expect((await listed()).find((t) => t.slug === 'yoroboshi').parent.collection).toBe(true);
  sql("UPDATE glossary SET metadata = '{}' WHERE slug = 'noh'");

  // a loop is refused with a readable message, nothing saved
  await userA.goto('/glossary/noh/edit');
  await userA.fill('#f-parent', 'yoroboshi');
  await Promise.all([userA.waitForLoadState(), userA.click('form.form > .actions button')]);
  await expect(userA.locator('main')).toContainText('That would make it part of itself');
  expect(sql("SELECT parent_id IS NULL FROM glossary WHERE slug = 'noh'")).toBe('t');
});

// 234/235: new categories ("style" now "art style"); a term in further categories for browsing — the main one alone does
// the work, and ticking it among the further ones changes nothing
test('a term in further categories: ticked in the form, shown on its page, found by the API\'s category filter (235)', async ({ userA, request }) => {
  sql("DELETE FROM glossary WHERE slug = 'test-mappo'");
  await userA.goto('/glossary/new');
  await userA.fill('#f-name', 'Test mappō');
  await userA.fill('#f-slug', 'test-mappo');
  await userA.selectOption('#f-category', 'religion');
  await expect(userA.locator('#f-category option')).toContainText(['art style', 'religion', 'politics', 'arts and customs']);
  await userA.locator('.also-in input[value="politics"]').check();
  await userA.locator('.also-in input[value="religion"]').check();   // the main category: dropped on save
  await userA.fill('#f-definition', 'Test: the degenerate last age of the Buddhist law.');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/glossary\/test-mappo\?done=created/);
  await expect(userA.locator('dl.fields')).toContainText('politics');
  expect(sql("SELECT also_in::text FROM glossary WHERE slug = 'test-mappo'")).toBe('{politics}');
  const term = await api(request, '/glossary/test-mappo');
  expect(term).toEqual(expect.objectContaining({ category: 'religion', also_in: ['politics'] }));
  for (const c of ['religion', 'politics']) {
    expect((await api(request, `/glossary?category=${c}&limit=500`)).data.map((t) => t.slug)).toContain('test-mappo');
  }
  expect((await api(request, '/glossary?category=society&limit=500')).data.map((t) => t.slug)).not.toContain('test-mappo');
  // the form shows the ticks again; unticked, it is in its main category only
  await userA.goto('/glossary/test-mappo/edit');
  await liveReady(userA);   // the live working copy: tick boxes kept as one field, one value per line
  await expect(userA.locator('.also-in input[value="politics"]')).toBeChecked();
  await expect(userA.locator('.also-in input[value="society"]')).not.toBeChecked();
  await userA.locator('.also-in input[value="politics"]').uncheck();
  await userA.locator('.also-in input[value="society"]').check();
  await userA.locator('.also-in input[value="aesthetics"]').check();
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect.poll(() => sql("SELECT also_in::text FROM glossary WHERE slug = 'test-mappo'")).toBe('{aesthetics,society}');
  sql("DELETE FROM glossary WHERE slug = 'test-mappo'");
});
