// Public numbers (migration 085): one number per entry across all types — the address /artworks/<number>/<slug>;
// the name is for reading; a converted or merged entry's old number leads to where it is now.
const { test, expect, sql, API } = require('./helpers');

const get = (request, path) => request.get(`${API}${path}`, { headers: { Host: 'api.localhost' }, maxRedirects: 0 });

test.afterEach(() => sql("DELETE FROM people WHERE slug IN ('test-pid-keep', 'test-pid-dup'); DELETE FROM artworks WHERE slug = '1984'"));

test('an entry by its number, with any name or none; other types and merges redirect; digit slugs still work', async ({ userA, request }) => {
  const n = Number(sql("SELECT public_id FROM artworks WHERE slug = 'the-starry-night'"));
  expect(n).toBeGreaterThan(100000);
  for (const path of [`/artworks/${n}`, `/artworks/${n}/the-starry-night`, `/artworks/${n}/an-old-name`]) {
    const r = await get(request, path);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ slug: 'the-starry-night', public_id: n, path: `/artworks/${n}/the-starry-night` });
  }
  // in lists and in references to it
  const list = await (await get(request, '/artworks?limit=500')).json();
  expect(list.data.find((a) => a.slug === 'the-starry-night').public_id).toBe(n);
  // the number under another type: redirected to its type
  const wrong = await get(request, `/artists/${n}`);
  expect(wrong.status()).toBe(301);
  expect(wrong.headers().location).toMatch(new RegExp(`/artworks/${n}$`));
  // the number alone: which entry it is
  expect(await (await get(request, `/entries/${n}`)).json()).toMatchObject({ type: 'artwork', plural: 'artworks', slug: 'the-starry-night', moved: false });

  // a merged entry's number leads to the kept one
  sql(`INSERT INTO people (slug, name) VALUES ('test-pid-keep', 'Test Keep'), ('test-pid-dup', 'Test Dup')`);
  const dup = Number(sql("SELECT public_id FROM people WHERE slug = 'test-pid-dup'"));
  const keep = Number(sql("SELECT public_id FROM people WHERE slug = 'test-pid-keep'"));
  sql("SELECT merge_entries('person', entity_id('person', 'test-pid-keep'), entity_id('person', 'test-pid-dup'))");
  expect(await (await get(request, `/entries/${dup}`)).json()).toMatchObject({ slug: 'test-pid-keep', public_id: keep, moved: true });
  const old = await get(request, `/people/${dup}`);
  expect(old.status()).toBe(301);
  expect(old.headers().location).toMatch(new RegExp(`/people/${keep}$`));

  // a slug of digits ("1984") is still found
  sql("INSERT INTO artworks (slug, title) VALUES ('1984', 'Test 1984')");
  expect((await (await get(request, '/artworks/1984')).json()).title).toBe('Test 1984');

  // the admin: a number leads to the entry's page, which shows the number and the public address
  await userA.goto(`/artworks/${n}`);
  await expect(userA).toHaveURL(/\/artworks\/the-starry-night$/);
  await expect(userA.locator('main')).toContainText(`no. ${n}`);
  await expect(userA.locator('a:has-text("public page")')).toHaveAttribute('href', new RegExp(`/artworks/${n}/the-starry-night$`));
});
