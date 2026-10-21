// Provenance as the Kunsthaus Zürich's Gauguin works showed it (migrations 073/074): custody beside the ownership,
// an auction that didn't sell, the 1933–1945 gap over undated steps, a settlement after a forced sale, the provenance
// status (BAK A–D), a design date for later prints, copy_after.
const { test, expect, sql, settled, API, submitForm } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-semmel-road')";
const P = (slug) => `entity_id('person', '${slug}')`;
const I = (slug) => `entity_id('institution', '${slug}')`;

const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-semmel-road', 'test-copy');
  DELETE FROM institutions WHERE slug IN ('test-museum-c', 'test-auction-c', 'test-gallery-c');
  DELETE FROM people WHERE slug IN ('test-semmel', 'test-buyer', 'test-later'); DELETE FROM live_docs WHERE entity_type = 'artwork'`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-semmel', 'Test Richard Semmel'), ('test-buyer', 'Test Buyer'), ('test-later', 'Test Later Owner');
       INSERT INTO institutions (slug, name) VALUES ('test-museum-c', 'Test Museum C'), ('test-auction-c', 'Test Auction C'), ('test-gallery-c', 'Test Gallery C');
       INSERT INTO artworks (slug, title, creator_id, created, created_label)
       VALUES ('test-semmel-road', 'Test Road', entity_id('artist', 'paul-gauguin'), '[1884-01-01,1885-01-01)', '1884');
       INSERT INTO provenance (artwork_id, position, owner_person_id, owner_institution_id, role, method, direct, acquired, acquired_label, ended, ended_label, not_sold) VALUES
         (${W}, 0, ${P('test-semmel')}, NULL, 'owner', 'unknown', false, '[1900-01-01,1901-01-01)', '1900', NULL, NULL, false),
         (${W}, 1, NULL, ${I('test-museum-c')}, 'custodian', 'unknown', true, '[1910-01-01,1911-01-01)', '1910', '[1912-01-01,1913-01-01)', '1912', false),
         (${W}, 2, NULL, ${I('test-auction-c')}, 'agent', 'auction', true, '[1933-06-13,1933-06-14)', '13 June 1933', '[1933-06-13,1933-06-14)', '13 June 1933', true),
         (${W}, 3, NULL, ${I('test-gallery-c')}, 'agent', 'auction', true, '[1937-03-20,1937-03-21)', '20 March 1937', '[1937-03-20,1937-03-21)', '20 March 1937', false),
         (${W}, 4, ${P('test-buyer')}, NULL, 'owner', 'forced_sale', true, '[1937-03-20,1937-03-21)', '20 March 1937', NULL, NULL, false),
         (${W}, 5, ${P('test-later')}, NULL, 'owner', 'unknown', false, NULL, NULL, NULL, NULL, false),
         (${W}, 6, ${P('test-buyer')}, NULL, 'owner', 'purchase', true, '[1950-01-01,1951-01-01)', '1950', NULL, NULL, false)`);
});
test.afterEach(cleanup);

test('custody beside the ownership; an auction that did not sell; the 1933–1945 gap over undated steps; settlement', async ({ userA, request }) => {
  // 1. the deposit (1910–1912) doesn't end Semmel's ownership: it lasts until the buyer's acquisition in 1937
  expect(sql(`SELECT period_label FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('1900–20 March 1937');
  expect(sql(`SELECT string_agg(position::text, ',' ORDER BY position) FROM provenance_periods WHERE artwork_id = ${W} AND NOT in_chain`)).toBe('1,2,3');
  // 2. one handover Semmel → buyer, through the auction that sold it — not through the one that didn't
  expect(sql(`SELECT string_agg(concat_ws(' ', s.slug || '>' || o.slug, e.label), '; ' ORDER BY (SELECT position FROM provenance WHERE id = e.provenance_id))
    FROM edges e JOIN entity_index s ON (s.type, s.id) = (e.subject_type, e.subject_id) JOIN entity_index o ON (o.type, o.id) = (e.object_type, e.object_id)
    WHERE e.relationship_type = 'transferred_to' AND e.provenance_id IN (SELECT id FROM provenance WHERE artwork_id = ${W})`))
    .toBe('test-semmel>test-buyer forced sale · via Test Gallery C; test-buyer>test-later; test-later>test-buyer purchase');
  expect(sql(`SELECT label FROM edges WHERE relationship_type = 'held_by' AND subject_id = ${W} AND object_id = ${I('test-auction-c')}`))
    .toBe('agent · not sold');

  // 3. the undated owner between 1937 and 1950: a possible handover in 1937–1945; the first, 1884–1900, isn't one
  expect(sql(`SELECT string_agg(detail, ' | ') FROM quality_issues_live WHERE check_id = 'provenance_gap_1933_1945' AND entity_id = ${W}`))
    .toBe('Test Later Owner: the change of owner (undated) is not documented as direct — it may have happened between 1937 and 1950');
  // 4. a forced sale without restitution is a warning — a settlement answers it
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_forced_transfer' AND entity_id = ${W}`)).toBe('1');

  // the admin page: custody "held alongside", the handover "via", "not sold"; a settlement added in the form
  await userA.goto('/artworks/test-semmel-road');
  const bodies = userA.locator('table.provenance tbody');
  await expect(bodies.filter({ hasText: 'Test Museum C' }).locator('tr.transfer')).toContainText('held alongside the owner');
  await expect(bodies.filter({ hasText: 'Test Auction C' })).toContainText('not sold');
  await expect(bodies.filter({ hasText: 'Test Buyer' }).first().locator('tr.transfer')).toContainText('via Test Gallery C');
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner', 'person/test-buyer');
  await userA.fill('#pv-acquired', '24 June 2025');
  await userA.selectOption('#pv-method', 'settlement');
  await userA.check('input[name="direct"]');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=prov-added/);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_forced_transfer' AND entity_id = ${W}`)).toBe('0');
  // … and the ownership goes on: the 1950 step isn't ended by the settlement (075)
  expect(sql(`SELECT period_label FROM provenance_periods WHERE artwork_id = ${W} AND position = 6`)).toBe('from 1950');
  // a dealer that held it on consignment and then bought it: not "via" itself (075)
  sql(`UPDATE provenance SET owner_person_id = NULL, owner_institution_id = ${I('test-gallery-c')}, role = 'dealer' WHERE artwork_id = ${W} AND position = 4`);
  expect(sql(`SELECT coalesce(via, '-') FROM provenance_periods WHERE artwork_id = ${W} AND position = 4`)).toBe('-');
  sql(`UPDATE provenance SET owner_institution_id = NULL, owner_person_id = ${P('test-buyer')}, role = 'owner' WHERE artwork_id = ${W} AND position = 4`);

  // the API: the steps say which are custody, which agent didn't sell, through whom a handover went
  const prov = (await api(request, '/artworks/test-semmel-road')).provenance.filter((s) => !s.implied);
  expect(prov.map((s) => [s.owner.slug, s.in_chain, s.not_sold])).toEqual(expect.arrayContaining([
    ['test-museum-c', false, false], ['test-auction-c', false, true]]));
  expect(prov.find((s) => s.owner.slug === 'test-buyer' && s.method === 'forced_sale').via).toBe('Test Gallery C');

  // "not sold" in the form: kept for an agent, refused for anyone else
  await bodies.filter({ has: userA.locator('td a', { hasText: 'Test Auction C' }) }).locator('a:has-text("edit")').click();
  await expect(userA.locator('input[name="not_sold"]')).toBeChecked();
  await userA.goto('/artworks/test-semmel-road');
  await bodies.filter({ has: userA.locator('td a', { hasText: 'Test Gallery C' }) }).locator('a:has-text("edit")').click();
  await userA.selectOption('#pv-role', 'owner');
  await userA.check('input[name="not_sold"]');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Save")')]);
  expect(sql(`SELECT not_sold FROM provenance WHERE artwork_id = ${W} AND position = 3`)).toBe('f');

});

test('provenance status (BAK A–D) and a design date earlier than the print; copy_after', async ({ userA, request }) => {
  // a print pulled after the artist's death: an error — until the design date says when the block was cut
  sql(`UPDATE artworks SET created = '[1921-01-01,1922-01-01)', created_label = '1921' WHERE slug = 'test-semmel-road'`);
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'artwork_outside_creator_life' AND entity_id = ${W}`)).toMatch(/^created 1921, but Paul Gauguin died/);
  await userA.goto('/artworks/test-semmel-road/edit');
  await userA.click('summary:has-text("Designed earlier")');
  await userA.fill('#f-conceived', '1893/1894');
  await userA.selectOption('#f-provenance_status', 'c_indications');
  await userA.fill('#f-provenance_status_note', 'Provenienzstatus (BAK): C');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'artwork_outside_creator_life' AND entity_id = ${W}`)).toBe('0');

  const w = await api(request, '/artworks/test-semmel-road');
  expect(w.conceived).toMatchObject({ from_year: 1893, to_year: 1894 });
  expect(w.provenance_status).toMatchObject({ category: 'C', code: 'c_indications', note: 'Provenienzstatus (BAK): C' });
  expect((await api(request, '/artworks?limit=500')).data.find((a) => a.slug === 'test-semmel-road').provenance_category).toBe('C');

  // a copy after another work
  sql(`INSERT INTO artworks (slug, title) VALUES ('test-copy', 'Test Copy');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artwork', entity_id('artwork', 'test-copy'), 'copy_after', 'artwork', ${W})`);
  await settled();   // the API reads the stored graph (126)
  const copy = await api(request, '/artworks/test-copy');
  expect(copy.relationships.map((r) => [r.type, r.entity.slug])).toContainEqual(['copy_after', 'test-semmel-road']);
});
