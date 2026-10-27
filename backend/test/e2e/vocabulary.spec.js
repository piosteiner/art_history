// GET /v1/stats/vocabulary (src/vocabulary.js): every kind of relationship and every provenance option with how often each is
// used — for the statistics page. The lists come from the database: an enum's values all appear, unused ones with 0.
const { test, expect, sql, API } = require('./helpers');

const vocab = async (request) => {
  const res = await request.get(`${API}/stats/vocabulary`, { headers: { Host: 'api.localhost' } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
};

test('vocabulary: relationship types with counts, every provenance option in its order with a German explanation', async ({ request }) => {
  const v = await vocab(request);
  // relationships: as many as the table has, each with both directions and the entry types it connects
  expect(v.relationships.length).toBe(Number(sql('SELECT count(*) FROM relationship_types')));
  const born = v.relationships.find((r) => r.code === 'born_in');
  expect(born).toMatchObject({ label: 'born in', inverse_label: 'birthplace of', presence: true, subject_types: ['artist', 'person'], object_types: ['place'] });
  expect(born.n).toBe(Number(sql("SELECT count(*) FROM graph_links WHERE relationship_type = 'born_in'")));
  // provenance: all values of each enum, in the declared order, explained; counted like the table
  const methods = sql("SELECT string_agg(v::text, ',') FROM unnest(enum_range(NULL::acquisition_method)) v").split(',');
  expect(v.provenance.methods.map((m) => m.code)).toEqual(methods);
  expect(v.provenance.methods.every((m) => m.description)).toBe(true);
  expect(v.provenance.methods.find((m) => m.code === 'theft').label).toBe('stolen');           // as the site shows it
  expect(v.provenance.roles.map((r) => r.code)).toContain('possessor');
  expect(v.provenance.status.map((s) => s.label)).toEqual(['A', 'B', 'C', 'D']);
  const purchases = Number(sql("SELECT count(*) FROM provenance WHERE method = 'purchase'"));
  expect(v.provenance.methods.find((m) => m.code === 'purchase').n).toBe(purchases);
  expect(v.provenance.numbers.find((n) => n.code === 'err')).toMatchObject({ scope: 'global' });
  expect(v.provenance.currencies.find((c) => c.code === 'RM')).toMatchObject({ since: '1924-08-30', until: '1948-06-21' });
});
