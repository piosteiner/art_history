// Groups of works (migrations 131/132): a whole whose kind is a term of the glossary category "group of works"
// (series, versions, edition, cycle, pair) — the form hides the empty fields of a physical object, the checks ask no web page
// of it but say how many parts are missing, the API marks it and names its parts' kind.
const { test, expect, sql, settled, API } = require('./helpers');

const api = async (request, p) => (await request.get(`${API}${p}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql("DELETE FROM artworks WHERE slug IN ('test-grp-a', 'test-grp-b', 'test-ed-a', 'test-ed-b'); DELETE FROM artworks WHERE slug IN ('test-grp', 'test-ed')");
test.beforeEach(cleanup);
test.afterAll(cleanup);

test('a group of versions: slim form, no web page asked of it, parts counted, labelled versions', async ({ userA, request }) => {
  sql(`INSERT INTO artworks (slug, title, kind, parts_count) VALUES ('test-grp', 'Test Group Composition', 'versions', 3);
       INSERT INTO artworks (slug, title, kind, parent_id, part_number, web_url) VALUES
         ('test-grp-a', 'Test Group Version A', 'painting', entity_id('artwork', 'test-grp'), '1', 'https://example.org/a'),
         ('test-grp-b', 'Test Group Version B', 'painting', entity_id('artwork', 'test-grp'), '2', NULL);
       INSERT INTO images (artwork_id, position, url, license, credit) VALUES (entity_id('artwork', 'test-grp-a'), 0, 'https://example.org/a.jpg', 'Public domain', 'test')`);
  expect(sql("SELECT artwork_is_group(kind_term_id) FROM artworks WHERE slug = 'test-grp'")).toBe('t');   // linked to the term "versions"
  await settled();
  const findings = (slug) => sql(`SELECT coalesce(string_agg(check_id || ': ' || detail, ' | ' ORDER BY check_id), '') FROM quality_issues
    WHERE entity_type = 'artwork' AND entity_id = entity_id('artwork', '${slug}') AND check_id IN ('artwork_without_web_page', 'group_parts_missing')`);
  expect(findings('test-grp')).toBe('group_parts_missing: 2 of 3 parts entered');   // no web page asked of the group
  expect(findings('test-grp-b')).toContain('artwork_without_web_page');            // its parts are objects

  // the form: the fields of a single object hidden while empty; a painting again shows them
  await userA.goto('/artworks/test-grp/edit');
  await expect(userA.locator('.relevance-note')).toContainText('A group of works');   // the relevance engine's note (2026-11-04)
  await expect(userA.locator('#f-medium')).toBeHidden();
  await expect(userA.locator('#f-inventory_number')).toBeHidden();
  await expect(userA.locator('#f-parts_count')).toBeVisible();
  await userA.fill('#f-kind', 'painting');
  await expect(userA.locator('#f-medium')).toBeVisible();
  await expect(userA.locator('.relevance-note')).toBeHidden();

  // the API: the whole marked, with its parts and the first part's image; a part knows its whole's kind
  const list = (await api(request, '/artworks?limit=500')).data;
  expect(list.find((w) => w.slug === 'test-grp')).toMatchObject({ is_group: true, parts: 2, parts_count: 3, image_url: 'https://example.org/a.jpg' });
  expect(list.find((w) => w.slug === 'test-grp-b').part_of).toMatchObject({ slug: 'test-grp', kind: 'versions' });
  const part = await api(request, '/artworks/test-grp-b');
  expect(part.part_of[0]).toMatchObject({ slug: 'test-grp', kind: 'versions', is_group: true, parts_count: 3 });
});

test('the works of one group are not duplicates of each other (144): a cycle, a versions group inside it, same-named versions', async () => {
  sql(`DELETE FROM artworks WHERE slug LIKE 'test-cyc%';
       INSERT INTO artists (slug, name) VALUES ('test-cyc-painter', 'Test Cycle Painter') ON CONFLICT DO NOTHING;
       INSERT INTO artworks (slug, title, kind, creator_id, parts_count) VALUES ('test-cyc', 'Test Ciclo di san Matteo', 'cycle', entity_id('artist', 'test-cyc-painter'), '2');
       INSERT INTO artworks (slug, title, kind, creator_id, parent_id, part_number, parts_count) VALUES
         ('test-cyc-ver', 'Test San Matteo e l''angelo', 'versions', entity_id('artist', 'test-cyc-painter'), entity_id('artwork', 'test-cyc'), '2', '2');
       INSERT INTO artworks (slug, title, kind, creator_id, parent_id, part_number, created) VALUES
         ('test-cyc-a', 'Test San Matteo e l''angelo', 'oil painting', entity_id('artist', 'test-cyc-painter'), entity_id('artwork', 'test-cyc-ver'), '1', '[1602-01-01,1603-01-01)'),
         ('test-cyc-b', 'Test San Matteo e l''angelo', 'oil painting', entity_id('artist', 'test-cyc-painter'), entity_id('artwork', 'test-cyc-ver'), '2', '[1602-01-01,1603-01-01)'),
         ('test-cyc-calling', 'Test Vocazione di san Matteo', 'oil painting', entity_id('artist', 'test-cyc-painter'), entity_id('artwork', 'test-cyc'), '1', NULL),
         ('test-cyc-other', 'Test San Matteo e l''angelo', 'oil painting', entity_id('artist', 'test-cyc-painter'), NULL, NULL, '[1602-01-01,1603-01-01)')`);
  try {
    // the function: a whole and its part, a part two levels down, siblings, cousins — in one group; an outsider not
    const one = (a, b) => sql(`SELECT artworks_in_one_group(entity_id('artwork', '${a}'), entity_id('artwork', '${b}'))`);
    expect([one('test-cyc', 'test-cyc-a'), one('test-cyc-ver', 'test-cyc-b'), one('test-cyc-a', 'test-cyc-b'), one('test-cyc-a', 'test-cyc-calling'), one('test-cyc-a', 'test-cyc-other')])
      .toEqual(['t', 't', 't', 't', 'f']);
    await settled();
    // findings: the same-named versions and the whole not flagged against each other; the outsider with the same name still is
    const dups = sql(`SELECT coalesce(string_agg(DISTINCT a.slug || '~' || b.slug, ' ' ORDER BY a.slug || '~' || b.slug), '')
      FROM quality_issues q JOIN artworks a ON a.id = q.entity_id JOIN artworks b ON q.issue_key IN ('dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id))
      WHERE q.check_id = 'possible_duplicate' AND a.slug LIKE 'test-cyc%' AND b.slug LIKE 'test-cyc%'`);
    const pairs = dups.split(' ').filter(Boolean);
    expect(pairs.filter((x) => !x.includes('test-cyc-other'))).toEqual([]);   // within the group: none
    expect(pairs).toContain('test-cyc-a~test-cyc-other');                   // the outsider of the same name: still asked
  } finally {
    sql(`DELETE FROM artworks WHERE slug LIKE 'test-cyc%' AND parent_id IS NOT NULL AND kind <> 'versions';
         DELETE FROM artworks WHERE slug = 'test-cyc-ver'; DELETE FROM artworks WHERE slug LIKE 'test-cyc%'; DELETE FROM artists WHERE slug = 'test-cyc-painter'`);
  }
});

test('a whole in the CMS list: a mosaic of its parts with a mark in the corner', async ({ userA }) => {
  sql(`DELETE FROM artworks WHERE slug LIKE 'test-mosaic-%';
       INSERT INTO artworks (slug, title, kind) VALUES ('test-mosaic-whole', 'Test Mosaic Whole', 'series');
       INSERT INTO artworks (slug, title, parent_id, part_number) SELECT 'test-mosaic-part-' || g, 'Test Mosaic Part ' || g, entity_id('artwork', 'test-mosaic-whole'), g::text FROM generate_series(1, 3) g;
       INSERT INTO images (artwork_id, url, license, credit) SELECT id, 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Tsunami_by_hokusai_19th_century.jpg', 'Public domain', 'Hokusai'
         FROM artworks WHERE slug LIKE 'test-mosaic-part-%'`);
  try {
    await userA.goto('/artworks?q=test%20mosaic%20whole');
    const cell = userA.locator('tr', { hasText: 'Test Mosaic Whole' }).locator('td.thumb .whole-thumb');
    await expect(cell).toHaveClass(/mosaic-3/);
    await expect(cell.locator('img')).toHaveCount(3);
    await expect(cell.locator('.whole-mark')).toHaveText(/^(S|3)$/);
  } finally {
    sql("DELETE FROM images WHERE artwork_id IN (SELECT id FROM artworks WHERE slug LIKE 'test-mosaic-%'); DELETE FROM artworks WHERE slug LIKE 'test-mosaic-part-%'; DELETE FROM artworks WHERE slug = 'test-mosaic-whole'");
  }
});

// A series made from the work itself (owner 2026-11-06): "Part of" offers "+ New series “…”" — saved, a whole of the
// kind "series" with the work's artist exists, the work is its part, the series is marked "to complete".
test('a new series from a work\'s "Part of": created with the save, with the artist, marked to complete', async ({ userA }) => {
  sql("DELETE FROM artworks WHERE slug IN ('test-grp-new-part', 'test-grp-new-series')");
  await userA.goto('/artworks/new');
  await userA.fill('#f-title', 'Test Grp New Part');
  await userA.fill('#f-slug', 'test-grp-new-part');
  await userA.fill('#f-creator', 'paul-gauguin');
  await userA.click('summary:has-text("Part of a series")');
  await userA.locator('#f-parent').pressSequentially('Test Grp New Series', { delay: 15 });
  await userA.locator('.ac-list li.ac-new', { hasText: '+ New series “Test Grp New Series”' }).click();
  await expect(userA.locator('#f-parent')).toHaveValue('new:artwork:Test Grp New Series');
  await userA.fill('#f-part_number', '3');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  expect(sql(`SELECT s.slug || ' | ' || s.kind || ' | ' || coalesce((SELECT slug FROM artists WHERE id = s.creator_id), '-') || ' | ' || artwork_is_group(s.kind_term_id)
    FROM artworks a JOIN artworks s ON s.id = a.parent_id WHERE a.slug = 'test-grp-new-part'`)).toBe('test-grp-new-series | series | paul-gauguin | true');
  expect(sql("SELECT count(*) FROM auto_created WHERE entity_type = 'artwork' AND entity_id = entity_id('artwork', 'test-grp-new-series')")).toBe('1');
  // a reference field shows the entry's name, the slug only in its tooltip (owner 2026-11-06)
  await userA.goto('/artworks/test-grp-new-part');
  const partOf = userA.locator('dl.fields dt:has-text("Part of") + dd a').first();
  await expect(partOf).toHaveText('Test Grp New Series');
  await expect(partOf).toHaveAttribute('title', 'test-grp-new-series');
  sql("DELETE FROM artworks WHERE slug IN ('test-grp-new-part', 'test-grp-new-series')");
});

test('an edition (247): the impressions of one print are its parts, each with its own museum and page', async ({ userA, request }) => {
  sql(`INSERT INTO artworks (slug, title, kind) VALUES ('test-ed', 'Test Edition Print', 'edition');
       INSERT INTO artworks (slug, title, kind, parent_id, part_number, current_institution_id, inventory_number, web_url) VALUES
         ('test-ed-a', 'Test Edition Print, impression A', 'lithograph', entity_id('artwork', 'test-ed'), '1', (SELECT min(id) FROM institutions), 'A.1', 'https://example.org/ed-a'),
         ('test-ed-b', 'Test Edition Print, impression B', 'lithograph', entity_id('artwork', 'test-ed'), '2', (SELECT max(id) FROM institutions), 'B.2', 'https://example.org/ed-b')`);
  expect(sql("SELECT artwork_is_group(kind_term_id) FROM artworks WHERE slug = 'test-ed'")).toBe('t');   // the term "edition"
  await settled();
  // no web page asked of the edition itself; each impression has its own
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'artwork_without_web_page'
    AND entity_type = 'artwork' AND entity_id IN (entity_id('artwork', 'test-ed'), entity_id('artwork', 'test-ed-a'), entity_id('artwork', 'test-ed-b'))`)).toBe('0');
  // the form: a group of works, its physical fields hidden while empty
  await userA.goto('/artworks/test-ed/edit');
  await expect(userA.locator('.relevance-note')).toContainText('A group of works');
  await expect(userA.locator('#f-inventory_number')).toBeHidden();
  // the API: the edition marked as a group, an impression knows its whole's kind
  const part = await api(request, '/artworks/test-ed-b');
  expect(part.part_of[0]).toMatchObject({ slug: 'test-ed', kind: 'edition', is_group: true });
  const whole = await api(request, '/artworks/test-ed');
  expect(whole.parts.map((p) => p.slug)).toEqual(['test-ed-a', 'test-ed-b']);
});
