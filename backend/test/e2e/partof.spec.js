// "part of" / "includes" (migration 097): a museum of a museum authority — the Pinakotheken and the Sammlung Schack
// are part of the Bayerische Staatsgemäldesammlungen.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM relationships WHERE relationship_type = 'part_of'; DELETE FROM institutions WHERE slug = 'test-staatsgemaeldesammlungen'`));

test('an institution part of another: both directions on the pages and in the API', async ({ userA, request }) => {
  sql("INSERT INTO institutions (slug, name, kind) VALUES ('test-staatsgemaeldesammlungen', 'Test Staatsgemäldesammlungen', 'museum administration')");
  await userA.goto('/institutions/van-gogh-museum');
  await userA.click('summary:has-text("+ Add relationship")');
  await expect(userA.locator('#r-type option[value="part_of"]')).toHaveCount(1);
  await userA.selectOption('#r-type', 'part_of');
  await userA.fill('#r-to', 'institution/test-staatsgemaeldesammlungen');
  await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
  await expect(userA).toHaveURL(/done=rel-added/);
  await expect(userA.locator('body')).toContainText('part of');
  await userA.goto('/institutions/test-staatsgemaeldesammlungen');
  await expect(userA.locator('body')).toContainText('includes');
  const museum = await api(request, '/institutions/van-gogh-museum');
  expect(museum.relationships.find((r) => r.type === 'part_of')).toMatchObject({ label: 'part of', direction: 'outgoing', entity: { slug: 'test-staatsgemaeldesammlungen' } });
  const roof = await api(request, '/institutions/test-staatsgemaeldesammlungen');
  expect(roof.relationships.find((r) => r.type === 'part_of')).toMatchObject({ label: 'includes', direction: 'incoming', entity: { slug: 'van-gogh-museum' } });
  // an artist cannot be "part of" an institution
  await userA.goto('/artists/vincent-van-gogh');
  await userA.click('summary:has-text("+ Add relationship")');
  await expect(userA.locator('#r-type option[value="part_of"]')).toHaveCount(0);
});

test('the authority owns it, its museum keeps it: the provenance is ongoing and not reported (098)', () => {
  sql(`INSERT INTO institutions (slug, name, kind) VALUES ('test-moma-authority', 'Test MoMA Authority', 'museum administration');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id)
         VALUES ('institution', entity_id('institution', 'museum-of-modern-art'), 'part_of', 'institution', entity_id('institution', 'test-moma-authority'));
       INSERT INTO provenance (artwork_id, position, owner_institution_id, acquired, acquired_label, method)
         VALUES (entity_id('artwork', 'the-starry-night'), 100, entity_id('institution', 'test-moma-authority'), daterange('1941-01-01', '1942-01-01'), '1941', 'purchase')`);
  const basis = () => sql(`SELECT end_basis FROM provenance_periods WHERE owner_institution_id = entity_id('institution', 'test-moma-authority')`);
  const warned = () => sql(`SELECT count(*) FROM quality_issues_live WHERE check_id = 'provenance_last_owner' AND entity_id = entity_id('artwork', 'the-starry-night')`);
  try {
    expect(basis()).toBe('ongoing');
    expect(warned()).toBe('0');
    // not part of it: the provenance ends elsewhere than where the work is
    sql("DELETE FROM relationships WHERE relationship_type = 'part_of' AND object_id = entity_id('institution', 'test-moma-authority')");
    expect(basis()).toBe('unknown');
    expect(warned()).toBe('1');
  } finally {
    sql(`DELETE FROM provenance WHERE owner_institution_id = entity_id('institution', 'test-moma-authority');
         DELETE FROM relationships WHERE object_id = entity_id('institution', 'test-moma-authority') AND relationship_type = 'part_of';
         DELETE FROM institutions WHERE slug = 'test-moma-authority'`);
  }
});
