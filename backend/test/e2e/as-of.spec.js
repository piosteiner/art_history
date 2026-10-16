// Citable versions (migration 089): an entry as recorded at a moment, rebuilt from the audit log — its fields,
// relationships, provenance; the changes since; the list of versions; also after the entry was deleted.
const { test, expect, sql, API } = require('./helpers');

const get = (request, path) => request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } });
const api = async (request, path) => (await get(request, path)).json();
const now = () => sql(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const W = "entity_id('artwork', 'test-asof')";

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-asof'; DELETE FROM people WHERE slug = 'test-asof-p'`);
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('the entry as of a moment, the changes since, its versions, after deletion too', async ({ request }) => {
  const before = now();
  sql(`INSERT INTO people (slug, name) VALUES ('test-asof-p', 'Test Asof Sitter');
       INSERT INTO artworks (slug, title) VALUES ('test-asof', 'Test Asof First')`);
  const t1 = now();
  sql(`UPDATE artworks SET title = 'Test Asof Second' WHERE slug = 'test-asof';
       INSERT INTO provenance (artwork_id, position, owner_person_id, method, direct, acquired, acquired_label)
       VALUES (${W}, 0, entity_id('person', 'test-asof-p'), 'purchase', true, year_range(1920), '1920');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
       VALUES ('artwork', ${W}, 'depicts_person', 'person', entity_id('person', 'test-asof-p'))`);
  const t2 = now();
  sql(`UPDATE artworks SET title = 'Test Asof Third' WHERE slug = 'test-asof'; DELETE FROM relationships WHERE subject_type = 'artwork' AND subject_id = ${W}`);
  const number = Number(sql("SELECT public_id FROM artworks WHERE slug = 'test-asof'"));

  // as of t1: the first title, nothing else yet; the changes since listed
  const v1 = await api(request, `/artworks/test-asof?as_of=${t1}`);
  expect(v1).toMatchObject({ type: 'artwork', deleted: false, entry: { title: 'Test Asof First' }, provenance: [], relationships: [] });
  expect(v1.current).toMatchObject({ slug: 'test-asof', public_id: number, name: 'Test Asof Third' });
  expect(v1.entry.created_by).toBeUndefined();
  expect(v1.changes_since.find((c) => c.table === 'artworks' && c.action === 'update').fields).toEqual(['title']);
  expect(v1.changes_since.some((c) => c.table === 'provenance' && c.action === 'insert')).toBe(true);
  expect(v1.changes_since.some((c) => c.table === 'relationships' && c.action === 'delete')).toBe(true);

  // as of t2: the second title, the provenance step, the portrait — by number
  const v2 = await api(request, `/artworks/${number}?as_of=${t2}`);
  expect(v2.entry.title).toBe('Test Asof Second');
  expect(v2.provenance).toMatchObject([{ position: 0, method: 'purchase', holder: { name: 'Test Asof Sitter' }, acquired: { from_year: 1920 } }]);
  expect(v2.relationships).toMatchObject([{ relationship_type: 'depicts_person', direction: 'out', other: { name: 'Test Asof Sitter' } }]);

  // the versions, newest first; each version's own moment shows it (microseconds kept)
  const h = await api(request, '/history/artworks/test-asof');
  expect(h.versions.length).toBe(3);
  expect(h.versions[0].changed_at > h.versions[2].changed_at).toBe(true);
  expect((await api(request, `/artworks/test-asof?as_of=${h.versions[2].as_of}`)).entry.title).toBe('Test Asof First');
  expect((await api(request, `/artworks/test-asof?as_of=${h.versions[1].as_of}`)).version).toBe(h.versions[1].changed_at);
  // a date: the end of that day — today: as of now
  expect((await api(request, `/artworks/test-asof?as_of=${new Date().toISOString().slice(0, 10)}`)).entry.title).toBe('Test Asof Third');

  // before it existed, nonsense, before the history began
  expect((await get(request, `/artworks/test-asof?as_of=${before}`)).status()).toBe(404);
  expect((await get(request, '/artworks/test-asof?as_of=yesterday')).status()).toBe(400);
  expect((await get(request, '/artworks/test-asof?as_of=2000-01-01')).status()).toBe(400);

  // deleted: a citation of it still works, by number or slug
  sql("DELETE FROM artworks WHERE slug = 'test-asof'");
  const gone = await api(request, `/artworks/${number}?as_of=${t2}`);
  expect(gone).toMatchObject({ deleted: true, current: null, entry: { title: 'Test Asof Second' } });
  expect((await api(request, '/history/artworks/test-asof')).deleted).toBe(true);
  expect((await get(request, '/artworks/test-asof')).status()).toBe(404);
});
