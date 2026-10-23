// What a creation span means (migration 135): worked on over the whole time (duration) or made at some point in it
// (uncertain). Circa and the like are uncertain by themselves; a plain span stays unstated and is listed as a hint;
// the admin sets it; the provenance reads it — and a provenance that begins with the artist's own estate keeps the
// artist's line before it (the years in the studio are no gap).
const { test, expect, sql, settled, API, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-span-w')";
const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-span-w', 'test-span-circa'); DELETE FROM people WHERE slug = 'test-span-buyer';
  DELETE FROM live_docs WHERE entity_type = 'artwork'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-span-buyer', 'Test Span Buyer');
       INSERT INTO artworks (slug, title, creator_id, created, created_label)
       VALUES ('test-span-w', 'Test Span Work', entity_id('artist', 'paul-gauguin'), '[1890-01-01,1896-01-01)', '1890–1895'),
              ('test-span-circa', 'Test Span Circa', NULL, '[1877-01-01,1888-01-01)', 'c. 1882');
       -- the first step: the artist's own estate, from his death; then a buyer
       INSERT INTO provenance (artwork_id, position, owner_artist_id, owner_person_id, role, method, direct, acquired, acquired_label) VALUES
         (${W}, 0, entity_id('artist', 'paul-gauguin'), NULL, 'estate', 'inheritance', false, '[1903-05-08,1903-05-09)', '8 May 1903'),
         (${W}, 1, NULL, entity_id('person', 'test-span-buyer'), 'owner', 'purchase', true, '[1910-01-01,1911-01-01)', '1910')`);
});
test.afterEach(cleanup);

test('creation span: set by wording or in the admin; the provenance holds the artist from the start of a duration', async ({ userA, request }) => {
  expect(sql("SELECT slug || ':' || coalesce(created_span::text, '-') FROM artworks WHERE slug LIKE 'test-span-%' ORDER BY slug"))
    .toBe('test-span-circa:uncertain\ntest-span-w:-');
  await settled();
  expect(sql(`SELECT detail FROM quality_issues WHERE check_id = 'creation_span_unstated' AND entity_id = ${W}`))
    .toBe('1890–1895: worked on over this time, or made at some point in it?');

  // not stated (read as uncertain): the artist's line before the estate — presumed over the span, no gap before 1903
  let cov = (await api(request, '/artworks/test-span-w')).provenance_coverage;
  expect(cov.segments.filter((s) => s.kind === 'gap' && s.period.from < '1903-05-08')).toEqual([]);
  expect(cov.segments[0]).toMatchObject({ kind: 'presumed', period: { from: '1890-01-01' } });

  await userA.goto('/artworks/test-span-w/edit');
  await userA.selectOption('#f-created_span', 'duration');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);
  await settled();

  const w = await api(request, '/artworks/test-span-w');
  expect(w.created_span).toBe('duration');
  // worked on throughout: the artist is documented as holder from the first day of the span
  expect(w.provenance_coverage.segments[0]).toMatchObject({ kind: 'documented', period: { from: '1890-01-01' } });
  expect(sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'creation_span_unstated' AND entity_id = ${W}`)).toBe('0');

  // without a creation date there is nothing to qualify
  sql("UPDATE artworks SET created = NULL, created_label = NULL WHERE slug = 'test-span-w'");
  expect(sql("SELECT coalesce(created_span::text, '-') FROM artworks WHERE slug = 'test-span-w'")).toBe('-');
});
