// Names in sources are "Surname, Given names" (migration 183): a name without a comma is a Quality warning — not an
// institution's or a Korean one — and the source form shows the short reference as typed ("Cited as Portal 2000:").
const { test, expect, sql } = require('./helpers');

const cleanup = () => sql("DELETE FROM bibliography WHERE slug IN ('test-names-wrong', 'test-names-right')");
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('a name without a comma is listed on the Quality page', async ({ userA }) => {
  sql(`INSERT INTO bibliography (slug, kind, name, authors, editors, year) VALUES
         ('test-names-wrong', 'book', 'Test Korea Book', '{"Jane Testportal"}', '{"Test Institute of Art"}', '2000'),
         ('test-names-right', 'book', 'Test Other Book', '{"Testportal, Jane","이청규"}', '{}', '2001');
       SELECT refresh_quality();`);
  await userA.goto('/quality?check=source_name_order');
  const main = userA.locator('main');
  await expect(main).toContainText('Name in a source without a comma');
  await expect(main).toContainText('Jane Testportal');
  await expect(main).not.toContainText('Test Institute of Art');
  await expect(main).not.toContainText('Test Other Book');

  sql(`UPDATE bibliography SET authors = '{"Testportal, Jane"}' WHERE slug = 'test-names-wrong'; SELECT refresh_quality();`);
  await userA.goto('/quality?check=source_name_order');
  await expect(main).not.toContainText('Jane Testportal');
});

test('the source form shows how it will be cited, and warns about a name without a comma', async ({ userA }) => {
  sql(`INSERT INTO bibliography (slug, kind, name, authors, year) VALUES ('test-names-wrong', 'book', 'Test Korea Book', '{"Jane Testportal"}', '2000')`);
  await userA.goto('/bibliography/test-names-wrong/edit');
  const cited = userA.locator('.cited-as');
  await expect(cited).toContainText('Cited as Jane Testportal 2000:');
  await expect(cited.locator('.flash.warn')).toContainText('“Jane Testportal” — no comma');

  await userA.fill('#f-authors', 'Testportal, Jane');
  await expect(cited).toContainText('Cited as Testportal 2000:');
  await expect(cited).toContainText('Jane Testportal, Test Korea Book');
  await expect(cited.locator('.flash.warn')).toHaveCount(0);
});
