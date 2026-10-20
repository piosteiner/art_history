// The public changelog and roadmap (migration 118, src/admin/routes/changelog.js, GET /v1/changelog, /v1/roadmap):
// bullets one per line with their kind, drafts off the site, an item marked done written into today's entry.
const { test, expect, sql, API, BASE } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
// the bullets' field is a Markdown editor (CodeMirror): replace its whole text as typed
async function typeItems(page, text) {
  await page.locator('.changelog-form .cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
test.afterEach(() => sql('DELETE FROM changelog_entries; DELETE FROM roadmap_items; DELETE FROM form_drafts'));

test('changelog: an entry with kinds, a draft until published, in the API and the RSS feed', async ({ userA, request }) => {
  await userA.goto('/changelog');
  await userA.click('a:has-text("+ New entry")');
  await userA.fill('#cl-day', '2026-10-19');
  await userA.fill('#cl-title', 'Patch: Suche');
  await typeItems(userA, 'Neu: Suche über Sprachen hinweg mit [[artist/paul-gauguin|Gauguin]]\nbehoben: Treffer öffnen beim Fund\n  auch in der Provenienz\nOhne Art');
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/\/changelog\/\d+\/edit\?done=created/);
  await expect(userA.locator('#cl-items')).toHaveValue('Neu: Suche über Sprachen hinweg mit [[artist/paul-gauguin|Gauguin]]\nBehoben: Treffer öffnen beim Fund\n  auch in der Provenienz\nNeu: Ohne Art');
  await expect(userA.locator('.changelog-preview li')).toHaveCount(3);
  await expect(userA.locator('.changelog-preview a', { hasText: 'Gauguin' })).toBeVisible();

  // a draft: not on the site, and the CMS says so — on the entry and in the list
  expect((await api(request, '/changelog')).total).toBe(0);
  await expect(userA.locator('.unpublished-entry')).toContainText('Saved, but not published');
  await expect(userA.locator('.md-lang').first()).toHaveText('DE');                    // spell check: German recognised
  await expect(userA.locator('.changelog-form .cm-content')).toHaveAttribute('lang', 'de');
  await userA.goto('/changelog');
  await expect(userA.locator('.unpublished-list')).toContainText('1 saved entry is not published');
  await userA.locator('.unpublished-list a').click();
  await Promise.all([userA.waitForNavigation(), userA.click('.unpublished-entry button:has-text("Publish now")')]);
  await expect(userA.locator('.flash')).toContainText('the entry is on the site');
  await expect(userA.locator('.unpublished-entry')).toHaveCount(0);
  // the editor's preview shows the bullets as on the site
  const preview = await userA.request.post(`${BASE}/changelog/preview`, { form: { text: 'Behoben: Ein Fehler' }, headers: { Origin: BASE } });
  expect(await preview.text()).toMatch(/<span class="cl-kind cl-behoben">Behoben<\/span> Ein Fehler/);
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

test('changelog: autosaved draft restored, edits in place in the history, a deleted entry restored with its bullets and id', async ({ userA }) => {
  await userA.goto('/changelog/new');
  await userA.fill('#cl-day', '2026-09-29');
  await typeItems(userA, 'Neu: Markdown-Editor\nBehoben: Anmeldung');
  await expect(userA.locator('[data-form-draft-status]')).toContainText('Draft saved');
  await userA.goto('/changelog');                                                    // the list names the unsaved draft
  await expect(userA.locator('.unsaved-drafts')).toContainText('a new entry');
  await userA.goto('/changelog/new');                                                // the tab closed: nothing lost
  await expect(userA.locator('.form-draft')).toContainText('Restored your unsaved draft');
  await expect(userA.locator('#cl-items')).toHaveValue('Neu: Markdown-Editor\nBehoben: Anmeldung');
  await expect(userA.locator('#cl-day')).toHaveValue('2026-09-29');
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Create")')]);
  const id = userA.url().match(/changelog\/(\d+)\/edit/)[1];
  expect(sql("SELECT count(*) FROM form_drafts WHERE form_key = 'changelog/new'")).toBe('0');

  // one bullet changed: an update of that bullet, not all deleted and written anew
  await typeItems(userA, 'Neu: Markdown-Editor mit Live-Formatierung\nBehoben: Anmeldung');
  await Promise.all([userA.waitForNavigation(), userA.click('.changelog-form button:has-text("Save")')]);
  expect(sql(`SELECT string_agg(action::text, ',' ORDER BY id) FROM audit_log WHERE table_name = 'changelog_items' AND (new_row->>'entry_id') = '${id}'
    AND txid = (SELECT max(txid) FROM audit_log WHERE table_name = 'changelog_items')`)).toBe('update');
  await expect(userA.locator('table.diff')).toContainText('Live-Formatierung');

  // deleted only after confirming on a page of its own: a bare POST deletes nothing, Cancel goes back
  const bare = await userA.request.post(`${BASE}/changelog/${id}/delete`, { form: { x: '1' }, headers: { Origin: BASE }, maxRedirects: 0 });
  expect([bare.status(), bare.headers().location]).toEqual([303, `/changelog/${id}/delete`]);
  expect(sql(`SELECT count(*) FROM changelog_entries WHERE id = ${id}`)).toBe('1');
  await userA.click('a:has-text("Delete this entry…")');
  await expect(userA.locator('main')).toContainText('2 bullet points');
  await userA.click('main a.button:has-text("Cancel")');
  await expect(userA).toHaveURL(new RegExp(`/changelog/${id}/edit$`));
  await userA.click('a:has-text("Delete this entry…")');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Yes, delete")')]);
  await expect(userA.locator('.recently-deleted')).toContainText('29. September 2026');
  // … and restored as it was before: same id, both bullets
  await userA.locator('.recently-deleted li', { hasText: '29. September 2026' }).locator('a:has-text("restore…")').click();
  await expect(userA.locator('.restore-preview li')).toHaveCount(2);
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Restore")')]);
  await expect(userA).toHaveURL(new RegExp(`/changelog/${id}/edit\\?done=restored`));
  await expect(userA.locator('#cl-items')).toHaveValue('Neu: Markdown-Editor mit Live-Formatierung\nBehoben: Anmeldung');
  await expect(userA.locator('table.diff .tag', { hasText: '↩ restore' }).first()).toBeVisible();

  // an older version restored from the entry's history
  await userA.locator('table.diff a:has-text("restore this version…")').last().click();
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Restore")')]);
  await expect(userA.locator('#cl-items')).toHaveValue('Neu: Markdown-Editor\nBehoben: Anmeldung');
  // the global history names it
  await userA.goto('/history');
  await expect(userA.locator('table.diff a', { hasText: 'changelog 2026-09-29' }).first()).toHaveAttribute('href', `/changelog/${id}/edit`);
});

test('roadmap: the edit form autosaves, a deleted item comes back from the history', async ({ userA }) => {
  sql("INSERT INTO roadmap_items (title, area) VALUES ('Historische Karten', 'Karte')");
  const id = sql("SELECT id FROM roadmap_items WHERE title = 'Historische Karten'");
  await userA.goto(`/roadmap/${id}/edit`);
  await userA.fill('#rm-title', 'Historische Karten pro Epoche');
  await expect(userA.locator('[data-form-draft-status]')).toContainText('Draft saved');
  await userA.reload();
  await expect(userA.locator('#rm-title')).toHaveValue('Historische Karten pro Epoche');
  await userA.click('.form-draft button:has-text("Discard draft")');
  await expect(userA.locator('#rm-title')).toHaveValue('Historische Karten');

  await userA.click('a:has-text("Delete this item…")');
  await expect(userA.locator('h1')).toHaveText('Delete “Historische Karten”?');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Yes, delete")')]);
  await userA.locator('.recently-deleted li', { hasText: 'Historische Karten' }).first().locator('a:has-text("restore…")').click();
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Restore")')]);
  await expect(userA).toHaveURL(new RegExp(`/roadmap/${id}/edit\\?done=restored`));
  await expect(userA.locator('#rm-title')).toHaveValue('Historische Karten');
  await userA.goto('/roadmap/history');
  await expect(userA.locator('table.diff')).toContainText('roadmap: Historische Karten');
});
