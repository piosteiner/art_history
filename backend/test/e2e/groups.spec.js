// Groups of works (migrations 131/132): a whole whose kind is a term of the glossary category "group of works"
// (series, versions, cycle, pair) — the form hides the empty fields of a physical object, the checks ask no web page
// of it but say how many parts are missing, the API marks it and names its parts' kind.
const { test, expect, sql, settled, API } = require('./helpers');

const api = async (request, p) => (await request.get(`${API}${p}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql("DELETE FROM artworks WHERE slug IN ('test-grp-a', 'test-grp-b'); DELETE FROM artworks WHERE slug = 'test-grp'");
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
  await expect(userA.locator('.group-note')).toBeVisible();
  await expect(userA.locator('#f-medium')).toBeHidden();
  await expect(userA.locator('#f-inventory_number')).toBeHidden();
  await expect(userA.locator('#f-parts_count')).toBeVisible();
  await userA.fill('#f-kind', 'painting');
  await expect(userA.locator('#f-medium')).toBeVisible();
  await expect(userA.locator('.group-note')).toBeHidden();

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
