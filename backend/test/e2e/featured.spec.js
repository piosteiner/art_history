// Curated start views (migration 069, src/admin/routes/featured.js, GET /v1/featured): a URL of the site pasted,
// its query checked and kept current when entries are renamed.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
test.afterEach(() => sql("DELETE FROM featured_views; UPDATE artists SET slug = 'paul-gauguin' WHERE slug = 'paul-gauguin-renamed'"));

test('start views: pasted from the site, checked, published in order, following renamed entries', async ({ userA, request }) => {
  await userA.goto('/featured');
  await userA.click('a:has-text("+ New view")');
  await userA.fill('#fv-url', 'https://arthistory.piogino.ch/?artists=vincent-van-gogh%2Cpaul-gauguin&movements=none&from=1886&to=1890&featured=old');
  await userA.fill('#fv-title', 'Van Gogh and Gauguin');
  await userA.locator('.md-editor .cm-content').first().click();                // the intro's Markdown editor
  await userA.keyboard.insertText('Two months in Arles with [[artist/paul-gauguin|Gauguin]].');
  await userA.check('input[name=published]');
  await Promise.all([userA.waitForNavigation(), userA.click('.featured-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/\/featured\/van-gogh-and-gauguin\/edit\?done=created/);
  const query = 'artists=vincent-van-gogh,paul-gauguin&movements=none&from=1886&to=1890';   // commas readable, the site's switch gone
  await expect(userA.locator('a:has-text("Preview on the site")')).toHaveAttribute('href', `https://arthistory.piogino.ch/?${query}`);

  // a view with problems: saved, but not published
  await userA.goto('/featured/new');
  await userA.fill('#fv-url', '?artists=nobody-at-all&colour=red&from=1900&to=1800');
  await userA.fill('#fv-title', 'Broken');
  await userA.fill('#fv-order', '-5');
  await userA.check('input[name=published]');
  await Promise.all([userA.waitForNavigation(), userA.click('.featured-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/done=featured-problems/);
  const problems = userA.locator('.featured-problems');
  await expect(problems).toContainText('unknown key “colour”');
  await expect(problems).toContainText('no artist “nobody-at-all”');
  await expect(problems).toContainText('from is after to');
  await expect(userA.locator('input[name=published]')).not.toBeChecked();
  await userA.goto('/quality');
  await expect(userA.locator('.flash.error', { hasText: 'start view has problems' })).toBeVisible();

  // the API: published only, in order, the intro rendered
  let data = (await api(request, '/featured')).data;
  expect(data.map((v) => v.slug)).toEqual(['van-gogh-and-gauguin']);
  expect(data[0]).toMatchObject({ title: 'Van Gogh and Gauguin', query });
  expect(data[0].intro_html).toContain('Gauguin</a>');

  // an entry renamed: the view follows it (query and intro), also when a stale copy is saved again
  sql("UPDATE artists SET slug = 'paul-gauguin-renamed' WHERE slug = 'paul-gauguin'");
  data = (await api(request, '/featured')).data;
  expect(data[0].query).toBe('artists=vincent-van-gogh,paul-gauguin-renamed&movements=none&from=1886&to=1890');
  expect(sql("SELECT intro_md FROM featured_views WHERE slug = 'van-gogh-and-gauguin'")).toContain('[[artist/paul-gauguin-renamed|Gauguin]]');
  expect(sql("SELECT count(*) FROM featured_view_problems WHERE view_slug = 'van-gogh-and-gauguin'")).toBe('0');

  // the list: the first published view is the home page
  await userA.goto('/featured');
  await expect(userA.locator('tbody', { hasText: 'Van Gogh and Gauguin' }).locator('.tag.ok')).toHaveText('home page');
  await expect(userA.locator('tbody', { hasText: 'Broken' })).toContainText('3 problems');
  // dragged into a new order (editor/sortable.js posts the ids in order)
  const ids = sql("SELECT string_agg(id::text, ',' ORDER BY sort_order DESC) FROM featured_views");
  expect(await userA.evaluate((body) => fetch('/featured/order', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then((r) => r.status), `ids=${ids}`)).toBe(204);
  expect(sql("SELECT string_agg(slug, ' ' ORDER BY sort_order) FROM featured_views")).toBe('van-gogh-and-gauguin broken');
});

test('the slug follows the title on a new view and is cleaned as you type; on an existing view it stays', async ({ userA }) => {
  await userA.goto('/featured/new');
  await userA.locator('#fv-title').pressSequentially('Hokusai & Hiroshige: Fuji', { delay: 15 });
  await expect(userA.locator('#fv-slug')).toHaveValue('hokusai-hiroshige-fuji');
  await userA.locator('#fv-slug').fill('');
  await userA.locator('#fv-slug').pressSequentially('Mein Blick Ä', { delay: 15 });
  await expect(userA.locator('#fv-slug')).toHaveValue('mein-blick-a');
  await userA.fill('#fv-url', '?artists=katsushika-hokusai');
  await Promise.all([userA.waitForNavigation(), userA.click('.featured-form button:has-text("Create")')]);
  await expect(userA).toHaveURL(/\/featured\/mein-blick-a\/edit/);
  await userA.locator('#fv-title').pressSequentially(' and more', { delay: 15 });   // existing: the address stays
  await expect(userA.locator('#fv-slug')).toHaveValue('mein-blick-a');
});
