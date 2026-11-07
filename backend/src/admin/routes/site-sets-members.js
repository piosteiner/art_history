// The site's study sets — the owner's side (routes/site-sets.js holds the sets themselves and what the files share):
// members, links, invitations and the set's kind of vote (228), its history, restore and lock (221), the proposals
// (228). Split from site-sets.js on 2026-11-07 (1,240 lines in one file before). `shared`: the helpers and constants
// of site-sets.js this file uses — passed in, so the two files don't require each other.
const express = require('express');

module.exports = (shared) => {
  const { ALIVE, ID, MAX_DESCRIPTION, MAX_EDITORS, MAX_SETS, MAX_VIEWERS, RIGHTS, TODAY, adminPool, asUser, countOf, describe, direct, ensurePublicName, entryId, fail, lockedOut, newLinkCode, ownSet, ownerOnly, proposalsOf, propose, proposed, roomFor, settleSet, text, viewerOut } = shared;
  const router = express.Router();

  // ---- members, links, invitations, the set's kind of vote (228) — the owner's ---------------------------------------
  const LINKS_SHOWN = 30;
  router.get('/:id/sharing', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const [{ rows: links }, { rows: invitations }, { rows: friends }] = await Promise.all([
      adminPool.query(`SELECT l.id::text AS id, l.code, l.rights::text AS rights, l.created_at, l.ended_at, l.joined, l.expires_at, l.max_joins,
          l.closed_because AS closed FROM study_set_links l
        WHERE l.set_id = $1 ORDER BY l.usable DESC, l.created_at DESC LIMIT ${LINKS_SHOWN}`, [set.id]),
      adminPool.query(`SELECT i.account_id::text AS id, u.public_name AS name, i.rights::text AS rights, i.chat, i.invited_at
        FROM study_set_invitations i JOIN admin_users u ON u.id = i.account_id WHERE i.set_id = $1 ORDER BY i.invited_at DESC`, [set.id]),
      // friends one may invite: not yet a member, not invited
      adminPool.query(`SELECT u.id::text AS id, u.public_name AS name FROM friendships f
        JOIN admin_users u ON u.id = CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END
        WHERE $1 IN (f.low_id, f.high_id) AND f.accepted_at IS NOT NULL AND u.deleted_at IS NULL AND u.disabled_at IS NULL AND u.public_name IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM study_set_members e WHERE e.set_id = $2 AND e.account_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM study_set_invitations i WHERE i.set_id = $2 AND i.account_id = u.id)
        ORDER BY lower(u.public_name)`, [req.user.id, set.id]),
    ]);
    res.json({ links, invitations, friends, settings: { visibility: set.visibility, vote_mode: set.vote_mode, vote_hours: set.vote_hours, owner_veto: set.owner_veto } });
  });

  /** Sharing with someone makes a private set shared (228) — the owner needs a public name for it. An error text or null. */
  async function shareFirst(req, set) {
    const why = await ensurePublicName(req, 'the members see your public name — choose one first');
    if (why) return why;
    if (set.visibility === 'private') await adminPool.query(`UPDATE study_sets SET visibility = 'shared', shared_at = coalesce(shared_at, now()) WHERE id = $1`, [set.id]);
    return null;
  }

  router.post('/:id/links', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const rights = RIGHTS.includes(req.body.rights) ? req.body.rights : null;
    if (!rights) return fail(res, 422, 'which rights does the link give?');
    // optional (230): the last day it works (YYYY-MM-DD, until midnight in Zurich), at most how many join with it
    const until = String(req.body.expires_on || '').trim();
    if (until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return fail(res, 422, 'a date, please (YYYY-MM-DD)');
      const { rows: [ok] } = await adminPool.query(`SELECT $1::date >= ${TODAY} AND $1::date <= ${TODAY} + 2 * 365 AS fine`, [until]).catch(() => ({ rows: [{ fine: false }] }));
      if (!ok.fine) return fail(res, 422, 'an end date from today on, within two years');
    }
    const most = String(req.body.max_joins || '').trim();
    const cap = rights === 'view' ? MAX_VIEWERS : MAX_EDITORS;
    if (most && !(/^\d+$/.test(most) && Number(most) >= 1 && Number(most) <= cap)) return fail(res, 422, `at most how many: a number from 1 to ${cap}`);
    const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_set_links l WHERE l.set_id = $1 AND l.usable', [set.id]);
    if (n >= 20) return fail(res, 422, 'at most 20 links at a time — turn one off first');
    const why = await shareFirst(req, set);
    if (why) return fail(res, 422, why);
    const { rows: [link] } = await adminPool.query(`INSERT INTO study_set_links AS l (set_id, code, rights, expires_at, max_joins)
        VALUES ($1, $2, $3, CASE WHEN $4 <> '' THEN ($4::date + 1)::timestamp AT TIME ZONE 'Europe/Zurich' END, nullif($5, '')::int)
      RETURNING l.id::text AS id, l.code, l.rights::text AS rights, l.created_at, l.ended_at, l.joined, l.expires_at, l.max_joins, l.closed_because AS closed`,
    [set.id, newLinkCode(), rights, until, most]);
    res.status(201).json({ link });
  });

  router.post('/:id/links/:lid/end', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    if (!ID.test(req.params.lid)) return fail(res, 404, 'no such link');
    const { rowCount } = await adminPool.query('UPDATE study_set_links SET ended_at = now() WHERE id = $1 AND set_id = $2 AND ended_at IS NULL', [req.params.lid, set.id]);
    if (!rowCount) return fail(res, 404, 'no such link (or it is off already)');
    res.status(204).end();
  });

  router.post('/:id/invitations', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const account = ID.test(String(req.body.account || '')) ? String(req.body.account) : null;
    if (!account) return fail(res, 422, 'whom?');
    if (req.body.action === 'cancel') {
      await adminPool.query('DELETE FROM study_set_invitations WHERE set_id = $1 AND account_id = $2', [set.id, account]);
      return res.status(204).end();
    }
    const rights = RIGHTS.includes(req.body.rights) ? req.body.rights : null;
    if (!rights) return fail(res, 422, 'which rights?');
    const { rows: [friend] } = await adminPool.query(`SELECT 1 FROM friendships WHERE (low_id, high_id) = (least($1::bigint, $2::bigint), greatest($1::bigint, $2::bigint))
      AND accepted_at IS NOT NULL`, [req.user.id, account]);
    if (!friend) return fail(res, 422, 'you can invite your friends — or send a link');
    if (set.members.some((m) => m.id === account)) return fail(res, 422, 'already a member — change their rights instead');
    const full = await roomFor(set.id, rights);
    if (full) return fail(res, 422, full);
    const why = await shareFirst(req, set);
    if (why) return fail(res, 422, why);
    await adminPool.query(`INSERT INTO study_set_invitations (set_id, account_id, rights, chat) VALUES ($1, $2, $3, $4)
      ON CONFLICT (set_id, account_id) DO UPDATE SET (rights, chat, invited_at) = (EXCLUDED.rights, EXCLUDED.chat, now())`, [set.id, account, rights, req.body.chat === '1']);
    res.status(201).json({ ok: true });
  });

  // the invited friend: accept (a member with the invitation's rights) or decline
  router.post('/invitations/:sid', async (req, res) => {
    if (!ID.test(req.params.sid)) return fail(res, 404, 'not_found');
    const { rows: [inv] } = await adminPool.query(`SELECT i.rights::text AS rights, i.chat FROM study_set_invitations i JOIN study_sets s ON s.id = i.set_id
      WHERE i.set_id = $1 AND i.account_id = $2 AND s.visibility <> 'private' AND ${ALIVE}`, [req.params.sid, req.user.id]);
    if (!inv) return fail(res, 404, 'this invitation is no longer valid — the set was deleted or made private, or the owner withdrew it');
    if (req.body.accept === '1') {
      const full = await roomFor(req.params.sid, inv.rights);
      if (full) return fail(res, 422, full);
      await adminPool.query(`INSERT INTO study_set_members (set_id, account_id, rights, chat, via) VALUES ($1, $2, $3, $4, 'invitation') ON CONFLICT DO NOTHING`,
        [req.params.sid, req.user.id, inv.rights, inv.chat]);
    }
    await adminPool.query('DELETE FROM study_set_invitations WHERE set_id = $1 AND account_id = $2', [req.params.sid, req.user.id]);
    res.json({ set: req.body.accept === '1' ? { id: req.params.sid } : null });
  });

  router.post('/:id/members/:aid', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const member = set.members.find((m) => m.id === req.params.aid);
    if (!member) return fail(res, 404, 'not a member of this set');
    const action = String(req.body.action || '');
    if (action === 'rights') {
      const rights = RIGHTS.includes(req.body.rights) ? req.body.rights : null;
      if (!rights) return fail(res, 422, 'which rights?');
      if ((rights === 'view') !== (member.rights === 'view')) { const full = await roomFor(set.id, rights); if (full) return fail(res, 422, full); }
      await adminPool.query('UPDATE study_set_members SET rights = $3 WHERE set_id = $1 AND account_id = $2', [set.id, member.id, rights]);
    } else if (action === 'chat') {
      await adminPool.query('UPDATE study_set_members SET chat = $3 WHERE set_id = $1 AND account_id = $2', [set.id, member.id, req.body.on === '1']);
    } else if (action === 'remove') {
      await adminPool.query('DELETE FROM study_set_members WHERE set_id = $1 AND account_id = $2', [set.id, member.id]);
    } else if (action === 'owner') {
      await asUser(req, (db) => db.query('SELECT study_set_transfer($1, $2)', [set.id, member.id]));
    } else return fail(res, 422, 'which action?');
    await settleSet(set.id);   // fewer who vote may decide a vote now
    res.json({ set: action === 'owner' ? null : await ownSet(req) });
  });

  router.post('/:id/settings', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const mode = ['advisory', 'binding'].includes(req.body.vote_mode) ? req.body.vote_mode : set.vote_mode;
    const hours = req.body.vote_hours === undefined ? set.vote_hours : Number.parseInt(req.body.vote_hours, 10);
    if (!(hours >= 1 && hours <= 24)) return fail(res, 422, 'a vote lasts 1 to 24 hours');
    const veto = req.body.owner_veto === undefined ? set.owner_veto : req.body.owner_veto === '1';
    await adminPool.query('UPDATE study_sets SET vote_mode = $2, vote_hours = $3, owner_veto = $4 WHERE id = $1', [set.id, mode, hours, veto]);
    res.json({ set: await ownSet(req) });
  });

  // ---- history, restore, lock (221) ----------------------------------------------------------------------
  const MAX_EVENTS = 1000;
  router.get('/:id/history', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (viewerOut(res, set)) return;
    const { rows } = await adminPool.query(`SELECT ev.id::text AS id, ev.at, ev.action, ev.field,
        left(ev.old_value, 300) AS old, left(ev.new_value, 300) AS new, ev.detail - 'seeded' AS detail, (ev.detail ? 'seeded') AS seeded,
        (SELECT u.public_name FROM admin_users u WHERE u.id = ev.actor_id) AS by,
        CASE WHEN ev.entity_id IS NOT NULL THEN (SELECT jsonb_build_object('type', e.type, 'slug', e.slug, 'name', e.name)
          FROM entity_index e WHERE (e.type, e.id) = (ev.entity_type, ev.entity_id)) END AS entry
      FROM study_set_events ev WHERE ev.set_id = $1 ORDER BY ev.at DESC, ev.id DESC LIMIT ${MAX_EVENTS}`, [set.id]);
    res.json({ events: rows, more: rows.length === MAX_EVENTS });
  });

  router.post('/:id/restore', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    // a step of the history (its exact time, microseconds and all) or a moment
    let at = null;
    if (ID.test(String(req.body.event || ''))) {
      // as text: a JS Date would drop the microseconds and miss the step itself
      const { rows: [ev] } = await adminPool.query('SELECT at::text AS at FROM study_set_events WHERE id = $1 AND set_id = $2', [req.body.event, set.id]);
      at = ev ? ev.at : null;
    } else {
      const d = new Date(String(req.body.at || ''));
      at = Number.isNaN(d.getTime()) || d > new Date() ? null : d.toISOString();
    }
    if (!at) return fail(res, 422, 'which moment?');
    try {
      const { rows: [{ r }] } = await asUser(req, (db) => db.query('SELECT study_set_restore($1, $2::timestamptz, $3) AS r', [set.id, at, text(req.body.reason, 300) || null]));
      res.json({ restored: r, set: await describe(await ownSet(req)) });
    } catch (err) {
      if (err.code === '23514') return fail(res, 422, 'the set did not exist yet then');
      throw err;
    }
  });

  router.post('/:id/lock', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    await asUser(req, (db) => db.query('UPDATE study_sets SET locked_at = CASE WHEN $2 THEN coalesce(locked_at, now()) END WHERE id = $1', [set.id, req.body.locked === '1']));
    res.json({ set: await ownSet(req) });
  });

  // ---- proposals (228) -----------------------------------------------------------------------------------------------
  router.post('/:id/proposals', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (viewerOut(res, set) || lockedOut(res, set)) return;
    if (direct(set)) return fail(res, 422, 'you change it directly');
    const reason = text(req.body.reason, 500);
    const kind = String(req.body.kind || '');
    if (kind === 'add' || kind === 'remove') {
      const id = await entryId(req.body.type, req.body.slug);
      if (!id) return fail(res, 422, 'no such entry');
      const { rows: [has] } = await adminPool.query('SELECT 1 FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]);
      if ((kind === 'add') === Boolean(has)) return fail(res, 422, kind === 'add' ? 'it is in the set already' : 'that entry is not in the set');
      return proposed(res, await propose(req, set, { kind, type: req.body.type, entity: id, reason }));
    }
    if (kind === 'field' && ['name', 'topic', 'description'].includes(req.body.field)) {
      const max = { name: 120, topic: 80, description: MAX_DESCRIPTION }[req.body.field];
      const value = text(req.body.value, max) || null;
      if (req.body.field === 'name' && !value) return fail(res, 422, 'a set needs a name');
      if (value === set[req.body.field]) return fail(res, 422, 'that is how it is already');
      return proposed(res, await propose(req, set, { kind, field: req.body.field, old: set[req.body.field], value, reason }));
    }
    return fail(res, 422, 'which change?');
  });

  async function openProposal(req, set) {
    if (!ID.test(req.params.pid)) return null;
    const { rows: [q] } = await adminPool.query(`SELECT id, procedure, tie_at, proposed_by = $3 AS mine FROM study_set_proposals
      WHERE id = $1 AND set_id = $2 AND decided_at IS NULL`, [req.params.pid, set.id, req.user.id]);
    return q || null;
  }
  router.post('/:id/proposals/:pid/vote', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (viewerOut(res, set) || lockedOut(res, set)) return;
    const q = await openProposal(req, set);
    if (!q) return fail(res, 404, 'no such open proposal');
    if (q.procedure === 'approval') return fail(res, 422, 'the owner decides this one — there is no vote');
    if (q.tie_at) return fail(res, 422, 'the vote has ended even — the owner decides');
    const vote = ['yes', 'no', 'abstain'].includes(req.body.vote) ? req.body.vote : null;
    if (!vote) return fail(res, 422, 'yes, no or abstain?');
    await asUser(req, async (db) => {
      await db.query(`INSERT INTO study_set_votes (proposal_id, voter_id, vote) VALUES ($1, $2, $3)
        ON CONFLICT (proposal_id, voter_id) DO UPDATE SET vote = EXCLUDED.vote, at = now()`, [q.id, req.user.id, vote]);
      if (q.procedure === 'binding') await db.query('SELECT study_proposal_settle($1)', [q.id]);
    });
    const { open, decided } = await proposalsOf(req, set);
    res.json({ proposals: open, decided, count: await countOf(set.id) });
  });

  router.post('/:id/proposals/:pid/decide', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (ownerOnly(res, set)) return;
    const q = await openProposal(req, set);
    if (!q) return fail(res, 404, 'no such open proposal');
    if (q.procedure === 'binding' && !q.tie_at && !set.owner_veto) return fail(res, 422, 'the vote decides this one — unless it ends even (or you allow yourself a veto in the settings)');
    const decision = ['accepted', 'rejected'].includes(req.body.decision) ? req.body.decision : null;
    if (!decision) return fail(res, 422, 'accepted or rejected?');
    const { rows: [r] } = await asUser(req, (db) => db.query(decision === 'accepted' ? 'SELECT study_proposal_accept($1, $2, false) AS outcome'
      : 'SELECT study_proposal_reject($1, $2, false) AS outcome', [q.id, req.user.id]));
    const { open, decided } = await proposalsOf(req, set);
    res.json({ outcome: r.outcome, proposals: open, decided, count: await countOf(set.id) });
  });

  router.post('/:id/proposals/:pid/withdraw', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    const q = await openProposal(req, set);
    if (!q || !q.mine) return fail(res, 404, 'no open proposal of yours');
    await adminPool.query(`UPDATE study_set_proposals SET decided_at = now(), outcome = 'withdrawn', decided_by = $2 WHERE id = $1 AND decided_at IS NULL`, [q.id, req.user.id]);
    const { open, decided } = await proposalsOf(req, set);
    res.json({ proposals: open, decided });
  });

  // a copy of a set one owns or edits (owner 2026-11-05: an editor can carry on when the owner is gone) — name, topic,
  // description, entries; not its editors, history or sharing. The copier owns it.
  router.post('/:id/copy', async (req, res) => {
    const set = await ownSet(req);
    if (!set) return fail(res, 404, 'not_found');
    if (viewerOut(res, set)) return;
    const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_sets WHERE owner_id = $1', [req.user.id]);
    if (n >= MAX_SETS) return fail(res, 422, `at most ${MAX_SETS} sets`);
    const copy = await asUser(req, async (db) => {
      const { rows: [c] } = await db.query(`INSERT INTO study_sets (owner_id, name, topic, description, copied_from)
        SELECT $1, name, topic, description, id FROM study_sets WHERE id = $2 RETURNING id`, [req.user.id, set.id]);
      await db.query(`INSERT INTO study_set_items (set_id, entity_type, entity_id, added_by)
        SELECT $1, entity_type, entity_id, $2 FROM study_set_items WHERE set_id = $3 ORDER BY added_at`, [c.id, req.user.id, set.id]);
      return c;
    });
    res.status(201).json({ set: { id: String(copy.id), name: set.name } });
  });


  return router;
};
