// Acquisition methods the French and Italian museums' provenances need (migration 120): found / excavated, partage
// of finds, spoils of war, accepted in lieu of tax — in the step form, the API and the YAML import; historical
// currencies (livres, scudi, piastres …) for prices.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-hammurabi')";
const cleanup = () => sql("DELETE FROM artworks WHERE slug = 'test-hammurabi'; DELETE FROM live_docs WHERE entity_type = 'artwork'");
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO artworks (slug, title, created, created_label) VALUES ('test-hammurabi', 'Test Stele', '[1755-01-01 BC,1744-01-01 BC)', 'c. 1750 BCE');
       INSERT INTO provenance (artwork_id, position, owner_label, method, acquired, acquired_label) VALUES
         (${W}, 0, 'the Elamite kings', 'spoils_of_war', '[1160-01-01 BC,1149-01-01 BC)', 'c. 1155 BCE'),
         (${W}, 1, 'a French mission', 'find', '[1901-12-01,1902-01-01)', 'December 1901')`);
});
test.afterEach(cleanup);

test('the new methods: offered in the step form, saved, shown by the API; prices in livres', async ({ userA, request }) => {
  const step = sql(`SELECT id FROM provenance WHERE artwork_id = ${W} AND position = 1`);
  await userA.goto(`/provenance/${step}/edit`);
  const options = await userA.locator('#pv-method option').evaluateAll((os) => os.map((o) => o.value));
  expect(options).toEqual(expect.arrayContaining(['find', 'partage', 'spoils_of_war', 'in_lieu']));
  await userA.selectOption('#pv-method', 'partage');
  await Promise.all([userA.waitForNavigation(), userA.click('form.provenance-form .actions button')]);
  expect(sql(`SELECT method FROM provenance WHERE id = ${step}`)).toBe('partage');
  sql(`UPDATE provenance SET method = 'in_lieu', price = 2604, price_currency = 'LIV' WHERE id = ${step}`);
  const detail = await api(request, '/artworks/test-hammurabi');
  expect(detail.provenance.map((s) => s.method)).toEqual(['spoils_of_war', 'in_lieu']);
  expect(detail.provenance[1].price).toMatchObject({ amount: 2604, currency: 'LIV' });
  expect(sql("SELECT string_agg(code, ',' ORDER BY code) FROM currencies WHERE code IN ('LIV', 'SCU', 'DUC', 'FIOR', 'PIA')")).toBe('DUC,FIOR,LIV,PIA,SCU');
});
