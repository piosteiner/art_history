// Control over the comparisons' suggestions (authority.js relsTable, gnd.apply; wikidata-ui suggestionRow):
// a person we don't have → created ("to complete", with its GND number); a place not found → linked to one of ours
// by hand; relationships we have → cited by the source on request.
const { test, expect, sql } = require('./helpers');

const me = "('artist', entity_id('artist', 'claude-monet-ctl'))";
const cleanup = () => sql(`DELETE FROM artists WHERE slug = 'claude-monet-ctl'; DELETE FROM people WHERE slug = 'charles-gleyre';
  DELETE FROM entry_identifiers WHERE value IN ('118583123', '118695967', '118583174', '500018666'); DELETE FROM live_docs WHERE entity_type = 'artist';
  DELETE FROM wikidata_reviews WHERE entity_type = 'artist'; DELETE FROM citations WHERE source_id = entity_id('source', 'gnd'); DELETE FROM bibliography WHERE slug = 'gnd'`);
test.afterAll(cleanup);

test('GND: cite a relationship we have, link a place by hand, create a person we lack', async ({ userA }) => {
  cleanup();
  sql(`INSERT INTO artists (slug, name, birth, birth_label) VALUES ('claude-monet-ctl', 'Claude Monet', '[1840-11-14,1840-11-15)', '14 November 1840');
       INSERT INTO entry_identifiers (entity_type, entity_id, authority, value) VALUES ('artist', entity_id('artist', 'claude-monet-ctl'), 'gnd', '118583123');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'claude-monet-ctl'), 'born_in', 'place', entity_id('place', 'paris'))`);
  await userA.goto('/artists/claude-monet-ctl/gnd');
  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  // ours already: cited on request (ticked)
  await expect(row('born in')).toContainText('have it');
  await expect(row('born in').locator('input[name^="citerel."]')).toBeChecked();
  // Giverny: not ours, not found — linked to one of ours by hand (typing chooses "another of ours")
  await expect(row('died in').locator('input[value=skip]')).toBeChecked();
  await row('died in').locator('input.rel-picker').fill('paris');
  await expect(row('died in').locator('input[value=other]')).toBeChecked();
  // Charles Gleyre: we don't have him — a new person
  await row('Gleyre').locator('input[value="new-person"]').check();
  await Promise.all([userA.waitForNavigation(), userA.click('.wd-form .sticky-actions button')]);

  // (collaborated_with is symmetric: stored in one direction, either may be the subject)
  const rels = sql(`SELECT string_agg(r.relationship_type || ' ' || o.slug || ' ' || coalesce(b.slug, '-'), ', ' ORDER BY r.relationship_type, o.slug)
    FROM relationships r
    JOIN entity_index o ON (o.type, o.id) = CASE WHEN (r.subject_type, r.subject_id) = ${me} THEN (r.object_type, r.object_id) ELSE (r.subject_type, r.subject_id) END
    LEFT JOIN citations c ON c.relationship_id = r.id LEFT JOIN bibliography b ON b.id = c.source_id
    WHERE (r.subject_type, r.subject_id) = ${me} OR (r.object_type, r.object_id) = ${me}`);
  expect(rels).toBe('born_in paris gnd, collaborated_with charles-gleyre gnd, collaborated_with vincent-van-gogh gnd, died_in paris gnd');
  // the new person: "to complete", with the GND number from the record
  expect(sql(`SELECT p.name || ' ' || (a.entity_id IS NOT NULL) || ' ' || i.value FROM people p
    LEFT JOIN auto_created a ON (a.entity_type, a.entity_id) = ('person', p.id)
    JOIN entry_identifiers i ON (i.entity_type, i.entity_id) = ('person', p.id) AND i.authority = 'gnd' WHERE p.slug = 'charles-gleyre'`))
    .toBe('Charles Gleyre true 118695967');
});

test('Wikidata: a relationship we have is cited with Wikidata; a suggestion linked to another of ours', async ({ userA }) => {
  cleanup();
  sql(`INSERT INTO artists (slug, name, wikidata_id) VALUES ('claude-monet-ctl', 'Claude Monet', 'Q100');
       INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id) VALUES ('artist', entity_id('artist', 'claude-monet-ctl'), 'born_in', 'place', entity_id('place', 'paris'))`);
  await userA.goto('/artists/claude-monet-ctl/wikidata');
  const row = (text) => userA.locator('.wd-table tbody tr', { hasText: text }).first();
  await expect(row('already there').locator('input[name^="citerel."]')).toBeChecked();
  // died in Giverny (Wikidata offers to create it): linked to our Paris instead
  await row('died in').locator('input.rel-picker').fill('paris');
  await Promise.all([userA.waitForNavigation(), userA.click('.wd-form .sticky-actions button')]);
  expect(sql(`SELECT string_agg(r.relationship_type || ' ' || o.slug || ' ' || coalesce(c.wikidata_item, '-'), ', ' ORDER BY r.relationship_type)
    FROM relationships r JOIN places o ON o.id = r.object_id LEFT JOIN citations c ON c.relationship_id = r.id
    WHERE (r.subject_type, r.subject_id) = ${me}`)).toBe('born_in paris Q100, died_in paris Q100');
  // a hand-picked link may be a stand-in: Paris did not get Giverny's Q-id
  expect(sql("SELECT coalesce(wikidata_id, '-') FROM places WHERE slug = 'paris'")).not.toBe('Q101');
});
