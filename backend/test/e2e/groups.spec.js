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
