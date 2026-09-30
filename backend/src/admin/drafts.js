// Per-user drafts (admin_drafts, migration 010): the unsaved state of an edit form, written by the live connection.
//
// A draft can go stale: while it sat there, someone else may have saved the same entry. Restoring it as-is would
// silently undo their changes in fields this user never touched, so a draft is *rebased* onto the current state —
// three-way per form field, with the entry as it was when editing started as the common ancestor (found in the audit
// log by the draft's base version):
//   only the draft changed it      → the draft's value
//   only the saved entry changed   → the saved value (the other person's edit is kept)
//   both, differently              → texts: word-level merge (textdiff.merge3); otherwise the draft's value, flagged
const { docFromJson } = require('../content');
const { docToForm, humanize } = require('./forms');
const { merge3, isLongText } = require('./textdiff');

async function getDraft(db, userId, type, entityId) {
  const { rows } = await db.query(`
    SELECT id, form, base_version, updated_at FROM admin_drafts
    WHERE user_id = $1 AND entity_type = $2 AND entity_id IS NOT DISTINCT FROM $3`, [userId, type, entityId]);
  return rows[0] || null;
}

async function deleteDraft(db, userId, type, entityId) {
  await db.query('DELETE FROM admin_drafts WHERE user_id = $1 AND entity_type = $2 AND entity_id IS NOT DISTINCT FROM $3',
    [userId, type, entityId]);
}

// doc → the flat form keys the browser posts ("slug", "f.name", "f.birth_label", "f.location_lon" …)
function formKeys(doc, t, slug) {
  const f = docToForm(doc, t.fields);
  return { slug, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [`f.${k}`, v])) };
}

const labelOf = (key) => humanize(key.replace(/^f\./, '').replace(/_(lon|lat|label)$/, ''));
const norm = (v) => String(v ?? '').replace(/\r\n/g, '\n');

// Fields a (rebased) draft form would change in the saved entry — only this user's own edits, since rebasing has
// already taken over what others saved meanwhile.
function changedFields(form, t, e) {
  const current = formKeys(e.doc, t, e.slug);
  return [...new Set(Object.keys(form).filter((k) => k !== 'version' && norm(form[k]) !== norm(current[k])).map(labelOf))];
}

// → { form (flat keys, ready to render), version (current, so saving works), merged: [labels], conflicts: [labels], stale }
async function rebase(db, t, e, draft) {
  const current = formKeys(e.doc, t, e.slug);
  if (!draft.base_version || draft.base_version === e.version) {
    return { form: draft.form, version: e.version, merged: [], conflicts: [], stale: false };
  }
  const { rows } = await db.query(`
    SELECT new_row FROM audit_log
    WHERE table_name = $1 AND row_id = $2 AND new_row IS NOT NULL AND (new_row->>'updated_at')::timestamptz = $3::timestamptz
    ORDER BY id DESC LIMIT 1`, [t.table, e.id, draft.base_version]);
  const base = rows[0] ? formKeys(await docFromJson(db, t, rows[0].new_row), t, rows[0].new_row.slug) : null;
  const form = {};
  const merged = [];
  const conflicts = [];
  for (const k of new Set([...Object.keys(draft.form), ...Object.keys(current)])) {
    if (k === 'version') continue;
    const d = norm(draft.form[k]);
    const c = norm(current[k]);
    if (!base) {  // no ancestor known: keep the draft, flag every difference
      form[k] = d;
      if (d !== c) conflicts.push(labelOf(k));
      continue;
    }
    const b = norm(base[k]);
    if (d === b) form[k] = c;
    else if (c === b || d === c) form[k] = d;
    else {
      const m = isLongText(k.replace(/^f\./, ''), d, c) ? merge3(b, d, c) : null;
      if (m !== null) { form[k] = m; merged.push(labelOf(k)); } else { form[k] = d; conflicts.push(labelOf(k)); }
    }
  }
  return { form, version: e.version, merged: [...new Set(merged)], conflicts: [...new Set(conflicts)], stale: true, baseKnown: !!base };
}

module.exports = { getDraft, deleteDraft, rebase, changedFields, formKeys };
