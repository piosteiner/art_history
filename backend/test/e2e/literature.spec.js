// Literary works (192/193): a type of its own — kind, when written, chapters as parts; written by (a chapter shows its
// whole's author), illustrated by works of art (on the work's page with the chapter named), editions in the bibliography.
const { test, expect, sql, submitForm, settled, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql(`DELETE FROM relationships WHERE subject_type = 'literature' OR object_type = 'literature';
  DELETE FROM bibliography WHERE slug = 'test-lit-tyler-2001';
  DELETE FROM literary_works WHERE parent_id IS NOT NULL AND slug LIKE 'test-lit-%'; DELETE FROM literary_works WHERE slug LIKE 'test-lit-%';
  DELETE FROM people WHERE slug = 'test-lit-murasaki'; DELETE FROM artworks WHERE slug = 'test-lit-scroll'`);
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
  expect(w.parts).toEqual([expect.objectContaining({ slug: 'test-lit-wakamurasaki', part_number: '5' })]);
  expect(w.editions).toEqual([expect.objectContaining({ slug: 'test-lit-tyler-2001', year: '2001' })]);
  expect(w.illustrations).toEqual([expect.objectContaining({ slug: 'test-lit-scroll', part: expect.objectContaining({ slug: 'test-lit-wakamurasaki', part_number: '5' }) })]);
  // the chapter: its whole's author, its place in the whole
  const ch = await api(request, '/literary-works/test-lit-wakamurasaki');
  expect(ch.authors.map((a) => a.slug)).toEqual(['test-lit-murasaki']);
  expect(ch.part_of).toEqual(expect.objectContaining({ slug: 'test-lit-genji', parts_count: 1 }));
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
