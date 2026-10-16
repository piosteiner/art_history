// Provenance as it happened (migrations 083/084): looters hold without title (possessor) — the owner's ownership goes
// on until the restitution; another source's reading of a step (alternative_to); what was given in exchange.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-poss-w')";
const P = (slug) => `entity_id('person', '${slug}')`;
const I = (slug) => `entity_id('institution', '${slug}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-poss-w', 'test-poss-tondo');
  DELETE FROM people WHERE slug IN ('test-poss-irene', 'test-poss-beatrice', 'test-poss-goering', 'test-poss-dealer', 'test-poss-buyer');
  DELETE FROM institutions WHERE slug IN ('test-poss-err', 'test-poss-ccp'); DELETE FROM live_docs WHERE entity_type = 'artwork'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-poss-irene', 'Test Irène'), ('test-poss-beatrice', 'Test Béatrice'),
         ('test-poss-goering', 'Test Göring'), ('test-poss-dealer', 'Test Dealer'), ('test-poss-buyer', 'Test Buyer');
       INSERT INTO institutions (slug, name) VALUES ('test-poss-err', 'Test ERR'), ('test-poss-ccp', 'Test Collecting Point');
       INSERT INTO artworks (slug, title) VALUES ('test-poss-tondo', 'Test Florentine Tondo');
       INSERT INTO artworks (slug, title, creator_id, created, created_label) VALUES ('test-poss-w', 'Test Petite', entity_id('artist', 'paul-gauguin'), year_range(1880), '1880');
       INSERT INTO provenance (artwork_id, position, owner_person_id, owner_institution_id, role, method, direct, acquired, acquired_label, ended, ended_label) VALUES
         (${W}, 0, ${P('test-poss-irene')}, NULL, 'owner', 'inheritance', false, year_range(1914), '1914', NULL, NULL),
         (${W}, 1, NULL, ${I('test-poss-err')}, 'possessor', 'confiscation', true, '[1941-07-07,1941-07-08)', '7 July 1941', '[1941-07-07,1941-07-08)', '7 July 1941'),
         (${W}, 2, ${P('test-poss-goering')}, NULL, 'possessor', 'transfer', true, '[1941-07-07,1941-07-08)', '7 July 1941', '[1942-03-10,1942-03-11)', '10 March 1942'),
         (${W}, 3, ${P('test-poss-dealer')}, NULL, 'possessor', 'exchange', true, '[1942-03-10,1942-03-11)', '10 March 1942', '[1945-07-31,1945-08-01)', '31 July 1945'),
         (${W}, 4, NULL, ${I('test-poss-ccp')}, 'custodian', 'unknown', true, '[1945-09-04,1945-09-05)', '4 September 1945', '[1946-03-27,1946-03-28)', '27 March 1946'),
         (${W}, 5, ${P('test-poss-irene')}, NULL, 'owner', 'restitution', true, '[1946-03-27,1946-03-28)', '27 March 1946', NULL, NULL),
         (${W}, 6, ${P('test-poss-buyer')}, NULL, 'owner', 'purchase', true, '[1949-10-21,1949-10-22)', '21 October 1949', NULL, NULL)`);
});
test.afterEach(cleanup);

test('looters hold without title; another reading of a step; exchanged for', async ({ userA, request }) => {
  // 1. the owner's ownership goes on through the seizure until the restitution; no "owned by" for those who took it
  expect(sql(`SELECT period_label FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('1914–27 March 1946');
  expect(sql(`SELECT string_agg(o.slug, ' ' ORDER BY o.slug) FROM edges e JOIN entity_index o ON (o.type, o.id) = (e.object_type, e.object_id)
    WHERE e.relationship_type = 'owned_by' AND e.subject_type = 'artwork' AND e.subject_id = ${W}`)).toBe('test-poss-buyer test-poss-irene test-poss-irene');
  expect(sql(`SELECT label FROM edges WHERE relationship_type = 'held_by' AND subject_id = ${W} AND object_id = ${P('test-poss-goering')} AND object_type = 'person'`))
    .toBe('possessor — held without title');
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id IN ('provenance_seizure_as_owner', 'provenance_forced_transfer') AND entity_id = ${W}`)).toBe('0');
  // recorded as an owner: the check asks for possessor
  sql(`UPDATE provenance SET role = 'owner' WHERE artwork_id = ${W} AND position = 1`);
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'provenance_seizure_as_owner' AND entity_id = ${W}`)).toMatch(/possession, not title/);
  sql(`UPDATE provenance SET role = 'possessor' WHERE artwork_id = ${W} AND position = 1`);
  await userA.goto('/artworks/test-poss-w');
  await expect(userA.locator('table.provenance tbody', { hasText: 'Test Göring' }).locator('tr.transfer')).toContainText('taken from its owner — held without title');

  // 3. exchanged for an artwork of ours: on the step, in the API, a derived edge
  await userA.locator('table.provenance tbody', { hasText: 'Test Dealer' }).locator('a:has-text("edit")').click();
  await userA.fill('#pv-exchanged', 'test-poss-tondo');
  await userA.fill('input[name=exchanged_for_text]', 'a Florentine tondo');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Save")')]);
  await expect(userA.locator('table.provenance tbody', { hasText: 'Test Dealer' })).toContainText('exchanged for Test Florentine Tondo — a Florentine tondo');
  expect(sql(`SELECT count(*) FROM edges WHERE relationship_type = 'exchanged_for' AND subject_id = ${W} AND object_id = entity_id('artwork', 'test-poss-tondo')`)).toBe('1');

  // 2. another source's reading of step 1: Béatrice the owner (a gift) — beside it, not in the chain
  await userA.goto('/artworks/test-poss-w');
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner', 'person/test-poss-beatrice');
  await userA.fill('#pv-acquired', '1933');
  await userA.selectOption('#pv-method', 'gift');
  await userA.selectOption('#pv-cert', 'disputed');
  await userA.fill('#pv-label', 'Léon Reinach (1941): a gift from her grandmother');
  await userA.selectOption('#pv-alt', { label: '1. Test Irène 1914' });
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  const alt = userA.locator('table.provenance tbody.alternative');
  await expect(alt).toContainText('another reading');
  await expect(alt).toContainText('Test Béatrice');
  expect(sql(`SELECT count(*) FROM provenance_periods WHERE artwork_id = ${W} AND owner_id = ${P('test-poss-beatrice')}`)).toBe('0');
  expect(sql(`SELECT period_label FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('1914–27 March 1946');   // unchanged
  const step = (await api(request, '/artworks/test-poss-w')).provenance.find((s) => s.owner && s.owner.slug === 'test-poss-irene');
  expect(step.alternatives.map((a) => [a.owner.slug, a.method, a.certainty])).toEqual([['test-poss-beatrice', 'gift', 'disputed']]);
  const dealer = (await api(request, '/artworks/test-poss-w')).provenance.find((s) => s.owner && s.owner.slug === 'test-poss-dealer');
  expect(dealer.exchanged_for).toEqual({ artwork: { slug: 'test-poss-tondo', title: 'Test Florentine Tondo' }, text: 'a Florentine tondo' });
  // dragging the steps still works with an alternative beside them
  const ids = sql(`SELECT string_agg(id::text, ',' ORDER BY position DESC) FROM provenance WHERE artwork_id = ${W} AND alternative_to IS NULL`);
  expect(await userA.evaluate((body) => fetch('/artworks/test-poss-w/provenance/order', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }).then((r) => r.status), `ids=${ids}`)).toBe(204);
});
