// Shared working copies (live collaboration step 2): one Yjs document per existing entry being edited.
//
// Document layout (the edit form, field by field):
//   getMap('form')        short fields as strings, keyed like the form posts them: slug, f.name, f.birth_label …
//   getText('f.<md>')     each Markdown field as Y.Text — concurrent typing merges character by character
//   getMap('meta')        version: the entry's updated_at this copy is based on (optimistic locking on publish)
// Yjs is a CRDT: every replica that has received the same updates has the same content, in whatever order they came,
// so browsers can keep editing offline and merge later. The server holds the copy while anyone has it open, relays
// updates between editors (src/admin/live.js), and persists it to live_docs (migration 011).
const crypto = require('crypto');
const Y = require('yjs');
const awarenessProtocol = require('y-protocols/awareness');
const { diffChars } = require('diff');
const { adminPool } = require('../db');
const { readDocs } = require('../content');
const { formKeys, rebase } = require('./drafts');

const entries = new Map();  // 'artist:12' → { key, t, id, doc, awareness, conns:Set, contributors:Set, timer, loading }
const b64 = (u8) => Buffer.from(u8).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(String(s), 'base64'));
const mdKeys = (t) => Object.entries(t.fields).filter(([, k]) => k === 'md').map(([k]) => `f.${k}`);

// Replace a Y.Text's content with a minimal character diff — other editors' cursors stay where they were.
function setText(ytext, value) {
  const old = ytext.toString();
  if (old === value) return;
  let pos = 0;
  for (const part of diffChars(old, value)) {
    if (part.added) { ytext.insert(pos, part.value); pos += part.value.length; } else if (part.removed) ytext.delete(pos, part.value.length);
    else pos += part.value.length;
  }
}

// Form (flat keys) → document, as one transaction.
function setForm(entry, form, origin = 'server') {
  const map = entry.doc.getMap('form');
  const md = new Set(mdKeys(entry.t));
  entry.doc.transact(() => {
    for (const [k, v] of Object.entries(form)) {
      if (k === 'version') continue;
      if (md.has(k)) setText(entry.doc.getText(k), String(v ?? ''));
      else if (map.get(k) !== String(v ?? '')) map.set(k, String(v ?? ''));
    }
  }, origin);
}

// Document → form (flat keys, what the browser would post).
function formOf(entry) {
  const form = { ...entry.doc.getMap('form').toJSON() };
  for (const k of mdKeys(entry.t)) form[k] = entry.doc.getText(k).toString();
  form.version = entry.doc.getMap('meta').get('version') || '';
  return form;
}

async function published(t, id) {
  return (await readDocs(adminPool, t, 't.id = $1', [id]))[0] || null;
}

// Open (load, seed or rebase) the working copy of an entry. Concurrent opens share one promise.
async function open(t, id) {
  const key = `${t.type}:${id}`;
  if (entries.has(key)) {
    const entry = entries.get(key);
    await entry.loading;
    return entry;
  }
  const doc = new Y.Doc();
  const entry = { key, t, id, doc, awareness: new awarenessProtocol.Awareness(doc), conns: new Set(), contributors: new Set(), timer: null };
  entry.awareness.setLocalState(null);  // the server itself has no cursor
  entries.set(key, entry);
  entry.loading = (async () => {
    const e = await published(t, id);
    if (!e) throw new Error('entry not found');
    const { rows } = await adminPool.query('SELECT state, base_version, contributors FROM live_docs WHERE entity_type = $1 AND entity_id = $2', [t.type, id]);
    if (rows[0]) {
      Y.applyUpdate(doc, new Uint8Array(rows[0].state), 'load');
      rows[0].contributors.forEach((u) => entry.contributors.add(u));
      if (rows[0].base_version !== e.version) {
        // Saved elsewhere since (revert, import …): take those changes in, keep the unpublished ones (three-way).
        const rb = await rebase(adminPool, t, e, { form: formOf(entry), base_version: rows[0].base_version });
        setForm(entry, rb.form);
        doc.getMap('meta').set('version', e.version);
        entry.rebased = { merged: rb.merged, conflicts: rb.conflicts };
      }
    } else {
      setForm(entry, formKeys(e.doc, t, e.slug), 'load');
      doc.getMap('meta').set('version', e.version);
    }
    // The document's lineage: browsers keep offline edits per epoch, so they never merge into a re-created copy
    // (two independently seeded Yjs documents would each contribute the same text → duplicated content).
    if (!doc.getMap('meta').get('epoch')) doc.getMap('meta').set('epoch', crypto.randomUUID());
    // Every change from now on: relay to the other editors, persist soon.
    doc.on('update', (update, origin) => {
      for (const conn of entry.conns) if (conn !== origin) conn.send({ t: 'doc-update', update: b64(update) });
      if (origin && origin.user) entry.contributors.add(origin.user.username);
      schedulePersist(entry);
    });
    entry.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin && origin.clientIds) [...added, ...updated].forEach((id2) => origin.clientIds.add(id2));
      const update = b64(awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...added, ...updated, ...removed]));
      for (const conn of entry.conns) if (conn !== origin) conn.send({ t: 'awareness', update });
    });
    if (entry.rebased) await persist(entry);
  })();
  try {
    await entry.loading;
  } catch (err) {
    entries.delete(key);
    throw err;
  }
  return entry;
}

function schedulePersist(entry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => persist(entry).catch((err) => console.error('collab persist failed', err)), 1500);
}

async function persist(entry) {
  clearTimeout(entry.timer);
  const e = await published(entry.t, entry.id);
  if (!e) return;
  const current = formKeys(e.doc, entry.t, e.slug);
  const form = formOf(entry);
  const dirty = Object.keys({ ...current, ...form }).some((k) => k !== 'version' && String(form[k] ?? '') !== String(current[k] ?? ''));
  if (!dirty) entry.contributors.clear();
  await adminPool.query(`
    INSERT INTO live_docs (entity_type, entity_id, state, base_version, dirty, contributors, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (entity_type, entity_id) DO UPDATE
      SET state = EXCLUDED.state, base_version = EXCLUDED.base_version, dirty = EXCLUDED.dirty,
          contributors = EXCLUDED.contributors, updated_at = now()`,
  [entry.t.type, entry.id, Buffer.from(Y.encodeStateAsUpdate(entry.doc)), form.version, dirty, [...entry.contributors]]);
}

// A connection (live.js) joins: send what it lacks (by its state vector) and everyone's cursors.
async function join(conn, t, id, sv) {
  const entry = await open(t, id);
  entry.conns.add(conn);
  conn.entry = entry;
  conn.clientIds = new Set();
  conn.send({
    t: 'doc-sync',
    update: b64(Y.encodeStateAsUpdate(entry.doc, sv ? fromB64(sv) : undefined)),
    sv: b64(Y.encodeStateVector(entry.doc)),
    awareness: b64(awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...entry.awareness.getStates().keys()])),
    rebased: entry.rebased || null,
  });
  entry.rebased = null;
}

function update(conn, update) {
  if (conn.entry) Y.applyUpdate(conn.entry.doc, fromB64(update), conn);
}

function awareness(conn, update) {
  if (conn.entry) awarenessProtocol.applyAwarenessUpdate(conn.entry.awareness, fromB64(update), conn);
}

// A connection leaves (closed, or navigated): drop its cursors; the last one out persists and unloads the copy.
async function leave(conn) {
  const entry = conn.entry;
  if (!entry) return;
  conn.entry = null;
  entry.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(entry.awareness, [...conn.clientIds], 'leave');
  if (!entry.conns.size) {
    await persist(entry);
    if (!entry.conns.size) { entry.doc.destroy(); entries.delete(entry.key); }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks for the admin routes
// ---------------------------------------------------------------------------------------------------------------
// For the edit page: the working copy's form values (shown even before scripts run), its epoch, and its whole state
// (base64) — the browser starts from exactly this document, so it can edit at once, even offline, and sync later.
async function currentForm(t, id) {
  const entry = await open(t, id);
  const form = formOf(entry);
  const epoch = entry.doc.getMap('meta').get('epoch');
  const state = b64(Y.encodeStateAsUpdate(entry.doc));
  if (!entry.conns.size) {
    await persist(entry);
    if (!entry.conns.size) { entry.doc.destroy(); entries.delete(entry.key); }  // someone may have joined meanwhile
  }
  return { form, epoch, state };
}

// After a successful publish: the copy is now based on the new version (and equals the published entry).
async function publishedNow(t, id, by) {
  const entry = await open(t, id);
  const e = await published(t, id);
  entry.doc.transact(() => {
    setForm(entry, formKeys(e.doc, t, e.slug));  // normally a no-op; picks up normalisation done on save
    entry.doc.getMap('meta').set('version', e.version);
  }, 'server');
  entry.contributors.clear();
  for (const conn of entry.conns) conn.send({ t: 'doc-published', by, at: new Date().toISOString() });
  await persist(entry);
  if (!entry.conns.size) { entry.doc.destroy(); entries.delete(entry.key); }
}

// The entry changed outside the working copy (revert, restore …): rebase open copies now, others on next open.
async function changedElsewhere(t, id) {
  const key = `${t.type}:${id}`;
  if (!entries.has(key)) return;
  const entry = entries.get(key);
  const e = await published(t, id);
  if (!e) return gone(t, id);
  const rb = await rebase(adminPool, t, e, { form: formOf(entry), base_version: entry.doc.getMap('meta').get('version') });
  entry.doc.transact(() => { setForm(entry, rb.form); entry.doc.getMap('meta').set('version', e.version); }, 'server');
  for (const conn of entry.conns) conn.send({ t: 'doc-rebased', merged: rb.merged, conflicts: rb.conflicts });
  await persist(entry);
}

// Throw away the unpublished changes: back to the published entry, for everyone.
async function discard(t, id) {
  const entry = await open(t, id);
  const e = await published(t, id);
  entry.doc.transact(() => { setForm(entry, formKeys(e.doc, t, e.slug)); entry.doc.getMap('meta').set('version', e.version); }, 'server');
  entry.contributors.clear();
  await persist(entry);
  if (!entry.conns.size) { entry.doc.destroy(); entries.delete(entry.key); }
}

// The entry was deleted: close the copy for everyone.
async function gone(t, id) {
  const key = `${t.type}:${id}`;
  const entry = entries.get(key);
  if (entry) {
    for (const conn of entry.conns) { conn.send({ t: 'doc-gone' }); conn.entry = null; }
    entry.doc.destroy();
    entries.delete(key);
  }
  await adminPool.query('DELETE FROM live_docs WHERE entity_type = $1 AND entity_id = $2', [t.type, id]);
}

// Persist everything (pm2 reload).
async function flush() {
  await Promise.allSettled([...entries.values()].map((e) => persist(e)));
}

async function unpublished(t, id) {
  const { rows } = await adminPool.query('SELECT contributors, updated_at FROM live_docs WHERE entity_type = $1 AND entity_id = $2 AND dirty', [t.type, id]);
  return rows[0] || null;
}

module.exports = { join, update, awareness, leave, currentForm, publishedNow, changedElsewhere, discard, gone, flush, unpublished };
