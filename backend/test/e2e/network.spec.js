// Network questions (migration 088): the shortest chain between two entries, through whose hands works went in a
// window, works that went through the same hands — over graph_links, refreshed with the quality findings.
const { test, expect, sql, API } = require('./helpers');

const get = (request, path) => request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } });
const api = async (request, path) => (await get(request, path)).json();
const W = (s) => `entity_id('artwork', '${s}')`;
const P = (s) => `entity_id('person', '${s}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-net-w1', 'test-net-w2', 'test-net-w3');
  DELETE FROM people WHERE slug IN ('test-net-a', 'test-net-b'); DELETE FROM institutions WHERE slug = 'test-net-museum'`);
test.beforeEach(() => {
  cleanup();
  // W1: Alder 1930, Birch 1936–1945 · W2: Birch 1938, the museum since 1950 · W3: the museum since 1951
  sql(`INSERT INTO people (slug, name) VALUES ('test-net-a', 'Test Net Alder'), ('test-net-b', 'Test Net Birch');
       INSERT INTO institutions (slug, name) VALUES ('test-net-museum', 'Test Net Museum');
       INSERT INTO artworks (slug, title, current_institution_id) VALUES ('test-net-w1', 'Test Net One', NULL),
         ('test-net-w2', 'Test Net Two', entity_id('institution', 'test-net-museum')), ('test-net-w3', 'Test Net Three', entity_id('institution', 'test-net-museum'));
       INSERT INTO provenance (artwork_id, position, owner_person_id, owner_institution_id, method, direct, acquired, acquired_label, ended, ended_label) VALUES
         (${W('test-net-w1')}, 0, ${P('test-net-a')}, NULL, 'purchase', true, year_range(1930), '1930', NULL, NULL),
         (${W('test-net-w1')}, 1, ${P('test-net-b')}, NULL, 'purchase', true, year_range(1936), '1936', year_range(1945), '1945'),
         (${W('test-net-w2')}, 0, ${P('test-net-b')}, NULL, 'purchase', true, year_range(1938), '1938', NULL, NULL),
         (${W('test-net-w2')}, 1, NULL, entity_id('institution', 'test-net-museum'), 'purchase', true, year_range(1950), '1950', NULL, NULL),
         (${W('test-net-w3')}, 0, NULL, entity_id('institution', 'test-net-museum'), 'purchase', true, year_range(1951), '1951', NULL, NULL);
       SELECT refresh_quality();`);
});
test.afterEach(cleanup);

test('shortest path, hands in a window, shared hands', async ({ request }) => {
  const num = (s) => Number(sql(`SELECT public_id FROM artworks WHERE slug = '${s}'`));
  // by number and by plural/slug: W1 → Birch → (Birch handed W2 to the museum) the museum → W3, each step joined to the next
  const path = await api(request, `/network/path?from=${num('test-net-w1')}&to=artworks/test-net-w3`);
  expect(path.found).toBe(true);
  expect(path.from.slug).toBe('test-net-w1');
  expect(path.steps[0].from.slug).toBe('test-net-w1');
  expect(path.steps.at(-1).to.slug).toBe('test-net-w3');
  for (let i = 1; i < path.steps.length; i++) expect(path.steps[i].from.path).toBe(path.steps[i - 1].to.path);
  expect(path.length).toBe(3);
  expect(path.steps.map((s) => s.to.name)).toEqual(['Test Net Birch', 'Test Net Museum', 'Test Net Three']);
  expect(path.steps[0]).toMatchObject({ relationship_type: 'owned_by', forward: true });
  expect(path.steps[1]).toMatchObject({ relationship_type: 'transferred_to', forward: true });
  // only artworks in between: no way
  expect((await api(request, '/network/path?from=artworks/test-net-w1&to=artworks/test-net-w3&via=artwork')).found).toBe(false);
  expect((await get(request, '/network/path?from=artworks/nope&to=artworks/test-net-w3')).status()).toBe(404);
  expect((await get(request, '/network/path?from=artworks/test-net-w1&to=artworks/test-net-w3&via=nope')).status()).toBe(400);

  // 1933–1945: Alder and Birch had works then, the handover in 1936; the museum only from 1950
  const hands = await api(request, '/network/hands?from=1933&to=1945');
  const names = hands.holders.map((h) => h.holder.name);
  expect(names).toEqual(expect.arrayContaining(['Test Net Alder', 'Test Net Birch']));
  expect(names).not.toContain('Test Net Museum');
  expect(hands.holders.find((h) => h.holder.name === 'Test Net Birch').artworks.map((a) => a.slug).sort()).toEqual(['test-net-w1', 'test-net-w2']);
  const handover = hands.handovers.find((x) => x.artwork.slug === 'test-net-w1');
  expect(handover).toMatchObject({ from: { name: 'Test Net Alder' }, to: { name: 'Test Net Birch' } });
  expect(handover.period.from_year).toBe(1936);
  expect((await get(request, '/network/hands')).status()).toBe(400);

  // shared hands: W2 through Birch (held together from 1938); W3 shares only the museum, which still has both — left
  // out unless asked for (current=1), then at depth 2 via W2
  let shared = await api(request, '/network/shared-hands?artwork=artworks/test-net-w1');
  const two = shared.data.find((d) => d.artwork.slug === 'test-net-w2');
  expect(two).toMatchObject({ depth: 1, via: { slug: 'test-net-w1' }, together: true });
  expect(two.holders.map((h) => h.name)).toEqual(['Test Net Birch']);
  expect(shared.data.find((d) => d.artwork.slug === 'test-net-w3')).toBeUndefined();
  shared = await api(request, '/network/shared-hands?artwork=artworks/test-net-w1&current=1');
  expect(shared.data.find((d) => d.artwork.slug === 'test-net-w3')).toMatchObject({ depth: 2, via: { slug: 'test-net-w2' }, holders: [{ name: 'Test Net Museum' }] });
  expect((await api(request, '/network/shared-hands?artwork=artworks/test-net-w1&depth=1&current=1')).data.map((d) => d.artwork.slug)).not.toContain('test-net-w3');
});
