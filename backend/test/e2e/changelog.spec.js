// The public changelog and roadmap (migration 118, src/admin/routes/changelog.js, GET /v1/changelog, /v1/roadmap):
// bullets one per line with their kind, drafts off the site, an item marked done written into today's entry.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
test.afterEach(() => sql('DELETE FROM changelog_entries; DELETE FROM roadmap_items'));

test('changelog: an entry with kinds, a draft until published, in the API and the RSS feed', async ({ userA, request }) => {
  await userA.goto('/changelog');
  await userA.click('a:has-text("+ New entry")');
  await userA.fill('#cl-day', '2026-10-19');
  await userA.fill('#cl-title', 'Patch: Suche');
  await userA.fill('#cl-items', 'Neu: Suche über Sprachen hinweg mit [[artist/paul-gauguin|Gauguin]]\nbehoben: Treffer öffnen beim Fund\n  auch in der Provenienz\nOhne Art');
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/\/changelog\/\d+\/edit\?done=created/);
  await expect(userA.locator('#cl-items')).toHaveValue('Neu: Suche über Sprachen hinweg mit [[artist/paul-gauguin|Gauguin]]\nBehoben: Treffer öffnen beim Fund\n  auch in der Provenienz\nNeu: Ohne Art');
  await expect(userA.locator('.changelog-preview li')).toHaveCount(3);
  await expect(userA.locator('.changelog-preview a', { hasText: 'Gauguin' })).toBeVisible();

  // a draft: not on the site
  expect((await api(request, '/changelog')).total).toBe(0);
  await userA.check('input[name=published]');
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Save")')]);
  const data = await api(request, '/changelog');
  expect(data.total).toBe(1);
  expect(data.data[0]).toMatchObject({ day: '2026-10-19', title: 'Patch: Suche' });
  expect(data.data[0].items.map((i) => i.kind)).toEqual(['neu', 'behoben', 'neu']);
  expect(data.data[0].items[0].html).toContain('Gauguin</a>');
  expect(data.data[0].items[0].html).not.toContain('<p>');
  expect((await api(request, '/changelog?kind=behoben')).data[0].items.map((i) => i.label)).toEqual(['Behoben']);

  const rss = await request.get(`${API}/changelog/feed.xml`, { headers: { Host: 'api.localhost' } });
  expect(rss.headers()['content-type']).toContain('xml');
  expect(await rss.text()).toContain('<title>Patch: Suche</title>');

  await userA.goto('/changelog');
  await expect(userA.locator('tr', { hasText: 'Patch: Suche' })).toContainText('2 Neu · 1 Behoben');
});

test('roadmap: columns, order, done items written into today\'s changelog', async ({ userA, request }) => {
  await userA.goto('/roadmap');
  for (const [title, status] of [['Historische Karten', 'spaeter'], ['Ausstellungsgeschichte', 'naechstes'], ['Projekt Dokumentation', 'jetzt']]) {
    await userA.fill('#rm-title', title);
    await userA.fill('#rm-area', 'Website');
    await userA.selectOption('#rm-status', status);
    await Promise.all([userA.waitForNavigation(), userA.click('.roadmap-form button:has-text("+ Add")')]);
  }
  await expect(userA.locator('.roadmap-jetzt')).toContainText('Projekt Dokumentation');
  await expect(userA.locator('.roadmap-spaeter')).toContainText('Historische Karten');

  // done: into a new draft entry of today, linked to the item
  await Promise.all([userA.waitForNavigation(), userA.locator('.roadmap-jetzt button:has-text("✓ Erledigt")').click()]);
  await expect(userA.locator('.flash')).toContainText("today's changelog");
  await expect(userA.locator('.roadmap-erledigt')).toContainText('in the changelog');
  expect(sql(`SELECT e.day::text || ' ' || e.published || ' ' || i.text_md FROM changelog_items i JOIN changelog_entries e ON e.id = i.entry_id
    WHERE i.roadmap_item_id IS NOT NULL`)).toBe(`${today()} false Projekt Dokumentation`);

  // the API: the published items per column, done with the day
  const { columns } = await api(request, '/roadmap');
  expect(columns.map((c) => c.status)).toEqual(['jetzt', 'naechstes', 'spaeter', 'erledigt']);
  expect(columns[3].items[0]).toMatchObject({ title: 'Projekt Dokumentation', done_on: today(), area: 'Website' });

  // dragged order within a column
  sql("INSERT INTO roadmap_items (title, status, position) VALUES ('Tracing Art', 'spaeter', 100)");
  const ids = sql("SELECT string_agg(id::text, ',' ORDER BY position DESC) FROM roadmap_items WHERE status = 'spaeter'");
  expect(await userA.evaluate((body) => fetch('/roadmap/order', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then((r) => r.status), `ids=${ids}`)).toBe(204);
  expect((await api(request, '/roadmap')).columns[2].items.map((i) => i.title)).toEqual(['Tracing Art', 'Historische Karten']);

  // the bullet keeps its link when the entry is saved again unchanged
  const entry = sql('SELECT entry_id FROM changelog_items LIMIT 1');
  await userA.goto(`/changelog/${entry}/edit`);
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Save")')]);
  expect(sql('SELECT count(*) FROM changelog_items WHERE roadmap_item_id IS NOT NULL')).toBe('1');
});
