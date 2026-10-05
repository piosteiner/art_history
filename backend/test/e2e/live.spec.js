// Live collaboration: presence, per-user drafts of new entries, shared working copies (co-editing, publish,
// offline merge across a server restart, discard, rebase after a revert).
const { test, expect, sql, liveReady, submitForm } = require('./helpers');
const server = require('./server');

const bio = (page) => page.evaluate(() => document.querySelector('#f-biography_md').value);

test('presence: who else is on an entry, and in which field', async ({ userA, userB }) => {
  await userA.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  await userA.click('#f-sort_name');
  await userB.goto('/artists');
  await expect(userB.locator('.presence-badge').first()).toHaveText('tester editing');
  await userB.goto('/artists/paul-gauguin');
  await expect(userB.locator('.presence-bar')).toHaveText(/tester editing · in Sort name/);
  await userA.close();
  await expect(userB.locator('.presence-bar')).toBeHidden();
});

test('a new entry\'s unsaved form survives leaving the page', async ({ userA }) => {
  await userA.goto('/movements/new');
  await userA.fill('#f-slug', 'impressionism');
  await userA.fill('#f-name', 'Impressionism');
  await expect(userA.locator('.live-status')).toHaveText(/Draft saved/);
  await userA.goto('/');
  await expect(userA.locator('.flash.draft', { hasText: 'Your unsaved drafts' })).toContainText('new movement');
  await userA.goto('/movements/new');
  await Promise.all([userA.waitForNavigation(), userA.click('.flash.draft a.button')]);
  await expect(userA.locator('#f-name')).toHaveValue('Impressionism');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/movements\/impressionism\?done=created/);
  expect(sql('SELECT count(*) FROM admin_drafts')).toBe('0');
});

test('two editors type into the same text at the same time and converge', async ({ userA, userB }) => {
  await userA.goto('/artists/paul-gauguin/edit');
  await userB.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  await liveReady(userB);
  const [cmA, cmB] = [userA.locator('.md-editor .cm-content').first(), userB.locator('.md-editor .cm-content').first()];
  await cmA.click(); await userA.keyboard.press('Control+Home');
  await cmB.click(); await userB.keyboard.press('Control+End');
  await Promise.all([userA.keyboard.type('AAA ', { delay: 30 }), userB.keyboard.type(' BBB', { delay: 30 })]);
  await expect.poll(async () => (await bio(userA)) === (await bio(userB)) && (await bio(userA)).startsWith('AAA ')
    && (await bio(userA)).endsWith(' BBB')).toBe(true);
  await expect(userB.locator('.cm-ySelectionInfo', { hasText: 'tester' })).toHaveCount(1);  // A's cursor

  await userA.fill('#f-sort_name', 'Gauguin, Paul (e2e)');
  await expect(userB.locator('#f-sort_name')).toHaveValue('Gauguin, Paul (e2e)');
  await expect.poll(() => sql("SELECT dirty FROM live_docs WHERE entity_type = 'artist' AND entity_id = entity_id('artist', 'paul-gauguin')")).toBe('t');
});

test('publish: the other editor follows and can publish too', async ({ userA, userB }) => {
  await userA.goto('/artists/paul-gauguin/edit');
  await userB.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  await liveReady(userB);
  const versionBefore = await userB.inputValue('input[name="version"]');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);
  expect(sql("SELECT sort_name FROM artists WHERE slug = 'paul-gauguin'")).toBe('Gauguin, Paul (e2e)');
  await expect(userB.locator('.collab-notice')).toContainText('tester published');
  await expect(userB.locator('input[name="version"]')).not.toHaveValue(versionBefore);
  await userB.fill('input[name="f.death_label"]', 'died 8 May 1903 (e2e)');
  await submitForm(userB);
  await expect(userB).toHaveURL(/done=published/);
  expect(sql("SELECT death_label FROM artists WHERE slug = 'paul-gauguin'")).toBe('died 8 May 1903 (e2e)');
});

test('edits made while the server is down merge after it comes back', async ({ userA, userB }) => {
  await userA.goto('/artists/paul-gauguin/edit');
  await userB.goto('/artists/paul-gauguin/edit');
  await liveReady(userA);
  await liveReady(userB);
  await server.stop();
  await userA.fill('#f-sort_name', 'offline-A');
  const cmB = userB.locator('.md-editor .cm-content').first();
  await cmB.click(); await userB.keyboard.press('Control+End'); await userB.keyboard.type(' OFFLINE-B');
  await server.start();
  await liveReady(userA);
  await liveReady(userB);
  await expect.poll(() => bio(userA)).toMatch(/ OFFLINE-B$/);
  await expect(userB.locator('#f-sort_name')).toHaveValue('offline-A');
  // A fresh page shows the working copy (it was persisted, not just held by the browsers)
  const fresh = await userA.context().newPage();
  await fresh.goto('/artists/paul-gauguin/edit');
  await expect(fresh.locator('#f-sort_name')).toHaveValue('offline-A');
  await fresh.close();
});

test('discard unpublished changes resets the copy for everyone', async ({ userA, userB }) => {
  await userB.goto('/artists/paul-gauguin/edit');
  await liveReady(userB);
  await userA.goto('/artists/paul-gauguin/discard-changes');
  await expect(userA.locator('main')).toContainText('Sort name');
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
  await expect(userB.locator('#f-sort_name')).toHaveValue('Gauguin, Paul (e2e)');
  await expect.poll(() => bio(userB)).not.toContain('OFFLINE-B');
});

test('a revert while someone edits rebases their working copy', async ({ userA, userB }) => {
  await userB.goto('/artists/paul-gauguin/edit');
  await liveReady(userB);
  const tx = sql("SELECT txid::text FROM audit_log WHERE table_name = 'artists' AND new_row->>'death_label' = 'died 8 May 1903 (e2e)' ORDER BY id DESC LIMIT 1");
  await userA.goto(`/revert/${tx}`);
  await Promise.all([userA.waitForNavigation(), userA.click('button[value=apply]')]);
  await expect(userB.locator('.collab-notice').last()).toContainText('changed elsewhere');
  await expect(userB.locator('input[name="f.death_label"]')).not.toHaveValue('died 8 May 1903 (e2e)');
});

test('unpublished changes are marked per field, also for others; publishing clears the marks', async ({ userA, userB }) => {
  await userA.goto('/artists/utagawa-hiroshige/edit');
  await liveReady(userA);
  const field = (page, id) => page.locator('.field', { has: page.locator(`#${id}`) });
  await expect(userA.locator('.field.unpublished')).toHaveCount(0);
  const before = await userA.locator('#f-sort_name').inputValue();
  await userA.fill('#f-sort_name', 'Hiroshige (changed)');
  await expect(field(userA, 'f-sort_name')).toHaveClass(/unpublished/);
  await expect(field(userA, 'f-sort_name').locator('.published-value')).toHaveText(`Published: ${before}`);
  await expect(userA.locator('.unpublished-summary')).toHaveText(/^1 field with unpublished changes/);
  await userA.fill('#f-sort_name', before);                          // back to the published value: no mark
  await expect(field(userA, 'f-sort_name')).not.toHaveClass(/unpublished/);

  // a Markdown edit is marked too, and another editor sees it
  const cm = userA.locator('.md-editor .cm-content').first();
  await cm.click();
  await userA.keyboard.press('Control+End');
  await userA.keyboard.type(' Unpublished sentence.');
  await expect(field(userA, 'f-biography_md')).toHaveClass(/unpublished/);
  await userB.goto('/artists/utagawa-hiroshige/edit');
  await liveReady(userB);
  await expect(field(userB, 'f-biography_md')).toHaveClass(/unpublished/);
  // the entry page names the field (the working copy is saved to the database shortly after an edit)
  await expect.poll(async () => {
    await userB.goto('/artists/utagawa-hiroshige');
    return (await userB.locator('.unpublished-banner').allTextContents()).join(' ');  // no waiting: polled
  }, { timeout: 10000 }).toContain('in Biography');

  // B publishes from a fresh edit page; A's marks go away without reloading
  await userB.goto('/artists/utagawa-hiroshige/edit');
  await liveReady(userB);
  await Promise.all([userB.waitForNavigation(), userB.click('form.form > .actions button')]);
  await expect(userB).toHaveURL(/done=published/);
  await expect(userA.locator('.field.unpublished')).toHaveCount(0);
  await expect(userA.locator('.unpublished-summary')).toBeHidden();
});
