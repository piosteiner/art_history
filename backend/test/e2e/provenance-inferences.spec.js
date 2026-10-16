// Biography × provenance (migration 086): what the dates and places imply — a handover narrowed by the giver's
// death, a work that travelled while its painter stayed far away — and contradictions as errors.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-inf-w')";

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-inf-w';
  DELETE FROM relationships WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'test-inf-painter');
  DELETE FROM artists WHERE slug = 'test-inf-painter'; DELETE FROM people WHERE slug IN ('test-inf-dealer', 'test-inf-late');
  DELETE FROM places WHERE slug IN ('test-inf-island', 'test-inf-paris')`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO places (slug, name, kind, location) VALUES ('test-inf-island', 'Test Island', 'settlement', 'POINT(-139.03 -9.80)'),
         ('test-inf-paris', 'Test Paris', 'settlement', 'POINT(2.35 48.86)');
       INSERT INTO artists (slug, name, birth, birth_label, death, death_label) VALUES
         ('test-inf-painter', 'Test Painter', '[1848-06-07,1848-06-08)', '7 June 1848', '[1903-05-08,1903-05-09)', '8 May 1903');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label)
         VALUES ('artist', entity_id('artist', 'test-inf-painter'), 'lived_in', 'place', entity_id('place', 'test-inf-island'), '[1895-01-01,1903-05-09)', '1895–8 May 1903');
       INSERT INTO people (slug, name, death, death_label) VALUES ('test-inf-dealer', 'Test Dealer', NULL, NULL), ('test-inf-late', 'Test Late', '[1950-01-01,1951-01-01)', '1950');
       INSERT INTO artworks (slug, title, creator_id, created, created_label) VALUES ('test-inf-w', 'Test Sunflowers', entity_id('artist', 'test-inf-painter'), '[1901-01-01,1902-01-01)', '1901');
       INSERT INTO provenance (artwork_id, position, owner_person_id, role, method, direct, acquired, acquired_label, location_id) VALUES
         (${W}, 0, entity_id('person', 'test-inf-dealer'), 'dealer', 'purchase', true, '[1901-01-01,1904-10-29)', 'between 1901 and 28 October 1904', entity_id('place', 'test-inf-paris'))`);
});
test.afterEach(cleanup);

test('a handover narrowed by the painter\'s death; the work travelled while he stayed; contradictions', async ({ userA, request }) => {
  const step = (await api(request, '/artworks/test-inf-w')).provenance.find((s) => !s.implied);
  const byKind = Object.fromEntries(step.inferences.map((i) => [i.kind, i]));
  expect(byKind.narrowed.text).toBe('from Test Painter during the artist\'s lifetime — by 8 May 1903 at the latest (Test Painter died then)');
  expect(byKind.narrowed.period).toMatchObject({ from_year: 1901, to_year: 1903 });
  expect(byKind.travelled.text).toMatch(/^Test Painter was in Test Island then: the work travelled to Test Paris, ≈ 1[45],\d{3} km$/);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_date_narrowable' AND entity_id = ${W}`)).toBe('1');
  // shown on the admin page, marked as derived
  await userA.goto('/artworks/test-inf-w');
  await expect(userA.locator('table.provenance .inference', { hasText: 'by 8 May 1903 at the latest' })).toBeVisible();

  // not when the handover isn't documented as direct: someone may have been in between
  sql(`UPDATE provenance SET direct = false WHERE artwork_id = ${W}`);
  expect(sql(`SELECT count(*) FROM provenance_inferences WHERE artwork_id = ${W}`)).toBe('0');
  sql(`UPDATE provenance SET direct = true WHERE artwork_id = ${W}`);

  // contradictions: acquired after the holder's death, before the work was made; made where the artist was not
  sql(`INSERT INTO provenance (artwork_id, position, owner_person_id, method, acquired, acquired_label) VALUES
         (${W}, 1, entity_id('person', 'test-inf-late'), 'purchase', '[1960-01-01,1961-01-01)', '1960'),
         (${W}, 2, entity_id('person', 'test-inf-dealer'), 'purchase', '[1890-01-01,1891-01-01)', '1890');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
         VALUES ('artwork', ${W}, 'created_in', 'place', entity_id('place', 'test-inf-paris'))`);
  const found = sql(`SELECT string_agg(check_id || ': ' || detail, ' | ' ORDER BY check_id) FROM quality_issues_live WHERE entity_id = ${W}
    AND check_id IN ('holder_after_death', 'acquired_before_creation', 'created_where_artist_was_not')`);
  expect(found).toContain('acquired_before_creation: Test Dealer acquired it 1890 — before it was made (1901)');
  expect(found).toContain('created_where_artist_was_not: made in Test Paris (1901), but Test Painter was in Test Island then');
  expect(found).toContain('holder_after_death: Test Late acquired it 1960 — after their death (1950)');
  sql(`DELETE FROM relationships WHERE subject_type = 'artwork' AND subject_id = ${W}`);
});
