// An artwork's type and materials are glossary terms with names in several languages (migrations 070/071): typed in
// any language, stored under the term's name, linked; new words become terms; phrases are sorted out on a batch page;
// the API filters and the search names know every language.
const { test, expect, sql, settled, submitForm, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => {
  sql(`DELETE FROM artworks WHERE slug LIKE 'test-term-%';
       DELETE FROM auto_created WHERE entity_type = 'term' AND entity_id IN (SELECT id FROM glossary WHERE slug IN ('lacquer-painting-test', 'lackmalerei'));
       DELETE FROM glossary WHERE slug IN ('lacquer-painting-test', 'lackmalerei');
       DELETE FROM auto_created WHERE entity_type = 'term' AND entity_id IN (SELECT id FROM glossary WHERE slug = 'testschnitt');
       DELETE FROM glossary WHERE slug = 'testschnitt';
       UPDATE glossary SET name = 'woodblock print' WHERE slug = 'woodblock-print'`);
});

test('a type and materials typed in German are stored as the glossary terms and linked', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Term Print');
  await userA.fill('#f-kind', 'Holzschnitt');
  await userA.fill('#f-medium', 'Farbholzschnitt auf Papier, Tusche');
  await expect(userA.locator('.material-suggestions')).toContainText('+ paper');  // from the medium, through the German names
  await expect(userA.locator('.material-suggestions')).toContainText('+ ink');
  await userA.fill('#f-materials', 'Papier\nTusche\npaper');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-term-print\?done=created/);
  await expect(userA.locator('dl.fields a[href="/glossary/woodblock-print"]')).toHaveText('woodblock print');
  await expect(userA.locator('dl.fields')).toContainText('paper · ink');               // main names, "paper" once

  sql('SELECT refresh_quality()');                                                    // the stored search fields (111)
  const list = await api(request, '/artworks?kind=Holzschnitt');                      // any name of the term
  expect(list.data.map((a) => a.slug)).toContain('test-term-print');
  expect((await api(request, '/artworks?material=Tusche')).data.map((a) => a.slug)).toContain('test-term-print');
  const w = list.data.find((a) => a.slug === 'test-term-print');
  // every name of its terms, in the type's search field (110: list items carry search_fields, no term_names)
  const typeField = w.search_fields.find((f) => f.label === 'Type');
  for (const n of ['woodblock print', 'Holzschnitt', '木版画', 'paper', 'Papier']) expect(typeField.match).toContain(n);
  const d = await api(request, '/artworks/test-term-print');
  expect(d.kind_term).toEqual({ slug: 'woodblock-print', name: 'woodblock print' });
  expect(d.material_terms.map((m) => m.slug)).toEqual(['paper', 'ink']);

  // a term renamed: the artwork follows
  sql("UPDATE glossary SET name = 'woodcut print' WHERE slug = 'woodblock-print'");
  expect(sql("SELECT kind FROM artworks WHERE slug = 'test-term-print'")).toBe('woodcut print');
});

test('a new word becomes a term to translate; a phrase is sorted out on the batch page', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Term Box');
  await userA.fill('#f-kind', 'Lackmalerei');
  await userA.fill('#f-materials', 'Öl auf Leinwand');                              // a phrase: no term made of it
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-term-box\?done=created&auto=1/);
  expect(sql("SELECT category || ' ' || (SELECT count(*) FROM auto_created a WHERE a.entity_type = 'term' AND a.entity_id = g.id) FROM glossary g WHERE name = 'Lackmalerei'"))
    .toBe('object type 1');                                                          // flagged: translations to add
  await expect(userA.locator('dl.fields')).toContainText('Öl auf Leinwand no term');

  await userA.goto('/quality/batch/terms');
  const form = userA.locator('form.term-fix', { hasText: 'material “Öl auf Leinwand”' });
  await expect(form).toContainText('Test Term Box');
  await form.locator('input[name=into]').fill('Ölfarbe, Leinwand');
  await Promise.all([userA.waitForNavigation(), form.locator('button[value=replace]').click()]);
  await expect(userA.locator('.flash.ok', { hasText: 'Saved' })).toContainText('1 artwork changed');
  expect(sql("SELECT array_to_string(materials, ', ') FROM artworks WHERE slug = 'test-term-box'")).toBe('oil paint, canvas');
  await expect(userA.locator('form.term-fix', { hasText: 'Öl auf Leinwand' })).toHaveCount(0);
});

test('an entry whose stored type has no term yet saves: the new term touching the row is no conflict; a real one is', async ({ userA }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Term Stored');
  await userA.fill('#f-kind', 'woodblock print');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-term-stored\?done=created/);
  // stored before 071, or by an import: a word that is no term yet
  sql("UPDATE artworks SET kind = 'Testschnitt', kind_term_id = NULL WHERE slug = 'test-term-stored'");
  await userA.goto('/artworks/test-term-stored/edit');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-term-stored\?done=published/);
  expect(sql("SELECT g.slug FROM artworks w JOIN glossary g ON g.id = w.kind_term_id WHERE w.slug = 'test-term-stored'")).toBe('testschnitt');
  // someone else saved meanwhile: still refused
  await userA.goto('/artworks/test-term-stored/edit');
  sql("UPDATE artworks SET title = 'Test Term Stored' WHERE slug = 'test-term-stored'");
  await submitForm(userA);
  await expect(userA.locator('body')).toContainText('Someone saved this record while you were editing');
});

test('broader terms find the works under them: API filters and search names (146)', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Term Panel');
  await userA.fill('#f-kind', 'woodblock print');
  await userA.fill('#f-materials', 'paper');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-term-panel\?done=created/);

  // a broader term for paper, set in the form: "Testmaterial" with a German name
  await userA.goto('/glossary/new');
  await userA.fill('#f-name', 'Testmaterial');
  await userA.selectOption('#f-category', 'material');
  await submitForm(userA);
  await userA.goto('/glossary/paper/edit');
  await userA.fill('#f-parent', 'testmaterial');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await settled();                                                                   // the worker refreshed the works under it

  const slugs = async (q) => (await api(request, `/artworks?${q}`)).data.map((a) => a.slug);
  expect(await slugs('material=testmaterial')).toContain('test-term-panel');         // a narrower term's work
  expect(await slugs('material=paper')).toContain('test-term-panel');
  expect(await slugs('material=testmaterial')).not.toContain('impression-sunrise');  // only what is under it
  const w = (await api(request, '/artworks?material=testmaterial')).data.find((a) => a.slug === 'test-term-panel');
  expect(w.search_fields.find((f) => f.label === 'Type').match).toContain('Testmaterial');  // found by the broader name

  // unhooked again: the work loses the broader name (no drift in the stored search fields)
  sql("UPDATE glossary SET parent_id = NULL WHERE slug = 'paper'");
  await settled();
  const again = (await api(request, '/artworks?material=paper')).data.find((a) => a.slug === 'test-term-panel');
  expect(again.search_fields.find((f) => f.label === 'Type').match).not.toContain('Testmaterial');
  sql("DELETE FROM glossary WHERE slug = 'testmaterial'");
});
