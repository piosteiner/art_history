// Provenance (migration 031): steps entered on the artwork page; periods computed (end recorded / implied / ongoing);
// derived edges owned_by / kept_in / transferred_to in the graph, the map route, the owner's page and roles; checks.
const { test, expect, sql } = require('./helpers');

const API = 'http://127.0.0.1:3006/v1';
const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

async function addStep(page, { owner, method, acquired, place, direct }) {
  await page.click('summary:has-text("+ Add provenance step")');
  await page.fill('#pv-owner', owner.name);
  await page.locator('.ac-list li', { hasText: owner.name }).first().click();
  await expect(page.locator('#pv-owner')).toHaveValue(owner.ref);
  await page.fill('#pv-acquired', acquired);
  await page.selectOption('#pv-method', method);
  if (place) {
    await page.fill('#pv-location', place);
    await page.locator('.ac-list li', { hasText: place }).first().click();
  }
  if (direct) await page.check('input[name="direct"]');
  await Promise.all([page.waitForNavigation(), page.click('.provenance-form button:has-text("Add")')]);
  await expect(page).toHaveURL(/done=prov-added#provenance/);
}

test.beforeEach(() => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-michel-monet', 'Test Michel Monet'), ('test-buhrle', 'Test Emil Bührle');
       INSERT INTO places (slug, name, kind, location) VALUES ('test-sorel', 'Test Sorel-Moussel', 'settlement', 'POINT(1.36 48.83)'),
                                                            ('test-zurich', 'Test Zürich', 'settlement', 'POINT(8.54 47.37)');
       INSERT INTO institutions (slug, name, place_id) VALUES ('test-kunsthaus', 'Test Kunsthaus', entity_id('place', 'test-zurich'));
       INSERT INTO artworks (slug, title, current_institution_id) VALUES ('test-bassin', 'Test Bassin aux nymphéas', entity_id('institution', 'test-kunsthaus'))`);
});
test.afterEach(() => {
  sql(`DELETE FROM artworks WHERE slug = 'test-bassin'; DELETE FROM institutions WHERE slug = 'test-kunsthaus';
       DELETE FROM places WHERE slug IN ('test-sorel', 'test-zurich'); DELETE FROM people WHERE slug IN ('test-michel-monet', 'test-buhrle')`);
});

test('a provenance chain: computed periods, derived edges in graph, map, owner page and roles', async ({ userA, request }) => {
  await userA.goto('/artworks/test-bassin');
  await expect(userA.locator('#r-type option[value="owned_by"]')).toHaveCount(0);  // ownership is entered as provenance now
  await addStep(userA, { owner: { name: 'Test Michel Monet', ref: 'person/test-michel-monet' }, method: 'inheritance', acquired: '1926', place: 'Test Sorel-Moussel' });
  await addStep(userA, { owner: { name: 'Test Emil Bührle', ref: 'person/test-buhrle' }, method: 'purchase', acquired: '1952', place: 'Test Zürich' });  // handover not documented
  await addStep(userA, { owner: { name: 'Test Kunsthaus', ref: 'institution/test-kunsthaus' }, method: 'gift', acquired: '1952', place: 'Test Zürich', direct: true });

  const rows = userA.locator('table.provenance tr:not(.transfer)');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('1926–1952');
  await expect(rows.nth(0)).toContainText('end implied by the next acquisition');
  await expect(rows.nth(1)).toContainText('purchase, 1952');
  await expect(rows.nth(2)).toContainText('since 1952');
  await expect(rows.nth(2)).toContainText('ongoing');
  await expect(userA.locator('table.provenance tr.transfer').nth(0)).toContainText('not documented as direct');
  await expect(userA.locator('table.provenance tr.transfer').nth(1)).toContainText('passed on directly');

  // a recorded end replaces the implied one
  await rows.nth(0).locator('a:has-text("edit")').click();
  await userA.fill('#pv-ended', '1952');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Save")')]);
  await expect(userA.locator('table.provenance tr:not(.transfer)').nth(0)).not.toContainText('implied');

  const w = await api(request, '/artworks/test-bassin');
  expect(w.provenance.map((p) => [p.owner && p.owner.slug, p.method, p.period.label, p.end_basis])).toEqual([
    ['test-michel-monet', 'inheritance', '1926–1952', 'recorded'],
    ['test-buhrle', 'purchase', '1952', 'implied'],
    ['test-kunsthaus', 'gift', 'since 1952', 'ongoing'],
  ]);
  expect(w.relationships.filter((r) => r.type === 'owned_by').map((r) => [r.entity.slug, r.derived, r.end_basis]))
    .toEqual(expect.arrayContaining([['test-buhrle', true, 'implied']]));

  // graph: owners and the transfers between them
  const g = await api(request, '/graph/people/test-buhrle?depth=1');
  const types = g.edges.map((e) => `${e.type}:${e.source}>${e.target}`).sort();
  expect(types).toEqual(expect.arrayContaining([
    'owned_by:artwork/test-bassin>person/test-buhrle',
    'transferred_to:person/test-michel-monet>person/test-buhrle',
    'transferred_to:person/test-buhrle>institution/test-kunsthaus',
  ]));
  const transfer = g.edges.find((e) => e.type === 'transferred_to' && e.source === 'person/test-michel-monet');
  expect(transfer.certainty).toBe('possible');  // not documented as direct

  // map: the artwork's route Sorel-Moussel → Zürich from the provenance places
  const m = await api(request, '/map/artworks/test-bassin');
  expect(m.features.filter((f) => f.properties.relationship === 'kept_in').map((f) => f.properties.place.slug))
    .toEqual(['test-sorel', 'test-zurich', 'test-zurich']);
  expect(m.features.some((f) => f.properties.layer === 'route')).toBe(true);

  // the owner: role from the provenance, "owner of" on the admin page linking to the step
  expect((await api(request, '/people/test-buhrle')).roles).toEqual(['owner']);
  await userA.goto('/people/test-buhrle');
  const ownerRow = userA.locator('tr', { hasText: 'owner of' });
  await expect(ownerRow).toContainText('Test Bassin aux nymphéas');
  await expect(ownerRow.locator('a:has-text("provenance")')).toHaveAttribute('href', /\/provenance\/\d+\/edit/);
  await expect(userA.locator('tr', { hasText: 'passed to' })).toContainText('Test Kunsthaus');

  // history of the artwork lists the steps
  await userA.goto('/artworks/test-bassin/history');
  await expect(userA.locator('main')).toContainText('provenance of Test Bassin aux nymphéas — Test Emil Bührle');
});

test('reorder and remove steps; an undocumented change of owner across 1933–1945 is reported', async ({ userA, request }) => {
  sql(`INSERT INTO provenance (artwork_id, position, owner_label, acquired, acquired_label, method) VALUES
         (entity_id('artwork', 'test-bassin'), 0, 'Private collection, Berlin', year_range(1930), '1930', 'purchase');
       INSERT INTO provenance (artwork_id, position, owner_person_id, acquired, acquired_label, method) VALUES
         (entity_id('artwork', 'test-bassin'), 1, entity_id('person', 'test-buhrle'), year_range(1948), '1948', 'purchase');
       INSERT INTO provenance (artwork_id, position, owner_institution_id, acquired, acquired_label, method, direct) VALUES
         (entity_id('artwork', 'test-bassin'), 2, entity_id('institution', 'test-kunsthaus'), year_range(1960), '1960', 'gift', true)`);
  await userA.goto('/quality?check=provenance_gap_1933_1945');
  await expect(userA.locator('main')).toContainText('Test Emil Bührle: the change of owner (1948) is not documented as direct');

  await userA.goto('/artworks/test-bassin');
  const rows = userA.locator('table.provenance tr:not(.transfer)');
  const order = () => sql(`SELECT string_agg(coalesce(owner_label, (SELECT name FROM entity_index e WHERE (e.type, e.id) IN
      (('person', owner_person_id), ('institution', owner_institution_id)))), ' > ' ORDER BY position) FROM provenance WHERE artwork_id = entity_id('artwork', 'test-bassin')`);
  // drag the third step's handle up, onto the second step (pointer events, as with a mouse or a finger)
  const handle = rows.nth(2).locator('.drag-handle');
  await handle.scrollIntoViewIfNeeded();   // the pointer works on what is on screen
  const box = await handle.boundingBox();
  const target = await rows.nth(1).boundingBox();
  await userA.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await userA.mouse.down();
  await userA.mouse.move(box.x + box.width / 2, target.y + target.height / 2 - 4, { steps: 8 });  // onto the upper half of step 2
  await userA.mouse.up();
  await expect.poll(order).toBe('Private collection, Berlin > Test Kunsthaus > Test Emil Bührle');
  await expect(rows.nth(1)).toContainText('Test Kunsthaus');
  // the keyboard: the handle focused, ↓ moves it back down
  await rows.nth(1).locator('.drag-handle').focus();
  await userA.keyboard.press('ArrowDown');
  await expect.poll(order).toBe('Private collection, Berlin > Test Emil Bührle > Test Kunsthaus');
  await userA.waitForLoadState('load');
  await expect(rows.nth(2).locator('.drag-handle')).toBeFocused();           // focus kept after the reload
  // and once more by dragging, so the steps are as the rest of this test expects
  await rows.nth(2).locator('.drag-handle').scrollIntoViewIfNeeded();
  const h2 = await rows.nth(2).locator('.drag-handle').boundingBox();
  const t1 = await rows.nth(1).boundingBox();
  await userA.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await userA.mouse.down();
  await userA.mouse.move(h2.x + h2.width / 2, t1.y + t1.height / 2 - 4, { steps: 8 });
  await userA.mouse.up();
  await expect.poll(order).toBe('Private collection, Berlin > Test Kunsthaus > Test Emil Bührle');
  await userA.goto('/quality?check=provenance_last_owner');
  await expect(userA.locator('main')).toContainText('the provenance ends with Test Emil Bührle, but the work is at Test Kunsthaus');

  await userA.goto('/artworks/test-bassin');
  await rows.nth(0).locator('a:has-text("edit")').click();
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Remove this step")')]);
  await expect(userA).toHaveURL(/done=prov-deleted/);
  const w = await api(request, '/artworks/test-bassin');
  expect(w.provenance.map((p) => [p.position, p.owner_name])).toEqual([[0, 'Test Kunsthaus'], [1, 'Test Emil Bührle']]);

  // a person still named in a provenance can't be deleted
  await userA.goto('/people/test-buhrle/delete');
  await Promise.all([userA.waitForNavigation(), userA.click('form button.danger')]);
  await expect(userA.locator('.flash.error')).toContainText('Still named in the provenance of an artwork');
});
