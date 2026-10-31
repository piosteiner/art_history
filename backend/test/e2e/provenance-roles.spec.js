// Provenance (063): the artist as implied first line, a loan as implied last line; role, joint owners, price; dates
// known from one side; the derived edges (owned by — also for a joint owner —, held by, commissioned); the API.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-tournesols')";

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-tournesols'; DELETE FROM institutions WHERE slug = 'test-kunsthaus-r';
  DELETE FROM people WHERE slug IN ('test-vollard', 'test-leo-stein', 'test-gertrude-stein', 'test-agent', 'test-patron')`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-vollard', 'Test Ambroise Vollard'), ('test-leo-stein', 'Test Leo Stein'),
         ('test-gertrude-stein', 'Test Gertrude Stein'), ('test-agent', 'Test Agent'), ('test-patron', 'Test Patron');
       INSERT INTO institutions (slug, name) VALUES ('test-kunsthaus-r', 'Test Kunsthaus R');
       INSERT INTO artworks (slug, title, creator_id, created, created_label, current_institution_id, on_loan, on_loan_since, on_loan_since_label)
       VALUES ('test-tournesols', 'Test Tournesols', entity_id('artist', 'paul-gauguin'), '[1901-01-01,1902-01-01)', '1901',
               entity_id('institution', 'test-kunsthaus-r'), true, '[2021-01-01,2022-01-01)', '2021')`);
});
test.afterEach(cleanup);

test('role, joint owners, price, one-sided dates; the artist and the loan as implied lines; edges and API', async ({ userA, request }) => {
  await userA.goto('/artworks/test-tournesols');
  // nothing recorded yet: the artist (from creator and date) and the loan — implied
  const rows = userA.locator('table.provenance tbody');
  await expect(rows.first()).toHaveClass(/implied/);
  await expect(rows.first()).toContainText('Paul Gauguin');
  await expect(rows.last()).toContainText('Test Kunsthaus R');
  await expect(rows.last()).toContainText('custodian');

  // Vollard: a dealer, bought from the artist for 200 FRF between 1901 and 28 October 1904
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner', 'person/test-vollard');
  await userA.selectOption('#pv-role', 'dealer');
  await userA.fill('#pv-acquired', '1901/28 October 1904');
  await userA.selectOption('#pv-method', 'purchase');
  await userA.check('input[name="direct"]');
  await userA.fill('#pv-price', '200.00');
  await userA.fill('#pv-cur', 'frf');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=prov-added/);
  // Léo and Gertrude Stein: one step, two owners; "at least until 1908": known from one side
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner', 'person/test-leo-stein');
  await userA.fill('input[name="co_owner_1"]', 'person/test-gertrude-stein');
  await userA.fill('#pv-acquired', '1904-10-28');
  await userA.fill('#pv-ended', '27 April 1908 or later');
  await userA.selectOption('#pv-method', 'purchase');
  await userA.check('input[name="direct"]');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=prov-added/);

  const table = userA.locator('table.provenance');
  await expect(table).toContainText('200 FRF');
  await expect(table).toContainText('dealer');
  await expect(table).toContainText('Test Leo Stein and Test Gertrude Stein');
  await expect(table).toContainText('27 April 1908 or later');
  // the artist until Vollard bought it (directly from him)
  await expect(rows.first()).toContainText('1901 – 1901 – 28 October 1904');

  // an agent and a commission (entered in SQL): held by, commissioned
  sql(`INSERT INTO provenance (artwork_id, position, owner_person_id, role, acquired, acquired_label) VALUES (${W}, 2, entity_id('person', 'test-agent'), 'agent', '[1928-01-01,1929-01-01)', '1928')`);
  const edges = sql(`SELECT string_agg(relationship_type || ' ' || o.slug, ', ' ORDER BY relationship_type, o.slug) FROM edges r
    JOIN entity_index o ON (o.type, o.id) = (r.object_type, r.object_id) WHERE (r.subject_type, r.subject_id) = ('artwork', ${W}) AND r.source = 'provenance'
    AND relationship_type IN ('owned_by', 'held_by')`);
  expect(edges).toBe('held_by test-agent, owned_by test-gertrude-stein, owned_by test-leo-stein, owned_by test-vollard');

  const a = await api(request, '/artworks/test-tournesols');
  expect(a.provenance.map((p) => p.kind)).toEqual(['creation', 'step', 'step', 'step', 'loan']);
  expect(a.provenance[0]).toMatchObject({ implied: true, owner: { slug: 'paul-gauguin' }, method: 'creation' });
  expect(a.provenance[1]).toMatchObject({ role: 'dealer', price: { amount: 200, currency: 'FRF', note: null } });
  expect(a.provenance[2].co_owners).toEqual([expect.objectContaining({ type: 'person', slug: 'test-gertrude-stein', name: 'Test Gertrude Stein' })]);
  expect(a.provenance[2].ended).toMatchObject({ from: '1908-04-27', to: null, label: '27 April 1908 or later' });
  expect(a.provenance[4]).toMatchObject({ kind: 'loan', implied: true, role: 'custodian', owner: { slug: 'test-kunsthaus-r' } });

  // a commission as first step: no implied artist line; "commissioned" derived
  sql(`UPDATE provenance SET position = position + 1 WHERE artwork_id = ${W};
       INSERT INTO provenance (artwork_id, position, owner_person_id, method) VALUES (${W}, 0, entity_id('person', 'test-patron'), 'commission')`);
  const b = await api(request, '/artworks/test-tournesols');
  expect(b.provenance[0]).toMatchObject({ kind: 'step', method: 'commission' });
  expect(sql(`SELECT count(*) FROM edges WHERE relationship_type = 'commissioned' AND object_id = ${W} AND subject_id = entity_id('person', 'test-patron')`)).toBe('1');
  const patron = await api(request, '/people/test-patron');
  expect(patron.roles).toContain('patron');
});

test('Wikidata "commissioned by" (P88) becomes the first step of the provenance, cited with the item', async ({ userA }) => {
  sql(`DELETE FROM artworks WHERE slug = 'test-altarpiece'; DELETE FROM people WHERE slug = 'test-patron-portinari';
       INSERT INTO artworks (slug, title, wikidata_id) VALUES ('test-altarpiece', 'Test Altarpiece', 'Q130')`);
  await userA.goto('/artworks/test-altarpiece/wikidata');
  const row = userA.locator('.wd-table tbody tr', { hasText: 'Test Patron Portinari' }).first();
  await row.locator('input[value=create]').check();
  await Promise.all([userA.waitForNavigation(), userA.click('.wd-form .sticky-actions button')]);
  expect(sql(`SELECT p.position || ' ' || p.method || ' ' || o.slug || ' ' || c.wikidata_item || ' ' || c.wikidata_property
    FROM provenance p JOIN people o ON o.id = p.owner_person_id JOIN citations c ON c.provenance_id = p.id
    WHERE p.artwork_id = entity_id('artwork', 'test-altarpiece')`)).toBe('0 commission test-patron-portinari Q130 P88');
  expect(sql("SELECT count(*) FROM relationships WHERE relationship_type = 'commissioned'")).toBe('0');
  // the next comparison knows it: "already there" (derived from the provenance)
  await userA.goto('/artworks/test-altarpiece/wikidata');
  await expect(userA.locator('.wd-table tbody tr', { hasText: 'Test Patron Portinari' }).first()).toContainText('already there');
  sql("DELETE FROM artworks WHERE slug = 'test-altarpiece'; DELETE FROM people WHERE slug = 'test-patron-portinari'");
});
