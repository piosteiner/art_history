// History: revert with conflicts, word-level text merge, restore a version, restore a deletion, stale previews.
const { test, expect, sql, adminChange } = require('./helpers');

const apply = async (page) => {
  await Promise.all([page.waitForNavigation(), page.click('button[value=apply]')]);
};

test('a field changed again since is a conflict and is kept by default', async ({ userA }) => {
  const tx1 = adminChange("UPDATE artists SET sort_name = 'B1' WHERE slug = 'utagawa-hiroshige'");
  adminChange("UPDATE artists SET sort_name = 'B2' WHERE slug = 'utagawa-hiroshige'");
  await userA.goto(`/revert/${tx1}`);
  await expect(userA.locator('.tag.warn', { hasText: 'changed since' })).toBeVisible();
  await expect(userA.locator('input[type=radio][value=keep]').first()).toBeChecked();
  await apply(userA);
  await expect(userA).toHaveURL(/done=reverted/);
  expect(sql("SELECT sort_name FROM artists WHERE slug = 'utagawa-hiroshige'")).toBe('B2');
});

test('restore this version', async ({ userA }) => {
  const id = sql("SELECT id FROM audit_log WHERE table_name = 'artists' AND new_row->>'sort_name' = 'B1' ORDER BY id DESC LIMIT 1");
  await userA.goto(`/restore/${id}`);
  await apply(userA);
  await expect(userA).toHaveURL(/\/artists\/utagawa-hiroshige\?done=restored/);
  expect(sql("SELECT sort_name FROM artists WHERE slug = 'utagawa-hiroshige'")).toBe('B1');
});

test('reverting a text edit merges word by word and keeps a later edit elsewhere', async ({ userA }) => {
  sql("UPDATE artists SET biography_md = 'He made prints of Japanese woodblock style. His career was ten years long.' WHERE slug = 'utagawa-hiroshige'");
  const tx = adminChange(`UPDATE artists SET biography_md = 'He made prints of Japanese woodblock style. His career was a decade long. He died in 1858.'
                          WHERE slug = 'utagawa-hiroshige'`);
  adminChange("UPDATE artists SET biography_md = replace(biography_md, 'woodblock', 'ukiyo-e') WHERE slug = 'utagawa-hiroshige'");
  await userA.goto(`/revert/${tx}`);
  await expect(userA.locator('input[type=radio][value=merge]')).toBeChecked();
  await expect(userA.locator('tr.rf-merge .wdiff')).toBeVisible();
  await apply(userA);
  expect(sql("SELECT biography_md FROM artists WHERE slug = 'utagawa-hiroshige'"))
    .toBe('He made prints of Japanese ukiyo-e style. His career was ten years long.');
});

test('reverting a deletion brings the entity back with its id and relationships', async ({ userA }) => {
  const before = sql("SELECT id || ':' || (SELECT count(*) FROM relationships WHERE object_type = 'place' AND object_id = p.id) FROM places p WHERE slug = 'pont-aven'");
  const tx = adminChange("DELETE FROM places WHERE slug = 'pont-aven'");
  await userA.goto(`/revert/${tx}`);
  await expect(userA.locator('.tag.ok', { hasText: 'dry run ok' }).first()).toBeVisible();
  await apply(userA);
  const after = sql("SELECT id || ':' || (SELECT count(*) FROM relationships WHERE object_type = 'place' AND object_id = p.id) FROM places p WHERE slug = 'pont-aven'");
  expect(after).toBe(before);
});

test('reverting a deletion brings back the entry\'s images too, in their order', async ({ userA }) => {
  sql(`INSERT INTO images (artwork_id, position, url, caption) VALUES
    (entity_id('artwork', 'plum-park-in-kameido'), 0, 'https://example.org/front.jpg', 'Front'),
    (entity_id('artwork', 'plum-park-in-kameido'), 1, 'https://example.org/back.jpg', 'Back')`);
  const tx = adminChange("DELETE FROM artworks WHERE slug = 'plum-park-in-kameido'");  // the images go with it (ON DELETE CASCADE)
  await userA.goto(`/revert/${tx}`);
  await expect(userA.locator('main')).toContainText('image of Plum Park in Kameido “Back”');
  await apply(userA);
  expect(sql(`SELECT string_agg(caption, ',' ORDER BY position) FROM images
              WHERE artwork_id = entity_id('artwork', 'plum-park-in-kameido')`)).toBe('Front,Back');
});

test('a preview that went stale is not applied', async ({ userA }) => {
  const tx = adminChange("UPDATE artists SET sort_name = 'S1' WHERE slug = 'katsushika-hokusai'");
  await userA.goto(`/revert/${tx}`);
  adminChange(`UPDATE artists SET names = '[{"text": "Hokusai", "role": "alternative"}]' WHERE slug = 'katsushika-hokusai'`);  // meanwhile
  await userA.click('button[value=apply]');
  await expect(userA.locator('.flash.error')).toContainText('Something changed since this preview was shown');
  expect(sql("SELECT sort_name FROM artists WHERE slug = 'katsushika-hokusai'")).toBe('S1');
});

test('history shows word-level diffs for long texts', async ({ userA }) => {
  await userA.goto('/artists/utagawa-hiroshige/history');
  await expect(userA.locator('.wdiff del').first()).toBeVisible();
  await expect(userA.locator('.wdiff ins').first()).toBeVisible();
});
