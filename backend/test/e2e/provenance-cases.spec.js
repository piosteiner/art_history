// Provenance for every case the Kunsthaus Zürich documents (migrations 076/077): events without a holder, theft,
// transfer, several places per step, RM prices, roles publisher / foundry / trustee, numbers of a step (searchable)
// and the Lugt authority, a step linked to an event, German and Roman-numeral dates.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-cases-w')";

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-cases-w'; DELETE FROM events WHERE slug = 'test-cases-sale';
  DELETE FROM people WHERE slug IN ('test-cases-owner', 'test-cases-heirs'); DELETE FROM institutions WHERE slug IN ('test-cases-bank', 'test-cases-foundry', 'test-cases-press');
  DELETE FROM places WHERE slug IN ('test-cases-koeln', 'test-cases-berlin', 'test-cases-genf')`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO people (slug, name) VALUES ('test-cases-owner', 'Test Max Owner'), ('test-cases-heirs', 'Test Heirs');
       INSERT INTO institutions (slug, name) VALUES ('test-cases-bank', 'Test Bank'), ('test-cases-foundry', 'Test Foundry'), ('test-cases-press', 'Test Press');
       INSERT INTO places (slug, name, kind, location) VALUES ('test-cases-koeln', 'Test Köln', 'settlement', 'POINT(6.96 50.94)'),
         ('test-cases-berlin', 'Test Berlin', 'settlement', 'POINT(13.40 52.52)'), ('test-cases-genf', 'Test Genf', 'settlement', 'POINT(6.14 46.20)');
       INSERT INTO events (slug, name, kind) VALUES ('test-cases-sale', 'Test Sale 1941', 'auction');
       INSERT INTO artworks (slug, title, creator_id, created, created_label) VALUES ('test-cases-w', 'Test Cases', entity_id('artist', 'paul-gauguin'), year_range(1889), '1889')`);
});
test.afterEach(cleanup);

async function addStep(page, fill) {
  await page.goto('/artworks/test-cases-w');
  await page.click('summary:has-text("+ Add provenance step")');
  await fill(page);
  await Promise.all([page.waitForNavigation(), page.click('.provenance-form button:has-text("Add")')]);
}

test('places, numbers, an event, RM, German dates; theft and recovery; events and the new roles', async ({ userA, request }) => {
  // an owner who took it from Köln to Berlin to Geneva (4), bought at an auction (9) for Reichsmark (5), dated "1.7.1913" (10), numbered (8)
  await addStep(userA, async (p) => {
    await p.fill('#pv-owner', 'person/test-cases-owner');
    await p.fill('#pv-acquired', '1.7.1913');
    await p.selectOption('#pv-method', 'purchase');
    await p.fill('#pv-location', 'test-cases-koeln');
    await p.fill('input[name=place_1]', 'test-cases-berlin');
    await p.fill('input[name=place_date_1]', '1930');
    await p.fill('input[name=place_2]', 'test-cases-genf');
    await p.fill('input[name=place_date_2]', '5.IX.1939');
    await p.fill('#pv-event', 'test-cases-sale');
    await p.fill('#pv-price', '50');
    await p.fill('#pv-cur', 'RM');
    await p.selectOption('select[name=number_kind_1]', 'munich');
    await p.fill('input[name=number_1]', '4317');
    await p.selectOption('select[name=number_kind_2]', 'ek');
    await p.fill('input[name=number_2]', '5363');
  });
  await expect(userA).toHaveURL(/done=prov-added/);
  const row = userA.locator('table.provenance tbody', { hasText: 'Test Max Owner' });
  await expect(row).toContainText('→ Test Berlin');
  await expect(row).toContainText('5 September 1939');
  await expect(row).toContainText('Munich no. 4317');
  await expect(row.locator('a[href="/events/test-cases-sale"]')).toBeVisible();
  // the number found again: the admin's search and the API
  await row.locator('a:has-text("4317")').click();
  await expect(userA.locator('[data-live-results="numbers"]')).toContainText('Test Cases');
  expect((await api(request, '/provenance-numbers?number=4317')).data.map((x) => [x.kind, x.artwork.slug])).toEqual([['munich', 'test-cases-w']]);
  // the API's step; the map: the step's three places as stops, the moves direct; "kept in" for each place
  const step = (await api(request, '/artworks/test-cases-w')).provenance.find((s) => !s.implied);
  expect(step.acquired.label).toBe('1 July 1913');
  expect(step.price).toMatchObject({ amount: 50, currency: 'RM' });
  expect(step.further_places.map((x) => x.slug)).toEqual(['test-cases-berlin', 'test-cases-genf']);
  expect(step.numbers.map((n) => `${n.kind} ${n.number}`)).toEqual(['munich 4317', 'ek 5363']);
  expect(step.event.slug).toBe('test-cases-sale');
  const map = (await api(request, '/map/artworks/test-cases-w')).provenance;
  expect(map.features.filter((f) => f.properties.layer === 'provenance_stop' && f.properties.kind === 'step').map((f) => f.properties.place.slug))
    .toEqual(['test-cases-koeln', 'test-cases-berlin', 'test-cases-genf']);
  expect(map.features.filter((f) => f.properties.layer === 'provenance_segment' && f.properties.move).every((f) => f.properties.direct)).toBe(true);
  expect(sql(`SELECT count(*) FROM edges WHERE relationship_type = 'kept_in' AND subject_id = ${W}`)).toBe('3');

  // 2. stolen: a custodian step, the owner keeps the title — a warning until the recovery is recorded
  await addStep(userA, async (p) => {
    await p.fill('#pv-owner-label', 'unknown (the thief)');
    await p.selectOption('#pv-role', 'custodian');
    await p.fill('#pv-acquired', '1992');
    await p.selectOption('#pv-method', 'theft');
  });
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'provenance_stolen' AND entity_id = ${W}`)).toMatch(/^stolen 1992 — not recovered/);
  expect(sql(`SELECT in_chain FROM provenance_periods WHERE artwork_id = ${W} AND method = 'theft'`)).toBe('f');
  sql(`UPDATE provenance SET ended = year_range(1995), ended_label = '1995' WHERE artwork_id = ${W} AND method = 'theft'`);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_stolen' AND entity_id = ${W}`)).toBe('0');
  await userA.goto('/artworks/test-cases-w');
  await expect(userA.locator('table.provenance .tag', { hasText: 'stolen — recovered' })).toBeVisible();

  // 1. an event without a holder: a description is enough; not an owner, not a holder
  await addStep(userA, async (p) => {
    await p.selectOption('#pv-role', 'event');
    await p.fill('#pv-acquired', 'between 1964 and 1965');
    await p.selectOption('#pv-method', 'settlement');
    await p.fill('#pv-label', 'amicable settlement between the heirs and a former owner');
  });
  await expect(userA).toHaveURL(/done=prov-added/);
  await expect(userA.locator('table.provenance tbody', { hasText: 'amicable settlement' }).locator('tr.transfer')).toContainText('an event');
  expect(sql(`SELECT acquired_label || ' ' || in_chain FROM provenance_periods WHERE artwork_id = ${W} AND role = 'event'`)).toBe('1964–1965 false');
  // a moment, not a holding (082): no end implied by a later acquisition — its period is its date
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, acquired, acquired_label, method)
       VALUES (${W}, 900, 'Later owner (test)', year_range(1970), '1970', 'purchase')`);
  expect(sql(`SELECT end_basis || ' ' || period_label FROM provenance_periods WHERE artwork_id = ${W} AND role = 'event'`)).toBe('point 1964–1965');
  sql(`DELETE FROM provenance WHERE artwork_id = ${W} AND owner_label = 'Later owner (test)'`);
  // without a description: refused
  await addStep(userA, async (p) => { await p.selectOption('#pv-role', 'event'); });
  await expect(userA.locator('.flash.error')).toContainText('An event: describe it');

  // 3, 6, 7: transfer; a publisher of the chain; a foundry and a trustee beside it (held_by, no owned_by)
  sql(`INSERT INTO provenance (artwork_id, position, owner_institution_id, role, method) VALUES
         (${W}, 10, entity_id('institution', 'test-cases-press'), 'publisher', 'transfer'),
         (${W}, 11, entity_id('institution', 'test-cases-foundry'), 'foundry', 'unknown'),
         (${W}, 12, entity_id('institution', 'test-cases-bank'), 'trustee', 'unknown')`);
  expect(sql(`SELECT string_agg(role || ':' || in_chain, ' ' ORDER BY position) FROM provenance_periods WHERE artwork_id = ${W} AND position >= 10`))
    .toBe('publisher:true foundry:false trustee:false');
  expect(sql(`SELECT string_agg(relationship_type, ' ' ORDER BY relationship_type) FROM edges WHERE subject_id = ${W} AND subject_type = 'artwork'
    AND object_type = 'institution' AND relationship_type IN ('owned_by', 'held_by')`)).toBe('held_by held_by owned_by');

  // 8. Lugt, the collectors' marks, as an authority
  expect(sql("SELECT url_template FROM authorities WHERE code = 'lugt'")).toBe('https://www.marquesdecollections.fr/detail.cfm/marque/{id}');
});
