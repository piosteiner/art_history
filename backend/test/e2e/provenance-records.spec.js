// Provenance records (migration 104, src/admin/provenance-records.js): the evidence under a step — inventory entries
// with date, place, room, number and the source's doubts; on the step's edit page, under the step on the artwork's
// page, in the number search, the API, the map's stops, the full-text search, the YAML snapshot and a quality check.
const { execFileSync } = require('child_process');
const path = require('path');
const { test, expect, sql, API } = require('./helpers');
const env = require('./env');

const api = async (request, p) => (await request.get(`${API}${p}`, { headers: { Host: 'api.localhost' } })).json();
const W = "entity_id('artwork', 'test-records-w')";

const cleanup = () => sql(`DELETE FROM artworks WHERE slug = 'test-records-w'; DELETE FROM institutions WHERE slug = 'test-records-crown';
  DELETE FROM places WHERE slug IN ('test-records-alcazar', 'test-records-palace')`);
test.beforeEach(() => {
  cleanup();
  sql(`INSERT INTO institutions (slug, name) VALUES ('test-records-crown', 'Test Royal Collection');
       INSERT INTO places (slug, name, kind, location) VALUES ('test-records-alcazar', 'Test Alcázar', 'site', 'POINT(-3.714 40.418)'),
         ('test-records-palace', 'Test Palace', 'site', 'POINT(-3.512 40.425)');
       INSERT INTO artworks (slug, title, creator_id, created, created_label) VALUES ('test-records-w', 'Test Royal Picture', entity_id('artist', 'paul-gauguin'), year_range(1650), '1650');
       INSERT INTO provenance (artwork_id, position, owner_institution_id, acquired, acquired_label, ended, ended_label, location_id)
         VALUES (${W}, 0, entity_id('institution', 'test-records-crown'), year_range(1650), '1650', year_range(1819), '1819', entity_id('place', 'test-records-alcazar'))`);
});
test.afterEach(cleanup);

const STEP = () => sql(`SELECT id FROM provenance WHERE artwork_id = ${W} ORDER BY position LIMIT 1`);
async function addRecord(page, fill) {
  await page.goto(`/provenance/${STEP()}/edit`);
  await page.click('#records summary:has-text("+ Add a record")');
  await fill(page.locator('#records form'));
  await Promise.all([page.waitForNavigation(), page.locator('#records form button:has-text("Add")').click()]);
}

test('records: added, edited and removed on the step; under the step, in the number search, the API, the map and the search', async ({ userA, request }) => {
  await addRecord(userA, async (f) => {
    await f.locator('input[name=date]').fill('1700');
    await f.locator('input[name=place]').fill('test-records-alcazar');
    await userA.keyboard.press('Escape');
    await f.locator('input[name=room]').fill('Testsummeroffice');
    await f.locator('input[name=document]').fill('inventory of the Test Alcázar');
    await f.locator('input[name=number]').fill('286');
  });
  await expect(userA).toHaveURL(/done=record-added#records/);
  await expect(userA.locator('#records ol li').first()).toContainText('1700 · inventory of the Test Alcázar');
  // the source doubts the number: "¿nº 411?"
  await addRecord(userA, async (f) => {
    await f.locator('input[name=date]').fill('1747');
    await f.locator('input[name=place]').fill('test-records-palace');
    await userA.keyboard.press('Escape');
    await f.locator('input[name=number]').fill('411');
    await f.locator('select[name=number_certainty]').selectOption('possible');
  });
  await expect(userA.locator('#records ol li')).toHaveCount(2);
  await expect(userA.locator('#records ol li').nth(1)).toContainText('no. 411 (possible)');
  // a record needs something
  await addRecord(userA, async () => {});
  await expect(userA.locator('.flash.error')).toContainText('A record needs something');
  // edited
  await userA.goto(`/provenance/${STEP()}/edit`);
  await Promise.all([userA.waitForNavigation(), userA.locator('#records ol li').first().locator('a:has-text("edit")').click()]);
  await userA.fill('input[name=room]', 'Testsummeroffice, ground floor');
  await Promise.all([userA.waitForNavigation(), userA.click('button:has-text("Save")')]);
  await expect(userA).toHaveURL(/done=record-saved#records/);
  await expect(userA.locator('#records ol li').first()).toContainText('ground floor');

  // under the step on the artwork's page; the number search finds both numbers, with the doubt
  await userA.goto('/artworks/test-records-w');
  await expect(userA.locator('table.provenance .records li')).toHaveCount(2);
  await userA.goto('/provenance/numbers?q=411');
  await expect(userA.locator('main table')).toContainText('Test Royal Picture');
  await expect(userA.locator('main table')).toContainText('(possible)');

  // the API: the records under the step, by date; the number lookup
  const w = await api(request, '/artworks/test-records-w');
  const step = w.provenance.find((s) => s.kind === 'step');
  expect(step.records.map((r) => [r.date.label, r.place && r.place.slug, r.number, r.number_certainty])).toEqual([
    ['1700', 'test-records-alcazar', '286', 'attested'], ['1747', 'test-records-palace', '411', 'possible']]);
  expect((await api(request, '/provenance-numbers?number=286')).data.map((x) => [x.artwork.slug, x.recorded])).toEqual([['test-records-w', '1700']]);
  // the map: the palace is a stop of the step (the Alcázar is its place already)
  const map = await api(request, '/map/artworks/test-records-w');
  expect(map.provenance.features.filter((f) => f.properties.layer === 'provenance_stop').map((f) => f.properties.part_label)).toContain('1747');
  // the full-text search finds a room
  const hits = await api(request, '/search/text?q=Testsummeroffice');
  expect(hits.data.find((h) => h.slug === 'test-records-w')).toMatchObject({ matched_in: 'provenance' });

  // the YAML snapshot keeps them (content.readProvenance, used by npm run export)
  const out = execFileSync('node', ['-e', `require('./src/content').readProvenance(require('./src/db').adminPool, ${sql(`SELECT ${W}`)})
    .then((s) => { console.log(JSON.stringify(s[0].records)); process.exit(0); })`],
  { cwd: path.join(__dirname, '../..'), env: { ...env.serverEnv(), DB_NAME: env.DB } }).toString();
  expect(JSON.parse(out)).toEqual([
    { date: '1700', place: 'test-records-alcazar', room: 'Testsummeroffice, ground floor', number: '286', document: 'inventory of the Test Alcázar' },
    { date: '1747', place: 'test-records-palace', number: '411', number_certainty: 'possible' }]);

  // a record outside its holder's period is a finding
  sql(`INSERT INTO provenance_records (provenance_id, position, date, date_label, note) VALUES (${STEP()}, 9, year_range(1600), '1600', 'test')`);
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_record_outside' AND entity_id = ${W}`)).toBe('1');

  // removed
  await userA.goto(`/provenance/${STEP()}/edit`);
  await Promise.all([userA.waitForNavigation(), userA.locator('#records ol li').first().locator('button:has-text("remove")').click()]);
  await expect(userA).toHaveURL(/done=record-deleted#records/);
  await expect(userA.locator('#records ol li')).toHaveCount(2);
});

test('an end known only as "or later" (105): the holder\'s period runs to its earliest day — its records inside', () => {
  // the royal collection from 1650 with no end of its own; the museum from "1819 or later"
  sql(`UPDATE provenance SET ended = NULL, ended_label = NULL WHERE artwork_id = ${W};
       INSERT INTO provenance (artwork_id, position, owner_label, acquired, acquired_label, method)
         VALUES (${W}, 1, 'Test Museum', '[1819-01-01,)'::daterange, '1819 or later', 'transfer');
       INSERT INTO provenance_records (provenance_id, position, date, date_label, note) VALUES (${STEP()}, 0, year_range(1747), '1747', 'test')`);
  expect(sql(`SELECT period::text || ' ' || end_basis FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('[1650-01-01,1819-01-02) implied');
  expect(sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_record_outside' AND entity_id = ${W}`)).toBe('0');
  // an end of its own "or later" likewise
  sql(`UPDATE provenance SET ended = '[1749-06-08,)'::daterange, ended_label = '8 June 1749 or later' WHERE artwork_id = ${W} AND position = 0`);
  expect(sql(`SELECT period::text FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('[1650-01-01,1749-06-09)');
});

test('a holder whose end is unknown (176): a later record shows the holding lasted — unless the holder had died', () => {
  // a collector from 1650, then the royal collection at an unknown date: the collector's end is unknown
  sql(`DELETE FROM people WHERE slug = 'test-records-collector';
       INSERT INTO people (slug, name, death, death_label) VALUES ('test-records-collector', 'Test Collector', year_range(1700), '1700');
       UPDATE provenance SET owner_institution_id = NULL, owner_person_id = entity_id('person', 'test-records-collector'),
         ended = NULL, ended_label = NULL WHERE artwork_id = ${W};
       INSERT INTO provenance (artwork_id, position, owner_institution_id, method) VALUES (${W}, 1, entity_id('institution', 'test-records-crown'), 'unknown');
       INSERT INTO provenance_records (provenance_id, position, date, date_label, note) VALUES (${STEP()}, 0, year_range(1690), '1690', 'test')`);
  const findings = () => sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_record_outside' AND entity_id = ${W}`);
  try {
    expect(sql(`SELECT end_basis FROM provenance_periods WHERE artwork_id = ${W} AND position = 0`)).toBe('unknown');
    expect(findings()).toBe('0');
    // after the collector's death: not theirs
    sql(`UPDATE provenance_records SET date = year_range(1710), date_label = '1710' WHERE provenance_id = ${STEP()}`);
    expect(findings()).toBe('1');
    // before the acquisition: not theirs either
    sql(`UPDATE provenance_records SET date = year_range(1600), date_label = '1600' WHERE provenance_id = ${STEP()}`);
    expect(findings()).toBe('1');
  } finally {
    sql(`DELETE FROM artworks WHERE slug = 'test-records-w'; DELETE FROM people WHERE slug = 'test-records-collector'`);
  }
});

test('several artworks\' provenance at once (/v1/map/provenances): the same as each artwork\'s map', async ({ request }) => {
  const one = await api(request, '/map/artworks/test-records-w');
  const many = await api(request, '/map/provenances?artworks=test-records-w,the-starry-night,no-such-work');
  expect(Object.keys(many.data).sort()).toEqual(['test-records-w', 'the-starry-night']);
  expect(many.data['test-records-w']).toEqual(one.provenance);
  expect((await request.get(`${API}/map/provenances?artworks=Bad%20Slug`, { headers: { Host: 'api.localhost' } })).status()).toBe(400);
});
