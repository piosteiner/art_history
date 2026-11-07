// The site's study sets — a set's chat (225): switched on by the owner; its owner and editors (and the viewers the
// owner allows, 228) write in it, friends or not; the owner removes members and deletes messages; hiding (226) and
// reports. Split from site-sets.js on 2026-11-07. `shared`: what site-sets.js lends this file.
const express = require('express');

module.exports = (shared) => {
  const { CHATTER, ID, adminPool, fail, ownSet, ownerOnly, settleSet, text } = shared;
  const router = express.Router();

  // ---- the set's chat (225): its owner and editors (and the viewers the owner allows, 228), whether friends or not; the owner switches it on, removes members
  // and deletes messages — the others see "<name> removed" / "message deleted by the owner of the set"
  //   POST /:id/chat/switch   owner: on=1|0
  //   GET  /:id/chat?before=  {on, messages: [{id, kind, by, by_id, mine, body, at, deleted}], members: [{id, name, owner, removed, me}], more}
  //   POST /:id/chat          body
  //   POST /:id/chat/delete   message — the owner any, an author their own
  //   POST /:id/chat/remove | readmit   owner: account
  //   POST /:id/chat/report   message | account, note → a copy for the admins (CMS → Accounts → Reports)
  const CHAT_PAGE = 60;
  async function chatMember(req, res) {
    const set = await ownSet(req);
    if (!set) { fail(res, 404, 'not_found'); return null; }
    if (!set.chat_allowed) { fail(res, 403, 'the owner has not opened the set\'s chat to viewers — ask them'); return null; }
    const { rows: [r] } = await adminPool.query(`SELECT s.chat_on, EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = $2) AS removed
      FROM study_sets s WHERE s.id = $1`, [set.id, req.user.id]);
    Object.assign(set, { chat_on: r.chat_on, removed: r.removed });
    return set;
  }
  const owns = (set) => set.role === 'owner';
  router.post('/:id/chat/switch', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set || ownerOnly(res, set)) return;
    await adminPool.query('UPDATE study_sets SET chat_on = $2 WHERE id = $1', [set.id, req.body.on === '1']);
    res.json({ on: req.body.on === '1' });
  });
  router.get('/:id/chat', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set) return;
    const members = (await adminPool.query(`SELECT u.id::text AS id, u.public_name AS name, u.id = s.owner_id AS owner, u.id = $2 AS me,
        EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = u.id) AS removed,
        EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $2 AND h.hidden_id = u.id) AS hidden,
        EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked
      FROM study_sets s JOIN admin_users u ON u.id = s.owner_id OR u.id IN (SELECT e.account_id FROM study_set_members e WHERE e.set_id = s.id AND ${CHATTER('e')})
      WHERE s.id = $1 ORDER BY u.id = s.owner_id DESC, lower(u.public_name)`, [set.id, req.user.id])).rows;
    if (!set.chat_on || (set.removed && !owns(set))) return res.json({ on: set.chat_on, removed: set.removed, messages: [], members: owns(set) ? members : [], more: false });
    const before = ID.test(String(req.query.before || '')) ? req.query.before : null;
    const { rows } = await adminPool.query(`SELECT m.id::text AS id, m.kind, m.sender_id::text AS by_id, m.sender_id = $2 AS mine,
        (SELECT u.public_name FROM admin_users u WHERE u.id = m.sender_id) AS by,
        CASE WHEN m.deleted_at IS NULL THEN m.body END AS body, m.sent_at AS at,
        CASE WHEN m.deleted_at IS NULL THEN NULL WHEN m.deleted_by_owner THEN 'owner' ELSE 'author' END AS deleted,
        CASE WHEN EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = m.sender_id) THEN 'blocked'
             WHEN EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = m.set_id AND h.hider_id = $2 AND h.hidden_id = m.sender_id) THEN 'hidden' END AS hidden
      FROM set_chat_messages m WHERE m.set_id = $1 AND ($3::bigint IS NULL OR m.id < $3) ORDER BY m.id DESC LIMIT ${CHAT_PAGE + 1}`, [set.id, req.user.id, before]);
    if (rows[0]) await adminPool.query(`INSERT INTO set_chat_reads (set_id, account_id, last_read_id) VALUES ($1, $2, $3)
      ON CONFLICT (set_id, account_id) DO UPDATE SET last_read_id = greatest(set_chat_reads.last_read_id, EXCLUDED.last_read_id)`, [set.id, req.user.id, rows[0].id]);
    res.json({ on: true, removed: false, messages: rows.slice(0, CHAT_PAGE).reverse(), members, more: rows.length > CHAT_PAGE });
  });
  router.post('/:id/chat', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set) return;
    if (!set.chat_on) return fail(res, 422, 'the chat of this set is off');
    if (set.removed) return fail(res, 403, 'the owner removed you from this chat');
    if (!req.user.public_name) return fail(res, 422, 'the others see your public name — choose one on “Your account” first');
    const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
    if (!body || body.length > 4000) return fail(res, 422, body ? 'at most 4000 characters' : 'an empty message');
    const { rows: [{ n }] } = await adminPool.query(`SELECT count(*)::int AS n FROM set_chat_messages WHERE sender_id = $1 AND sent_at > now() - interval '1 minute'`, [req.user.id]);
    if (n >= 30) return fail(res, 429, 'slow down a little');
    const { rows: [m] } = await adminPool.query(`INSERT INTO set_chat_messages (set_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id::text AS id`, [set.id, req.user.id, body]);
    res.status(201).json({ id: m.id });
  });
  router.post('/:id/chat/delete', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set) return;
    if (!ID.test(String(req.body.message || ''))) return fail(res, 422, 'which message?');
    const { rowCount } = await adminPool.query(`UPDATE set_chat_messages SET deleted_at = now(), body = NULL, deleted_by_owner = (sender_id IS DISTINCT FROM $3)
      WHERE id = $1 AND set_id = $2 AND kind = 'message' AND deleted_at IS NULL AND ($4 OR sender_id = $3)`, [req.body.message, set.id, req.user.id, owns(set)]);
    if (!rowCount) return fail(res, 403, 'not yours to delete');
    res.status(204).end();
  });
  const readmitOrRemove = (remove) => async (req, res) => {
    const set = await chatMember(req, res);
    if (!set || ownerOnly(res, set)) return;
    const { rows: [u] } = await adminPool.query(`SELECT u.id, u.public_name FROM admin_users u WHERE u.id = $1 AND u.id <> $2
      AND u.id IN (SELECT e.account_id FROM study_set_members e WHERE e.set_id = $3 AND ${CHATTER('e')})`, [ID.test(String(req.body.account || '')) ? req.body.account : 0, req.user.id, set.id]);
    if (!u) return fail(res, 404, 'not a member of this set');
    if (remove) {
      const { rowCount } = await adminPool.query('INSERT INTO set_chat_removed (set_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [set.id, u.id]);
      if (rowCount) await adminPool.query(`INSERT INTO set_chat_messages (set_id, kind, body) VALUES ($1, 'system', $2)`, [set.id, `${u.public_name || 'A member'} removed`]);
    } else {
      const { rowCount } = await adminPool.query('DELETE FROM set_chat_removed WHERE set_id = $1 AND account_id = $2', [set.id, u.id]);
      if (rowCount) await adminPool.query(`INSERT INTO set_chat_messages (set_id, kind, body) VALUES ($1, 'system', $2)`, [set.id, `${u.public_name || 'A member'} is back in the chat`]);
    }
    res.status(204).end();
  };
  router.post('/:id/chat/remove', readmitOrRemove(true));
  // hiding someone in the set's chat (226): only one's own view — nobody is told. Someone the account has blocked (224) is
  // hidden in every set's chat by that alone (owner 2026-11-05) — the block works on the blocker's view only: their own
  // messages stay visible to everyone, the blocked person too
  router.post('/:id/chat/hide', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set) return;
    const id = ID.test(String(req.body.account || '')) && String(req.body.account) !== String(req.user.id) ? req.body.account : null;
    const { rows: [m] } = id ? await adminPool.query(`SELECT 1 FROM study_sets s WHERE s.id = $1 AND (s.owner_id = $2
        OR EXISTS (SELECT 1 FROM study_set_members e WHERE e.set_id = s.id AND e.account_id = $2 AND ${CHATTER('e')}))`, [set.id, id]) : { rows: [] };
    if (!m) return fail(res, 404, 'not a member of this set');
    if (req.body.hide === '0') await adminPool.query('DELETE FROM set_chat_hidden WHERE set_id = $1 AND hider_id = $2 AND hidden_id = $3', [set.id, req.user.id, id]);
    else await adminPool.query('INSERT INTO set_chat_hidden (set_id, hider_id, hidden_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [set.id, req.user.id, id]);
    res.status(204).end();
  });

  // the set's members (226, 228): the owner and everyone else with their rights — for every member; `chat`: may use the
  // set's chat (when it is on)
  router.get('/:id/members', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    const { rows } = await adminPool.query(`SELECT u.id::text AS id, u.public_name AS name,
        CASE WHEN u.id = s.owner_id THEN 'owner' WHEN e.rights = 'view' THEN 'viewer' ELSE 'editor' END AS role,
        CASE WHEN u.id = s.owner_id THEN 'owner' ELSE e.rights::text END AS rights,
        CASE WHEN u.id = s.owner_id THEN s.created_at ELSE e.added_at END AS since, e.via,
        (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id AND i.added_by = u.id) AS added,
        u.id = $2 AS me, s.chat_on AND (u.id = s.owner_id OR e.rights <> 'view' OR e.chat) AS chat, coalesce(e.chat, false) AS chat_allowed,
        EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = u.id) AS removed,
        EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $2 AND h.hidden_id = u.id) AS hidden,
        EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = u.id) AS blocked
      FROM study_sets s JOIN admin_users u ON u.id = s.owner_id OR u.id IN (SELECT x.account_id FROM study_set_members x WHERE x.set_id = s.id)
      LEFT JOIN study_set_members e ON e.set_id = s.id AND e.account_id = u.id
      WHERE s.id = $1 ORDER BY u.id = s.owner_id DESC, e.rights = 'view', lower(u.public_name)`, [set.id, req.user.id]);
    res.json({ members: rows });
  });
  router.post('/:id/chat/readmit', readmitOrRemove(false));
  router.post('/:id/chat/report', async (req, res) => {
    const set = await chatMember(req, res);
    if (!set) return;
    const note = String(req.body.note || '').trim().slice(0, 1000) || null;
    const reporter = req.user.public_name || req.user.username;
    if (ID.test(String(req.body.message || ''))) {
      const { rows: [m] } = await adminPool.query(`SELECT m.sender_id, m.body, m.sent_at, (SELECT u.public_name FROM admin_users u WHERE u.id = m.sender_id) AS name
        FROM set_chat_messages m WHERE m.id = $1 AND m.set_id = $2 AND m.kind = 'message' AND m.deleted_at IS NULL`, [req.body.message, set.id]);
      if (!m) return fail(res, 404, 'no such message');
      await adminPool.query(`INSERT INTO chat_reports (reporter_id, reported_id, reporter, reported, note, messages, kind, set_id, set_name)
        VALUES ($1, $2, $3, $4, $5, $6, 'set_message', $7, $8)`, [req.user.id, m.sender_id, reporter, m.name || '—', note,
        JSON.stringify([{ from: 'reported', at: m.sent_at, body: m.body }]), set.id, set.name]);
    } else if (ID.test(String(req.body.account || ''))) {
      const { rows: [u] } = await adminPool.query('SELECT id, public_name FROM admin_users WHERE id = $1', [req.body.account]);
      if (!u) return fail(res, 404, 'no such member');
      await adminPool.query(`INSERT INTO chat_reports (reporter_id, reported_id, reporter, reported, note, messages, kind, set_id, set_name)
        VALUES ($1, $2, $3, $4, $5, '[]', 'set_user', $6, $7)`, [req.user.id, u.id, reporter, u.public_name || '—', note, set.id, set.name]);
    } else return fail(res, 422, 'a message or a member?');
    res.status(201).json({ ok: true });
  });

  router.post('/:id/leave', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (set.role === 'owner') return fail(res, 422, 'the owner can hand the set to a member or delete it, not leave it');
    await adminPool.query('DELETE FROM study_set_members WHERE set_id = $1 AND account_id = $2', [set.id, req.user.id]);
    await settleSet(set.id);
    res.status(204).end();
  });

  return router;
};
