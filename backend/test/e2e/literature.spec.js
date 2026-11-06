// Literary works (192/193): a type of its own — kind, when written, chapters as parts; written by (a chapter shows its
// whole's author), illustrated by works of art (on the work's page with the chapter named), editions in the bibliography.
const { test, expect, sql, submitForm, settled, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql(`DELETE FROM relationships WHERE subject_type = 'literature' OR object_type = 'literature';
  DELETE FROM bibliography WHERE slug = 'test-lit-tyler-2001';
  DELETE FROM literary_works WHERE parent_id IS NOT NULL AND slug LIKE 'test-lit-%'; DELETE FROM literary_works WHERE slug LIKE 'test-lit-%';
  DELETE FROM people WHERE slug = 'test-lit-murasaki'; DELETE FROM artworks WHERE slug = 'test-lit-scroll';
  DELETE FROM glossary WHERE slug = 'test-lit-heroic-epic'; DELETE FROM glossary WHERE slug = 'test-lit-epic-poem'`);
test.beforeAll(cleanup);
test.afterAll(cleanup);

test('a literary work: created in the CMS, a chapter, its author, a scroll illustrating the chapter, an edition; API and links', async ({ userA, request }) => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-lit-murasaki', 'Murasaki Shikibu');
       INSERT INTO artworks (slug, title) VALUES ('test-lit-scroll', 'Test Genji scroll')`);
  await userA.goto('/literary-works/new');
  await userA.fill('#f-name', 'Test Tale of Genji');
  await expect(userA.locator('#f-slug')).toHaveValue('test-tale-of-genji');
  await userA.fill('#f-slug', 'test-lit-genji');
  await userA.fill('#f-kind', 'tale');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-written', 'c. 1010');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/literary-works\/test-lit-genji\?done=created/);

  // the summary (the Markdown editor: set directly) links its author
  sql(`UPDATE literary_works SET description_md = 'The life and loves of the Shining Prince, written by [[person/test-lit-murasaki]].' WHERE slug = 'test-lit-genji';
  INSERT INTO literary_works (slug, name, kind, parent_id, part_number) VALUES ('test-lit-wakamurasaki', 'Wakamurasaki', 'chapter', entity_id('literature', 'test-lit-genji'), '5')`);
  // written by: added on the work's page like any relationship
  await userA.goto('/literary-works/test-lit-genji');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'written_by');
  await userA.fill('#r-to', 'person/test-lit-murasaki');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  // the scroll illustrates the chapter
  await userA.goto('/artworks/test-lit-scroll');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'illustrates');
  await userA.fill('#r-to', 'literature/test-lit-wakamurasaki');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  // a translation in the bibliography: an edition of the work
  sql(`INSERT INTO bibliography (slug, kind, name, authors, year, edition_of) VALUES ('test-lit-tyler-2001', 'book', 'The Tale of Genji (tr.)', '{"Tyler, Royall"}', '2001', entity_id('literature', 'test-lit-genji'))`);
  await settled();

  // the API: the whole with its author, chapter, editions and the illustration (the chapter named)
  const w = await api(request, '/literary-works/test-lit-genji');
  expect(w).toEqual(expect.objectContaining({ type: 'literature', kind: 'tale', written: expect.objectContaining({ label: 'c. 1010' }) }));
  expect(w.authors).toEqual([expect.objectContaining({ type: 'person', slug: 'test-lit-murasaki', name: 'Murasaki Shikibu' })]);
  expect(w.parts).toEqual([expect.objectContaining({ slug: 'test-lit-wakamurasaki', part_number: '5', original: null, summary: null })]);
  expect(w.editions).toEqual([expect.objectContaining({ slug: 'test-lit-tyler-2001', year: '2001' })]);
  expect(w.illustrations).toEqual([expect.objectContaining({ slug: 'test-lit-scroll', part: expect.objectContaining({ slug: 'test-lit-wakamurasaki', part_number: '5' }) })]);
  // the chapter: its whole's author, its place in the whole
  const ch = await api(request, '/literary-works/test-lit-wakamurasaki');
  expect(ch.authors.map((a) => a.slug)).toEqual(['test-lit-murasaki']);
  expect(ch.part_of).toEqual(expect.objectContaining({ slug: 'test-lit-genji', parts_count: 1, previous: null, next: null }));
  // the list: the whole, its parts and pictures counted
  const list = await api(request, '/literary-works?top=1');
  expect(list.data.find((x) => x.slug === 'test-lit-genji')).toEqual(expect.objectContaining({ parts_count: 1, illustrations_count: 1 }));
  expect(list.data.some((x) => x.slug === 'test-lit-wakamurasaki')).toBe(false);
  // the artwork names what it illustrates; previews and [[literature/…]] links
  const scroll = await api(request, '/artworks/test-lit-scroll');
  expect(JSON.stringify(scroll.relationships)).toContain('test-lit-wakamurasaki');
  const prev = await api(request, '/previews?refs=literature/test-lit-genji');
  expect(prev.data['literature/test-lit-genji'].subtitle).toBe('tale · Murasaki Shikibu · c. 1010');
  // found by its author's name in the CMS list
  await userA.goto('/literary-works?q=murasaki');
  await expect(userA.locator('table')).toContainText('Wakamurasaki');
});

// 209: a chapter and its whole are connected through each other, without any relationship
test('a chapter and its work are not "not connected to anything"', () => {
  sql(`INSERT INTO literary_works (slug, name, kind) VALUES ('test-lit-lonely', 'Test lonely tale', 'tale');
       INSERT INTO literary_works (slug, name, kind, parent_id, part_number) VALUES ('test-lit-lonely-1', 'Test chapter', 'chapter', entity_id('literature', 'test-lit-lonely'), '1')`);
  const unconnected = () => sql(`SELECT count(*) FROM quality_issues_live q JOIN literary_works l ON l.id = q.entity_id
    WHERE q.check_id = 'no_relationships' AND q.entity_type = 'literature' AND l.slug LIKE 'test-lit-lonely%'`);
  expect(unconnected()).toBe('0');
  sql(`DELETE FROM literary_works WHERE slug = 'test-lit-lonely-1'`);
  expect(unconnected()).toBe('1');                                                          // a work alone still is
});

// 233: the kind is a literary genre of the glossary — typed in any language, stored as the term's name, found by every
// name of the genre and of its broader terms; ?kind= takes a term and the narrower ones; a renamed term carries the works
test('a literary work\'s kind is a genre: Heldenepos → heroic epic, found as Epos and epic poem; filtered by the broader term', async ({ userA, request }) => {
  sql(`INSERT INTO glossary (slug, name, category, definition, names) VALUES ('test-lit-epic-poem', 'test epic poem', 'literary genre', 'A long narrative poem.',
         '[{"text": "Testepos", "lang": "de", "role": "translation"}]');
       INSERT INTO glossary (slug, name, category, definition, parent_id, names) VALUES ('test-lit-heroic-epic', 'test heroic epic', 'literary genre', 'An epic about a hero.',
         (SELECT id FROM glossary WHERE slug = 'test-lit-epic-poem'), '[{"text": "Testheldenepos", "lang": "de", "role": "translation"}]')`);
  await userA.goto('/literary-works/new');
  await userA.fill('#f-name', 'Test Nibelungenlied');
  await userA.fill('#f-slug', 'test-lit-nibelungen');
  await userA.fill('#f-kind', 'Testheldenepos');
  await userA.keyboard.press('Escape');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/literary-works\/test-lit-nibelungen\?done=created/);
  const work = await api(request, '/literary-works/test-lit-nibelungen');
  expect(work.kind).toBe('test heroic epic');
  expect(work.kind_term).toEqual({ slug: 'test-lit-heroic-epic', name: 'test heroic epic' });

  // the list's search field "Kind" matches every name of the genre and of the broader one
  await settled();
  const row = (await api(request, '/literary-works?limit=500')).data.find((w) => w.slug === 'test-lit-nibelungen');
  const kind = row.search_fields.find((f) => f.label === 'Kind');
  expect(kind.text).toBe('test heroic epic');
  for (const word of ['Testheldenepos', 'Testepos', 'test epic poem']) expect(kind.match).toContain(word);
  // ?kind= by the broader term (slug or a name in another language) finds the narrower one's works
  for (const k of ['test-lit-epic-poem', 'Testepos', 'test heroic epic']) {
    expect((await api(request, `/literary-works?kind=${encodeURIComponent(k)}`)).data.map((w) => w.slug)).toContain('test-lit-nibelungen');
  }
  // the term renamed: the work's kind follows
  sql(`UPDATE glossary SET name = 'test heroic poem' WHERE slug = 'test-lit-heroic-epic'`);
  expect(sql(`SELECT kind FROM literary_works WHERE slug = 'test-lit-nibelungen'`)).toBe('test heroic poem');
});

// 237: a work's text — the original line by line with furigana, its romanization, a translation and whose; "written"
// and the text citable
test('a poem\'s text: original with furigana, romanization, translation — kept line by line, sent with the work', async ({ userA, request }) => {
  await userA.goto('/literary-works/new');
  await userA.fill('#f-name', 'Test frog poem');
  await userA.fill('#f-slug', 'test-lit-frog');
  await userA.fill('#f-kind', 'haiku');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-written', '1686');
  await userA.fill('#f-text_original', '{古池|ふるいけ}や\n{蛙|かわづ}{飛|と}びこむ\n{水|みず}の{音|おと}');
  await userA.fill('#f-text_lang', 'ja');
  await userA.fill('#f-text_romanization', 'furuike ya\nkawazu tobikomu\nmizu no oto');
  await userA.fill('#f-text_translation', 'An old pond —\na frog jumps in:\nthe sound of water.');
  await userA.fill('#f-text_translator', 'own');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/literary-works\/test-lit-frog\?done=created/);
  await expect(userA.locator('.lines ruby').first()).toContainText('古池');
  const w = await api(request, '/literary-works/test-lit-frog');
  expect(w).toEqual(expect.objectContaining({ text_original: '古池や\n蛙飛びこむ\n水の音', text_lang: 'ja', text_romanization: 'furuike ya\nkawazu tobikomu\nmizu no oto',
    text_translation: 'An old pond —\na frog jumps in:\nthe sound of water.', text_translator: 'own' }));
  expect(w.text_original_html).toContain('<ruby>古池<rp>(</rp><rt>ふるいけ</rt><rp>)</rp></ruby>や\n');
  // the date and the text take sources
  expect(sql("SELECT string_agg(field, ',' ORDER BY position) FROM citable_fields WHERE entity_type = 'literature'")).toBe('kind,written,text,translation');
});
