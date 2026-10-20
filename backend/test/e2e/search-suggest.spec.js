// Search (113): "did you mean …?" from the words of the entries' names; the full-text search limited to / without a
// collection (?in= / ?not_in=); a provenance number shared only within its reach (global series, the holder's own
// series, one record).
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = (s) => `entity_id('artwork', '${s}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug LIKE 'test-sg-%'; DELETE FROM artists WHERE slug = 'test-sg-zyxwortel';
  DELETE FROM people WHERE slug IN ('test-sg-holder', 'test-sg-other'); DELETE FROM institutions WHERE slug = 'test-sg-museum'`);
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('did you mean: unknown words replaced by the nearest of ours, the rest as typed', async ({ request }) => {
  sql("INSERT INTO artists (slug, name) VALUES ('test-sg-zyxwortel', 'Hanna Zyxwortel'); SELECT refresh_quality();");
  expect(await api(request, '/search/suggest?q=zyxwortl')).toMatchObject({ query: 'Zyxwortel', words: [{ from: 'zyxwortl', to: 'Zyxwortel', edits: 1 }] });
  // operators and known words stay
  expect((await api(request, `/search/suggest?q=${encodeURIComponent('zyxvortel -hanna "x"')}`)).query).toBe('Zyxwortel -hanna "x"');
  expect(await api(request, '/search/suggest?q=hanna')).toEqual({ query: null, words: [] });
});

test('full-text search within or without a collection', async ({ request }) => {
  sql(`INSERT INTO institutions (slug, name) VALUES ('test-sg-museum', 'Test Sg Kunstmuseum');
       INSERT INTO artworks (slug, title, description_md, current_institution_id) VALUES
         ('test-sg-in', 'Test Sg In', 'a qzxvelt landscape', entity_id('institution', 'test-sg-museum')),
         ('test-sg-out', 'Test Sg Out', 'a qzxvelt landscape', NULL)`);
  const slugs = async (extra) => (await api(request, `/search/text?q=qzxvelt${extra}`)).data.map((h) => h.slug).sort();
  expect(await slugs('')).toEqual(['test-sg-in', 'test-sg-out']);
  expect(await slugs('&not_in=sg%20kunstmuseum')).toEqual(['test-sg-out']);
  expect(await slugs('&in=kunstmuseum')).toEqual(['test-sg-in']);
  expect(await slugs('&not_in=nowhere%20else')).toEqual(['test-sg-in', 'test-sg-out']);
});

test('a provenance number is shared only within its reach; the numbers page shows that series', async ({ request }) => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-sg-holder', 'Test Sg Holder'), ('test-sg-other', 'Test Sg Other');
       INSERT INTO artworks (slug, title) VALUES ('test-sg-a', 'Test Sg A'), ('test-sg-b', 'Test Sg B'), ('test-sg-c', 'Test Sg C');
       INSERT INTO provenance (artwork_id, position, owner_person_id, method) VALUES
         (${W('test-sg-a')}, 0, entity_id('person', 'test-sg-holder'), 'purchase'),
         (${W('test-sg-b')}, 0, entity_id('person', 'test-sg-holder'), 'purchase'),
         (${W('test-sg-c')}, 0, entity_id('person', 'test-sg-other'), 'purchase');
       INSERT INTO provenance_numbers (provenance_id, position, kind, number)
         SELECT p.id, 0, 'inventory', '9244' FROM provenance p WHERE p.artwork_id IN (${W('test-sg-a')}, ${W('test-sg-b')}, ${W('test-sg-c')});
       INSERT INTO provenance_numbers (provenance_id, position, kind, number)
         SELECT p.id, 1, 'err', 'TSG 7' FROM provenance p WHERE p.artwork_id IN (${W('test-sg-a')}, ${W('test-sg-c')});
       INSERT INTO provenance_records (provenance_id, position, kind, date, date_label, number)
         SELECT p.id, 0, 'inventory', year_range(1701), '1701', '244' FROM provenance p WHERE p.artwork_id = ${W('test-sg-a')};
       INSERT INTO provenance_records (provenance_id, position, kind, date, date_label, number)
         SELECT p.id, 0, 'inventory', year_range(1772), '1772', '244' FROM provenance p WHERE p.artwork_id = ${W('test-sg-c')};`);
  const numbersOf = async (slug) => (await api(request, `/artworks/${slug}`)).provenance.find((s) => s.position === 0);
  const a = await numbersOf('test-sg-a');
  // the inventory number: the same holder's series (B), not the other holder's (C)
  expect(a.numbers.find((n) => n.kind === 'inventory')).toMatchObject({ number: '9244', shared: 1 });
  expect((await numbersOf('test-sg-c')).numbers.find((n) => n.kind === 'inventory').shared).toBe(0);
  // ERR: one series for every holder
  expect(a.numbers.find((n) => n.kind === 'err').shared).toBe(1);
  // "244" of the 1701 inventory and "244" of the 1772 one: unrelated
  expect(a.records[0]).toMatchObject({ number: '244', shared: 0 });
  // the numbers page for that number's series: A and B, not C
  const inv = a.numbers.find((n) => n.kind === 'inventory');
  const series = (await api(request, `/provenance-numbers?number=9244&kind=inventory&of=n${inv.id}`)).data.map((h) => h.artwork.slug).sort();
  expect(series).toEqual(['test-sg-a', 'test-sg-b']);
  expect((await api(request, '/provenance-numbers?number=9244')).data.length).toBe(3);
  expect((await api(request, `/provenance-numbers?number=244&of=r${a.records[0].id}`)).data.map((h) => h.artwork.slug)).toEqual(['test-sg-a']);
});
