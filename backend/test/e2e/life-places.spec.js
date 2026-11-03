// Places of birth and death entered next to the dates (owner 2026-11-03): fields of kind life:… (content.js) whose one
// record is the relationship born_in / died_in — the form shows it, Publish writes it (saveLifePlaces in
// routes/entries.js); another place replaces it, an empty field leaves it; the YAML keeps it among the relationships.
const { test, expect, sql, liveReady, submitForm } = require('./helpers');

const places = (slug) => sql(`SELECT coalesce(string_agg(r.relationship_type || ' ' || p.slug, ', ' ORDER BY r.relationship_type, p.slug), '')
  FROM relationships r JOIN places p ON p.id = r.object_id
  WHERE r.subject_type = 'person' AND r.subject_id = entity_id('person', '${slug}') AND r.relationship_type IN ('born_in', 'died_in')`);
test.beforeAll(() => sql("DELETE FROM people WHERE slug = 'test-life-places'"));
test.afterAll(() => sql("DELETE FROM people WHERE slug = 'test-life-places'; DELETE FROM live_docs WHERE entity_type = 'person'"));

test('a place next to the birth and death dates becomes the relationship; replaced by another; an empty field leaves it', async ({ userA }) => {
  sql("INSERT INTO people (slug, name) VALUES ('test-life-places', 'Test Life Places')");
  await userA.goto('/people/test-life-places/edit');
  await liveReady(userA);
  await expect(userA.locator('label[for=f-birth_place]')).toHaveText('Place of birth');
  await userA.fill('#f-birth', '19. Februar 1902');               // German dates are taken too
  await userA.fill('#f-birth_place', 'paris');
  await userA.fill('#f-death', '5. Juli 1996');
  await userA.fill('#f-death_place', 'London');                    // a name instead of the slug: found
  await submitForm(userA);
  await expect(userA).toHaveURL(/\/people\/test-life-places\?done=/);
  expect(places('test-life-places')).toBe('born_in paris, died_in london');
  expect(sql("SELECT birth_label || ' – ' || death_label FROM people WHERE slug = 'test-life-places'")).toBe('19 February 1902 – 5 July 1996');
  // on the entry page: beside the dates, and in the relationships
  await expect(userA.locator('dt:has-text("Place of birth") + dd a')).toHaveAttribute('href', '/places/paris');
  await expect(userA.locator('#relationships + .table-wrap')).toContainText('London');

  // the form shows the relationship's place; another one replaces it (not a second birthplace)
  await userA.goto('/people/test-life-places/edit');
  await liveReady(userA);
  await expect(userA.locator('#f-birth_place')).toHaveValue('paris');
  await userA.fill('#f-birth_place', 'amsterdam');
  await userA.fill('#f-death_place', '');                          // empty: the place of death stays
  await submitForm(userA);
  expect(places('test-life-places')).toBe('born_in amsterdam, died_in london');

  // a place that doesn't exist: said, nothing changed
  await userA.goto('/people/test-life-places/edit');
  await liveReady(userA);
  await userA.fill('#f-birth_place', 'no-such-place-anywhere');
  await submitForm(userA);
  await expect(userA.locator('.flash.error, .errors')).toContainText(/no-such-place-anywhere|no place/i);
  expect(places('test-life-places')).toBe('born_in amsterdam, died_in london');
});
