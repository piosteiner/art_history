// Series and other wholes (migration 037): a whole with its numbered parts, new parts prefilled, existing artworks
// added, order and neighbours, the loop guard, publishers, the public API.
const { test, expect, sql, submitForm, settled, API } = require('./helpers');

// also when the test fails half-way: its works left behind would stop the YAML round trip (yaml-roundtrip.spec.js)
test.afterAll(() => sql("DELETE FROM artworks WHERE slug IN ('print-twenty-one', 'thirty-six-views-test')"));

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a series with numbered parts: new and existing parts, order, neighbours, missing numbers, API', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Thirty-six Views Test');
  await userA.fill('#f-kind', 'series');
  await expect(userA.locator('#group-parent')).toHaveAttribute('open', '');  // a whole: the series fields open by themselves
  await userA.fill('#f-parts_count', '46');
  await userA.fill('#f-creator', 'katsushika-hokusai');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-created', '1830/1832');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/thirty-six-views-test\?done=created/);
  await expect(userA.locator('#parts + p')).toContainText('0 of 46 entered');

  // a new part: prefilled with the series and its creator
  await userA.click('a:has-text("+ New part")');
  await expect(userA.locator('#group-parent')).toHaveAttribute('open', '');  // prefilled → open
  await expect(userA.locator('#f-parent')).toHaveValue('thirty-six-views-test');
  await expect(userA.locator('#f-creator')).toHaveValue('katsushika-hokusai');
  await userA.fill('#f-title', 'Print Twenty-one');
  await userA.fill('#f-part_number', '21');
  await submitForm(userA);
  await expect(userA.locator('.part-of')).toContainText('No. 21 of 46 in Thirty-six Views Test');

  // an existing artwork as No. 1
  await userA.goto('/artworks/thirty-six-views-test');
  await userA.fill('input[name=part]', 'the-great-wave-off-kanagawa');
  await userA.keyboard.press('Escape');
  await userA.fill('input[name=part_number]', '1');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/parts"] button:has-text("Add")')]);
  await expect(userA.locator('.parts-list figcaption')).toHaveText([/^1 · The Great Wave/, /^21 · Print Twenty-one/]);
  await expect(userA.locator('#parts + p')).toContainText('2 of 46 entered — missing numbers: 2, 3, 4');
  await userA.goto('/artworks/the-great-wave-off-kanagawa');
  await expect(userA.locator('.part-of')).toContainText('No. 1 of 46 in Thirty-six Views Test');
  await expect(userA.locator('.part-of')).toContainText('Print Twenty-one →');

  const whole = await api(request, '/artworks/thirty-six-views-test');
  expect(whole.parts_count).toBe(46);
  expect(whole.parts.map((p) => [p.part_number, p.slug])).toEqual([['1', 'the-great-wave-off-kanagawa'], ['21', 'print-twenty-one']]);
  const wave = await api(request, '/artworks/the-great-wave-off-kanagawa');
  expect(wave.part_of.map((w) => w.slug)).toEqual(['thirty-six-views-test']);
  expect(wave.part_number).toBe('1');
  expect(wave.next_part).toEqual({ slug: 'print-twenty-one', title: 'Print Twenty-one', part_number: '21' });
  expect((await api(request, '/artworks?part_of=thirty-six-views-test')).data.map((a) => a.slug).sort()).toEqual(['print-twenty-one', 'the-great-wave-off-kanagawa']);
  await userA.goto('/quality?check=part_missing_data');                          // Print Twenty-one has no date
  await expect(userA.locator('main')).toContainText('no date — its whole, Thirty-six Views Test, has 1830–1832');

  // no loops: the series can't become a part of its own part
  sql(`UPDATE artworks SET parent_id = NULL, part_number = NULL WHERE slug = 'the-great-wave-off-kanagawa'`);
  expect(() => sql(`UPDATE artworks SET parent_id = entity_id('artwork', 'print-twenty-one') WHERE slug = 'thirty-six-views-test'`))
    .toThrow(/part of itself/);

  // the publisher
  await userA.goto('/people/theo-van-gogh');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'published');
  await userA.fill('#r-to', 'artwork/thirty-six-views-test');
  await userA.keyboard.press('Escape');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await settled();   // the entry page reads graph_links, a moment behind (126)
  await userA.goto('/artworks/thirty-six-views-test');
  await expect(userA.locator('tr', { hasText: 'Theo van Gogh' })).toContainText('published by');

  // the whole's map carries its parts at the places they depict (2026-11-04): No. 21 at The Hague (the wave left the series above)
  sql(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, label, certainty)
       VALUES ('artwork', entity_id('artwork', 'print-twenty-one'), 'depicts', 'place', entity_id('place', 'the-hague'), 'the beach at Scheveningen', 'probable')`);
  const map = await api(request, '/map/artworks/thirty-six-views-test');
  const placed = map.parts.features.map((f) => f.properties);
  expect(placed.find((p) => p.slug === 'print-twenty-one')).toMatchObject({ layer: 'part', number: '21', title: 'Print Twenty-one',
    place: { slug: 'the-hague', name: 'The Hague' }, certainty: 'probable', note: 'the beach at Scheveningen' });
  expect(placed.map((p) => p.slug)).toEqual(['print-twenty-one']);
  expect(map.parts.unplaced).toEqual([]);
  sql("DELETE FROM relationships WHERE subject_id = entity_id('artwork', 'print-twenty-one') AND relationship_type = 'depicts'");
  expect((await api(request, '/map/artworks/thirty-six-views-test')).parts.unplaced).toMatchObject([{ number: '21', slug: 'print-twenty-one' }]);
  expect((await api(request, '/map/artworks/print-twenty-one')).parts).toBeUndefined();   // a part, not a whole
  sql("DELETE FROM artworks WHERE slug IN ('print-twenty-one', 'thirty-six-views-test')");
});
