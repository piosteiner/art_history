// A work's building history (migration 169, src/phases.js, src/admin/routes/phases.js): phases added and edited on
// the artwork's page, dragged into order; who took part becomes the work's co-creator (artist) or commissioner
// (patron) — on their pages and in the API — without a relationship typed; the API's `phases`; YAML export shape.
const { test, expect, sql, settled, submitForm, API, BASE } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
test.afterAll(() => sql("DELETE FROM artworks WHERE slug = 'test-phase-palace'"));

test('a building in phases: makers and patrons from the phases, in order, in the API and on their pages (169)', async ({ userA, request }) => {
  sql("INSERT INTO artworks (slug, title) VALUES ('test-phase-palace', 'Test Phase Palace')");
  await userA.goto('/artworks/test-phase-palace');
  await expect(userA.locator('#building-history + p')).toContainText('For buildings');

  // the first phase, with an artist (architect) and a patron
  await userA.click('a:has-text("+ Add a phase")');
  await userA.fill('#ph-period', '1698/1706');
  await userA.selectOption('#ph-kind', 'alteration');
  await userA.fill('#ph-title', 'Baroque rebuilding');
  await userA.fill('#ph-part', 'south and north wings');
  await userA.fill('#ph-people', 'artist/paul-gauguin | architect\nperson/theo-van-gogh | commissioned it | patron');
  await userA.locator('.md-editor .cm-content').first().click();                // the text's Markdown editor
  await userA.keyboard.insertText('Rebuilt as a royal residence.');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artworks\/test-phase-palace\?done=saved#building-history/);
  await expect(userA.locator('table.phases')).toContainText('Baroque rebuilding');

  // a mistake is shown, nothing saved
  await userA.click('a:has-text("+ Add a phase")');
  await userA.fill('#ph-title', 'Demolition');
  await userA.selectOption('#ph-kind', 'demolition');
  await userA.fill('#ph-people', 'artist/no-such-artist | engineer');
  await submitForm(userA);
  await expect(userA.locator('.flash')).toContainText('no artist “no-such-artist”');
  await userA.fill('#ph-people', 'person/theo-van-gogh | patron');   // the same patron again, no role
  await userA.fill('#ph-period', '1950-09-07/1951-03');
  await submitForm(userA);
  expect(sql("SELECT string_agg(title, ' | ' ORDER BY position) FROM artwork_phases WHERE artwork_id = entity_id('artwork', 'test-phase-palace')"))
    .toBe('Baroque rebuilding | Demolition');

  // dragged into another order (what the handles post)
  const ids = sql("SELECT string_agg(id::text, ',' ORDER BY position DESC) FROM artwork_phases WHERE artwork_id = entity_id('artwork', 'test-phase-palace')");
  expect((await userA.request.post(`${BASE}/artworks/test-phase-palace/phases/order`, { form: { ids }, headers: { Origin: BASE } })).status()).toBe(204);
  expect(sql("SELECT string_agg(title, ' | ' ORDER BY position) FROM artwork_phases WHERE artwork_id = entity_id('artwork', 'test-phase-palace')"))
    .toBe('Demolition | Baroque rebuilding');

  // the API: phases with who took part; the derived edges on the artist's and the patron's side
  await settled();
  const work = await api(request, '/artworks/test-phase-palace');
  expect(work.phases.map((p) => p.title)).toEqual(['Demolition', 'Baroque rebuilding']);
  expect(work.phases[1]).toMatchObject({ kind: 'alteration', part: 'south and north wings', period: { label: '1698–1706' } });
  expect(work.phases[1].people).toEqual([
    expect.objectContaining({ type: 'artist', slug: 'paul-gauguin', role: 'architect', patron: false }),
    expect.objectContaining({ type: 'person', slug: 'theo-van-gogh', role: 'commissioned it', patron: true })]);
  expect(work.phases[1].notes_html).toContain('Rebuilt as a royal residence.');
  const artist = await api(request, '/artists/paul-gauguin');
  expect(artist.artworks.find((w) => w.slug === 'test-phase-palace')).toMatchObject({ co_creator: true, role: 'architect · Baroque rebuilding' });
  // the patron of two phases: one line, both phases named, from the first start to the last end
  const patron = (await api(request, '/people/theo-van-gogh')).relationships.filter((r) => r.entity.slug === 'test-phase-palace');
  expect(patron).toHaveLength(1);
  expect(patron[0]).toMatchObject({ type: 'commissioned', label: 'commissioned', note: 'commissioned it · Baroque rebuilding; Demolition',
    period: { label: '1698–1706, 7 September 1950 – March 1951', from_year: 1698, to_year: 1951 } });

  // edited: the artist removed → the derived edge goes with it
  await userA.goto('/artworks/test-phase-palace');
  await userA.locator('table.phases tbody', { hasText: 'Baroque rebuilding' }).locator('a:has-text("edit")').click();
  await expect(userA.locator('#ph-people')).toHaveValue('artist/paul-gauguin | architect\nperson/theo-van-gogh | commissioned it | patron');
  await userA.goBack();
  await userA.locator('table.phases tbody', { hasText: 'Demolition' }).locator('a:has-text("edit")').click();
  await expect(userA.locator('#ph-people')).toHaveValue('person/theo-van-gogh | patron');
  await userA.goBack();
  await userA.locator('table.phases tbody', { hasText: 'Baroque rebuilding' }).locator('a:has-text("edit")').click();
  await userA.fill('#ph-people', 'person/theo-van-gogh | commissioned it | patron');
  await submitForm(userA);
  await settled();
  expect((await api(request, '/artists/paul-gauguin')).artworks.some((w) => w.slug === 'test-phase-palace')).toBe(false);
  expect(sql("SELECT count(*) FROM graph_links WHERE source = 'phase' AND artwork_id = entity_id('artwork', 'test-phase-palace')")).toBe('2');
});
