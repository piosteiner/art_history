// Revert a change set and restore an entity version, from the audit_log (migrations 006 + 009).
//
// A change set = every audit_log row one transaction wrote (same txid): an edit, a creation, or a deletion together
// with the relationships the delete trigger removed. Reverting it is planned per row:
//
//   audit action   revert does                          conflicts checked
//   update         set the changed fields back          three-way per field: before / after the change / now —
//                                                       now = after → revert automatically; now ≠ after → someone
//                                                       edited it since → the user picks "keep current" or "revert"
//                                                       row deleted since → skip, or restore it as it was before
//   insert         delete the row again                 edited since (confirm), other records pointing at it
//   delete         re-insert the row with its old id    slug / Wikidata id taken meanwhile, referenced rows gone,
//                  (OVERRIDING SYSTEM VALUE)             relationship endpoints gone, identical relationship exists,
//                                                       image's entry gone, same image there again
//
// Relationships and images are "dependent" rows: they hang on entities, so they are re-created after and deleted
// before them.
//
// "Restore this version" plans one row: every field back to the state right after the chosen audit entry.
//
// Values are compared and written as they are stored in the audit log: to_jsonb() of the row. Writing uses
// jsonb_populate_record(NULL::<table>, json), which turns that JSON back into the table's own column types
// (daterange, geography, text[], jsonb …) — so no per-type code. Every plan is dry-run first (inside a transaction
// that is rolled back): what the database would reject is shown before anything is applied.
const crypto = require('crypto');
const { merge3 } = require('./textdiff');
const { IMAGE_FK: BY_IMAGE_FK, BY_TYPE, BY_FOLDER } = require('../content');

const TABLES = ['places', 'movements', 'polities', 'artists', 'patrons', 'institutions', 'artworks', 'relationships', 'images'];
// table → type and back (polities ↔ polity: not always + 's')
const typeOf = (table) => BY_FOLDER[table].type;
const tableOf = (type) => BY_TYPE[type].table;
const DEPENDENT = new Set(['relationships', 'images']);
// An image row belongs to the entity in whichever of its three foreign keys is set (migration 017).
const imageOwner = (row) => ['artwork', 'artist', 'institution'].map((type) => ({ type, id: row[`${type}_id`] })).find((o) => o.id != null);
const IGNORED = new Set(['id', 'created_at', 'updated_at', 'lifespan']);  // never compared or reverted
// Foreign keys of entity tables (column → referenced table); relationships are checked by their own trigger.
const FKS = { parent_id: null /* same table */, place_id: 'places', creator_id: 'artists', current_institution_id: 'institutions' };

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Writable columns of a table (generated ones like artists.lifespan excluded), cached.
const columnCache = new Map();
async function columnsOf(db, table) {
  if (!columnCache.has(table)) {
    const { rows } = await db.query(`
      SELECT attname FROM pg_attribute
      WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum`, [table]);
    columnCache.set(table, rows.map((r) => r.attname));
  }
  return columnCache.get(table);
}

async function currentRow(db, table, id) {
  const { rows } = await db.query(`SELECT to_jsonb(t) AS j FROM ${table} t WHERE id = $1`, [id]);
  return rows[0] ? rows[0].j : null;
}

// "Van Gogh — lived in → Paris" / "artist Vincent van Gogh"; names of deleted entities from their last audit entry.
async function describe(db, table, row) {
  if (!DEPENDENT.has(table)) return `${typeOf(table)} ${row.name || row.title || row.slug}`;
  const name = async (type, id) => {
    const { rows } = await db.query(`
      SELECT coalesce((SELECT name FROM entity_index WHERE type = $1::entity_type AND id = $2),
                      (SELECT coalesce(old_row->>'name', old_row->>'title') FROM audit_log
                        WHERE table_name = entity_table($1::entity_type) AND row_id = $2 AND old_row IS NOT NULL ORDER BY id DESC LIMIT 1),
                      $1 || ' #' || $2) AS n`, [type, id]);
    return rows[0].n;
  };
  if (table === 'images') {
    const owner = imageOwner(row);
    return `image of ${await name(owner.type, owner.id)} “${row.caption || String(row.url).replace(/^.*\//, '')}”`;
  }
  const { rows } = await db.query('SELECT label FROM relationship_types WHERE code = $1', [row.relationship_type]);
  return `${await name(row.subject_type, row.subject_id)} — ${rows[0] ? rows[0].label : row.relationship_type} → ${await name(row.object_type, row.object_id)}`;
}

async function loadChangeSet(db, txid) {
  const { rows } = await db.query(`
    SELECT a.id, a.table_name, a.row_id, a.action::text, a.old_row, a.new_row, a.changed_at, a.source, u.username
    FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id
    WHERE a.txid = $1::xid8 ORDER BY a.id`, [txid]);
  return rows.filter((r) => TABLES.includes(r.table_name));
}

// ---------------------------------------------------------------------------------------------------------------
// Planning. An item: { key, table, rowId, op: 'update'|'restore'|'delete'|'none', label, include, fields, notes,
//                      json (row to write for restore), needs: {slug?, confirm?}, blocked? }
// `choices` is the submitted form (flat): include.<key>, f.<key>.<field> = keep|revert, slug.<key>, confirm.<key>
// ---------------------------------------------------------------------------------------------------------------
function fieldPlan(key, before, after, now, choices) {
  // before = value to go back to, after = what the change wrote, now = current value
  const fields = [];
  for (const k of Object.keys({ ...before, ...after })) {
    // columns dropped since (e.g. the single image fields before migration 017) can't be reverted
    if (IGNORED.has(k) || !(k in now) || same(before[k], after[k])) continue;
    const conflict = !same(now[k], after[k]);
    const already = same(now[k], before[k]);
    const chosen = choices[`f.${key}.${k}`];
    // A text edited again since: try a word-level three-way merge — undo only this change's words, keep later edits.
    const merged = conflict && !already && [before[k], after[k], now[k]].every((v) => typeof v === 'string' || v === null)
      ? merge3(after[k], before[k], now[k]) : null;
    fields.push({
      name: k, before: before[k], after: after[k], now: now[k],
      merged: merged === null || merged === now[k] ? undefined : merged || null,
      status: already ? 'already' : conflict ? 'conflict' : 'auto',
      // Conflicts default to merging when that works, else to keeping the newer value; everything else to reverting.
      choice: already ? 'keep' : (chosen || (conflict ? (merged !== null && merged !== now[k] ? 'merge' : 'keep') : 'revert')),
    });
  }
  return fields;
}

async function planRestore(db, item, row, choices) {
  // Re-insert `row` (a full to_jsonb row) with its old id. Mutates item: json, notes, needs, blocked.
  const json = { ...row };
  const { table } = item;
  if (table === 'images') {
    const owner = imageOwner(json);
    const t = tableOf(owner.type);
    if (!(await db.query(`SELECT 1 FROM ${t} WHERE id = $1`, [owner.id])).rows.length && !item.plannedIds.has(`${t}:${owner.id}`)) {
      item.blocked = `its ${owner.type} (#${owner.id}) no longer exists and is not restored here`;
    }
    if ((await db.query(`SELECT 1 FROM images WHERE ${owner.type}_id = $1 AND url = $2 AND id <> $3`, [owner.id, json.url, json.id])).rows.length) {
      item.blocked = 'the same image is there again';
    }
  } else if (table !== 'relationships') {
    if (row.image_url) item.notes.push(`Its image from before multiple images (migration 017) is not restored — add it again: ${row.image_url}`);
    const taken = (await db.query(`SELECT slug FROM ${table} WHERE slug = $1 AND id <> $2`, [json.slug, json.id])).rows.length;
    if (taken) {
      const wanted = String(choices[`slug.${item.key}`] || '').trim();
      item.needs.slug = { taken: json.slug, value: wanted || `${json.slug}-restored` };
      json.slug = item.needs.slug.value;
      item.notes.push(`The slug “${row.slug}” now belongs to another ${typeOf(table)} — restored under a new slug.`);
    }
    if (json.wikidata_id && (await db.query(`SELECT 1 FROM ${table} WHERE wikidata_id = $1 AND id <> $2`, [json.wikidata_id, json.id])).rows.length) {
      item.notes.push(`Wikidata id ${json.wikidata_id} now belongs to another record — left empty.`);
      json.wikidata_id = null;
    }
    for (const [col, refTable] of Object.entries(FKS)) {
      if (json[col] === undefined || json[col] === null) continue;
      const target = refTable || table;
      if (!(await db.query(`SELECT 1 FROM ${target} WHERE id = $1`, [json[col]])).rows.length && !item.plannedIds.has(`${target}:${json[col]}`)) {
        item.notes.push(`${col.replace(/_id$/, '').replace(/_/g, ' ')} (#${json[col]}) no longer exists — left empty.`);
        json[col] = null;
      }
    }
  } else {
    for (const side of ['subject', 'object']) {
      const t = tableOf(json[`${side}_type`]);
      const id = json[`${side}_id`];
      if (!(await db.query(`SELECT 1 FROM ${t} WHERE id = $1`, [id])).rows.length && !item.plannedIds.has(`${t}:${id}`)) {
        item.blocked = `its ${side} (${json[`${side}_type`]} #${id}) no longer exists and is not restored here`;
      }
    }
    const dup = await db.query(`
      SELECT 1 FROM relationships WHERE id <> $1 AND relationship_type = $2 AND period IS NOT DISTINCT FROM $3::daterange
        AND ((subject_type, subject_id, object_type, object_id) = ($4::entity_type, $5, $6::entity_type, $7)
          OR (subject_type, subject_id, object_type, object_id) = ($6::entity_type, $7, $4::entity_type, $5))`,
    [json.id, json.relationship_type, json.period, json.subject_type, json.subject_id, json.object_type, json.object_id]);
    if (dup.rows.length) item.blocked = 'an identical relationship exists again';
  }
  json.updated_at = new Date().toISOString();
  item.json = json;
}

async function planDelete(db, item, now, after, changeSetKeys) {
  if (!same({ ...now, updated_at: null }, { ...after, updated_at: null })) {
    item.needs.confirm = 'It has been edited since it was created — deleting it also discards those edits.';
  }
  if (!DEPENDENT.has(item.table)) {
    const type = typeOf(item.table);
    const { rows } = await db.query(`
      SELECT id FROM relationships WHERE (subject_type, subject_id) = ($1::entity_type, $2) OR (object_type, object_id) = ($1::entity_type, $2)`,
    [type, item.rowId]);
    const extra = rows.filter((r) => !changeSetKeys.has(`relationships:${r.id}`));
    if (extra.length) {
      item.needs.confirm = `${item.needs.confirm ? `${item.needs.confirm} ` : ''}${extra.length} relationship${extra.length === 1 ? '' : 's'} added since will be deleted with it.`;
    }
    if (BY_IMAGE_FK[type]) {
      const imgs = (await db.query(`SELECT id FROM images WHERE ${type}_id = $1`, [item.rowId])).rows.filter((r) => !changeSetKeys.has(`images:${r.id}`));
      if (imgs.length) {
        item.needs.confirm = `${item.needs.confirm ? `${item.needs.confirm} ` : ''}${imgs.length} image${imgs.length === 1 ? '' : 's'} added since will be removed with it.`;
      }
    }
  }
}

async function planChangeSet(db, txid, choices = {}, submitted = false) {
  const entries = await loadChangeSet(db, txid);
  const changeSetKeys = new Set(entries.map((e) => `${e.table_name}:${e.row_id}`));
  // Rows this revert brings back — references to them count as existing.
  const plannedIds = new Set(entries.filter((e) => e.action === 'delete').map((e) => `${e.table_name}:${e.row_id}`));
  const items = [];
  for (const e of entries) {
    const key = String(e.id);
    const now = await currentRow(db, e.table_name, e.row_id);
    const item = {
      key, auditId: e.id, table: e.table_name, rowId: e.row_id, action: e.action, notes: [], needs: {}, fields: [],
      label: await describe(db, e.table_name, e.new_row || e.old_row), plannedIds,
      include: submitted ? choices[`include.${key}`] === '1' : true,
    };
    if (e.action === 'update') {
      if (!now) {
        item.op = choices[`gone.${key}`] === 'restore' ? 'restore' : 'none';
        item.gone = true;
        item.notes.push('Deleted since this change.');
        if (item.op === 'restore') await planRestore(db, item, e.old_row, choices);
      } else {
        item.op = 'update';
        item.fields = fieldPlan(key, e.old_row, e.new_row, now, choices);
        const dropped = Object.keys({ ...e.old_row, ...e.new_row }).filter((k) => !IGNORED.has(k) && !(k in now) && !same(e.old_row[k], e.new_row[k]));
        if (dropped.length) item.notes.push(`${dropped.join(', ')}: no longer a field of ${e.table_name} (the database changed since, e.g. images became a list) — not reverted.`);
        if (item.fields.every((f) => f.status === 'already') && !(dropped.length && !item.fields.length)) item.notes.push('Already undone — nothing left to revert here.');
      }
    } else if (e.action === 'insert') {
      if (!now) { item.op = 'none'; item.notes.push('Already deleted.'); } else {
        item.op = 'delete';
        await planDelete(db, item, now, e.new_row, changeSetKeys);
      }
    } else if (e.action === 'delete') {
      if (now) { item.op = 'none'; item.notes.push('Exists again already.'); } else {
        item.op = 'restore';
        await planRestore(db, item, e.old_row, choices);
      }
    }
    item.confirmed = choices[`confirm.${key}`] === '1';
    items.push(item);
  }
  return { entries, items };
}

async function planVersion(db, auditId, choices = {}, submitted = false) {
  const { rows } = await db.query(`
    SELECT a.id, a.table_name, a.row_id, a.action::text, a.new_row, a.changed_at, u.username
    FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id WHERE a.id = $1`, [auditId]);
  const e = rows[0];
  if (!e || !TABLES.includes(e.table_name) || DEPENDENT.has(e.table_name) || !e.new_row) return null;
  const now = await currentRow(db, e.table_name, e.row_id);
  const key = String(e.id);
  const item = {
    key, auditId: e.id, table: e.table_name, rowId: e.row_id, action: 'version', notes: [], needs: {}, fields: [],
    label: await describe(db, e.table_name, e.new_row), plannedIds: new Set(), include: true,
  };
  if (!now) {
    item.op = 'restore';
    item.notes.push('Deleted since — it will be re-created in this version (its relationships are not restored here; revert the deletion for those).');
    await planRestore(db, item, e.new_row, choices);
  } else {
    item.op = 'update';
    // Target = that version, "after" = now: every field that differs is offered, ticked by default.
    for (const k of Object.keys(e.new_row)) {
      if (IGNORED.has(k) || !(k in now) || same(e.new_row[k], now[k])) continue;
      const chosen = choices[`f.${key}.${k}`];
      item.fields.push({ name: k, before: e.new_row[k], after: now[k], now: now[k], status: 'auto', choice: chosen || 'revert' });
    }
    if (!item.fields.length) item.notes.push('The entity already looks exactly like this version.');
  }
  return { entry: e, items: [item] };
}

// ---------------------------------------------------------------------------------------------------------------
// Execution — the same code for the dry run (then ROLLBACK) and for real. Order matters: re-created entities first,
// then updates, then re-created relationships and images (their entities may just have come back), then deletions
// (relationships and images before the entities they hang on).
// ---------------------------------------------------------------------------------------------------------------
const PHASE = (i) => ({
  'restore:entity': 0, 'update:entity': 1, 'update:relationship': 1, 'restore:relationship': 2,
  'delete:relationship': 3, 'delete:entity': 4,
}[`${i.op}:${DEPENDENT.has(i.table) ? 'relationship' : 'entity'}`] ?? 9);

// Items still waiting for a confirmation are executed by the dry run too (to know whether they would work);
// applying refuses to start while any included item is unconfirmed (see unconfirmed()).
async function execute(db, items) {
  const results = {};
  const todo = items.filter((i) => i.include && i.op !== 'none' && !i.blocked).sort((a, b) => PHASE(a) - PHASE(b));
  for (const item of todo) {
    await db.query('SAVEPOINT item');
    try {
      if (item.op === 'update') {
        const writes = item.fields.filter((f) => f.choice === 'revert' || (f.choice === 'merge' && f.merged !== undefined));
        const cols = writes.map((f) => f.name);
        if (cols.length) {
          const json = Object.fromEntries(writes.map((f) => [f.name, f.choice === 'merge' ? f.merged : f.before]));
          await db.query(`UPDATE ${item.table} SET (${cols.join(', ')}) = (SELECT ${cols.join(', ')}
            FROM jsonb_populate_record(NULL::${item.table}, $1::jsonb)) WHERE id = $2`, [JSON.stringify(json), item.rowId]);
        }
      } else if (item.op === 'restore') {
        const cols = await columnsOf(db, item.table);
        await db.query(`INSERT INTO ${item.table} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE
          SELECT ${cols.join(', ')} FROM jsonb_populate_record(NULL::${item.table}, $1::jsonb)`, [JSON.stringify(item.json)]);
      } else if (item.op === 'delete') {
        await db.query(`DELETE FROM ${item.table} WHERE id = $1`, [item.rowId]);
      }
      await db.query('RELEASE SAVEPOINT item');
      results[item.key] = { ok: true };
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT item');
      results[item.key] = { ok: false, error: err };
    }
  }
  return results;
}

const unconfirmed = (items) => items.filter((i) => i.include && i.op !== 'none' && !i.blocked && i.needs.confirm && !i.confirmed);

// Fingerprint of the current state of every row a plan touches: if it differs at "apply" from the preview,
// something changed meanwhile and the preview is shown again.
async function fingerprint(db, items) {
  const parts = [];
  for (const i of items) parts.push(`${i.table}:${i.rowId}:${JSON.stringify(await currentRow(db, i.table, i.rowId))}`);
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

// Links for the history: has this change set been reverted (by which txid, when)?
async function revertedBy(db, txid) {
  const { rows } = await db.query(`SELECT DISTINCT txid::text, min(changed_at) AS at FROM audit_log WHERE reverts = $1::xid8 GROUP BY 1`, [txid]);
  return rows;
}

module.exports = { planChangeSet, planVersion, execute, fingerprint, revertedBy, unconfirmed, TABLES };
