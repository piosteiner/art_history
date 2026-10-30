// export → import: what `npm run export` writes, `npm run import` takes back unchanged — the public numbers too
// (pg reads bigint as text: exports wrote them quoted, and the import refused its own snapshot), and a work with an
// inventory number (the import's INSERT … ON CONFLICT ran the number check before finding the row, 108).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect, sql } = require('./helpers');
const { DB, BACKEND } = require('./env');

const run = (script, dir, args = []) => execFileSync('node', [script, ...args],
  { cwd: BACKEND, env: { ...process.env, DB_NAME: DB, CONTENT_DIR: dir } }).toString();

test('the export imports again: public numbers as numbers, an older quoted one accepted, nothing changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arthistory-roundtrip-'));
  sql("UPDATE artworks SET inventory_number = 'RT 1' WHERE current_institution_id IS NOT NULL AND id = (SELECT min(id) FROM artworks WHERE current_institution_id IS NOT NULL)");
  // a whole's number of parts (an integer column: written as a number) and a building phase dated in free words
  // ("after 1648, until 1688" doesn't parse back — the export writes the range and the words beside it), 2026-10-30
  sql(`UPDATE artworks SET parts_count = 3 WHERE slug = 'the-starry-night';
       INSERT INTO artwork_phases (artwork_id, position, kind, title, period, period_label)
       VALUES (entity_id('artwork', 'the-starry-night'), 1, 'construction', 'RT phase', '[1648-01-01,1689-01-01)', 'after 1648, until 1688')`);
  // a pseudonym (a plain alternative name but for its kind), a date in free words that parses ("between 1746 and
  // 1749" reads back as "1746–1749"), a source's note that itself contains " · " — each came back changed before
  const before = sql("SELECT names::text || '|' || coalesce(created_label, '') FROM artworks WHERE slug = 'the-starry-night'");
  sql(`UPDATE artworks SET names = names || '[{"text": "RT Pseudonym", "role": "alternative", "kind": "pseudonym"}]'::jsonb,
         created_label = 'between 1888 and 1889', created = '[1888-01-01,1890-01-01)' WHERE slug = 'the-starry-night';
       INSERT INTO bibliography (slug, kind, name) VALUES ('rt-source', 'web', 'RT source') ON CONFLICT (slug) DO NOTHING;
       INSERT INTO citations (entity_type, entity_id, field, source_id, note, accessed)
       SELECT 'artwork', entity_id('artwork', 'the-starry-night'), 'medium', entity_id('source', 'rt-source'), 'RT · a note · with dots', current_date`);
  try {
    run('scripts/export.js', dir);
    const file = path.join(dir, 'artists', 'vincent-van-gogh.yaml');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^public_id: \d+$/m);
    // a snapshot from before the fix: the number quoted
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^public_id: (\d+)$/m, 'public_id: "$1"'));
    const out = run('scripts/import.js', dir, ['--dry-run', '--verbose']);
    expect(out).not.toContain('import failed');
    expect(out).toMatch(/unchanged/);
    expect(out).not.toMatch(/^ *\d+ [a-z ]+ (inserted|updated)$/m);
  } finally {
    sql("UPDATE artworks SET inventory_number = NULL WHERE inventory_number = 'RT 1'; UPDATE artworks SET parts_count = NULL WHERE slug = 'the-starry-night'; DELETE FROM artwork_phases WHERE title = 'RT phase'");
    const [names, label] = before.split('|');
    sql(`UPDATE artworks SET names = '${names.replace(/'/g, "''")}'::jsonb, created_label = ${label ? `'${label.replace(/'/g, "''")}'` : 'NULL'}, created = '[1889-06-01,1889-07-01)' WHERE slug = 'the-starry-night';
         DELETE FROM citations WHERE note LIKE 'RT · a note%'; DELETE FROM bibliography WHERE slug = 'rt-source'`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
