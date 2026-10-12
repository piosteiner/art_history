// Enrich with Metagrid (numbers found by name), then SIKART, RKD, the Library of Congress and the BnF side by side
// (src/admin/metagrid.js, records.js, rkd.js, lc.js, bnf.js): dates grouped where the sources agree, cited by each;
// one "born in Bern" cited by every source that names it (RKD finds our Bern by its Wikidata item).
const { test, expect, sql, submitForm } = require('./helpers');

const me = "('artist', entity_id('artist', 'ferdinand-hodler-mg'))";
const cleanup = () => sql(`DELETE FROM artists WHERE slug = 'ferdinand-hodler-mg'; DELETE FROM places WHERE slug IN ('bern-mg', 'geneva');
  DELETE FROM entry_identifiers WHERE value IN ('4000055', 'n50031263', '019084', 'P13383', '38688', '119454480', '41848532', '500027184', '027405397');
  DELETE FROM live_docs WHERE entity_type = 'artist';
  DELETE FROM bibliography WHERE slug IN ('sikart', 'lc', 'bnf', 'rkd') AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.source_id = bibliography.id)`);
test.afterAll(cleanup);

test('Metagrid: the person picked by its dates, its numbers become reference records', async ({ userA }) => {
  cleanup();
  sql(`INSERT INTO places (slug, name, kind, location, wikidata_id) VALUES ('bern-mg', 'Bern', 'settlement', 'POINT(7.45 46.95)', 'Q70');
       INSERT INTO artists (slug, name, birth, birth_label) VALUES ('ferdinand-hodler-mg', 'Ferdinand Hodler', '[1853-03-14,1853-03-15)', '14 March 1853')`);
  await userA.goto('/artists/ferdinand-hodler-mg/enrich');
  const ferdinand = userA.locator('.mg-candidate', { hasText: 'Ferdinand Hodler' });
  await expect(ferdinand.locator('input[name="mg:pick"]')).toBeChecked();            // the same year of birth
  await expect(userA.locator('.mg-candidate', { hasText: 'Hector Hodler' }).locator('input[name="mg:pick"]')).not.toBeChecked();
  await expect(ferdinand.locator('input[name="mg:mgFerdinand:hls"]')).toBeChecked();
  await expect(ferdinand).toContainText('Burgerbibliothek Bern');                   // a database we keep no number of: a link
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA.locator('.flash.ok')).toContainText('4 reference records added');
  expect(sql(`SELECT string_agg(authority || ' ' || value, ', ' ORDER BY authority) FROM entry_identifiers WHERE (entity_type, entity_id) = ${me}`))
    .toBe('dodis P13383, hls 019084, lc n50031263, sikart 4000055');
});

test('then SIKART, RKD, LC and BnF in one review: agreeing dates cited by each, one relationship cited by several', async ({ userA }) => {
  sql(`INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'ferdinand-hodler-mg'), 'rkd', '38688'),
       ('artist', entity_id('artist', 'ferdinand-hodler-mg'), 'bnf', '119454480')`);
  await userA.goto('/artists/ferdinand-hodler-mg/enrich');
  await expect(userA.locator('.enrich-sources')).toContainText('RKD');
  await expect(userA.locator('.enrich-sources')).toContainText('BnF');
  // Metagrid now finds him by our numbers
  await expect(userA.locator('.enrich-form')).toContainText('contains one of our numbers');
  // birth: the same as ours in all four — each cited
  const birth = userA.locator('tr[data-merged="birth"]');
  await expect(birth).toContainText('the same as yours in SIKART, RKD, LC, BnF');
  // death: 19 May 1918 (SIKART, LC) or 1918 (BnF) — the sources differ; the value most give is picked
  const death = userA.locator('tr[data-merged="death"]');
  await expect(death).toContainText('the sources differ');
  await expect(death.locator('label:has(input:checked)')).toContainText('SIKART, LC');
  // born in Bern: RKD (by Wikidata item), SIKART and LC (by name) — all ticked
  for (const code of ['sikart', 'rkd', 'lc']) await expect(userA.locator(`input[name^="${code}:rel."]`).first()).toBeChecked();
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA).toHaveURL(/\/artists\/ferdinand-hodler-mg\/edit\?done=enrich/);
  await expect(userA.locator('#f-death')).toHaveValue('1918-05-19');
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/artists\/ferdinand-hodler-mg\?done=published/);

  const citedBy = (field) => sql(`SELECT string_agg(b.slug, ', ' ORDER BY b.slug) FROM citations c JOIN bibliography b ON b.id = c.source_id
    WHERE (c.entity_type, c.entity_id) = ${me} AND c.field = '${field}' AND c.pending IS NULL`);
  expect(citedBy('birth')).toBe('bnf, lc, rkd, sikart');
  expect(citedBy('death')).toBe('lc, sikart');
  expect(sql(`SELECT count(*) FROM relationships WHERE (subject_type, subject_id) = ${me} AND relationship_type = 'born_in'`)).toBe('1');
  expect(sql(`SELECT string_agg(b.slug, ', ' ORDER BY b.slug) FROM relationships r JOIN citations c ON c.relationship_id = r.id
    JOIN bibliography b ON b.id = c.source_id WHERE (r.subject_type, r.subject_id) = ${me} AND r.relationship_type = 'born_in'`)).toBe('lc, rkd, sikart');
  // the numbers the records know: VIAF, ULAN (RKD), IdRef (BnF)
  expect(sql(`SELECT string_agg(authority, ', ' ORDER BY authority) FROM entry_identifiers WHERE (entity_type, entity_id) = ${me}
    AND authority IN ('viaf', 'ulan', 'idref')`)).toBe('idref, ulan, viaf');
});
