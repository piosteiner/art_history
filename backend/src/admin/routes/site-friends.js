// Friends and chat on the site (migration 224, owner 2026-11-05). Mounted under /site/friends by routes/site-account.js
// — the site's origin only, writes as form posts, the session's account in every query. People are shown by their
// public name only (never the login name); an account without a public name is asked for one before it may send a
// request or a message.
//   GET  /site/friends                      {me: {public_name, friend_code}, people: [person], unread}
//        person = {id, name, status: friend | sent | received | none | blocked, sets: [{id, name}], unread, last_at}
//        — everyone the account works with (the owners and editors of its sets) and everyone it has a friendship or
//        request with; the site groups them by set or lists them A–Z
//   POST /site/friends/request              account (an id from the list) | code (a friend link) → {status}
//   POST /site/friends/accept | decline | remove | withdraw   account → 204
//   POST /site/friends/block | unblock      account → 204 — a block ends the friendship and stops requests and messages
//   POST /site/friends/code                 new=1 → {friend_code} (a new one ends the old link)
//   GET  /site/friends/link/:code           {name, status} — whose friend link it is (logged in)
//   GET  /site/friends/chat/:id?before=     {friend: {id, name}, messages: [{id, mine, body, at, read}], more} — newest 50;
//                                           marks theirs read
//   POST /site/friends/chat/:id             body → {message}   (friends only)
//   POST /site/friends/chat/:id/delete      message=<id> (one's own: gone for both) | all=1 (the conversation, for oneself)
//   POST /site/friends/chat/:id/report      note → 201 — a copy of the last 100 messages to the admins
//   GET  /site/friends/events               text/event-stream: `message` {from, id} and `read` {by} as they happen;
//                                           `friend` {} when a request between the account and someone changed
// The stream: Postgres NOTIFY chat (a trigger on chat_messages) → this process LISTENs on a connection of its own →
// the open streams of the two accounts get an event. One process today; with several, each would LISTEN the same way.
const crypto = require('node:crypto');
const express = require('express');
const { Client } = require('pg');
const { adminPool } = require('../../db');
const config = require('../../config');

const router = express.Router();
const ID = /^[1-9][0-9]{0,17}$/;
const CODE = /^[A-Za-z0-9_-]{12}$/;
const MAX_BODY = 4000;
const PAGE = 50;
const fail = (res, status, error) => res.status(status).json({ error });
const newCode = () => crypto.randomBytes(9).toString('base64url');
const pair = (a, b) => (BigInt(a) < BigInt(b) ? [String(a), String(b)] : [String(b), String(a)]);
const ALIVE = (alias) => `${alias}.deleted_at IS NULL AND ${alias}.disabled_at IS NULL`;

router.use((req, res, next) => (req.user ? (res.set('Cache-Control', 'no-store'), next()) : fail(res, 401, 'not_logged_in')));

/** The other account by id, alive and with a public name, with the relation to the viewer — or null. */
async function other(req, id) {
  if (!ID.test(String(id || '')) || String(id) === String(req.user.id)) return null;
  const [lo, hi] = pair(req.user.id, id);
  const { rows: [o] } = await adminPool.query(`SELECT u.id::text AS id, u.public_name AS name,
      f.accepted_at, f.requested_by::text AS requested_by,
      EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS i_blocked,
      EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $2) AS blocked_me
    FROM admin_users u LEFT JOIN friendships f ON (f.low_id, f.high_id) = ($3::bigint, $4::bigint)
    WHERE u.id = $1 AND ${ALIVE('u')} AND u.public_name IS NOT NULL AND NOT u.test_env`, [id, req.user.id, lo, hi]);
  return o || null;
}
const statusOf = (o, me) => (o.i_blocked ? 'blocked' : o.accepted_at ? 'friend' : o.requested_by ? (o.requested_by === String(me) ? 'sent' : 'received') : 'none');
const needName = (req, res) => (req.user.public_name ? false : (fail(res, 422, 'others see your public name — choose one on “Your account” first'), true));

router.get('/', async (req, res) => {
  const me = req.user.id;
  let { rows: [mine] } = await adminPool.query('SELECT public_name, friend_code FROM admin_users WHERE id = $1', [me]);
  if (!mine.friend_code) {
    ({ rows: [mine] } = await adminPool.query('UPDATE admin_users SET friend_code = $2 WHERE id = $1 RETURNING public_name, friend_code', [me, newCode()]));
  }
  // everyone the account works with: owners and editors of its sets (its own and those it edits), with those sets
  const { rows } = await adminPool.query(`
    WITH my_sets AS (
      SELECT s.id, s.name, s.owner_id FROM study_sets s
      WHERE s.owner_id = $1 OR EXISTS (SELECT 1 FROM study_set_members e WHERE e.set_id = s.id AND e.account_id = $1)),
    co AS (
      SELECT ms.owner_id AS who, ms.id, ms.name FROM my_sets ms
      UNION SELECT e.account_id, ms.id, ms.name FROM my_sets ms JOIN study_set_members e ON e.set_id = ms.id),
    rel AS (
      SELECT CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END AS who FROM friendships f WHERE $1 IN (f.low_id, f.high_id)
      UNION SELECT blocked_id FROM account_blocks WHERE blocker_id = $1),
    people AS (SELECT who FROM co UNION SELECT who FROM rel)
    SELECT u.id::text AS id, u.public_name AS name, f.accepted_at, f.requested_by::text AS requested_by,
      EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = u.id) AS i_blocked,
      coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', co.id::text, 'name', co.name)) FROM co WHERE co.who = u.id), '[]') AS sets,
      (SELECT count(*)::int FROM chat_messages m WHERE m.sender_id = u.id AND m.recipient_id = $1 AND m.read_at IS NULL AND NOT m.hidden_for_recipient) AS unread,
      (SELECT max(m.sent_at) FROM chat_messages m WHERE (m.sender_id, m.recipient_id) IN ((u.id, $1), ($1, u.id))) AS last_at
    FROM people p JOIN admin_users u ON u.id = p.who
    LEFT JOIN friendships f ON (f.low_id, f.high_id) = (least(u.id, $1), greatest(u.id, $1))
    WHERE u.id <> $1 AND ${ALIVE('u')} AND u.public_name IS NOT NULL AND NOT u.test_env
    ORDER BY lower(u.public_name)`, [me]);
  const people = rows.map((o) => ({ id: o.id, name: o.name, status: statusOf(o, me), sets: o.sets, unread: o.unread, last_at: o.last_at }));
  res.json({ me: mine, people, unread: people.reduce((n, p) => n + p.unread, 0) });
});

// a request: to someone from the list, or by their friend link; a request the other way already open = accepted
router.post('/request', async (req, res) => {
  if (needName(req, res)) return;
  let id = req.body.account;
  if (req.body.code !== undefined) {
    if (!CODE.test(String(req.body.code))) return fail(res, 404, 'not_found');
    const { rows: [u] } = await adminPool.query('SELECT id::text AS id FROM admin_users WHERE friend_code = $1', [req.body.code]);
    id = u ? u.id : null;
  }
  const o = await other(req, id);
  if (!o) return fail(res, 404, 'not_found');
  if (o.i_blocked || o.blocked_me) return fail(res, 403, 'not possible');
  const status = statusOf(o, req.user.id);
  if (status === 'friend' || status === 'sent') return res.json({ status });
  const [lo, hi] = pair(req.user.id, o.id);
  if (status === 'received') {
    await adminPool.query('UPDATE friendships SET accepted_at = now() WHERE (low_id, high_id) = ($1, $2)', [lo, hi]);
    friendsChanged(req.user.id, o.id);
    return res.json({ status: 'friend' });
  }
  const { rows: [{ n }] } = await adminPool.query(`SELECT count(*)::int AS n FROM friendships WHERE requested_by = $1 AND accepted_at IS NULL
    AND requested_at > now() - interval '1 day'`, [req.user.id]);
  if (n >= 30) return fail(res, 429, 'at most 30 open requests a day');
  await adminPool.query('INSERT INTO friendships (low_id, high_id, requested_by) VALUES ($1, $2, $3)', [lo, hi, req.user.id]);
  friendsChanged(req.user.id, o.id);
  res.status(201).json({ status: 'sent' });
});

const relation = (sql) => async (req, res) => {
  const o = await other(req, req.body.account);
  if (!o) return fail(res, 404, 'not_found');
  const [lo, hi] = pair(req.user.id, o.id);
  await adminPool.query(sql, [lo, hi, req.user.id]);
  friendsChanged(req.user.id, o.id);
  res.status(204).end();
};
router.post('/accept', relation('UPDATE friendships SET accepted_at = now() WHERE (low_id, high_id) = ($1, $2) AND accepted_at IS NULL AND requested_by <> $3'));
router.post('/decline', relation('DELETE FROM friendships WHERE (low_id, high_id) = ($1, $2) AND accepted_at IS NULL AND requested_by <> $3'));
router.post('/withdraw', relation('DELETE FROM friendships WHERE (low_id, high_id) = ($1, $2) AND accepted_at IS NULL AND requested_by = $3'));
router.post('/remove', relation('DELETE FROM friendships WHERE (low_id, high_id) = ($1, $2) AND $3 IN (low_id, high_id)'));

router.post('/block', async (req, res) => {
  const o = await other(req, req.body.account);
  if (!o) return fail(res, 404, 'not_found');
  const [lo, hi] = pair(req.user.id, o.id);
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO account_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, o.id]);
    await client.query('DELETE FROM friendships WHERE (low_id, high_id) = ($1, $2)', [lo, hi]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  friendsChanged(req.user.id, o.id);
  res.status(204).end();
});
router.post('/unblock', async (req, res) => {
  if (!ID.test(String(req.body.account || ''))) return fail(res, 404, 'not_found');
  await adminPool.query('DELETE FROM account_blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, req.body.account]);
  res.status(204).end();
});

router.post('/code', async (req, res) => {
  const { rows: [u] } = await adminPool.query('UPDATE admin_users SET friend_code = $2 WHERE id = $1 RETURNING friend_code', [req.user.id, newCode()]);
  res.json(u);
});
router.get('/link/:code', async (req, res) => {
  if (!CODE.test(req.params.code)) return fail(res, 404, 'not_found');
  const { rows: [u] } = await adminPool.query(`SELECT id::text AS id FROM admin_users u WHERE friend_code = $1 AND ${ALIVE('u')}`, [req.params.code]);
  if (!u) return fail(res, 404, 'not_found');
  if (u.id === String(req.user.id)) return res.json({ name: req.user.public_name, status: 'me' });
  const o = await other(req, u.id);
  if (!o) return fail(res, 404, 'not_found');
  res.json({ name: o.name, status: o.blocked_me ? 'none' : statusOf(o, req.user.id) });
});

// ---- chat between friends ------------------------------------------------------------------------------------------
async function friend(req, res) {
  const o = await other(req, req.params.id);
  if (!o || !o.accepted_at) { fail(res, 404, 'not friends'); return null; }
  return o;
}
router.get('/chat/:id', async (req, res) => {
  const o = await friend(req, res);
  if (!o) return;
  const before = ID.test(String(req.query.before || '')) ? req.query.before : null;
  const { rows } = await adminPool.query(`SELECT id::text AS id, sender_id = $1 AS mine, body, sent_at AS at, read_at IS NOT NULL AS read
    FROM chat_messages m
    WHERE least(sender_id, recipient_id) = least($1::bigint, $2::bigint) AND greatest(sender_id, recipient_id) = greatest($1::bigint, $2::bigint)
      AND NOT CASE WHEN sender_id = $1 THEN hidden_for_sender ELSE hidden_for_recipient END
      AND ($3::bigint IS NULL OR id < $3)
    ORDER BY id DESC LIMIT ${PAGE + 1}`, [req.user.id, o.id, before]);
  await adminPool.query('UPDATE chat_messages SET read_at = now() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL', [o.id, req.user.id]);
  res.json({ friend: { id: o.id, name: o.name }, messages: rows.slice(0, PAGE).reverse(), more: rows.length > PAGE });
});

router.post('/chat/:id', async (req, res) => {
  if (needName(req, res)) return;
  const o = await friend(req, res);
  if (!o) return;
  if (o.blocked_me) return fail(res, 403, 'not possible');
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
  if (!body) return fail(res, 422, 'an empty message');
  if (body.length > MAX_BODY) return fail(res, 422, `at most ${MAX_BODY} characters`);
  const { rows: [{ n }] } = await adminPool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE sender_id = $1 AND sent_at > now() - interval '1 minute'`, [req.user.id]);
  if (n >= 30) return fail(res, 429, 'slow down a little');
  const { rows: [m] } = await adminPool.query(`INSERT INTO chat_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)
    RETURNING id::text AS id, true AS mine, body, sent_at AS at, false AS read`, [req.user.id, o.id, body]);
  res.status(201).json({ message: m });
});

router.post('/chat/:id/delete', async (req, res) => {
  const o = await other(req, req.params.id);
  if (!o) return fail(res, 404, 'not_found');
  if (req.body.all === '1') {
    // the whole conversation, for this account; a message both have hidden is gone
    await adminPool.query(`UPDATE chat_messages SET hidden_for_sender = hidden_for_sender OR sender_id = $1,
        hidden_for_recipient = hidden_for_recipient OR recipient_id = $1
      WHERE (sender_id, recipient_id) IN (($1, $2), ($2, $1))`, [req.user.id, o.id]);
    await adminPool.query('DELETE FROM chat_messages WHERE (sender_id, recipient_id) IN (($1, $2), ($2, $1)) AND hidden_for_sender AND hidden_for_recipient', [req.user.id, o.id]);
  } else if (ID.test(String(req.body.message || ''))) {
    await adminPool.query('DELETE FROM chat_messages WHERE id = $1 AND sender_id = $2 AND recipient_id = $3', [req.body.message, req.user.id, o.id]);
  } else return fail(res, 422, 'which message?');
  res.status(204).end();
});

router.post('/chat/:id/report', async (req, res) => {
  const o = await other(req, req.params.id);
  if (!o) return fail(res, 404, 'not_found');
  const { rows } = await adminPool.query(`SELECT CASE WHEN sender_id = $1 THEN 'reporter' ELSE 'reported' END AS "from", sent_at AS at, body
    FROM chat_messages WHERE (sender_id, recipient_id) IN (($1, $2), ($2, $1)) ORDER BY id DESC LIMIT 100`, [req.user.id, o.id]);
  await adminPool.query(`INSERT INTO chat_reports (reporter_id, reported_id, reporter, reported, note, messages) VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.id, o.id, req.user.public_name || req.user.username, o.name, String(req.body.note || '').trim().slice(0, 1000) || null, JSON.stringify(rows.reverse())]);
  res.status(201).json({ ok: true });
});

// ---- the live stream -----------------------------------------------------------------------------------------------
const streams = new Map();   // account id → Set of responses
router.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const id = String(req.user.id);
  if (!streams.has(id)) streams.set(id, new Set());
  streams.get(id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); streams.get(id)?.delete(res); if (!streams.get(id)?.size) streams.delete(id); });
  listen();
});
// requests made, accepted, declined, withdrawn: both accounts' open pages count their open requests again (the header's dot)
function friendsChanged(...accounts) { for (const a of accounts) send(String(a), 'friend', {}); }
const send = (account, event, data) => {
  for (const res of streams.get(String(account)) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

let listener = null;
function listen() {
  if (listener) return;
  const client = new Client({ connectionString: config.db.adminUrl, application_name: 'arthistory-chat' });
  listener = client;
  client.on('notification', (n) => {
    try {
      const m = JSON.parse(n.payload);
      if (m.kind === 'message') send(m.to, 'message', { from: String(m.from), id: String(m.id) });
      else if (m.kind === 'read') send(m.from, 'read', { by: String(m.to) });
      else if (m.kind === 'set') {
        // a set's chat (225): its owner and the members allowed in it (228: editors, viewers the owner allows) still in the chat
        adminPool.query(`SELECT s.owner_id::text AS id FROM study_sets s WHERE s.id = $1
            UNION SELECT e.account_id::text FROM study_set_members e WHERE e.set_id = $1 AND (e.rights <> 'view' OR e.chat)
              AND NOT EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = e.set_id AND x.account_id = e.account_id)`, [m.set])
          .then(({ rows }) => { for (const r of rows) send(r.id, 'set', { set: String(m.set), id: String(m.id) }); }).catch(() => {});
      }
    } catch { /* a malformed notice: ignored */ }
  });
  const again = () => { if (listener === client) listener = null; if (streams.size) setTimeout(listen, 5000).unref(); };
  client.on('error', () => client.end().catch(() => {}));
  client.on('end', again);
  client.connect().then(() => client.query('LISTEN chat')).catch(() => client.end().catch(() => {}));
}

module.exports = router;
