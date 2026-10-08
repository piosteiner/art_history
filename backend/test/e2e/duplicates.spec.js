// Duplicates (migration 044, src/admin/duplicates.js): hard rules, evidence instead of names alone, "not the same"
// remembered, and merging.
const { test, expect, sql, submitForm } = require('./helpers');

test.afterAll(() => {
  sql(`DELETE FROM quality_acks WHERE check_id = 'possible_duplicate';
       DELETE FROM artworks WHERE slug IN ('untitled-test-a', 'untitled-test-b', 'starry-night-copy');
       DELETE FROM artists WHERE slug IN ('paul-gauguin-2', 'vincent-van-gogh-dup');
       DELETE FROM slug_history WHERE old_slug = 'vincent-van-gogh-dup'`);
});

test('a likely duplicate: shown while typing, Create asks; "it\'s a different one" creates it and is remembered', async ({ userA }) => {
  await userA.goto('/artists/new');
  await userA.fill('#f-name', 'Paul Gauguin');
  const box = userA.locator('.dup-live');
  await expect(box).toContainText('Already here?');
  await expect(box).toContainText('Paul Gauguin');
  await expect(box).toContainText('same name');
  await expect(box).toContainText('probably the same');

  await userA.fill('#f-slug', 'paul-gauguin-2');
  await submitForm(userA);
  await expect(userA.locator('.dup-confirm')).toContainText('This may already exist');
  expect(sql("SELECT count(*) FROM artists WHERE slug = 'paul-gauguin-2'")).toBe('0');  // rolled back
  await userA.check('input[name="dup.ok"]');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/paul-gauguin-2\?done=created/);
  // the pair is "not the same" from now on: no question, no quality warning
  expect(sql(`SELECT count(*) FROM duplicate_candidates('artist', entity_id('artist', 'paul-gauguin-2'))`)).toBe('0');
  expect(sql(`SELECT note FROM quality_acks WHERE check_id = 'possible_duplicate'`)).toBe('confirmed as different when it was created');

  // born 1950: not the painter (born 1848) — only the new one without dates may still be the same
  await userA.goto('/artists/new');
  await userA.fill('#f-name', 'Paul Gauguin');
  await userA.fill('#f-birth', '1950');
  await userA.fill('#f-slug', 'paul-gauguin-3');
  await submitForm(userA);
  await expect(userA.locator('.dup-confirm li')).toHaveCount(1);
  await expect(userA.locator('.dup-confirm')).toContainText('(paul-gauguin-2)');
  await userA.check('input[name="dup.ok"]');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/paul-gauguin-3\?done=created/);
  sql("DELETE FROM artists WHERE slug = 'paul-gauguin-3'");
});

test('"Untitled" is no evidence: other creator → created; same creator and dimensions → asked', async ({ userA }) => {
  sql(`INSERT INTO artworks (slug, title, creator_id, height_cm, width_cm) VALUES ('untitled-test-a', 'Untitled', entity_id('artist', 'katsushika-hokusai'), 25, 37)`);
  const newUntitled = async (slug, creator) => {
    await userA.goto('/artworks/new');
    await userA.fill('#f-title', 'Untitled');
    await userA.fill('#f-slug', slug);
    await userA.fill('#f-creator', creator);
    await userA.keyboard.press('Escape');
    await userA.fill('input[name="f.dimensions_h"]', '25');
    await userA.fill('input[name="f.dimensions_w"]', '37');
    await submitForm(userA);
  };
  await newUntitled('untitled-test-b', 'vincent-van-gogh');
  await expect(userA).toHaveURL(/\/artworks\/untitled-test-b\?done=created/);
  sql("DELETE FROM artworks WHERE slug = 'untitled-test-b'");
  await newUntitled('untitled-test-b', 'katsushika-hokusai');
  await expect(userA.locator('.dup-confirm')).toContainText('same creator, same dimensions');
});

test('hard rule: an inventory number exists once per collection — shown as "already exists", no way around it', async ({ userA }) => {
  sql("UPDATE artworks SET inventory_number = '472.1941' WHERE slug = 'the-starry-night'");
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Starry Night copy');
  await userA.fill('#f-slug', 'starry-night-copy');
  await userA.fill('#f-institution', 'museum-of-modern-art');
  await userA.keyboard.press('Escape');
  await userA.fill('#f-inventory_number', '472.1941');
  await expect(userA.locator('.dup-live')).toContainText('same inventory number in the same collection');
  await submitForm(userA);
  await expect(userA.locator('.dup-confirm')).toContainText('The Starry Night');
  await expect(userA.locator('.dup-confirm input[name="dup.ok"]')).toHaveCount(0);
  sql("UPDATE artworks SET inventory_number = NULL WHERE slug = 'the-starry-night'");
});

test('merge: preview, then everything moves to the kept entry; the old address and [[links]] lead there', async ({ userA, request }) => {
  const text = sql("SELECT translate(encode(convert_to(description_md, 'UTF8'), 'base64'), E'\\n', '') FROM movements WHERE slug = 'japonisme'");
  sql(`INSERT INTO artists (slug, name, death, death_label) VALUES ('vincent-van-gogh-dup', 'Vincent Willem van Gogh', '[1890-07-29,1890-07-30)', '1890-07-29');
       INSERT INTO artworks (slug, title, creator_id) VALUES ('untitled-test-a', 'Untitled', entity_id('artist', 'vincent-van-gogh-dup'))
         ON CONFLICT (slug) DO UPDATE SET creator_id = EXCLUDED.creator_id;
       UPDATE movements SET description_md = 'Painted by [[artist/vincent-van-gogh-dup|him]].' WHERE slug = 'japonisme'`);
  // the quality page offers it, from either side
  await userA.goto('/quality?check=possible_duplicate');
  const row = userA.locator('tr', { hasText: 'Vincent Willem van Gogh' }).first();
  await expect(row.locator('a', { hasText: 'Merge…' })).toBeVisible();
  await expect(row.locator('button', { hasText: 'Not the same' })).toBeVisible();

  await userA.goto('/artists/vincent-van-gogh-dup/merge?into=vincent-van-gogh');
  const summary = userA.locator('.merge-summary');
  await expect(summary).toContainText('1 artworks (as their creator)');
  await expect(summary).toContainText('Vincent Willem van Gogh');           // its name becomes another name
  await expect(summary).toContainText('1 text with [[links]] to it rewritten');
  expect(sql("SELECT count(*) FROM artists WHERE slug = 'vincent-van-gogh-dup'")).toBe('1');  // the preview changed nothing
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
  await expect(userA).toHaveURL(/\/artists\/vincent-van-gogh\?done=merged/);

  expect(sql("SELECT a.slug FROM artworks w JOIN artists a ON a.id = w.creator_id WHERE w.slug = 'untitled-test-a'")).toBe('vincent-van-gogh');
  expect(sql("SELECT description_md FROM movements WHERE slug = 'japonisme'")).toBe('Painted by [[artist/vincent-van-gogh|him]].');
  expect(sql("SELECT names::text FROM artists WHERE slug = 'vincent-van-gogh'")).toContain('Vincent Willem van Gogh');
  expect(sql("SELECT source FROM audit_log WHERE table_name = 'artists' AND action = 'delete' ORDER BY id DESC LIMIT 1")).toBe('merge');
  const old = await request.get('http://127.0.0.1:3006/v1/artists/vincent-van-gogh-dup', { headers: { Host: 'api.localhost' }, maxRedirects: 0 });
  expect(old.status()).toBe(301);
  sql(`UPDATE movements SET description_md = convert_from(decode('${text}', 'base64'), 'UTF8') WHERE slug = 'japonisme';
       UPDATE artists SET names = '[]' WHERE slug = 'vincent-van-gogh'`);
});
