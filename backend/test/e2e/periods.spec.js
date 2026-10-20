// The periods timeline (API 100): /v1/periods — lanes per place, dated "active in" spans with fuzzy edges, phases under
// their style, the works of the collection (through the artist, only those made while it lasted), drafts.
const { test, expect, sql, API } = require('./helpers');

const api = async (request) => (await request.get(`${API}/periods`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM movements WHERE slug IN ('test-phase', 'test-style', 'test-art-style');
  DELETE FROM artworks WHERE slug = 'test-art-work'; DELETE FROM artists WHERE slug = 'test-art-early'`));

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
  // where each work was made (the provenance's creation stop, the places above, its country): for its lane
  expect(phase.works.every((w) => Array.isArray(w.places))).toBe(true);
  const starry = phase.works.find((w) => w.slug === 'the-starry-night');
  if (starry) expect(starry.places).toEqual(expect.arrayContaining(['france']));
  // a draft: marked "to complete"
  sql("INSERT INTO auto_created (entity_type, entity_id) VALUES ('movement', entity_id('movement', 'test-style'))");
  d = await api(request);
  expect(d.periods.find((p) => p.slug === 'test-style').reviewed).toBe(false);
  // a movement without a dated span is not on the timeline
  expect(d.periods.some((p) => p.slug === 'impressionism' && !p.spans.length)).toBe(false);
});

test('periods: the artists of a period (112) — directly with the link\'s dates, through works, rolled up; life, lane places', async ({ request }) => {
  sql(`INSERT INTO movements (slug, name, kind, period, period_label) VALUES ('test-art-style', 'Test Art Style', 'style', '[1880-01-01,1900-01-01)', '1880s–1890s');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label) VALUES
         ('movement', entity_id('movement', 'test-art-style'), 'active_in', 'place', entity_id('place', 'france'), '[1880-01-01,1900-01-01)', '1880–1899'),
         ('artist', entity_id('artist', 'vincent-van-gogh'), 'member_of', 'movement', entity_id('movement', 'test-art-style'), '[1886-01-01,1891-01-01)', '1886–1890');
       INSERT INTO artists (slug, name, birth, birth_label, death, death_label) VALUES ('test-art-early', 'Test Art Early', year_range(1700), 'c. 1700', year_range(1750), '1750');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artist', entity_id('artist', 'test-art-early'), 'associated_with', 'movement', entity_id('movement', 'test-art-style'));
       INSERT INTO artworks (slug, title, creator_id, created, created_label) VALUES ('test-art-work', 'Test Art Work', entity_id('artist', 'paul-gauguin'), year_range(1889), '1889');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES
         ('artwork', entity_id('artwork', 'test-art-work'), 'associated_with', 'movement', entity_id('movement', 'test-art-style'));`);
  const p = (await api(request)).periods.find((x) => x.slug === 'test-art-style');
  const by = (slug) => p.artists.find((a) => a.slug === slug);
  // directly, with the link's dates and the life
  expect(by('vincent-van-gogh')).toMatchObject({ via: 'artist', active: { label: '1886–1890' }, life: { from_year: 1853, to_year: 1890 }, fuzzy: { start: false, end: false } });
  expect(Array.isArray(by('vincent-van-gogh').places)).toBe(true);
  // through a work of theirs; the work names its artist for the artist's row
  expect(by('paul-gauguin')).toMatchObject({ via: 'works', active: null });
  expect(p.works.find((w) => w.slug === 'test-art-work').creator_slug).toBe('paul-gauguin');
  // a birth known roughly fades; a life outside the span is still listed (the site marks it)
  expect(by('test-art-early')).toMatchObject({ via: 'artist', fuzzy: { start: true, end: false }, life: { from_year: 1700 } });
  // the earlier test's phase: its artist is also its style's (rolled up like the works)
  const style = (await api(request)).periods.find((x) => x.slug === 'test-style');
  if (style) expect(style.artists.map((a) => a.slug)).toContain('vincent-van-gogh');
});
