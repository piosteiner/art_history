// The project's numbers (migration 138, src/stats.js): recorded at server start and hourly; /v1/stats gives each
// metric's latest value and one value per day. The database counts its entries, the app its tests.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test('statistics: today\'s counts recorded, the series per day, the tests counted from the files', async ({ request }) => {
  sql('SELECT record_site_stats()');   // as the server does at start, with the data as it is now
  const s = await api(request, '/stats');
  expect(s.updated).toBe(sql('SELECT current_date::text'));
  const count = (table) => Number(sql(`SELECT count(*) FROM ${table}`));
  expect(s.metrics['entries.artworks'].value).toBe(count('artworks'));
  expect(s.metrics['content.provenance'].value).toBe(count('provenance'));
  expect(s.metrics['project.migrations'].value).toBe(Number(sql('SELECT count(*) FROM schema_migrations')));
  const kinds = ['artworks', 'artists', 'people', 'institutions', 'places', 'movements', 'events', 'polities', 'glossary', 'bibliography'];
  expect(s.metrics['entries.total'].value).toBe(kinds.reduce((n, k) => n + s.metrics[`entries.${k}`].value, 0));
  // the series: one value per day, the last one today's
  const series = s.metrics['entries.artworks'].series;
  expect(series[series.length - 1]).toEqual([s.updated, s.metrics['entries.artworks'].value]);
  // the tests: counted from the repository's files by the server at start (this file among them)
  expect(s.metrics['tests.backend_e2e'].value).toBeGreaterThan(200);
  expect(s.metrics['tests.site'].value).toBeGreaterThan(100);
  // recorded again: today's row rewritten, not a second one
  sql("INSERT INTO artworks (slug, title) VALUES ('test-stats-new', 'Test Stats New'); SELECT record_site_stats();");
  const again = await api(request, '/stats');
  expect(again.metrics['entries.artworks'].value).toBe(s.metrics['entries.artworks'].value + 1);
  expect(again.metrics['entries.artworks'].series.length).toBe(series.length);
  sql("DELETE FROM artworks WHERE slug = 'test-stats-new'; SELECT record_site_stats();");
});
