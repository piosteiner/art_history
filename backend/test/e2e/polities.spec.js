// Polities and countries (migration 019): a polity entry, nationality links, today's country derived from places,
// the public API (country, birth_place, polities, filters) and the quality check for links outside a polity's existence.
const { test, expect, sql, submitForm } = require('./helpers');

const API = 'http://127.0.0.1:3006/v1';
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a polity: country codes are checked, then it can be created', async ({ userA }) => {
  await userA.goto('/polities/new');
  await userA.fill('#f-slug', 'ussr');
  await userA.fill('#f-name', 'Soviet Union');
  await userA.locator('.names-row .n-text').first().fill('USSR');
  await userA.fill('#f-period', '1922-12-30/1991-12-26');
  await userA.fill('#f-country_codes', 'RU\nukr');
  await submitForm(userA);
  await expect(userA.locator('.flash.error, ul.errors')).toContainText('two capital letters each');
  await userA.fill('#f-country_codes', 'RU\nUA\nBY');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/polities\/ussr\?done=created/);
  await userA.goto('/polities');
  await expect(userA.locator('tr', { hasText: 'Soviet Union' })).toBeVisible();
});

test('nationality: linked from the artist, shown on the polity, in the API with today\'s country', async ({ userA, request }) => {
  await userA.goto('/artists/katsushika-hokusai');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'nationality');
  await userA.fill('#r-to', 'polity/ussr');
  await userA.keyboard.press('Escape');
  await userA.fill('#r-period', '1800');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  // USSR in 1800: a contradiction the quality check reports
  await expect(userA.locator('.qa-box')).toContainText('Linked to a polity outside its existence');

  await userA.goto('/polities/ussr');
  await expect(userA.locator('tr', { hasText: 'Katsushika Hokusai' })).toContainText('nationality of');

  const a = await api(request, '/artists/katsushika-hokusai');
  expect(a.birth_place).toEqual({ slug: 'edo', name: 'Edo', country_code: 'JP' });
  expect(a.country).toMatchObject({ code: 'JP', name: 'Japan', source: 'place', place: { slug: 'edo' } });
  expect(a.polities).toHaveLength(1);
  expect(a.polities[0]).toMatchObject({ slug: 'ussr', name: 'Soviet Union', relationship: 'nationality', country_codes: ['RU', 'UA', 'BY'] });
  expect((await api(request, '/artists?polity=ussr')).data.map((x) => x.slug)).toEqual(['katsushika-hokusai']);
  expect((await api(request, '/artists?country=jp')).data.map((x) => x.slug).sort()).toEqual(['katsushika-hokusai', 'utagawa-hiroshige']);
  const p = await api(request, '/polities/ussr');
  expect(p.period.label).toBe('30 December 1922–26 December 1991');
  expect(p.relationships[0]).toMatchObject({ label: 'nationality of', entity: { slug: 'katsushika-hokusai' } });
  expect((await api(request, '/polities?country=ua')).data.map((x) => x.slug)).toEqual(['ussr']);
  sql("DELETE FROM relationships WHERE relationship_type = 'nationality'");  // leave no quality error behind
});

test('today\'s country: inherited from the parent place, named from the ISO code without a country entry', async ({ request }) => {
  sql("UPDATE places SET country_code = NULL WHERE slug = 'zundert'");  // Zundert → its parent Netherlands (NL)
  expect((await api(request, '/artists/vincent-van-gogh')).country).toMatchObject({ code: 'NL', name: 'Netherlands', place: { slug: 'zundert' } });
  sql("UPDATE places SET country_code = 'NL' WHERE slug = 'zundert'");
  expect((await api(request, '/institutions?limit=500')).data.find((i) => i.slug === 'van-gogh-museum').country.code).toBe('NL');
  // An artwork without a place but linked to a polity in one modern country: "today" comes from the polity.
  sql("INSERT INTO polities (slug, name, country_codes) VALUES ('han-dynasty', 'Han dynasty', '{CN}')");
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-bronze', 'Test bronze');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
       VALUES ('artwork', entity_id('artwork', 'test-bronze'), 'created_in_polity', 'polity', entity_id('polity', 'han-dynasty'))`);
  expect((await api(request, '/artworks/test-bronze')).country).toMatchObject({ code: 'CN', name: 'China', source: 'polity', place: null });
  sql("DELETE FROM artworks WHERE slug = 'test-bronze'");
});
