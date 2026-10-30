// Ranges typed as people write them (099): "1900-1905", "c. 1900 – c. 1905", "from 1900" — in any date field.
const { test, expect, sql, API } = require('./helpers');

const api = async (request, path) => (await request.get(`${API}${path}`, { headers: { Host: 'api.localhost' } })).json();

test.afterAll(() => sql(`DELETE FROM relationships WHERE relationship_type = 'lived_in' AND subject_type = 'person'
  AND subject_id = entity_id('person', 'theo-van-gogh') AND object_id IN (entity_id('place', 'the-hague'), entity_id('place', 'london'))`));

test('a period typed with a hyphen, a dash or "from": stored as a range, shown with an en dash', async ({ userA, request }) => {
  const add = async (place, period) => {
    await userA.goto('/people/theo-van-gogh');
    await userA.click('summary:has-text("+ Add relationship")');
    await userA.selectOption('#r-type', 'lived_in');
    await userA.fill('#r-to', `place/${place}`);
    await userA.fill('#r-period', period);
    await Promise.all([userA.waitForNavigation(), userA.click('form[action$="/relationships"] button:has-text("Add")')]);
    await expect(userA).toHaveURL(/done=rel-added/);
  };
  await add('the-hague', '1872-1873');
  await add('london', 'c. 1873 – c. 1874');
  const theo = await api(request, '/people/theo-van-gogh');
  const at = (slug) => theo.relationships.find((r) => r.type === 'lived_in' && r.entity.slug === slug);
  expect(at('the-hague').period.label).toBe('1872–1873');
  expect(at('london').period.label).toBe('c. 1873–c. 1874');
  expect(sql(`SELECT period::text FROM relationships WHERE relationship_type = 'lived_in' AND object_id = entity_id('place', 'london') AND subject_id = entity_id('person', 'theo-van-gogh')`)).toBe('[1868-01-01,1880-01-01)');
});

test('years before 4713 BCE come from the label where the range has no bound (174)', () => {
  const j = (r, l) => JSON.parse(sql(`SELECT range_json(${r === null ? 'NULL' : `'${r}'`}::daterange, '${l}')`));
  expect(j('(,0394-01-01 BC)', 'c. 11,000–400 BCE')).toMatchObject({ from_year: -11000, to_year: -395 });
  expect(j(null, '100,000–40,000 BCE')).toMatchObject({ from_year: -100000, to_year: -40000 });
  expect(j(null, 'before c. 10,000 BCE')).toMatchObject({ from_year: null, to_year: -10000 });
  expect(j('[1990-01-01,2001-01-01)', '1990–2000')).toMatchObject({ from_year: 1990, to_year: 2000 });
  expect(j('[2019-05-01,)', 'since 1 May 2019')).toMatchObject({ from_year: 2019, to_year: null });
});
