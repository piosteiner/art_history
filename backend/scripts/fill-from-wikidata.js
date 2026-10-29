// Empty fields of existing entries filled from their Wikidata items — as "Compare with Wikidata" with only the empty
// fields ticked, followed by Publish (saveEntity: city of a location, citations W). A value we have is never replaced,
// a value declined on a review page is not taken again. Also: the first image when the entry has none, the numbers in
// authority files, relationships to entries we have (nothing created for them). A place reference is linked to ours,
// or created from its item (flagged "to complete"); a similar name without an item is left for a person (reported).
// An entry flagged "to complete" stays flagged — filled by a script is not reviewed.
//
//   node scripts/fill-from-wikidata.js [--dry-run] [--user=pio] [--no-names] <type> [slug …]
//     no slugs: every entry of the type that has a Wikidata item
//     --no-names   leave the other names alone
//     --skip=slug:key,…  values not to take (key as printed: location, ~founded …)
//     --name-kinds       only the names of a kind (153): birth name, pseudonym, nickname, art name — added also when
//                        the entry has other names already; each cited with its Wikidata statement (W)
// Prints one line per entry: what was filled.
const { adminPool } = require('../src/db');
const { BY_TYPE, readDocs } = require('../src/content');
const { docToForm } = require('../src/admin/forms');
const wikidata = require('../src/admin/wikidata');
const { saveEntity } = require('../src/admin/routes/entries');

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || null;
const [type, ...slugs] = args.filter((a) => !a.startsWith('--'));
const t = BY_TYPE[type];
if (!t) {
  console.error('usage: node scripts/fill-from-wikidata.js [--dry-run] [--user=pio] [--no-names] <type> [slug …]');
  process.exit(2);
}
const DRY = flag('dry-run');
const SKIP = new Set((opt('skip') || '').split(',').filter(Boolean));
const NAME_KINDS = flag('name-kinds');
// a name line's kind ("Oscar-Claude Monet | fr | former, birth" → birth)
const kindOfLine = (line) => { const role = String(line).split(' | ')[2] || ''; return role.split(',').map((x) => x.trim()).find((x) => wikidata.NAME_PROPS[x]) || null; };

async function tx(user, fn) {
  const db = await adminPool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', 'wikidata', true)", [String(user.id)]);
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

const undecided = [];
// only what is empty on our side; references: ours, a new entry from the item — a similar name is asked about
async function emptyOnly(slug, plan, hasImage) {
  const choices = {};
  const keys = [];
  for (const row of plan.rows) {
    // other names (a list): all when there are none yet; names of a kind (153) also beside others
    if (row.kind === 'list') {
      if (flag('no-names') || SKIP.has(`${slug}:${row.key}`) || (row.key !== 'names' && NAME_KINDS)) continue;
      const items = row.items.filter((it) => !it.declined && (!row.ours.length || NAME_KINDS ? kindOfLine(it.value) : true)).map((it) => it.value);
      if (items.length) { choices[`alt.${row.key}`] = items; keys.push(`${row.key} (${items.length})`); }
      continue;
    }
    if (NAME_KINDS || row.status !== 'empty' || row.declined || SKIP.has(`${slug}:${row.key}`)) continue;
    if (row.kind === 'ref') {
      let pick = row.target ? 'link' : row.create && !row.candidate ? 'create' : 'later';
      if (!row.target && row.candidate) {
        const own = (await adminPool.query(`SELECT wikidata_id FROM ${BY_TYPE[row.candidate.type].table} WHERE slug = $1`, [row.candidate.slug])).rows[0];
        if (own && own.wikidata_id && row.create) pick = 'create';
        else undecided.push(`${plan.qid} ${row.key}: is “${row.candidate.name}” (${row.candidate.type}/${row.candidate.slug}) Wikidata's ${row.wikiLabel}?`);
      }
      if (pick !== 'later') { choices[`ref.${row.key}`] = pick; keys.push(`${row.key}${pick === 'create' ? ' (new)' : ''}`); }
    } else { choices[`take.${row.key}`] = 'take'; keys.push(row.key); }
  }
  if (NAME_KINDS) return { choices, keys };
  const img = plan.images.findIndex((x) => x.status === 'new' && !x.declined);
  if (!hasImage && img >= 0) { choices[`img.${img}`] = 'add'; keys.push('image'); }
  for (const x of plan.identifiers || []) if (x.status === 'new') { choices[`idf.${x.code}`] = 'take'; keys.push(x.code); }
  for (const [i, s] of plan.suggestions.entries()) {
    if (s.already || s.declined || !s.target || s.type === '~commissioned' || SKIP.has(`${slug}:${s.type}`)) continue;
    choices[`rel.${i}`] = 'link'; keys.push(`${s.type} ${s.target.slug}`);
  }
  return { choices, keys };
}

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function patiently(fn) {
  for (let wait = 10000; ; wait *= 2) {
    try { return await fn(); } catch (err) {
      if (!/429/.test(err.message) || wait > 160000) throw err;
      console.error(`  (Wikidata busy — waiting ${wait / 1000} s)`);
      await pause(wait);
    }
  }
}

(async () => {
  const user = (await adminPool.query('SELECT id, username FROM admin_users WHERE username = $1', [opt('user') || 'pio'])).rows[0];
  if (!user) throw new Error('no such admin user');
  const docs = await readDocs(adminPool, t, slugs.length ? 't.slug = ANY ($1)' : 't.wikidata_id IS NOT NULL', slugs.length ? [slugs] : []);
  for (const { id, slug, version, doc } of docs.sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (!doc.wikidata_id) { console.log(`${slug}: no Wikidata item`); continue; }
    const row = { id, version };
    doc.slug = slug;
    const entity = { type: t.type, id };
    const ours = Object.fromEntries(Object.entries(docToForm(doc, t.fields)).map(([k, v]) => [`f.${k}`, v]));
    let plan;
    try { plan = await patiently(() => wikidata.compare(adminPool, t, doc.wikidata_id, ours, entity)); } catch (err) {
      console.log(`${doc.slug} ✗ ${err.message}`); continue;
    }
    const hasImage = t.imageFk && (await adminPool.query(`SELECT 1 FROM images WHERE ${t.imageFk} = $1 LIMIT 1`, [row.id])).rows.length > 0;
    const { choices, keys } = await emptyOnly(slug, plan, hasImage);
    if (!keys.length) { console.log(`${doc.slug}: nothing to fill`); await pause(1500); continue; }
    if (DRY) {
      const lines = [].concat(choices['alt.names'] || []);  // the names themselves, to be read before taking them
      console.log(`${doc.slug} (${doc.wikidata_id}) would fill: ${keys.join(', ')}${NAME_KINDS && lines.length ? `\n    ${lines.join('\n    ')}` : ''}`);
      await pause(1500); continue;
    }
    const flagged = (await adminPool.query('SELECT * FROM auto_created WHERE entity_type = $1 AND entity_id = $2', [t.type, row.id])).rows[0];
    const result = await tx(user, (db) => wikidata.apply(db, t, entity, plan, choices, user.id));
    const taken = wikidata.withProvenance(result.form, ours, doc.wikidata_id);
    let saved = { slug: doc.slug, created: [] };
    if (Object.keys(result.form).length) {
      const body = { ...ours, ...taken, slug: doc.slug, version: row.version,
        ...(result.cites.length ? { 'wd.cite': JSON.stringify({ qid: doc.wikidata_id, cites: result.cites }) } : {}) };
      saved = await saveEntity(user, t, body, { id: row.id });
      if (saved.errors) { console.log(`${doc.slug} ✗ ${saved.errors.join('; ')}`); continue; }
    }
    // the names of a kind taken: cited with their Wikidata statement (the name's own source, 152)
    const kinded = [].concat(choices['alt.names'] || []).filter(kindOfLine);
    if (kinded.length && !saved.errors) {
      await tx(user, async (db) => {
        for (const line of kinded) {
          await db.query(`INSERT INTO citations (name_id, wikidata_item, wikidata_property, accessed, created_by)
            SELECT n.id, $3, $4, current_date, $5 FROM entry_names n WHERE n.entity_type = $1 AND n.entity_id = $2 AND n.text = $6
              AND NOT EXISTS (SELECT 1 FROM citations c WHERE c.name_id = n.id AND c.wikidata_item = $3)`,
          [t.type, row.id, doc.wikidata_id, wikidata.NAME_PROPS[kindOfLine(line)], user.id, line.split(' | ')[0]]);
        }
      });
    }
    if (flagged) {
      await adminPool.query(`INSERT INTO auto_created (entity_type, entity_id, created_from_type, created_from_id, created_by, via, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [flagged.entity_type, flagged.entity_id, flagged.created_from_type, flagged.created_from_id, flagged.created_by, flagged.via, flagged.created_at]);
    }
    const made = [...result.created, ...(saved.city && saved.city.created ? ['city created'] : [])];
    console.log(`${doc.slug} (${doc.wikidata_id}) filled: ${keys.join(', ')}${made.length ? ` — ${made.join(', ')}` : ''}`);
    await pause(1500);
  }
  if (undecided.length) console.log(`Left undecided (similar names):\n  ${undecided.join('\n  ')}`);
  await adminPool.end();
})().catch(async (err) => { console.error(err); await adminPool.end(); process.exit(1); });
