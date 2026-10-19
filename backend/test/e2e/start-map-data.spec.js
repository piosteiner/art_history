// What the start map's pickers need from the API: the artwork list names the institutions that hold a work now and
// those that held it before (provenance) — a search for a museum finds what is there and what was; institutions have a
// closing date (106) and the sites layer says when each existed; start views may set the museums and events pickers.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-holders-now', 'test-holders-open');
  UPDATE institutions SET dissolved = NULL, dissolved_label = NULL WHERE slug = 'van-gogh-museum'; DELETE FROM featured_views`);
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('holders: now (where it is) and before (earlier owners), and an open last step without a current institution', async ({ request }) => {
  sql(`INSERT INTO artworks (slug, title, current_institution_id, creator_id) VALUES ('test-holders-now', 'Test Holders Now', entity_id('institution', 'van-gogh-museum'), entity_id('artist', 'paul-gauguin'));
       INSERT INTO provenance (artwork_id, position, owner_institution_id, method) VALUES
         (entity_id('artwork', 'test-holders-now'), 0, entity_id('institution', 'museum-of-modern-art'), 'purchase'),
         (entity_id('artwork', 'test-holders-now'), 1, entity_id('institution', 'van-gogh-museum'), 'purchase');
       INSERT INTO artworks (slug, title) VALUES ('test-holders-open', 'Test Holders Open');
       INSERT INTO provenance (artwork_id, position, owner_institution_id, method) VALUES
         (entity_id('artwork', 'test-holders-open'), 0, entity_id('institution', 'national-gallery-london'), 'purchase'),
         (entity_id('artwork', 'test-holders-open'), 1, entity_id('institution', 'metropolitan-museum-of-art'), 'purchase')`);
  const list = (await api(request, '/artworks?limit=500')).data;
  const names = (hs) => hs.map((h) => h.slug);
  const now = list.find((a) => a.slug === 'test-holders-now').holders;
  expect(names(now.now)).toEqual(['van-gogh-museum']);
  expect(names(now.before)).toEqual(['museum-of-modern-art']);
  const open = list.find((a) => a.slug === 'test-holders-open').holders;
  expect(names(open.now)).toEqual(['metropolitan-museum-of-art']);
  expect(names(open.before)).toEqual(['national-gallery-london']);
  expect(list.find((a) => !a.holders.now.length && !a.holders.before.length)?.holders).toEqual({ now: [], before: [] });

  // the other way round: a museum names the artists of the works it holds and held, with counts (107)
  const institutions = (await api(request, '/institutions?limit=500')).data;
  const gauguin = (slug) => institutions.find((i) => i.slug === slug).artists_held.find((a) => a.slug === 'paul-gauguin');
  expect(gauguin('van-gogh-museum')).toMatchObject({ name: 'Paul Gauguin', now: expect.any(Number), before: expect.any(Number) });
  expect(gauguin('van-gogh-museum').now).toBeGreaterThanOrEqual(1);
  expect(gauguin('museum-of-modern-art').before).toBeGreaterThanOrEqual(1);
});

test('an institution closed: its date in the API, and the sites layer says when it existed', async ({ request }) => {
  sql(`UPDATE institutions SET dissolved = '[1990-01-01,1991-01-01)', dissolved_label = '1990', location = coalesce(location, 'SRID=4326;POINT(4.88 52.36)')
       WHERE slug = 'van-gogh-museum'`);
  const museum = await api(request, '/institutions/van-gogh-museum');
  expect(museum.dissolved).toMatchObject({ label: '1990', from_year: 1990, to_year: 1990 });
  expect((await api(request, '/institutions?limit=500')).data.find((i) => i.slug === 'van-gogh-museum').dissolved.label).toBe('1990');
  const site = (await api(request, '/map/sites')).features.find((f) => f.properties.slug === 'van-gogh-museum');
  expect(site.properties).toMatchObject({ from_year: 1973, to_year: 1990 });
});

test('start views: the museums and events pickers (auto, all, none, slugs) are accepted; auto only there', () => {
  sql(`INSERT INTO featured_views (slug, title, query) VALUES
         ('layers-ok', 'Layers', 'artists=vincent-van-gogh&institutions=van-gogh-museum&events=auto'),
         ('layers-bad', 'Bad', 'artists=auto&institutions=nowhere-museum')`);
  expect(sql(`SELECT count(*) FROM featured_view_problems WHERE view_slug = 'layers-ok'`)).toBe('0');
  const problems = sql(`SELECT string_agg(problem, ' | ' ORDER BY problem) FROM featured_view_problems WHERE view_slug = 'layers-bad'`);
  expect(problems).toContain('“auto” is not a value for artists');
  expect(problems).toContain('no institution “nowhere-museum”');
});
