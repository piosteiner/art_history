// "Not connected to anything" (no_relationships, 180): a reference anywhere counts — a provenance event step, a
// co-owner, a record's place, a building-phase person, a group's part, a [[link]] in another entry's text — and the
// worker re-checks an entry when the text linking to it changes (text_links_touch). The Quality page lists what's left.
const { test, expect, sql, settled } = require('./helpers');

const W = "entity_id('artwork', 'test-conn-w')";
const lonely = (type, slug) => sql(`SELECT count(*) FROM quality_issues WHERE check_id = 'no_relationships'
  AND entity_type = '${type}' AND entity_id = entity_id('${type}', '${slug}')`);

const cleanup = () => sql(`DELETE FROM artworks WHERE slug IN ('test-conn-w', 'test-conn-part', 'test-conn-group');
  DELETE FROM people WHERE slug IN ('test-conn-claimant', 'test-conn-coowner', 'test-conn-builder', 'test-conn-named');
  DELETE FROM places WHERE slug = 'test-conn-seen'`);
test.beforeEach(cleanup);
test.afterEach(cleanup);

test('references count as connections; a [[link]] added or removed re-checks its target', async ({ userA }) => {
  sql(`INSERT INTO people (slug, name) VALUES ('test-conn-claimant', 'Test Claimant'), ('test-conn-coowner', 'Test Co-owner'),
         ('test-conn-builder', 'Test Builder'), ('test-conn-named', 'Test Named Only');
       INSERT INTO places (slug, name, kind, location) VALUES ('test-conn-seen', 'Test Seen Here', 'site', 'POINT(-3.714 40.418)');
       INSERT INTO artworks (slug, title, creator_id) VALUES ('test-conn-w', 'Test Connected Work', entity_id('artist', 'paul-gauguin'));
       INSERT INTO artworks (slug, title) VALUES ('test-conn-group', 'Test Group');
       INSERT INTO artworks (slug, title, parent_id) VALUES ('test-conn-part', 'Test Part', entity_id('artwork', 'test-conn-group'));
       INSERT INTO provenance (artwork_id, position, owner_artist_id) VALUES (${W}, 0, entity_id('artist', 'paul-gauguin'));
       INSERT INTO provenance (artwork_id, position, role, method, owner_person_id)
         VALUES (${W}, 1, 'event', 'claim', entity_id('person', 'test-conn-claimant'));
       INSERT INTO provenance_co_owners (provenance_id, position, owner_person_id)
         SELECT id, 0, entity_id('person', 'test-conn-coowner') FROM provenance WHERE artwork_id = ${W} AND position = 0;
       INSERT INTO provenance_records (provenance_id, position, place_id, note)
         SELECT id, 0, entity_id('place', 'test-conn-seen'), 'test' FROM provenance WHERE artwork_id = ${W} AND position = 0;
       INSERT INTO artwork_phases (artwork_id, position, kind, title) VALUES (${W}, 0, 'construction', 'Test phase');
       INSERT INTO artwork_phase_people (phase_id, position, person_id, role)
         SELECT id, 0, entity_id('person', 'test-conn-builder'), 'architect' FROM artwork_phases WHERE artwork_id = ${W}`);
  await settled();
  expect(lonely('person', 'test-conn-claimant')).toBe('0');   // owner of an event step only (no edge in the graph)
  expect(lonely('person', 'test-conn-coowner')).toBe('0');    // co-owner beside the artist
  expect(lonely('person', 'test-conn-builder')).toBe('0');    // building-phase person, not an artist or patron
  expect(lonely('place', 'test-conn-seen')).toBe('0');        // a provenance record's place
  expect(lonely('artwork', 'test-conn-group')).toBe('0');     // a group with its part, no creator or museum
  expect(lonely('artwork', 'test-conn-part')).toBe('0');
  expect(lonely('person', 'test-conn-named')).toBe('1');      // nothing yet

  // named in another entry's text: connected; the link taken out again: not any more — without touching the person
  sql(`UPDATE artworks SET description_md = 'Bought from [[person/test-conn-named]].' WHERE slug = 'test-conn-w'`);
  await settled();
  expect(lonely('person', 'test-conn-named')).toBe('0');
  sql(`UPDATE artworks SET description_md = 'Bought from a dealer.' WHERE slug = 'test-conn-w'`);
  await settled();
  expect(lonely('person', 'test-conn-named')).toBe('1');

  // the Quality page lists it under the check
  await userA.goto('/quality?check=no_relationships');
  await expect(userA.locator('body')).toContainText('Test Named Only');
});
