// The periods timeline (API 100): /v1/periods — lanes per place, dated "active in" spans with fuzzy edges, phases under
// their style, the works of the collection (through the artist, only those made while it lasted), drafts.
const { test, expect, sql, API } = require('./helpers');

const api = async (request) => (await request.get(`${API}/periods`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM movements WHERE slug IN ('test-phase', 'test-style');`));

test('periods: lanes, spans with fuzzy edges, parts under their style, works through the artist, drafts', async ({ request }) => {
  sql(`INSERT INTO movements (slug, name, kind, period, period_label) VALUES ('test-style', 'Test Style', 'style', '[1880-01-01,1900-01-01)', '1880s–1890s');
       INSERT INTO movements (slug, name, kind, period, period_label, parent_id) VALUES ('test-phase', 'Test Phase', 'style', '[1888-01-01,1890-01-01)', '1888–1889', entity_id('movement', 'test-style'));
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label) VALUES
         ('movement', entity_id('movement', 'test-style'), 'active_in', 'place', entity_id('place', 'france'), '[1875-01-01,1901-01-01)', 'c. 1880–late 19th century'),
         ('movement', entity_id('movement', 'test-phase'), 'active_in', 'place', entity_id('place', 'france'), '[1888-01-01,1890-01-01)', '1888–1889'),
         ('movement', entity_id('movement', 'test-style'), 'active_in', 'place', entity_id('place', 'japan'), '[1001-01-01,1201-01-01)', '11th–12th century');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artist', entity_id('artist', 'vincent-van-gogh'), 'associated_with', 'movement', entity_id('movement', 'test-phase'));`);
  let d = await api(request);
  // the European lanes first, then the others — Japan after France although its span starts earlier
  const lanes = d.lanes.map((l) => l.slug);
  expect(lanes.indexOf('france')).toBeGreaterThanOrEqual(0);
  expect(lanes.indexOf('japan')).toBeGreaterThan(lanes.indexOf('france'));
  const style = d.periods.find((p) => p.slug === 'test-style');
  const phase = d.periods.find((p) => p.slug === 'test-phase');
  expect(style.spans.find((s) => s.place === 'france')).toEqual({ place: 'france', period: expect.objectContaining({ label: 'c. 1880–late 19th century' }), fuzzy: { start: true, end: true } });
  expect(style.spans.find((s) => s.place === 'japan').fuzzy).toEqual({ start: true, end: true });   // "11th–12th century"
  expect(phase.spans[0].fuzzy).toEqual({ start: false, end: false });
  expect(phase.parent).toBe('test-style');
  expect(style.reviewed).toBe(true);
  // Van Gogh's works of 1888–1889 belong to the phase (through the artist), and to its style; none from outside the phase
  const years = (p) => p.works.map((w) => w.created && w.created.from_year);
  expect(phase.works.length).toBeGreaterThan(0);
  expect(years(phase).every((y) => y === null || (y >= 1888 && y <= 1889))).toBe(true);
  expect(style.works.map((w) => w.slug)).toEqual(expect.arrayContaining(phase.works.map((w) => w.slug)));
  // a draft: marked "to complete"
  sql("INSERT INTO auto_created (entity_type, entity_id) VALUES ('movement', entity_id('movement', 'test-style'))");
  d = await api(request);
  expect(d.periods.find((p) => p.slug === 'test-style').reviewed).toBe(false);
  // a movement without a dated span is not on the timeline
  expect(d.periods.some((p) => p.slug === 'impressionism' && !p.spans.length)).toBe(false);
});
