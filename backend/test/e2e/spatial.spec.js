// Spatial history (migration 091) and prices (090): how far a work travelled, who was near whom, places clustered
// by zoom; an exchange rate's period can't overlap another one's; a price's value stays null without data.
const { test, expect, sql, API } = require('./helpers');

const get = (request, path) => request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } });
const api = async (request, path) => (await get(request, path)).json();
const PL = (s) => `entity_id('place', '${s}')`;
const P = (s) => `entity_id('person', '${s}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-sp-w'; DELETE FROM people WHERE slug IN ('test-sp-a', 'test-sp-b', 'test-sp-c');
  DELETE FROM places WHERE slug IN ('test-sp-zurich', 'test-sp-winterthur', 'test-sp-tokyo')`);
test.beforeEach(() => {
  cleanup();
  // Zurich and Winterthur ≈ 20 km apart; Tokyo ≈ 9,600 km away
  sql(`INSERT INTO places (slug, name, kind, location) VALUES ('test-sp-zurich', 'Test Sp Zurich', 'settlement', 'POINT(8.54 47.37)'),
         ('test-sp-winterthur', 'Test Sp Winterthur', 'settlement', 'POINT(8.72 47.50)'), ('test-sp-tokyo', 'Test Sp Tokyo', 'settlement', 'POINT(139.69 35.69)');
       INSERT INTO people (slug, name) VALUES ('test-sp-a', 'Test Sp Ash'), ('test-sp-b', 'Test Sp Beech'), ('test-sp-c', 'Test Sp Cherry');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label) VALUES
         ('person', ${P('test-sp-a')}, 'lived_in', 'place', ${PL('test-sp-zurich')}, '[1900-01-01,1911-01-01)', '1 January 1900 – 31 December 1910'),
         ('person', ${P('test-sp-b')}, 'visited', 'place', ${PL('test-sp-zurich')}, '[1905-06-01,1905-07-01)', 'June 1905'),
         ('person', ${P('test-sp-c')}, 'lived_in', 'place', ${PL('test-sp-winterthur')}, '[1905-01-01,1906-01-01)', '1905'),
         ('person', ${P('test-sp-c')}, 'visited', 'place', ${PL('test-sp-tokyo')}, '(,1890-01-01)', 'until 1889');
       INSERT INTO artworks (slug, title) VALUES ('test-sp-w', 'Test Sp Work');
       INSERT INTO provenance (artwork_id, position, owner_person_id, method, direct, acquired, acquired_label, location_id) VALUES
         (entity_id('artwork', 'test-sp-w'), 0, ${P('test-sp-a')}, 'purchase', true, year_range(1920), '1920', ${PL('test-sp-zurich')}),
         (entity_id('artwork', 'test-sp-w'), 1, ${P('test-sp-b')}, 'purchase', true, year_range(1930), '1930', ${PL('test-sp-tokyo')}),
         (entity_id('artwork', 'test-sp-w'), 2, ${P('test-sp-c')}, 'purchase', true, year_range(1940), '1940', ${PL('test-sp-zurich')});
       SELECT refresh_quality();`);
});
test.afterEach(cleanup);

test('travel, encounters, clusters', async ({ request }) => {
  // Zurich → Tokyo → Zurich: two legs along the stops, ≈ 2 × 9,600 km
  const w = await api(request, '/artworks/test-sp-w');
  expect(w.travel).toMatchObject({ legs: 2, placed: 3, steps: 3 });
  expect(w.travel.km).toBeGreaterThan(18500);
  expect(w.travel.km).toBeLessThan(20000);
  // the map's route uses the same stops
  const map = await api(request, '/map/artworks/test-sp-w');
  expect(map.provenance.features.filter((f) => f.properties.layer === 'provenance_stop').map((f) => f.properties.place.slug))
    .toEqual(['test-sp-zurich', 'test-sp-tokyo', 'test-sp-zurich']);

  // Ash met Beech in Zurich in June 1905; Cherry in Winterthur only counts within 30 km; Cherry's open-start stay in
  // Tokyo ("until 1889") is no stay we can date
  const near = (r) => r.data.map((e) => [e.a.name, e.b.name].sort().join(' + '));
  const same = await api(request, '/map/encounters?entity=people/test-sp-a');
  expect(near(same)).toEqual(['Test Sp Ash + Test Sp Beech']);
  expect(same.data[0]).toMatchObject({ place: { slug: 'test-sp-zurich' }, km: 0, overlap: { from: '1905-06-01' }, days: 30, approximate: false });
  const wide = await api(request, '/map/encounters?entity=people/test-sp-a&within_km=30');
  expect(near(wide).sort()).toEqual(['Test Sp Ash + Test Sp Beech', 'Test Sp Ash + Test Sp Cherry']);
  const far = wide.data.find((e) => [e.a.name, e.b.name].includes('Test Sp Cherry'));
  expect(far.km).toBeGreaterThan(15);
  expect(far.km).toBeLessThan(25);
  expect(far.approximate).toBe(true);   // Cherry's stay is known to the year
  expect(near(await api(request, '/map/encounters?entity=people/test-sp-a&from=1910&to=1915'))).toEqual([]);
  expect((await get(request, '/map/encounters?within_km=9999')).status()).toBe(400);

  // clusters: at zoom 3 Zurich and Winterthur are one group, at zoom 12 two; Tokyo has no dated presence
  const groupOf = (fc, slug) => fc.features.find((f) => f.properties.top.some((p) => p.slug === slug));
  const z3 = await api(request, '/map/clusters?zoom=3&from=1905&to=1905');
  const g = groupOf(z3, 'test-sp-zurich');
  expect(g.properties.top.map((p) => p.slug)).toContain('test-sp-winterthur');
  expect(g.bbox.length).toBe(4);
  const z12 = await api(request, '/map/clusters?zoom=12&from=1905&to=1905');
  expect(groupOf(z12, 'test-sp-zurich')).not.toBe(groupOf(z12, 'test-sp-winterthur'));
  expect(groupOf(z12, 'test-sp-zurich').properties.places).toBe(1);
  expect(groupOf(z12, 'test-sp-tokyo')).toBeUndefined();
  expect((await get(request, '/map/clusters')).status()).toBe(400);
});

test('prices: one rate per pair and day; no value without data; currencies are known codes', async ({ request }) => {
  sql("UPDATE provenance SET price = 200, price_currency = 'AFRF' WHERE artwork_id = entity_id('artwork', 'test-sp-w') AND position = 0");
  const step = (await api(request, '/artworks/test-sp-w')).provenance.find((s) => s.position === 0);
  expect(step.price).toMatchObject({ amount: 200, currency: 'AFRF', chf_today: null });
  // with a rate and two index values (in a transaction rolled back: reference data isn't loaded yet)
  expect(sql(`BEGIN; INSERT INTO exchange_rates (currency, quote, period, rate) VALUES ('AFRF', 'CHF', '[1920-01-01,1921-01-01)', 0.5);
    INSERT INTO price_indices (country, period, value) VALUES ('CH', '[1920-01-01,1921-01-01)', 10), ('CH', '[2025-01-01,2026-01-01)', 110);
    SELECT price_value(200, 'AFRF', '1920-03-01'); ROLLBACK;`).split('\n').find((l) => /^\d/.test(l))).toBe('1100.00');
  expect(() => sql(`BEGIN; INSERT INTO exchange_rates (currency, quote, period, rate) VALUES ('USD', 'CHF', '[1920-01-01,1921-01-01)', 5),
    ('USD', 'CHF', '[1920-06-01,1920-07-01)', 5.1); ROLLBACK;`)).toThrow(/exclusion constraint/);
  expect(() => sql("UPDATE provenance SET price_currency = 'XYZ' WHERE artwork_id = entity_id('artwork', 'test-sp-w') AND position = 0")).toThrow(/foreign key/);
});
