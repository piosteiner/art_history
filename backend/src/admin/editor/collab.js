// Shared working copy in the browser (live collaboration step 2; server: src/admin/collab.js).
//
// <form data-collab="artist:12:<epoch>" data-state="<base64 Yjs state>"> — the server embeds the working copy itself,
// so editing starts immediately, even offline. Local changes are kept in IndexedDB (y-indexeddb) and merged when the
// connection is there; Yjs guarantees every replica ends up with the same content.
//   short fields ↔ Y.Map 'form' (last writer wins per field)     Markdown ↔ Y.Text (character-level, live cursors)
//   hidden "version" ← meta.version (so Publish always uses the version the copy is based on)
// Sync: on (re)connect the browser sends its state vector; the server answers with what it lacks plus its own vector,
// and the browser sends back what the server lacks. After that, every update goes both ways as it happens.
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as awarenessProtocol from 'y-protocols/awareness';
import { toBase64, fromBase64 } from 'lib0/buffer';

const COLORS = ['#b0561d', '#2f6f9f', '#7a4bb0', '#2f8f5b', '#b03a5b', '#8a6d1d'];
const colorFor = (name) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

function notice(form, text, kind = 'ok') {
  const p = document.createElement('p');
  p.className = `flash ${kind} collab-notice`;
  p.textContent = text;
  form.before(p);
  setTimeout(() => p.remove(), 12000);
}

export function startCollab(form, live, enhance) {
  const key = form.dataset.collab;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(form.dataset.state), 'remote');  // same lineage as the server's copy
  const awareness = new awarenessProtocol.Awareness(doc);
  const fields = doc.getMap('form');
  const meta = doc.getMap('meta');
  const mdAreas = [...form.querySelectorAll('textarea.md')];
  const mdNames = new Set(mdAreas.map((t) => t.name));
  const inputs = [...form.elements].filter((e) => e.name && !mdNames.has(e.name) && e.name !== 'version' && !['submit', 'button'].includes(e.type));
  const version = form.querySelector('[name="version"]');
  let synced = false;
  let applyingRemote = false;

  // --- network --------------------------------------------------------------------------------------------------
  doc.on('update', (update, origin) => {
    if (origin !== 'remote' && synced && live.isOpen()) live.send({ t: 'doc-update', update: toBase64(update) });
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote' || !live.isOpen()) return;
    live.send({ t: 'awareness', update: toBase64(awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])) });
  });
  live.on('doc-sync', (msg) => {
    Y.applyUpdate(doc, fromBase64(msg.update), 'remote');
    if (msg.awareness) awarenessProtocol.applyAwarenessUpdate(awareness, fromBase64(msg.awareness), 'remote');
    const mine = Y.encodeStateAsUpdate(doc, fromBase64(msg.sv));  // e.g. edits made offline
    synced = true;
    if (mine.length > 2) live.send({ t: 'doc-update', update: toBase64(mine) });
    const name = live.username || 'someone';
    awareness.setLocalStateField('user', { name, color: colorFor(name), colorLight: `${colorFor(name)}33` });
    live.setStatus('Live — shared working copy', 'ok');
    if (msg.rebased && (msg.rebased.merged.length || msg.rebased.conflicts.length)) {
      notice(form, `The entry was changed elsewhere and this working copy was updated${msg.rebased.conflicts.length ? ` — check: ${msg.rebased.conflicts.join(', ')}` : ''}.`, 'error');
    }
  });
  live.on('doc-update', (msg) => Y.applyUpdate(doc, fromBase64(msg.update), 'remote'));
  live.on('awareness', (msg) => awarenessProtocol.applyAwarenessUpdate(awareness, fromBase64(msg.update), 'remote'));
  live.on('doc-published', (msg) => { if (msg.by !== live.username) notice(form, `${msg.by} published the working copy — it is now the public version.`); });
  live.on('doc-rebased', (msg) => notice(form, `The entry was changed elsewhere (e.g. a revert) — this working copy was updated${msg.conflicts.length ? `; check: ${msg.conflicts.join(', ')}` : ''}.`, 'error'));
  live.on('doc-gone', () => {
    notice(form, 'This entry was deleted — the working copy is closed.', 'error');
    form.querySelectorAll('input, textarea, select, button').forEach((e) => { e.disabled = true; });
  });
  live.on('close', () => { synced = false; });

  // --- form ↔ document --------------------------------------------------------------------------------------------
  const setEl = (el, value) => {
    if (el.value === value) return;
    const focused = document.activeElement === el && typeof el.selectionStart === 'number';
    const [start, end] = focused ? [el.selectionStart, el.selectionEnd] : [];
    el.value = value;
    if (focused) el.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));  // keep the caret
  };

  function bind() {
    for (const el of inputs) {
      if (fields.has(el.name)) setEl(el, fields.get(el.name));
      else doc.transact(() => fields.set(el.name, el.value), 'local');  // a field the copy doesn't know yet
      const push = () => {
        if (applyingRemote || fields.get(el.name) === el.value) return;
        doc.transact(() => fields.set(el.name, el.value), 'local');
      };
      el.addEventListener('input', push);
      el.addEventListener('change', push);
    }
    fields.observe((ev) => {
      if (ev.transaction.origin === 'local') return;
      applyingRemote = true;
      for (const k of ev.keysChanged) {
        const el = form.elements[k];
        if (el && !mdNames.has(k)) {
          setEl(el, fields.get(k) ?? '');
          el.dispatchEvent(new Event('change', { bubbles: true }));  // the map picker, pickers … follow
        }
      }
      applyingRemote = false;
    });
    const syncVersion = () => { if (version) version.value = meta.get('version') || version.value; };
    syncVersion();
    meta.observe(syncVersion);
    for (const ta of mdAreas) {
      const ytext = doc.getText(ta.name);
      ta.value = ytext.toString();
      enhance(ta, { ytext, awareness, undoManager: new Y.UndoManager(ytext) });
    }
  }

  // Local offline edits first (IndexedDB), then bind, then join the server's copy.
  const idb = new IndexeddbPersistence(`ah-live:${key}`, doc);
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    bind();
    live.onOpen(() => live.send({ t: 'doc-join', sv: toBase64(Y.encodeStateVector(doc)) }));
  };
  idb.whenSynced.then(start);
  setTimeout(start, 1500);  // IndexedDB unavailable (private mode …): work from the embedded state
  window.addEventListener('beforeunload', () => awareness.setLocalState(null));
}
