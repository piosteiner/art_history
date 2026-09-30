// Live connection of the admin panel (WebSocket at /live on the admin host) — step 1 of live collaboration:
//   presence  who else is on which entity, viewing or editing, and in which field
//   drafts    the edit form's unsaved state, saved continuously into admin_drafts (migration 010), so nothing typed
//             is lost when the connection, the browser or the server goes away
// Browser side: src/admin/editor/live.js. Messages are small JSON objects { t: type, … }.
//
// Security: the upgrade is accepted only on the admin host and path, only from the admin site's own Origin (a page on
// another site could otherwise open the socket with our cookie: "cross-site WebSocket hijacking"), and only with a
// valid session. Payloads are size-limited and validated like form posts.
const { WebSocketServer } = require('ws');
const config = require('../config');
const { adminPool } = require('../db');
const { userFromRequest, adminOrigin } = require('./auth');
const { BY_TYPE, SLUG } = require('../content');

const clients = new Set();  // { ws, user: {id, username}, page: {type, slug, id, mode} | null, field, alive }
let wss = null;

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function attach(server) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const host = String(req.headers.host || '').split(':')[0];
      if (new URL(req.url, 'http://x').pathname !== '/live' || host !== config.adminHost) return reject(socket, 404, 'Not Found');
      if (req.headers.origin !== adminOrigin(req)) return reject(socket, 403, 'Forbidden');
      const user = await userFromRequest(req);
      if (!user) return reject(socket, 401, 'Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => connected(ws, user));
    } catch (err) {
      console.error('live upgrade failed', err);
      reject(socket, 500, 'Internal Server Error');
    }
  });
  // Heartbeat: a connection that doesn't answer a ping within 30 s is gone (laptop closed, network lost).
  const beat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, 30000);
  beat.unref();
}

// On shutdown (pm2 reload): tell browsers to reconnect (1012 = service restart) instead of waiting for a timeout.
function close() {
  for (const c of clients) c.ws.close(1012, 'restart');
}

function connected(ws, user) {
  const c = { ws, user, page: null, field: null, alive: true };
  clients.add(c);
  ws.on('pong', () => { c.alive = true; });
  // Strictly in order per connection: after a reconnect the browser sends "hello" and its pending draft back to back,
  // and the draft must not be handled before "hello" (which awaits a lookup) has said which entry it belongs to.
  c.queue = Promise.resolve();
  ws.on('message', (data) => {
    c.queue = c.queue.then(() => handle(c, data)).catch((err) => {
      console.error('live message failed', err);
      send(c, { t: 'error', message: 'The server could not handle that — your changes are still in this page.' });
    });
  });
  ws.on('close', () => { clients.delete(c); broadcastPresence(); });
  send(c, { t: 'welcome', user: user.username });
}

const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };

async function handle(c, data) {
  let msg;
  try { msg = JSON.parse(String(data)); } catch { return; }
  if (msg.t === 'hello') {
    const p = msg.page || {};
    const t = BY_TYPE[p.type];
    let page = null;
    if (t && (p.slug === null || SLUG.test(String(p.slug)))) {
      const id = p.slug ? (await adminPool.query(`SELECT id FROM ${t.table} WHERE slug = $1`, [p.slug])).rows[0]?.id : null;
      if (!p.slug || id) page = { type: t.type, folder: t.folder, slug: p.slug || null, id: id || null, mode: ['edit', 'new'].includes(p.mode) ? p.mode : 'view' };
    }
    c.page = page;
    c.field = null;
    broadcastPresence();
  } else if (msg.t === 'focus') {
    c.field = typeof msg.field === 'string' ? msg.field.slice(0, 60) : null;
    broadcastPresence();
  } else if (msg.t === 'draft' && c.page && c.page.mode !== 'view') {
    const form = msg.form;
    if (!form || typeof form !== 'object' || Array.isArray(form) || !Object.values(form).every((v) => typeof v === 'string')) return;
    const { rows } = await adminPool.query(`
      INSERT INTO admin_drafts (user_id, entity_type, entity_id, form, base_version) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, entity_type, entity_id)
        DO UPDATE SET form = EXCLUDED.form, base_version = EXCLUDED.base_version, updated_at = now()
      RETURNING updated_at`,
    [c.user.id, c.page.type, c.page.id, JSON.stringify(form), form.version || null]);
    send(c, { t: 'saved', at: rows[0].updated_at, seq: msg.seq });
  } else if (msg.t === 'discard' && c.page && c.page.mode !== 'view') {
    await adminPool.query('DELETE FROM admin_drafts WHERE user_id = $1 AND entity_type = $2 AND entity_id IS NOT DISTINCT FROM $3',
      [c.user.id, c.page.type, c.page.id]);
    send(c, { t: 'saved', at: null, seq: msg.seq });
  }
}

// Everyone gets: who else is on *their* page (with the field), and a map of all entity pages with people on them
// (for badges in lists). Several tabs of one user count once, "editing" wins over "viewing"; you never see yourself.
function broadcastPresence() {
  const byPath = new Map();  // '/artists/vincent-van-gogh' → Map(userId → {user, mode, field})
  for (const c of clients) {
    if (!c.page || !c.page.slug) continue;
    const path = `/${c.page.folder}/${c.page.slug}`;
    if (!byPath.has(path)) byPath.set(path, new Map());
    const users = byPath.get(path);
    const prev = users.get(c.user.id);
    const editing = c.page.mode === 'edit';
    if (!prev || (editing && prev.mode !== 'editing') || (c.field && !prev.field)) {
      users.set(c.user.id, { id: c.user.id, user: c.user.username, mode: editing ? 'editing' : (prev ? prev.mode : 'viewing'), field: c.field || (prev && prev.field) || null });
    }
  }
  for (const c of clients) {
    const others = (m) => [...m.values()].filter((u) => u.id !== c.user.id).map(({ user, mode, field }) => ({ user, mode, field }));
    const all = {};
    for (const [path, users] of byPath) {
      const o = others(users);
      if (o.length) all[path] = o;
    }
    const here = c.page && c.page.slug ? all[`/${c.page.folder}/${c.page.slug}`] || [] : [];
    send(c, { t: 'presence', here, all });
  }
}

module.exports = { attach, close };
