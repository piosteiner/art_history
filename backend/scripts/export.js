// Exports the database to YAML in content/ — the reverse of import.js. Since Phase 5 the database is the source
// of truth (edited in the admin panel); export when you want a readable snapshot in git:
//
//   npm run export                  # production DB → content/   then review `git diff content/` and commit
//   npm run export:dev              # arthistory_dev → content/
//   CONTENT_DIR=/tmp/x npm run export
//
// One file per entity (content/<folder>/<slug>.yaml), relationships in the subject's file. Files of entities that
// no longer exist are deleted. Import of an export changes nothing (tested: export → import --dry-run → all unchanged).
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { Client } = require('pg');
const config = require('../src/config');
const { TYPES, IMAGE_KEYS, readDocs, readRelationships, readImages, readProvenance } = require('../src/content');

const CONTENT_DIR = process.env.CONTENT_DIR || path.join(__dirname, '..', '..', 'content');

// Years are written as numbers (1853, not "1853"); everything else as the fuzzy-date text.
const yearsAsNumbers = (doc, keys) => {
  for (const k of keys) if (typeof doc[k] === 'string' && /^-?\d+$/.test(doc[k])) doc[k] = Number(doc[k]);
};

async function main() {
  const client = new Client({ connectionString: config.db.apiUrl, application_name: 'arthistory-export' });
  await client.connect();
  const stats = {};
  try {
    // One snapshot for the whole export, even if someone edits in the admin panel meanwhile.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const t of TYPES) {
      const dir = path.join(CONTENT_DIR, t.folder);
      fs.mkdirSync(dir, { recursive: true });
      const keep = new Set();
      const dateKeys = Object.entries(t.fields).filter(([, k]) => k === 'date' || k === 'period').map(([k]) => k);
      for (const { id, slug, doc } of await readDocs(client, t)) {
        yearsAsNumbers(doc, dateKeys);
        const rels = (await readRelationships(client, t.type, id)).map((r) => r.rel);
        rels.forEach((rel) => yearsAsNumbers(rel, ['period']));
        if (rels.length) doc.relationships = rels;
        const imgs = (await readImages(client, t.type, id)).map((img) => Object.fromEntries(IMAGE_KEYS.filter((k) => img[k] !== null).map((k) => [k, img[k]])));
        if (imgs.length) doc.images = imgs;
        if (t.type === 'artwork') {
          const steps = await readProvenance(client, id);
          steps.forEach((st) => yearsAsNumbers(st, ['acquired', 'ended']));
          if (steps.length) doc.provenance = steps;
        }
        const file = path.join(dir, `${slug}.yaml`);
        // Lists of plain values inline ([a, b]) like the hand-written files; relationships stay one per block.
        const yaml = new YAML.Document(doc, { schema: 'core' });
        YAML.visit(yaml, { Seq(_, seq) { if (seq.items.every((i) => YAML.isScalar(i))) seq.flow = true; } });
        const text = yaml.toString({ lineWidth: 0, flowCollectionPadding: false });
        const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (old !== text) {
          fs.writeFileSync(file, text);
          const what = `${t.folder} ${old === null ? 'new' : 'changed'}`;
          stats[what] = (stats[what] || 0) + 1;
        }
        keep.add(`${slug}.yaml`);
      }
      for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') && !keep.has(f))) {
        fs.unlinkSync(path.join(dir, name));
        stats[`${t.folder} deleted`] = (stats[`${t.folder} deleted`] || 0) + 1;
      }
    }
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
  console.log(`✓ exported ${config.db.name} → ${CONTENT_DIR}`);
  const lines = Object.entries(stats).sort();
  if (!lines.length) console.log('  no changes');
  lines.forEach(([k, v]) => console.log(`  ${String(v).padStart(4)} ${k}`));
}

main().catch((err) => { console.error(`✗ ${err.message}`); process.exit(1); });
