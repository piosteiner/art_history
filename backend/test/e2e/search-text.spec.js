// Full-text search (migration 087): texts and provenance steps, stemmed in English/German/French, accents folded,
// phrases and exclusions, highlighted passages; names by trigram too.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const search = (request, q, more = '') => api(request, `/search/text?q=${encodeURIComponent(q)}${more}`);

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-fts-work'; DELETE FROM people WHERE slug = 'test-fts-collector'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name, description_md) VALUES ('test-fts-collector', 'Test Ftscollector',
         'Er sammelte Gemälde der Südsee, darunter Werke von [[artist/paul-gauguin]][[source/nothing|S.]]; (5 < 6 & 7) kept as text.');
       INSERT INTO artworks (slug, title, description_md) VALUES ('test-fts-work', 'Test Fts Work', 'Painted in a hut on the *lagoon*.');
       INSERT INTO provenance (artwork_id, position, owner_label, method, direct, notes_md) VALUES
         (entity_id('artwork', 'test-fts-work'), 0, 'Test Holder', 'purchase', true, NULL),
         (entity_id('artwork', 'test-fts-work'), 1, 'Einsatzstab Reichsleiter Rosenberg', 'confiscation', true, 'Seized at the Château de Test in 1941')`);
});
test.afterEach(cleanup);

test('texts, stems, accents, phrases, provenance steps and highlighted passages', async ({ request }) => {
  // German stem + folded accents: "gemalden" (no umlaut, other ending) finds "Gemälde"; the link reads as words
  const r = await search(request, 'gemalden sudsee');
  const hit = r.data.find((h) => h.slug === 'test-fts-collector');
  expect(hit).toMatchObject({ type: 'person', matched_in: 'text' });
  expect(hit.path).toMatch(/^\/people\/\d+\/test-fts-collector$/);
  expect(hit.headline_html).toContain('<mark>Gemälde</mark>');
  expect((await search(request, '"paul gauguin" sammelte')).data.map((h) => h.slug)).toContain('test-fts-collector');
  // the text is escaped; only the marks are HTML
  const s = (await search(request, 'kept text')).data.find((h) => h.slug === 'test-fts-collector');
  expect(s.headline_html).toContain('5 &lt; 6 &amp; 7');
  expect(s.headline_html).not.toContain('5 < 6');

  // English stem: "painting" finds "Painted"; a phrase must stand together; - excludes
  expect((await search(request, 'painting lagoon')).data.map((h) => h.slug)).toContain('test-fts-work');
  expect((await search(request, '"lagoon hut"')).data.map((h) => h.slug)).not.toContain('test-fts-work');
  expect((await search(request, 'painted -lagoon')).data.map((h) => h.slug)).not.toContain('test-fts-work');

  // provenance steps are documents of their artwork: the method too ("confiscation"), the step named
  const p = (await search(request, 'confiscated chateau', '&type=artwork')).data.find((h) => h.slug === 'test-fts-work');
  expect(p).toMatchObject({ matched_in: 'provenance' });
  expect(p.provenance_ids).toEqual([Number(sql("SELECT id FROM provenance WHERE artwork_id = entity_id('artwork', 'test-fts-work') AND position = 1"))]);
  expect(p.headline_html).toContain('<mark>Château</mark>');

  // names: a word of the name ranks it as a name match; a typo still finds it by trigram
  expect((await search(request, 'ftscollector')).data[0]).toMatchObject({ slug: 'test-fts-collector', matched_in: 'name' });
  expect((await search(request, 'ftscolector')).data.map((h) => h.slug)).toContain('test-fts-collector');

  // type filter, paging, a bad type
  const typed = await search(request, 'gauguin', '&type=person&limit=1');
  expect(typed.data.length).toBe(1);
  expect(typed.data.every((h) => h.type === 'person')).toBe(true);
  expect(typed.total).toBeGreaterThanOrEqual(1);
  const bad = await request.get(`${API}/search/text?q=x&type=nope`, { headers: { Host: 'api.localhost' } });
  expect(bad.status()).toBe(400);
});
