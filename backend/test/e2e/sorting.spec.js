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
