// Events (migration 047): a type of its own — when, where, part of; depicted, taken part in (with a role), concerned.
const { test, expect, sql, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`http://127.0.0.1:3006/v1${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => {
  sql(`DELETE FROM events WHERE slug IN ('great-fire-of-meireki', 'great-fire-of-meireki-2', 'edo-fires-test');
       DELETE FROM places WHERE slug LIKE 'edo-2%'`);
});

test('an event: created with dates and place, depicted by an artwork, a person took part (role); API, map, links', async ({ userA, request }) => {
  sql(`INSERT INTO events (slug, name, kind, period, period_label) VALUES ('edo-fires-test', 'Fires of Edo', 'fire', '[1601-01-01,1868-01-01)', '1601–1867')`);
  await userA.goto('/events/new');
  await userA.fill('#f-name', 'Great Fire of Meireki');
  await expect(userA.locator('#f-slug')).toHaveValue('great-fire-of-meireki');
  await userA.fill('#f-kind', 'fire');
  await userA.fill('#f-parent', 'edo-fires-test');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-period', '1657-03-02/1657-03-04');
  await userA.fill('#f-place', 'edo');
  await userA.keyboard.press('Escape');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/events\/great-fire-of-meireki\?done=created/);

  // the handscroll depicts it; Hokusai (standing in for a witness) took part, the role in the label
  await userA.goto('/artworks/the-great-wave-off-kanagawa');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'depicts');
  await userA.fill('#r-to', 'event/great-fire-of-meireki');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await userA.goto('/artists/katsushika-hokusai');
  await userA.click('summary:has-text("+ Add relationship")');
  await userA.selectOption('#r-type', 'participated_in');
  await userA.fill('#r-to', 'event/great-fire-of-meireki');
  await userA.fill('#r-label', 'witness');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);

  // the API: list (by time window too), detail with place, whole, relationships; the whole lists its parts
  const list = await api(request, '/events?from=1650&to=1660');
  expect(list.data.map((e) => e.slug)).toContain('great-fire-of-meireki');
  const ev = await api(request, '/events/great-fire-of-meireki');
  expect(ev.period).toMatchObject({ from: '1657-03-02' });
  expect(ev.place).toMatchObject({ slug: 'edo' });
  expect(ev.part_of).toMatchObject({ slug: 'edo-fires-test' });
  expect(ev.country).toMatchObject({ code: 'JP' });
  expect(JSON.stringify(ev.relationships)).toContain('the-great-wave-off-kanagawa');
  expect(JSON.stringify(ev.relationships)).toContain('witness');
  expect((await api(request, '/events/edo-fires-test')).parts.map((p) => p.slug)).toEqual(['great-fire-of-meireki']);
  // on the events map (at its place), and on the participant's map
  const map = await api(request, '/map/events');
  expect(map.features.find((f) => f.properties.slug === 'great-fire-of-meireki').properties.precision).toBe('place');
  const hokusai = await api(request, '/map/artists/katsushika-hokusai');
  expect(hokusai.features.some((f) => f.properties.event && f.properties.event.slug === 'great-fire-of-meireki')).toBe(true);
  // [[event/…]] links and their previews
  const prev = await api(request, '/previews?refs=event/great-fire-of-meireki');
  expect(prev.data['event/great-fire-of-meireki'].subtitle).toBe('fire · Edo · 2 March–4 March 1657');

  // the quality page: connected (a place, a whole) — not "not connected to anything"
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'no_relationships' AND entity_type = 'event'`)).toBe('0');
});

test('an event from Wikidata: dates from start/end, place from "location"; then participants suggested', async ({ userA }) => {
  sql("DELETE FROM events WHERE slug = 'great-fire-of-meireki'");  // the first test's
  const apply = () => Promise.all([userA.waitForNavigation(), userA.click('.wd-form .sticky-actions button')]);
  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  await userA.goto('/events/new/wikidata?q=Q123');
  await expect(row('Period')).toContainText('1657-03-02/1657-03-04');
  await expect(row('Place')).toContainText('Edo');
  await row('Place').locator('input[value=link]').check();
  await apply();
  await expect(userA.locator('#f-period')).toHaveValue('1657-03-02/1657-03-04');
  await expect(userA.locator('#f-place')).toHaveValue('edo');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/events\/great-fire-of-meireki\?done=created/);
  expect(sql("SELECT wikidata_id FROM events WHERE slug = 'great-fire-of-meireki'")).toBe('Q123');
  // compared again: the participant (P710) is suggested — from the event's side "participants" — our Claude Monet (same Q-id)
  await userA.goto('/events/great-fire-of-meireki/wikidata');
  await expect(userA.locator('main')).toContainText('participants');
  await expect(userA.locator('main')).toContainText('Claude Monet');
});
