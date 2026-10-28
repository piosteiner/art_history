// Sorting (migration 061, src/sortkey.js): titles without their leading article, by the title's language; people and
// places keep theirs; a natural order — accents with their letter, numbers by value, capitals no different.
const { test, expect, sql, API } = require('./helpers');

const mine = ['abbey-museum-s', 'eclair-gallery-s', 'gallery-no-2-s', 'gallery-no-10-s', 'le-musee-ancien-s', 'the-zoo-museum-s', 'de-kunsthal-s', 'zurich-hall-s'];
const cleanup = () => sql(`DELETE FROM institutions WHERE slug IN (${mine.map((s) => `'${s}'`).join(', ')}); DELETE FROM people WHERE slug IN ('le-corbusier-s', 'leger-s')`);
test.afterAll(cleanup);

test('titles without articles, natural order — in the API and the admin list', async ({ userA, request }) => {
  cleanup();
  sql(`INSERT INTO institutions (slug, name, name_lang) VALUES ('abbey-museum-s', 'abbey Museum', 'en'), ('eclair-gallery-s', 'Éclair Gallery', 'fr'),
         ('gallery-no-2-s', 'Gallery No. 2', 'en'), ('gallery-no-10-s', 'Gallery No. 10', 'en'), ('le-musee-ancien-s', 'Le Musée Ancien', 'fr'),
         ('the-zoo-museum-s', 'The Zoo Museum', NULL), ('de-kunsthal-s', 'De Kunsthal', 'nl'), ('zurich-hall-s', 'Zürich Hall', 'de');
       INSERT INTO people (slug, name) VALUES ('le-corbusier-s', 'Le Corbusier'), ('leger-s', 'Lucien Léger')`);
  const order = (list) => list.map((x) => x.slug).filter((s) => mine.includes(s) || s.endsWith('-s'));
  const inst = await (await request.get(`${API}/institutions?limit=500`, { headers: { Host: 'api.localhost' } })).json();
  // "Le Musée Ancien" under M, "The Zoo Museum" under Z (before Zürich: ü sorts as u), "De Kunsthal" (Dutch) under K; abbey with the a's, Éclair with
  // the e's, No. 2 before No. 10
  expect(order(inst.data)).toEqual(['abbey-museum-s', 'eclair-gallery-s', 'gallery-no-2-s', 'gallery-no-10-s', 'de-kunsthal-s',
    'le-musee-ancien-s', 'the-zoo-museum-s', 'zurich-hall-s']);
  // people keep their article: Le Corbusier under L — before Léger
  const people = await (await request.get(`${API}/people?limit=500`, { headers: { Host: 'api.localhost' } })).json();
  expect(order(people.data)).toEqual(['le-corbusier-s', 'leger-s']);

  await userA.goto('/institutions');
  const slugs = (await userA.locator('table tbody tr td.muted:nth-of-type(3), table tbody tr td.muted').allTextContents()).filter((s) => mine.includes(s.trim())).map((s) => s.trim());
  expect(slugs).toEqual(['abbey-museum-s', 'eclair-gallery-s', 'gallery-no-2-s', 'gallery-no-10-s', 'de-kunsthal-s', 'le-musee-ancien-s', 'the-zoo-museum-s', 'zurich-hall-s']);
});

test('people and artists: given and family name filled from the name, sorted by family name (066)', async ({ userA, request }) => {
  const slugs = ['test-anna-zeller', 'test-zoe-adler', 'test-willem-de-bruin', 'test-jan-brueghel', 'test-medici'];
  sql(`DELETE FROM people WHERE slug IN (${slugs.map((x) => `'${x}'`).join(', ')});
       INSERT INTO people (slug, name) VALUES ('test-anna-zeller', 'Anna Zeller'), ('test-zoe-adler', 'Zoe Adler'),
         ('test-willem-de-bruin', 'Willem de Bruin'), ('test-jan-brueghel', 'Jan Brueghel the Elder'), ('test-medici', 'Medici family')`);
  expect(sql("SELECT given_name || ' / ' || family_name FROM people WHERE slug = 'test-willem-de-bruin'")).toBe('Willem / de Bruin');
  expect(sql("SELECT given_name || ' / ' || family_name FROM people WHERE slug = 'test-jan-brueghel'")).toBe('Jan, the Elder / Brueghel');
  expect(sql("SELECT coalesce(family_name, '-') FROM people WHERE slug = 'test-medici'")).toBe('-');   // a group: left alone
  // translations of the name don't make it East Asian (150): split as usual; an original name in Japanese does
  sql(`DELETE FROM people WHERE slug IN ('test-paul-delvaux', 'test-kuroda-seiki');
       INSERT INTO people (slug, name, names) VALUES
         ('test-paul-delvaux', 'Paul Delvaux', '[{"lang": "ja", "role": "translation", "text": "ポール・デルヴォー"}]'),
         ('test-kuroda-seiki', 'Kuroda Seiki', '[{"lang": "ja", "role": "original", "text": "黒田清輝"}]')`);
  expect(sql("SELECT given_name || ' / ' || family_name FROM people WHERE slug = 'test-paul-delvaux'")).toBe('Paul / Delvaux');
  expect(sql("SELECT coalesce(family_name, '-') FROM people WHERE slug = 'test-kuroda-seiki'")).toBe('-');
  sql("DELETE FROM people WHERE slug IN ('test-paul-delvaux', 'test-kuroda-seiki')");
  const people = await (await request.get(`${API}/people?limit=500`, { headers: { Host: 'api.localhost' } })).json();
  const order = people.data.map((p) => p.slug).filter((s) => slugs.includes(s));
  // Adler, Brueghel, (de) Bruin, Medici (by its name), Zeller
  expect(order).toEqual(['test-zoe-adler', 'test-jan-brueghel', 'test-willem-de-bruin', 'test-medici', 'test-anna-zeller']);
  expect(people.data.find((p) => p.slug === 'test-willem-de-bruin')).toMatchObject({ given_name: 'Willem', family_name: 'de Bruin', sort_key: 'Bruin, Willem' });

  // the form: the fields are there; "Filed as" overrides
  await userA.goto('/people/test-zoe-adler/edit');
  await expect(userA.locator('#f-family_name')).toHaveValue('Adler');
  sql("UPDATE people SET sort_name = 'Zzz' WHERE slug = 'test-zoe-adler'");
  const again = await (await request.get(`${API}/people?limit=500`, { headers: { Host: 'api.localhost' } })).json();
  expect(again.data.map((p) => p.slug).filter((s) => slugs.includes(s)).at(-1)).toBe('test-zoe-adler');
  sql(`DELETE FROM people WHERE slug IN (${slugs.map((x) => `'${x}'`).join(', ')}); DELETE FROM live_docs WHERE entity_type = 'person'`);
});
