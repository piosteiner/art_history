// Where the provenance is silent (migration 078): documented / presumed / gap over an artwork's time, the gaps in the
// API (detail, list filter, map), the admin's bar and gap lines, the research ranking.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-cov-w')";
const P = (slug) => `entity_id('person', '${slug}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-cov-w'; DELETE FROM institutions WHERE slug = 'test-cov-museum';
  DELETE FROM people WHERE slug IN ('test-cov-a', 'test-cov-b', 'test-cov-c', 'test-cov-d');
  DELETE FROM places WHERE slug IN ('test-cov-berlin', 'test-cov-london')`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-cov-a', 'Test First Owner'), ('test-cov-b', 'Test Gold'), ('test-cov-c', 'Test Undated'), ('test-cov-d', 'Test Later');
       INSERT INTO institutions (slug, name) VALUES ('test-cov-museum', 'Test Cov Museum');
       INSERT INTO artworks (slug, title, creator_id, created, created_label, current_institution_id)
       VALUES ('test-cov-w', 'Test Coverage', entity_id('artist', 'paul-gauguin'), year_range(1900), '1900', entity_id('institution', 'test-cov-museum'));
       INSERT INTO provenance (artwork_id, position, owner_person_id, owner_institution_id, method, direct, acquired, acquired_label, ended, ended_label) VALUES
         (${W}, 0, ${P('test-cov-a')}, NULL, 'purchase', true, year_range(1900), '1900', year_range(1910), '1910'),
         (${W}, 1, ${P('test-cov-b')}, NULL, 'unknown', false, '(,1929-01-01)', '1928 or earlier', '[1934-01-01,)', '1934 or later'),
         (${W}, 2, ${P('test-cov-c')}, NULL, 'unknown', false, NULL, NULL, NULL, NULL),
         (${W}, 3, ${P('test-cov-d')}, NULL, 'purchase', true, year_range(1950), '1950', NULL, NULL),
         (${W}, 4, NULL, entity_id('institution', 'test-cov-museum'), 'gift', true, year_range(1960), '1960', NULL, NULL)`);
});
test.afterEach(cleanup);

test('gaps where no holder is known: API, list filter, map, admin bar and lines, research ranking', async ({ userA, request }) => {
  // two gaps: after the first owner until Gold (1911–1928), after Gold until 1950 — the undated holder a candidate
  const cov = (await api(request, '/artworks/test-cov-w')).provenance_coverage;
  const gaps = cov.segments.filter((s) => s.kind === 'gap');
  expect(gaps.map((g) => [g.period.from_year, g.period.to_year, g.in_1933_1945, g.before, g.after])).toEqual([
    [1911, 1928, false, 'Test First Owner', 'Test Gold'],
    [1934, 1949, true, 'Test Gold', 'Test Later']]);
  expect(gaps[1].candidates).toEqual(['Test Undated']);
  expect(cov.gap_1933_1945_years).toBeGreaterThan(11);
  expect(cov.segments.some((s) => s.kind === 'documented' && s.period.from_year === 1928)).toBe(true);   // Gold: at the latest 1928 – at least 1934

  // the list: a summary per work, and a filter
  const list = (await api(request, '/artworks?provenance_gap=1933-1945&limit=500')).data.map((a) => a.slug);
  expect(list).toContain('test-cov-w');
  const row = (await api(request, '/artworks?limit=500')).data.find((a) => a.slug === 'test-cov-w');
  expect(row.provenance_coverage).toMatchObject({ has_provenance: true, gap_1933_1945: true });

  // the map: the gap on the segment from Gold's place to the later owner's, all gaps beside
  sql(`INSERT INTO places (slug, name, kind, location) VALUES ('test-cov-berlin', 'Test Cov Berlin', 'settlement', 'POINT(13.4 52.5)'),
         ('test-cov-london', 'Test Cov London', 'settlement', 'POINT(-0.12 51.5)') ON CONFLICT DO NOTHING;
       UPDATE provenance SET location_id = (SELECT id FROM places WHERE slug = 'test-cov-berlin') WHERE artwork_id = ${W} AND position = 1;
       UPDATE provenance SET location_id = (SELECT id FROM places WHERE slug = 'test-cov-london') WHERE artwork_id = ${W} AND position = 3`);
  const map = (await api(request, '/map/artworks/test-cov-w')).provenance;
  expect(map.gaps).toHaveLength(2);
  const london = map.features.find((f) => f.properties.layer === 'provenance_stop' && f.properties.place.slug === 'test-cov-london').properties.step;
  const seg = map.features.find((f) => f.properties.layer === 'provenance_segment' && f.properties.to_step === london);
  expect(seg.properties.gaps.map((g) => [g.period.from_year, g.in_1933_1945])).toEqual([[1934, true]]);

  // the admin page: the bar, and the gaps as lines of the table, after the step they follow
  await userA.goto('/artworks/test-cov-w');
  await expect(userA.locator('figure.coverage figcaption')).toContainText('1 touching 1933–1945');
  const gapRows = userA.locator('table.provenance tbody.gap');
  await expect(gapRows).toHaveCount(2);
  await expect(gapRows.nth(1)).toContainText('Gap 1934–1949');
  await expect(gapRows.nth(1)).toContainText('touches 1933–1945');
  await expect(gapRows.nth(1)).toContainText('possibly then: Test Undated');
  // the research ranking
  await userA.goto('/quality/provenance-gaps');
  await expect(userA.locator('tr', { hasText: 'Test Coverage' })).toContainText('1934–1949: after Test Gold, before Test Later');
});

test('a gap split by an unsold auction: each half where it belongs — before and after the auction (079)', async ({ userA, request }) => {
  sql(`DELETE FROM provenance WHERE artwork_id = ${W};
       INSERT INTO institutions (slug, name) VALUES ('test-cov-auction', 'Test Cov Auction') ON CONFLICT DO NOTHING;
       INSERT INTO provenance (artwork_id, position, owner_person_id, owner_institution_id, role, method, direct, acquired, acquired_label, ended, ended_label, not_sold) VALUES
         (${W}, 0, ${P('test-cov-a')}, NULL, 'owner', 'purchase', true, year_range(1900), '1900', year_range(1963), '1963', false),
         (${W}, 1, NULL, entity_id('institution', 'test-cov-auction'), 'agent', 'auction', true, '[1975-06-04,1975-06-05)', '4 June 1975', '[1975-06-04,1975-06-05)', '4 June 1975', true),
         (${W}, 2, ${P('test-cov-d')}, NULL, 'owner', 'purchase', false, year_range(1981), '1981', NULL, NULL, false),
         (${W}, 3, NULL, entity_id('institution', 'test-cov-museum'), 'owner', 'gift', true, year_range(1990), '1990', NULL, NULL, false)`);
  const gaps = (await api(request, '/artworks/test-cov-w')).provenance_coverage.segments.filter((s) => s.kind === 'gap');
  expect(gaps.map((g) => [g.period.from_year, g.before_position, g.show_after])).toEqual([[1964, 0, 0], [1975, 0, 1]]);

  await userA.goto('/artworks/test-cov-w');
  const lines = await userA.locator('table.provenance tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim())
    .filter((t) => /^(\d+\. |Gap )/.test(t) || /Test (First Owner|Cov Auction|Later)/.test(t)).map((t) => t.slice(0, 30)));
  const at = (re) => lines.findIndex((t) => re.test(t));
  expect(at(/^Gap 1964/)).toBeGreaterThan(at(/Test First Owner/));
  expect(at(/^Gap 1964/)).toBeLessThan(at(/Test Cov Auction/));
  expect(at(/^Gap 1975/)).toBeGreaterThan(at(/Test Cov Auction/));
  expect(at(/^Gap 1975/)).toBeLessThan(at(/Test Later/));
  sql("DELETE FROM provenance WHERE owner_institution_id = entity_id('institution', 'test-cov-auction'); DELETE FROM institutions WHERE slug = 'test-cov-auction'");
});
