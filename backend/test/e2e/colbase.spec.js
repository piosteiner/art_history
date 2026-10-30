// ColBase (Japan's national museums, through Japan Search) on the Enrich page of an artwork with a Japanese title
// (src/admin/colbase.js, roadmap 2026-10-28): the record that is this work gives its page, its heritage designation
// (a relationship to the glossary term, migration 166, cited with the record) and its image — only what ours lacks.
const { test, expect, sql, submitForm } = require('./helpers');

const SLUG = 'test-colbase-screens';
test.afterAll(() => sql(`DELETE FROM artworks WHERE slug = '${SLUG}'; DELETE FROM live_docs WHERE entity_type = 'artwork'`));

test('ColBase: the work’s record gives its page, its designation and its image', async ({ userA }) => {
  // the designation's term (migration 166; the test data is loaded from the fixtures, without it)
  sql(`INSERT INTO glossary (slug, name, category) VALUES ('important-cultural-property-japan', 'Important Cultural Property (Japan)', 'heritage designation'),
       ('national-treasure-japan', 'National Treasure (Japan)', 'heritage designation') ON CONFLICT (slug) DO NOTHING`);
  sql(`INSERT INTO artworks (slug, title, names) VALUES ('${SLUG}', 'Wind God and Thunder God (test)',
       '[{"text": "風神雷神図屏風", "lang": "ja", "role": "original"}]')`);
  await userA.goto(`/artworks/${SLUG}/enrich`);
  const rows = userA.locator('.colbase-records tbody tr');
  await expect(rows).toHaveCount(1);   // the photograph of it (Tobunken) is not the work
  await expect(rows.first()).toContainText('Important Cultural Property (重要文化財)');
  await expect(rows.first()).toContainText('Tokyo National Museum, A-11189-1');
  await expect(userA.locator('input[name="cb:pick"]')).toBeChecked();   // the one with exactly our title
  // Cultural Heritage Online: the Agency's title around ours, the dates of the designations
  const agency = userA.locator('.bunka-records tbody tr');
  await expect(agency).toHaveCount(1);
  await expect(agency).toContainText('Important Cultural Property since 1920-04-15, National Treasure since 1993-06-10');
  await userA.check('input[name="bk:pick"]');
  await Promise.all([userA.waitForNavigation(), userA.click('.enrich-form .sticky-actions button')]);
  await expect(userA).toHaveURL(new RegExp(`/artworks/${SLUG}/edit\\?done=enrich`));
  await expect(userA.locator('#f-web_url')).toHaveValue('https://colbase.example/cobas-1');
  await submitForm(userA);
  expect(sql(`SELECT web_url FROM artworks WHERE slug = '${SLUG}'`)).toBe('https://colbase.example/cobas-1');
  // one relationship per designation, dated by the Agency, cited with each source that gave it
  expect(sql(`SELECT string_agg(g.slug || ' ' || coalesce(r.period_label, '-') || ' ' || (SELECT string_agg(b.slug, '+' ORDER BY b.slug) FROM citations c
      JOIN bibliography b ON b.id = c.source_id WHERE c.relationship_id = r.id), ' | ' ORDER BY g.slug)
    FROM relationships r JOIN glossary g ON g.id = r.object_id WHERE r.relationship_type = 'designated_as' AND r.subject_id = entity_id('artwork', '${SLUG}')`))
    .toBe('important-cultural-property-japan since 15 April 1920 bunka-online+colbase | national-treasure-japan since 10 June 1993 bunka-online');
  expect(sql(`SELECT license || ' | ' || credit FROM images WHERE artwork_id = entity_id('artwork', '${SLUG}')`)).toBe('CC BY 4.0 | Tokyo National Museum, ColBase');
});
