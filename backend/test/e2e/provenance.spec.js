// Provenance (migration 031): steps entered on the artwork page; periods computed (end recorded / implied / ongoing);
// derived edges owned_by / kept_in / transferred_to in the graph, the map route, the owner's page and roles; checks.
const { test, expect, sql, settled, API, submitForm } = require('./helpers');

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
  sql(`DELETE FROM relationships WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'test-painter');
       DELETE FROM artworks WHERE slug = 'test-bassin'; DELETE FROM institutions WHERE slug = 'test-kunsthaus';
       DELETE FROM places WHERE slug IN ('test-sorel', 'test-zurich'); DELETE FROM people WHERE slug IN ('test-michel-monet', 'test-buhrle'); DELETE FROM artists WHERE slug = 'test-painter'`);
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
  // a step with no start ("until 1952") is the first stop of the route, not the last (Postgres range order)
  sql(`UPDATE provenance SET acquired = NULL, acquired_label = NULL WHERE owner_person_id = entity_id('person', 'test-michel-monet')`);
  const route = (await api(request, '/map/artworks/test-bassin')).features.find((f) => f.properties.layer === 'route');
  expect(route.geometry.coordinates.map(([x]) => x)).toEqual([1.36, 8.54]);
  // the provenance on the map, in the chain's order: a stop per placed step; the purchase isn't documented as direct
  const pr = (await api(request, '/map/artworks/test-bassin')).provenance;
  expect(pr.features.filter((f) => f.properties.layer === 'provenance_stop')
    .map((f) => [f.properties.step, f.properties.place.slug, f.properties.place_basis]))
    .toEqual([[1, 'test-sorel', 'recorded'], [2, 'test-zurich', 'recorded'], [3, 'test-zurich', 'recorded']]);
  expect(pr.features.filter((f) => f.properties.layer === 'provenance_segment')
    .map((f) => [f.properties.from_step, f.properties.to_step, f.properties.direct, f.properties.implied]))
    .toEqual([[1, 2, false, false]]);
  expect(pr.unplaced).toEqual([]);

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
  await settled();   // the finding comes from the derived-data worker (125)
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
  await Promise.all([userA.waitForEvent('load'), userA.mouse.up()]);   // saved, then the page reloads
  await expect.poll(order).toBe('Private collection, Berlin > Test Kunsthaus > Test Emil Bührle');
  await expect(rows.nth(1)).toContainText('Test Kunsthaus');
  // the keyboard: the handle focused, ↓ moves it back down
  await rows.nth(1).locator('.drag-handle').focus();
  await Promise.all([userA.waitForEvent('load'), userA.keyboard.press('ArrowDown')]);
  await expect.poll(order).toBe('Private collection, Berlin > Test Emil Bührle > Test Kunsthaus');
  await expect(rows.nth(2).locator('.drag-handle')).toBeFocused();           // focus kept after the reload
  // and once more by dragging, so the steps are as the rest of this test expects
  await rows.nth(2).locator('.drag-handle').scrollIntoViewIfNeeded();
  const h2 = await rows.nth(2).locator('.drag-handle').boundingBox();
  const t1 = await rows.nth(1).boundingBox();
  await userA.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await userA.mouse.down();
  await userA.mouse.move(h2.x + h2.width / 2, t1.y + t1.height / 2 - 4, { steps: 8 });
  await Promise.all([userA.waitForEvent('load'), userA.mouse.up()]);   // saved, then the page reloads
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

test('the provenance on the map: where it was made from where the artist lived, a step without a place passed over', async ({ request }) => {
  sql(`INSERT INTO artists (slug, name) VALUES ('test-painter', 'Test Painter');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period)
         VALUES ('artist', entity_id('artist', 'test-painter'), 'lived_in', 'place', entity_id('place', 'test-sorel'), '[1880-01-01,1890-01-01)');
       UPDATE artworks SET creator_id = entity_id('artist', 'test-painter'), created = '[1885-01-01,1886-01-01)', created_label = '1885'
         WHERE slug = 'test-bassin';
       INSERT INTO provenance (artwork_id, position, owner_person_id, method) VALUES (entity_id('artwork', 'test-bassin'), 1, entity_id('person', 'test-michel-monet'), 'purchase');
       INSERT INTO provenance (artwork_id, position, owner_person_id, method, acquired, acquired_label, location_id, direct)
         VALUES (entity_id('artwork', 'test-bassin'), 2, entity_id('person', 'test-buhrle'), 'purchase', '[1952-01-01,1953-01-01)', '1952', entity_id('place', 'test-zurich'), true)`);
  const pr = (await api(request, '/map/artworks/test-bassin')).provenance;
  const stops = pr.features.filter((f) => f.properties.layer === 'provenance_stop');
  expect(stops.map((f) => [f.properties.step, f.properties.kind, f.properties.place.slug, f.properties.place_basis]))
    .toEqual([[1, 'creation', 'test-sorel', 'artist_residence'], [3, 'step', 'test-zurich', 'recorded']]);
  const [seg] = pr.features.filter((f) => f.properties.layer === 'provenance_segment');
  expect([seg.properties.from_step, seg.properties.to_step, seg.properties.implied]).toEqual([1, 3, true]);
  expect(seg.properties.between.map((b) => b.holder.slug)).toEqual(['test-michel-monet']);
  expect(pr.unplaced.map((u) => [u.step, u.holder.slug])).toEqual([[2, 'test-michel-monet']]);

  // no dated place then: the artist's one undated place of work
  sql(`UPDATE relationships SET relationship_type = 'worked_in', period = NULL WHERE subject_type = 'artist' AND subject_id = entity_id('artist', 'test-painter')`);
  const workshop = (await api(request, '/map/artworks/test-bassin')).provenance;
  expect(workshop.features.find((f) => f.properties.kind === 'creation').properties.place_basis).toBe('artist_workplace');

  // a recorded place of creation (e.g. Wikidata P1071) wins over the derived one
  sql(`INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
         VALUES ('artwork', entity_id('artwork', 'test-bassin'), 'created_in', 'place', entity_id('place', 'test-zurich'))`);
  const again = (await api(request, '/map/artworks/test-bassin')).provenance;
  expect(again.features.find((f) => f.properties.kind === 'creation').properties.place_basis).toBe('created_in');
});

test('provenance flags and research 1933–1945: a flagged holder is a warning; links to Lost Art and others (068)', async ({ userA, request }) => {
  sql(`INSERT INTO provenance (artwork_id, position, owner_person_id, method, acquired, acquired_label) VALUES
         (entity_id('artwork', 'test-bassin'), 1, entity_id('person', 'test-michel-monet'), 'inheritance', '[1926-01-01,1927-01-01)', '1926'),
         (entity_id('artwork', 'test-bassin'), 2, entity_id('person', 'test-buhrle'), 'purchase', '[1937-01-01,1938-01-01)', '1937')`);
  await userA.goto('/people/test-buhrle/edit');
  await userA.click('summary:has-text("Provenance flag…")');
  await userA.fill('#f-provenance_flag', 'bought from dealers in occupied France — see Kunsthaus report 2024');
  await submitForm(userA);
  await expect(userA).toHaveURL(/done=published/);
  expect(sql(`SELECT detail FROM quality_issues_live WHERE check_id = 'flagged_holder' AND entity_id = entity_id('artwork', 'test-bassin')`))
    .toBe('Test Emil Bührle (from 1937): bought from dealers in occupied France — see Kunsthaus report 2024');
  expect((await api(request, '/people/test-buhrle')).provenance_flag).toBeUndefined();   // not public

  await userA.goto('/artworks/test-bassin');
  await expect(userA.locator('table.provenance .tag.flagged')).toHaveCount(1);
  const research = userA.locator('details.research');
  await expect(research).toHaveAttribute('open', '');   // open: a holder is flagged
  await expect(research.locator('li')).toHaveCount(2);  // Michel Monet (1926–1937, overlaps 1933) and Bührle
  await expect(research.locator('li', { hasText: 'Test Emil Bührle' }).locator('a:has-text("Lost Art")'))
    .toHaveAttribute('href', 'https://www.lostart.de/en/search?term=Test%20Emil%20B%C3%BChrle');
  sql("UPDATE people SET provenance_flag = NULL WHERE slug = 'test-buhrle'; DELETE FROM live_docs WHERE entity_type = 'person'");
});

test('a provenance date in the future is planned: marked, in the lists, a reminder after its day, "Went as planned" (095, 096)', async ({ userA, request }) => {
  const who = 'Test Sothebys New York';
  // an auction announced for a day to come: accepted, marked as planned
  await userA.goto('/artworks/test-bassin');
  await userA.click('summary:has-text("+ Add provenance step")');
  await userA.fill('#pv-owner-label', who);
  await userA.fill('#pv-ended', '18 November 2099');
  await Promise.all([userA.waitForNavigation(), userA.click('.provenance-form button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=prov-added#provenance/);
  await expect(userA.locator('table.provenance .tag.planned')).toHaveText('planned · check after 18 Nov 2099');
  expect(sql(`SELECT check_after::text FROM provenance WHERE owner_label = '${who}'`)).toBe('2099-11-18');
  // the lists still answer (095), and the API says it is planned
  const list = await request.get(`${API}/artworks?limit=5`, { headers: { Host: 'api.localhost' } });
  expect(list.status()).toBe(200);
  const one = await request.get(`${API}/artworks/test-bassin`, { headers: { Host: 'api.localhost' } });
  expect(one.status()).toBe(200);
  expect((await one.json()).provenance.find((s) => s.owner_label === who).planned_until).toBe('2099-11-18');
  await userA.goto('/');
  await expect(userA.locator('.planned-upcoming')).toContainText('(18 Nov 2099)');
  await expect(userA.locator('.planned-reminder')).toHaveCount(0);
  // the day has passed: the dashboard and the artwork ask whether it happened
  sql(`UPDATE provenance SET check_after = current_date - 1 WHERE owner_label = '${who}'`);
  await userA.goto('/artworks/test-bassin');
  await expect(userA.locator('table.provenance .planned-due')).toContainText('did it happen?');
  await userA.goto('/');
  const reminder = userA.locator('.planned-reminder');
  await expect(reminder).toContainText('Planned provenance — did it happen?');
  await Promise.all([userA.waitForNavigation(), reminder.locator('button:has-text("Went as planned")').click()]);
  await expect(userA).toHaveURL(/\/\?done=prov-confirmed/);
  await expect(userA.locator('.planned-reminder')).toHaveCount(0);
  expect(sql(`SELECT check_after IS NULL FROM provenance WHERE owner_label = '${who}'`)).toBe('t');
  sql(`DELETE FROM provenance WHERE owner_label = '${who}'`);
});
