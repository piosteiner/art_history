// Names in several languages (migration 022): furigana with "Add reading", language tags, other names with roles,
// sorting and search by romanization, the slug from the romanization, the public API.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('a Japanese title: furigana by "Add reading", language, romanization and translation as rows', async ({ userA, request }) => {
  await userA.goto('/artworks/new');
  const title = userA.locator('#f-title');
  await title.fill('神奈川沖浪裏');
  await userA.fill('input[name="f.title_lang"]', 'JA');
  // furigana: select 神奈川, press the button, type the reading
  await title.evaluate((el) => el.setSelectionRange(0, 3));
  await userA.click('.name-field .add-reading');
  const panel = userA.locator('.name-field .reading-panel');
  await expect(panel).toContainText('Reading for 神奈川');               // inline, no browser popup
  await panel.locator('.reading-input').fill('かながわ');
  await panel.locator('.reading-input').press('Enter');                 // Enter adds (and doesn't submit)
  await expect(panel).toBeHidden();
  await expect(title).toHaveValue('{神奈川|かながわ}沖浪裏');
  await expect(userA.locator('.name-field .ruby-preview rt')).toHaveText('かながわ');
  await expect(userA).toHaveURL(/\/artworks\/new$/);
  await userA.click('.name-field .add-reading');                      // nothing selected
  await expect(panel.locator('.reading-note')).toHaveText('Select the kanji in the field first, then press “Add reading”.');
  await panel.locator('button:has-text("OK")').click();
  await expect(panel).toBeHidden();

  // other names as rows; the slug follows the romanization (the title has no Latin letters)
  const rows = userA.locator('.names-row');
  await rows.nth(0).locator('.n-text').fill('Kanagawa-oki nami ura');
  await rows.nth(0).locator('.n-lang').fill('ja-Latn');
  await rows.nth(0).locator('.n-role').selectOption('romanization');
  await expect(userA.locator('#f-slug')).toHaveValue('kanagawa-oki-nami-ura');
  await userA.click('text=+ Add a name');
  await rows.nth(1).locator('.n-text').fill('Under the Wave off Kanagawa');
  await rows.nth(1).locator('.n-lang').fill('en');
  await rows.nth(1).locator('.n-role').selectOption('translation');
  await expect(userA.locator('#f-names')).toHaveValue('Kanagawa-oki nami ura | ja-Latn | romanization\nUnder the Wave off Kanagawa | en | translation');
  await userA.fill('#f-slug', 'test-kanagawa');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/artworks\/test-kanagawa\?done=created/);

  await expect(userA.locator('h1')).toHaveText('神奈川沖浪裏');                 // plain in headings and lists
  await expect(userA.locator('.main-name rt')).toHaveText('かながわ');
  await expect(userA.locator('.main-name')).toHaveAttribute('lang', 'ja');
  await expect(userA.locator('.names-list')).toContainText('Under the Wave off Kanagawa');
  expect(sql("SELECT title || ' ' || title_ruby || ' ' || title_lang FROM artworks WHERE slug = 'test-kanagawa'"))
    .toBe('神奈川沖浪裏 {神奈川|かながわ}沖浪裏 ja');

  const w = await api(request, '/artworks/test-kanagawa');
  expect(w.title).toBe('神奈川沖浪裏');
  expect(w.title_ruby_html).toBe('<ruby>神奈川<rp>(</rp><rt>かながわ</rt><rp>)</rp></ruby>沖浪裏');
  expect(w.title_reading).toBe('かながわ沖浪裏');
  expect(w.sort_key).toBe('Kanagawa-oki nami ura');
  expect(w.alt_titles).toEqual(['Kanagawa-oki nami ura', 'Under the Wave off Kanagawa']);  // as before, plain
  expect(w.names[1]).toEqual({ text: 'Under the Wave off Kanagawa', lang: 'en', role: 'translation', status: 'common', ruby_html: null, reading: null,
    period: null, note: null, sources: [] });  // status: 052; period, note, sources: 152
  expect((await api(request, '/artworks?q=kanagawa oki')).data.map((x) => x.slug)).toContain('test-kanagawa');
  expect((await api(request, '/search?q=under the wave')).data.map((x) => x.slug)).toContain('test-kanagawa');

  // admin list: sorted by the romanization, shown under the title; search finds the translation
  await userA.goto('/artworks?q=under+the+wave');
  await expect(userA.locator('tr', { hasText: '神奈川沖浪裏' })).toContainText('Kanagawa-oki nami ura');
  await userA.goto('/quality?check=missing_romanization');
  await expect(userA.locator('main')).not.toContainText('神奈川沖浪裏');       // has one
  sql("DELETE FROM artworks WHERE slug = 'test-kanagawa'");
});

test('names are checked: furigana braces and language codes', async ({ userA }) => {
  await userA.goto('/places/edo/edit');
  await userA.fill('#f-name', '{江戸');
  await userA.locator('.names-row .n-lang').first().fill('english');
  await userA.click('form.form > .actions button');
  await expect(userA.locator('.errors')).toContainText('furigana must be written as {kanji|reading}');
  await expect(userA.locator('.errors')).toContainText('"english" is not a language code');
  expect(sql("SELECT name FROM places WHERE slug = 'edo'")).toBe('Edo');  // nothing saved
  await userA.goto('/places/edo/discard-changes');                        // reset the shared working copy
  await Promise.all([userA.waitForNavigation(), userA.click('button.danger')]);
});

test('kana readings are found in Latin letters; lists sort by the title (romanization only for non-Latin titles)', async ({ userA, request }) => {
  sql(`INSERT INTO places (slug, name, name_ruby, name_lang, kind, location)
       VALUES ('test-hokkaido', '北海道', '{北海道|ほっかいどう}', 'ja', 'region', 'POINT(142.8 43.2)')`);
  await userA.goto('/places?q=hokkaido');                               // ほっかいどう → hokkaidou / hokkaido
  await expect(userA.locator('tr', { hasText: '北海道' })).toBeVisible();
  expect((await api(request, '/places?q=hokkaido')).data.map((x) => x.slug)).toContain('test-hokkaido');
  expect((await api(request, '/search?q=hokkaidou')).data.map((x) => x.slug)).toContain('test-hokkaido');
  expect((await api(request, '/places/test-hokkaido')).sort_key).toBe('hokkaidou');  // no romanization: from the reading
  // for filtering in the browser: the same search text the database uses
  expect((await api(request, '/places/test-hokkaido')).search_text).toBe('ほっかいどう · hokkaidou hokkaido');
  expect((await api(request, '/places?limit=500')).data.find((p) => p.slug === 'test-hokkaido').search_text).toContain('hokkaido');

  // An English title sorts by itself, even with a romanization among the other names.
  sql(`INSERT INTO artworks (slug, title, names) VALUES ('test-english-title', 'Zebra in the Snow',
       '[{"text": "Aaa romanized", "lang": "ja-Latn", "role": "romanization"}]')`);
  expect((await api(request, '/artworks/test-english-title')).sort_key).toBe('Zebra in the Snow');
  sql("DELETE FROM places WHERE slug = 'test-hokkaido'; DELETE FROM artworks WHERE slug = 'test-english-title'");
});

test('previews of any internal links in one request (GET /v1/previews)', async ({ request }) => {
  const res = await request.get(`${API}/previews?refs=artist/paul-gauguin,place/arles,artist/nobody-here`,
    { headers: { Host: 'api.localhost' } });
  const { data } = await res.json();
  expect(Object.keys(data).sort()).toEqual(['artist/paul-gauguin', 'place/arles']);  // entries that don't exist: left out
  expect(data['artist/paul-gauguin']).toMatchObject({ type: 'artist', name: 'Paul Gauguin' });
  expect(data['artist/paul-gauguin'].excerpt).toContain('French painter');  // other specs edit the biography
  expect(data['place/arles'].subtitle).toMatch(/^settlement/);
  const bad = await request.get(`${API}/previews?refs=evil/x;drop`, { headers: { Host: 'api.localhost' } });
  expect(bad.status()).toBe(400);
});

test('a former name (139): chosen as the role in the form, stored and in the API as "former"', async ({ userA, request }) => {
  await userA.goto('/institutions/new');
  await userA.fill('#f-name', 'Test Museen Berlin');
  await userA.fill('#f-slug', 'test-museen-berlin');
  const rows = userA.locator('.names-row');
  await rows.nth(0).locator('.n-text').fill('Test Königliche Museen');
  await rows.nth(0).locator('.n-lang').fill('de');
  await rows.nth(0).locator('.n-role').selectOption('former');
  await expect(userA.locator('#f-names')).toHaveValue('Test Königliche Museen | de | former');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/institutions\/test-museen-berlin\?done=created/);
  const res = await request.get(`${API}/institutions/test-museen-berlin`, { headers: { Host: 'api.localhost' } });
  const body = await res.json();
  expect((body.data ?? body).names).toEqual([expect.objectContaining({ text: 'Test Königliche Museen', lang: 'de', role: 'former' })]);
  sql("DELETE FROM institutions WHERE slug = 'test-museen-berlin'");
});

// 152: a name with its context — when it was in use, a note — and its own sources (entry_names, citations.name_id)
test('a former name in context: period and note in the form, a source of its own, the name then at a provenance step', async ({ userA, request }) => {
  await userA.goto('/institutions/new');
  await userA.fill('#f-name', 'Test Musées de France');
  await userA.fill('#f-slug', 'test-musees-de-france');
  const row = userA.locator('.names-row').nth(0);
  await row.locator('.n-text').fill('Test Direction des musées nationaux');
  await row.locator('.n-lang').fill('fr');
  await row.locator('.n-role').selectOption('former');
  await row.locator('.n-period').fill('until 1945');
  await row.locator('.n-note').fill('renamed in 1945');
  await expect(userA.locator('#f-names')).toHaveValue('Test Direction des musées nationaux | fr | former | until 1945 | renamed in 1945');
  await Promise.all([userA.waitForNavigation(), userA.click('form.form > .actions button')]);
  await expect(userA).toHaveURL(/\/institutions\/test-musees-de-france\?done=created/);
  expect(sql(`SELECT concat_ws(' / ', text, role, period, period_label, note) FROM entry_names
              WHERE entity_type = 'institution' AND entity_id = entity_id('institution', 'test-musees-de-france')`))
    .toBe('Test Direction des musées nationaux / former / (,1946-01-01) / until 1945 / renamed in 1945');

  // on the entry page: the period, the note, and a marker for its sources
  const name = userA.locator('.names-list li', { hasText: 'Test Direction des musées nationaux' });
  await expect(name).toContainText('until 1945');
  await expect(name).toContainText('renamed in 1945');
  await name.locator('details.cite > summary').click();
  const form = name.locator('.cite-add');
  await form.locator('.cite-more summary').click();
  await form.locator('input[name=text]').fill('Archives nationales, fonds 20150044');
  await form.locator('.cite-submit').click();
  await expect(userA.locator('details.cite[open] .cite-status')).toHaveText(/Source added/);
  await expect(name.locator('summary .cite-badge.cite-text')).toHaveText('T');

  // a spelling corrected in place keeps the name's row, and so its source
  sql(`UPDATE institutions SET names = jsonb_set(names, '{0,text}', '"Test Direction des Musées nationaux"') WHERE slug = 'test-musees-de-france'`);
  expect(sql(`SELECT count(*) FROM citations c JOIN entry_names n ON n.id = c.name_id WHERE n.text = 'Test Direction des Musées nationaux'`)).toBe('1');

  // the API: the name with its period, note and sources; a provenance step in 1939 shows the name then
  const body = await (await request.get(`${API}/institutions/test-musees-de-france`, { headers: { Host: 'api.localhost' } })).json();
  expect(body.names[0]).toEqual(expect.objectContaining({ text: 'Test Direction des Musées nationaux', role: 'former', note: 'renamed in 1945',
    period: expect.objectContaining({ label: 'until 1945', to_year: 1945 }), sources: [expect.objectContaining({ kind: 'text', text: 'Archives nationales, fonds 20150044' })] }));
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-name-then-work', 'Name then test');
       INSERT INTO provenance (artwork_id, position, owner_institution_id, role, acquired, acquired_label)
         VALUES (entity_id('artwork', 'test-name-then-work'), 0, entity_id('institution', 'test-musees-de-france'), 'custodian', '[1939-10-01,1939-11-01)', 'October 1939')`);
  const work = await (await request.get(`${API}/artworks/test-name-then-work`, { headers: { Host: 'api.localhost' } })).json();
  const step = work.provenance.find((p) => p.owner && p.owner.slug === 'test-musees-de-france');
  expect(step.owner.name_then).toEqual(expect.objectContaining({ text: 'Test Direction des Musées nationaux', note: 'renamed in 1945' }));
  sql(`DELETE FROM artworks WHERE slug = 'test-name-then-work'; DELETE FROM institutions WHERE slug = 'test-musees-de-france'`);
  expect(sql(`SELECT count(*) FROM entry_names WHERE text LIKE 'Test Direction des%'`)).toBe('0');
});
