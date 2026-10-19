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
  try {
    run('scripts/export.js', dir);
    const file = path.join(dir, 'artists', 'vincent-van-gogh.yaml');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^public_id: \d+$/m);
    // a snapshot from before the fix: the number quoted
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^public_id: (\d+)$/m, 'public_id: "$1"'));
    const out = run('scripts/import.js', dir, ['--dry-run']);
    expect(out).not.toContain('import failed');
    expect(out).toMatch(/unchanged/);
    expect(out).not.toMatch(/^ *\d+ [a-z ]+ (inserted|updated)$/m);
  } finally {
    sql("UPDATE artworks SET inventory_number = NULL WHERE inventory_number = 'RT 1'");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
