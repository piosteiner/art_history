// Live connection (browser side of src/admin/live.js): presence and continuously saved drafts.
//
// <body data-live data-page-type data-page-slug data-page-mode> says where we are. On edit/new pages the form
// (form[data-draft]) is compared every 1.5 s with what was last sent — that also catches values set by scripts
// (Markdown editor, map picker, pickers), which fire no input events — and changes are sent as a draft.
// Offline, the latest state is kept in localStorage and sent when the connection is back.

const RETRY = [500, 1000, 2000, 4000, 8000, 15000];

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Returns the connection for other modules (collab.js): { send, on(type, fn), onOpen(fn), isOpen, username, setStatus,
// enableDrafts(form) }. onOpen handlers run after every (re)connect, right after "hello".
export function initLive() {
  const body = document.body;
  if (!body.dataset.live || !('WebSocket' in window)) return null;
  const listeners = {};
  const openHandlers = [];
  let username = null;
  const page = body.dataset.pageType
    ? { type: body.dataset.pageType, slug: body.dataset.pageSlug || null, mode: body.dataset.pageMode || 'view' }
    : null;
  let form = document.querySelector('form[data-draft]');
  const focusForm = document.querySelector('form[data-draft], form[data-collab]');
  const storeKey = page && `ah-draft:${page.type}:${page.slug || 'new'}`;

  // --- status indicator & presence bar ------------------------------------------------------------------------
  const status = el('div', 'live-status');
  status.setAttribute('role', 'status');
  document.body.append(status);
  const setStatus = (text, kind = '') => { status.textContent = text; status.className = `live-status ${kind}`; };
  const bar = el('div', 'presence-bar');
  bar.hidden = true;
  document.querySelector('main')?.prepend(bar);

  // --- form snapshots -------------------------------------------------------------------------------------------
  const snapshot = () => JSON.stringify(Object.fromEntries([...new FormData(form)].filter(([, v]) => typeof v === 'string')));
  let initial = null;
  let lastSent = null;
  let submitting = false;
  let seq = 0;
  const safeStore = (fn) => { try { return fn(window.localStorage); } catch { return null; } };

  let ws = null;
  let attempt = 0;
  const isOpen = () => ws && ws.readyState === WebSocket.OPEN;
  const send = (msg) => { if (isOpen()) ws.send(JSON.stringify(msg)); };

  function sendDraft(snap) {
    lastSent = snap;
    if (!isOpen()) {  // keep it until we are back
      safeStore((s) => s.setItem(storeKey, JSON.stringify({ snap, at: Date.now() })));
      setStatus('Offline — your changes are kept in this browser and saved when the connection is back', 'warn');
      return;
    }
    seq += 1;
    send(snap === initial ? { t: 'discard', seq } : { t: 'draft', form: JSON.parse(snap), seq });
  }

  function enableDrafts(f) {
    form = f;
    // Baseline right away: the enhancements that ran before this (Markdown editor, pickers) and the map picker (loaded
    // later) never change form values when they start — and a fast typist must not end up in the baseline.
    (() => {
      initial = snapshot();
      lastSent = initial;
      // Changes made while offline in an earlier visit (browser closed before they could be sent)?
      const pending = safeStore((s) => JSON.parse(s.getItem(storeKey) || 'null'));
      if (pending && pending.snap !== initial) lastSent = null;  // → sent on connect
      setInterval(() => {
        if (submitting) return;
        const snap = snapshot();
        if (snap !== lastSent) sendDraft(snap);
      }, 1500);
    })();
    form.addEventListener('submit', () => {
      submitting = true;  // the server deletes the draft once the save succeeds
      safeStore((s) => s.removeItem(storeKey));
    });
  }
  if (form && page && page.mode !== 'view') enableDrafts(form);

  // Which field am I in? (label text, e.g. "Biography") — on draft and working-copy forms
  if (focusForm) {
    let blurTimer = null;
    focusForm.addEventListener('focusin', (e) => {
      clearTimeout(blurTimer);
      const label = e.target.closest('.field')?.querySelector('label');
      send({ t: 'focus', field: label ? label.textContent.trim() : null });
    });
    focusForm.addEventListener('focusout', () => { blurTimer = setTimeout(() => send({ t: 'focus', field: null }), 300); });
  }

  // --- presence -------------------------------------------------------------------------------------------------
  function showPresence(here, all) {
    bar.textContent = '';
    bar.hidden = !here.length;
    if (here.length) {
      bar.append(el('span', 'muted', 'Also here: '));
      here.forEach((u, i) => {
        if (i) bar.append(', ');
        bar.append(el('b', '', u.user), ` ${u.mode}${u.field ? ` · in ${u.field}` : ''}`);
      });
    }
    // Field tags on the form
    document.querySelectorAll('.presence-tag').forEach((t) => t.remove());
    for (const u of here) {
      if (!u.field) continue;
      const label = [...document.querySelectorAll('form[data-draft] .field > label, form[data-collab] .field > label')].find((l) => l.textContent.trim() === u.field);
      if (label) label.append(el('span', 'tag presence-tag', `${u.user} is here`));
    }
    // Badges in lists and elsewhere: links to entries others are on
    document.querySelectorAll('.presence-badge').forEach((b) => b.remove());
    for (const [path, users] of Object.entries(all)) {
      if (!/^\/[a-z]+\/[a-z0-9-]+$/.test(path)) continue;  // "/artists/vincent-van-gogh": safe inside the selector
      document.querySelectorAll(`main a[href="${path}"]`).forEach((a) => {
        if (a.closest('.presence-bar')) return;
        const editing = users.filter((u) => u.mode === 'editing');
        a.after(el('span', `tag presence-badge${editing.length ? ' editing' : ''}`,
          `${users.map((u) => u.user).join(', ')} ${editing.length ? 'editing' : 'viewing'}`));
      });
    }
  }

  // --- connection -----------------------------------------------------------------------------------------------
  function connect() {
    setStatus(attempt ? 'Reconnecting…' : 'Connecting…', 'muted');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
    ws.addEventListener('open', () => {
      attempt = 0;
      setStatus('Live', 'ok');
      send({ t: 'hello', page });
      openHandlers.forEach((fn) => fn());
      if (form && initial !== null && !submitting) {
        const pending = safeStore((s) => JSON.parse(s.getItem(storeKey) || 'null'));
        const snap = pending ? pending.snap : snapshot();
        if (snap !== initial) { lastSent = null; sendDraft(snap); }
      }
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      (listeners[msg.t] || []).forEach((fn) => fn(msg));
      if (msg.t === 'welcome') username = msg.user;
      else if (msg.t === 'presence') showPresence(msg.here || [], msg.all || {});
      else if (msg.t === 'saved') {
        safeStore((s) => s.removeItem(storeKey));
        setStatus(msg.at ? `Draft saved ${new Date(msg.at).toLocaleTimeString()}` : 'No unsaved changes', 'ok');
      } else if (msg.t === 'error') setStatus(msg.message, 'warn');
    });
    ws.addEventListener('close', (e) => {
      if (e.code === 1008 || e.code === 4401) { setStatus('Not logged in — reload the page', 'warn'); return; }
      (listeners.close || []).forEach((fn) => fn());
      setStatus(page && page.mode !== 'view' ? 'Offline — your changes are kept in this browser' : 'Offline — reconnecting…', 'warn');
      const wait = e.code === 1012 ? 500 : RETRY[Math.min(attempt, RETRY.length - 1)];
      attempt += 1;
      setTimeout(connect, wait);
    });
  }
  connect();
  return {
    send,
    isOpen,
    setStatus,
    enableDrafts,
    get username() { return username; },
    on(type, fn) { (listeners[type] ||= []).push(fn); },
    onOpen(fn) { openHandlers.push(fn); if (isOpen()) fn(); },
  };
}
