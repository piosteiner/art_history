// New entries from Wikidata, made as the admin's "+ from Wikidata…" followed by "Create" makes them: every value the
// item has (cited W), its first image, its numbers in authority files; creator, institution … linked to ours or
// created from their items (flagged "to complete"). The save is the form's own (saveEntity: duplicate check, terms,
// city). With --links, then the relationships the item suggests (depicts, movement …) as on "Compare with Wikidata":
// ours linked, the rest created from their items. Items we have already (by Q-id) are not created again.
//
//   node scripts/from-wikidata.js [--dry-run] [--user=pio] [--prefer-lang=es] [--links] <type> Q123 Q456:its-slug …
//     --dry-run       what would be taken and created; nothing is written
//     --prefer-lang   the title in this language when Wikidata has the work's name in it (the others stay names)
//     --links         also the suggested relationships ("commissioned by" left out: it is a provenance step)
//     --skip=a,b      relationship types to leave out (e.g. created_in_polity: Wikidata's "country of origin" is today's)
//     --trust-type    the items are of this type even where Wikidata's classes say otherwise (as "Create anyway")
//     Q456:its-slug   the slug to use (else one from the item's label)
// Prints one line per item: Q-id → type/slug, what was created.
const { adminPool } = require('../src/db');
const { BY_TYPE } = require('../src/content');
const wikidata = require('../src/admin/wikidata');
const { saveEntity } = require('../src/admin/routes/entries');
const { fold } = require('../src/fold');

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || null;
const [type, ...items] = args.filter((a) => !a.startsWith('--'));
const qids = items.map((x) => x.split(':')[0]);
const slugFor = Object.fromEntries(items.filter((x) => x.includes(':')).map((x) => x.split(':')));
const t = BY_TYPE[type];
if (!t || !qids.length || qids.some((q) => !/^Q[1-9][0-9]*$/.test(q))) {
  console.error('usage: node scripts/from-wikidata.js [--dry-run] [--user=pio] [--prefer-lang=es] [--links] <type> Q123 …');
  process.exit(2);
}
const DRY = flag('dry-run');
const PREFER = opt('prefer-lang');
const SKIP = (opt('skip') || '').split(',').filter(Boolean);

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

// everything the review page offers, ticked: values, list items, references (ours, else a candidate, else new),
// the first image, the authority numbers
// (an artwork's map location only for one that doesn't move: Wikidata gives some paintings their museum's point, and a
// location makes the form add "created in" that city)
const MOVABLE = /\b(painting|panel|canvas|print|drawing|triptych|paint)\b/i;
// A candidate is only a similar name (similarEntry): one with an item of its own is someone else — the item is created;
// one without is left for a person to decide on the review page (reported).
const undecided = [];
async function candidatePick(c, create, what) {
  const t2 = BY_TYPE[c.type];
  const own = (await adminPool.query(`SELECT wikidata_id FROM ${t2.table} WHERE slug = $1`, [c.slug])).rows[0];
  if (own && own.wikidata_id) return create ? 'create' : 'later';
  undecided.push(`${what}: is “${c.name}” (${c.type}/${c.slug}) the same? — decide on the review page`);
  return 'later';
}
async function takeAll(plan) {
  const choices = {};
  const movable = t.type === 'artwork' && MOVABLE.test(`${plan.description || ''} ${JSON.stringify((plan.rows.find((r) => r.key === 'materials') || {}).items || [])}`);
  // other names that only add the artist's name ("Las Meninas (Diego Velazquez)") are search aliases, not names
  const creator = plan.rows.find((r) => r.key === 'creator') || {};
  const artist = fold(((creator.target || creator.candidate || {}).name || ((creator.create || {}).doc || {}).name || '').split(' ').pop());
  const alias = (v) => { const [text, , role] = String(v).split(' | '); return artist.length > 2 && (role || 'alternative') === 'alternative' && fold(text).includes(artist); };
  for (const row of plan.rows) {
    if (row.status === 'same' || (movable && row.key === 'location')) continue;
    if (row.kind === 'list') choices[`alt.${row.key}`] = row.items.filter((it) => !it.declined && !(row.key === 'names' && alias(it.value))).map((it) => it.value);
    else if (row.kind === 'ref') {
      choices[`ref.${row.key}`] = row.target ? 'link' : row.candidate ? await candidatePick(row.candidate, row.create, `${plan.qid} ${row.key}`) : row.create ? 'create' : 'later';
    }
    else choices[`take.${row.key}`] = 'take';
  }
  if (plan.images.length) choices['img.0'] = 'add';
  for (const x of plan.identifiers || []) choices[`idf.${x.code}`] = 'take';
  return choices;
}

// the title in the preferred language, when one of the names is the work's name in it ("Las Meninas | es | original")
function preferTitle(form) {
  if (!PREFER) return;
  const lines = String(form['f.names'] || '').split('\n').filter(Boolean);
  const i = lines.findIndex((l) => { const [, lang, role] = l.split(' | '); return lang === PREFER && role !== 'translation'; });
  if (i < 0 || form['f.title_lang'] === PREFER) return;
  const [text] = lines[i].split(' | ');
  const old = form['f.title'] ? `${form['f.title']} | ${form['f.title_lang'] || ''} | translation` : null;
  lines.splice(i, 1);
  if (old && !lines.some((l) => l.split(' | ')[0] === form['f.title'])) lines.push(old);
  form['f.title'] = text;
  form['f.title_lang'] = PREFER;
  form['f.names'] = lines.join('\n');
}

// Wikidata answers 429 when asked too fast: wait and ask again
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
  for (const qid of qids) {
    const have = (await adminPool.query(`SELECT id, slug FROM ${t.table} WHERE wikidata_id = $1`, [qid])).rows[0];
    let entity = have ? { type: t.type, id: have.id } : null;
    let slug = have ? have.slug : null;
    let made = [];
    if (!have) {
      const plan = await patiently(() => wikidata.compare(adminPool, t, qid, {}, null));
      const choices = await takeAll(plan);
      if (DRY) {
        console.log(`${qid} → new ${type} "${plan.label}": ${plan.rows.filter((r) => choices[`take.${r.key}`] || choices[`alt.${r.key}`] || (choices[`ref.${r.key}`] || 'later') !== 'later').map((r) => r.key).join(', ')}`
          + `${plan.images.length ? ', image' : ''}${(plan.identifiers || []).length ? `, ${plan.identifiers.map((x) => x.code).join('/')}` : ''}`);
        await pause(3000);
        continue;
      } else {
        const result = await tx(user, (db) => wikidata.apply(db, t, null, plan, choices, user.id));
        const form = wikidata.withProvenance(result.form, {}, qid);
        preferTitle(form);
        slug = slugFor[qid] || wikidata.slugify(plan.label || qid);
        const body = { slug, ...form, ...(flag('trust-type') ? { 'type.ok': '1' } : {}),
          ...(result.pendingImages.length ? { 'wd.images': JSON.stringify(result.pendingImages) } : {}),
          ...(result.pendingIds.length ? { 'wd.ids': JSON.stringify(result.pendingIds) } : {}),
          ...(result.cites.length ? { 'wd.cite': JSON.stringify({ qid, cites: result.cites }) } : {}) };
        const saved = await saveEntity(user, t, body, null);
        if (saved.errors) { console.log(`${qid} ✗ ${saved.errors.join('; ')}${saved.duplicates ? ` (${saved.duplicates.map((d) => d.slug || d.name).join(', ')})` : ''}`); continue; }
        slug = saved.slug;
        made = [...result.created, ...saved.created.map((c) => `${c.type} ${c.name}`)];
        entity = { type: t.type, id: (await adminPool.query(`SELECT id FROM ${t.table} WHERE slug = $1`, [slug])).rows[0].id };
      }
    }
    // the relationships Wikidata suggests, for the entry now that it exists
    if (flag('links') && entity && !DRY) {
      const plan = await patiently(() => wikidata.compare(adminPool, t, qid, {}, entity));
      const choices = {};
      for (const [i, s] of plan.suggestions.entries()) {
        if (s.already || s.type === '~commissioned' || SKIP.includes(s.type.replace('~', ''))) continue;
        choices[`rel.${i}`] = s.target ? 'link' : s.candidate ? await candidatePick(s.candidate, s.create, `${qid} ${s.type} ${s.name}`) : s.create ? 'create' : 'later';
      }
      const result = await tx(user, (db) => wikidata.apply(db, t, entity, { ...plan, rows: [], images: [], identifiers: [] }, choices, user.id));
      made = [...made, ...result.created, `${result.relationships} relationships`];
    }
    await pause(3000);
    console.log(`${qid} → ${type}/${slug || '?'}${have ? ' (had it)' : ''}${made.length ? ` — ${made.join(', ')}` : ''}`);
  }
  if (undecided.length) console.log(`Left undecided (similar names):\n  ${undecided.join('\n  ')}`);
  await adminPool.end();
})().catch(async (err) => { console.error(err); await adminPool.end(); process.exit(1); });
