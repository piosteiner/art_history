// A source cites a piece of information once (143): the dialog greys out a source already cited there (suggestions
// and quick chips), the server refuses it with a message, "also for" leaves fields that cite it already alone; the
// database index holds even when the form is bypassed.
const { test, expect, sql } = require('./helpers');

test.beforeEach(() => sql("INSERT INTO bibliography (slug, name) VALUES ('test-twice-source', 'Test Twice Catalogue') ON CONFLICT DO NOTHING"));
test.afterEach(() => sql("DELETE FROM citations WHERE source_id = entity_id('source', 'test-twice-source'); DELETE FROM bibliography WHERE slug = 'test-twice-source'"));

test('a source is cited once per piece of information — greyed out in the dialog, refused by the server and the database', async ({ userA }) => {
  await userA.goto('/artists/vincent-van-gogh');
  const birth = userA.locator('dt:has-text("Birth") + dd');
  await birth.locator('details.cite > summary').click();
  const dialog = birth.locator('.cite-panel');
  await dialog.locator('input[name=source]').fill('Test Twice');
  await dialog.locator('.ac-list li', { hasText: 'Test Twice Catalogue' }).click();
  await dialog.locator('input[name=locator]').fill('12');
  await dialog.locator('.cite-submit').click();
  await expect(userA.locator('details.cite[open] .cite-status')).toHaveText(/Source added/);

  // the same dialog (redrawn in place): the source greyed out in the suggestions, Enter doesn't take it; its chip disabled
  const again = userA.locator('dt:has-text("Birth") + dd .cite-panel');
  await again.locator('input[name=source]').fill('Test Twice');
  const hit = again.locator('.ac-list li', { hasText: 'Test Twice Catalogue' });
  await expect(hit).toHaveClass(/ac-cited/);
  await expect(hit).toContainText('already cited here');
  await again.locator('input[name=source]').press('Enter');
  await expect(again.locator('input[name=source]')).toHaveValue('Test Twice');
  await expect(again.locator('.cite-chip-used[data-slug="test-twice-source"]')).toBeDisabled();
  await expect(again.locator('.cite-status')).not.toContainText('already a source');   // Enter didn't send the form

  // sent anyway (another tab, an old page): refused with a message
  const ids = sql("SELECT id || ',' || (SELECT id FROM artists WHERE slug = 'vincent-van-gogh') FROM citations WHERE source_id = entity_id('source', 'test-twice-source')").split(',');
  const res = await userA.evaluate(async ([artistId]) => {
    const r = await fetch('/citations', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ type: 'artist', id: artistId, field: 'birth', source: 'test-twice-source', locator: '45', back: '/artists/vincent-van-gogh' }) });
    return { status: r.status, body: await r.json() };
  }, [ids[1]]);
  expect(res.status).toBe(422);
  expect(res.body.error).toMatch(/Test Twice Catalogue is already a source here — a source is cited once/);
  // "also for": the field asked for gets it, a field that has it already is left as it is
  const both = await userA.evaluate(async ([artistId]) => {
    const r = await fetch('/citations', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([['type', 'artist'], ['id', artistId], ['field', 'death'], ['also', 'birth'], ['source', 'test-twice-source'], ['back', '/artists/vincent-van-gogh']]) });
    return r.status;
  }, [ids[1]]);
  expect(both).toBe(200);
  expect(sql("SELECT string_agg(field || ':' || coalesce(locator, '-'), ' ' ORDER BY field) FROM citations WHERE source_id = entity_id('source', 'test-twice-source')"))
    .toBe('birth:12 death:-');
  // and the database itself (index citations_one_per_source, NULLS NOT DISTINCT)
  expect(() => sql(`INSERT INTO citations (entity_type, entity_id, field, source_id) SELECT 'artist', id, 'birth', entity_id('source', 'test-twice-source')
    FROM artists WHERE slug = 'vincent-van-gogh'`)).toThrow(/citations_one_per_source/);
});
