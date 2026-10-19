// scripts/from-wikidata.js: entries from Wikidata items as "+ from Wikidata…" and "Create" make them — against the
// test database and the fixture server (Q140, a panel by Q141). A similar name among ours is never taken for the item.
const { execFileSync } = require('child_process');
const path = require('path');
const { test, expect, sql } = require('./helpers');
const env = require('./env');

const run = (...args) => execFileSync('node', ['scripts/from-wikidata.js', '--user=tester', ...args],
  { cwd: path.join(__dirname, '../..'), env: { ...env.serverEnv(), DB_NAME: env.DB } }).toString();

test.afterAll(() => {
  sql(`DELETE FROM artworks WHERE wikidata_id = 'Q140'; DELETE FROM artists WHERE slug = 'test-painter-velasko' OR wikidata_id = 'Q141'`);
});

test('a dry run writes nothing; a similar name is left for a person to decide; a second run finds the entry', () => {
  sql("INSERT INTO artists (slug, name) VALUES ('test-painter-velasko', 'Test Painter Velasko')");
  expect(run('--dry-run', 'artwork', 'Q140')).toContain('Q140 → new artwork "Test Prado Panel": title, title_lang');
  expect(sql("SELECT count(*) FROM artworks WHERE wikidata_id = 'Q140'")).toBe('0');

  const out = run('--prefer-lang=es', 'artwork', 'Q140:test-prado-panel');
  expect(out).toContain('Q140 → artwork/test-prado-panel');
  expect(out).toMatch(/Left undecided[\s\S]*Q140 creator: is “Test Painter Velasko”/);
  // created as the form creates it: the original title, the date, cited with the item; the painter not linked
  expect(sql("SELECT title || ' | ' || title_lang || ' | ' || created_label || ' | ' || (creator_id IS NULL)::text FROM artworks WHERE wikidata_id = 'Q140'"))
    .toBe('Tabla de prueba | es | 1600 | true');
  expect(Number(sql("SELECT count(*) FROM citations WHERE entity_type = 'artwork' AND entity_id = entity_id('artwork', 'test-prado-panel') AND wikidata_item = 'Q140'"))).toBeGreaterThan(0);
  expect(sql("SELECT coalesce(wikidata_id, '-') FROM artists WHERE slug = 'test-painter-velasko'")).toBe('-');  // not given the item

  expect(run('artwork', 'Q140')).toContain('Q140 → artwork/test-prado-panel (had it)');
  expect(sql("SELECT count(*) FROM artworks WHERE wikidata_id = 'Q140'")).toBe('1');
});
