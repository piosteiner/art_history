// Study sets on the site (migration 218, owner 2026-11-04): an account's own lists of entries of any type, and index
// cards to learn them. Mounted under /site/sets by routes/site-account.js — the site's origin only (CORS with
// credentials), writes only from the site's pages, the session's account in every query: a set is only ever its
// owner's. Writes are form posts (application/x-www-form-urlencoded: a "simple" request, no CORS preflight).
//   GET  /site/sets                       {sets: [{id, name, topic, description, visibility, code, count, created_at, updated_at}],
//                                         public_name, topics} — topics: the account's and the public sets', to offer again
//   POST /site/sets                       name, topic, description → {set}
//   GET  /site/sets/of?type=&slug=        {sets: [{id, name, has}]} — every set, and whether it holds this entry
//   GET  /site/sets/:id                   {set, items: [{type, slug, name, subtitle, image, own, added_at}]}
//   POST /site/sets/:id                   name, topic, description → {set}
//   POST /site/sets/:id/share             visibility (private|shared|public), public_name → {set, public_name} (219, 228: private = its members out)
//   POST /site/sets/:id/sessions          mode, answered, known, seconds, complete → 201 — one round of a quiz (219), with the
//                                         set as it was then (229: study_set_snapshot(); see "results" below)
//   POST /site/sets/preview               text → {html} — a description as it will look (Markdown, src/markdown.js)
//   GET  /site/sets/:id/stats             the account's results on this set per kind of quiz, its boxes, hardest cards
//   POST /site/sets/:id/delete            → 204
//   POST /site/sets/:id/items             type, slug → {count}   (adding twice changes nothing)
//   POST /site/sets/:id/items/remove      type, slug → {count}
//   GET  /site/sets/:id/cards             {set, cards: [card + progress {forward, reverse}]} (src/study.js)
//   POST /site/sets/progress              type, slug, direction (forward|reverse), known (1|0) → {box}
// Shared sets (219) — the router `shared` below, mounted at /site/shared before any login is asked:
//   GET  /site/shared?topic=&q=           {sets: [public sets with creator], topics: [{topic, count}]}
//   GET  /site/shared/:code               {set (+ creator, mine), items} — a public set; anyone
//   GET  /site/shared/:code/cards         its index cards (logged in: with the account's own progress)
//   POST /site/shared/:code/copy          logged in: a copy among the account's sets → {set}
//   POST /site/shared/:code/sessions      logged in: one round of a quiz on it (the account's results, never the owner's)
//   GET  /site/shared/:code/stats         logged in: the account's results on it
//   POST /site/shared/:code/plan          logged in: exam_on (YYYY-MM-DD, empty = none) — the account's exam date (220)
// Members and their rights (228, owner 2026-11-05; were the editors of 220): a set is private (its owner only), shared
// (members invited as friends or joined by a link) or public (also listed and seen by anyone). Each member is a viewer
// (reads and studies; the set's chat only if the owner allows it to them) or edits it: full (changes apply at once),
// approval (each change is a proposal the owner accepts or rejects) or vote (each change is put to the vote — the set's
// vote_mode: advisory = the owner decides seeing the votes, binding = the vote decides after vote_hours, or earlier once
// it can't change; even → the owner; owner_veto lets the owner decide anyway). Rules in the database: migration 228.
//   GET  /site/shared/join/:code          {set: {name, topic, creator, count, members}, rights, role} — what the link is for
//   POST /site/shared/join/:code          logged in: public_name (if none yet) → {set: {id}} — joined with the link's rights
//   GET  /site/sets/:id/sharing           the owner: {links, invitations, friends, settings}
//   POST /site/sets/:id/links             the owner: rights, expires_on (optional, the last day), max_joins (optional) → a
//                                         new link (a private set becomes shared). A link off, expired or full → 410 on joining
//   POST /site/sets/:id/links/:lid/end    the owner: no one new joins with it; those who did stay
//   POST /site/sets/:id/invitations       the owner: account (a friend), rights, chat → invited; action=cancel
//   POST /site/sets/invitations/:sid      the invited: accept=1|0
//   POST /site/sets/:id/members/:aid      the owner: action=rights&rights= | chat&on= | remove | owner (hand the set over)
//   POST /site/sets/:id/settings          the owner: vote_mode, vote_hours, owner_veto
//   POST /site/sets/:id/leave             a member leaves the set
//   POST /site/sets/:id                   … + base_name, base_topic, base_description: what the form started from — a
//                                         field someone else changed meanwhile → 409 {error: 'changed', set, by}
// A member editing with approval or votes: POST /:id, /:id/items and /:id/items/remove become proposals (202 {proposed}).
// History, restore, lock (221): every change of a set is an event (study_set_events, by triggers — the actor is the
// transaction's arthistory.user_id, so every write goes through asUser()).
//   GET  /site/sets/:id/history            owner and editors: {events: [{at, action, field, old, new, entry, by, detail}]}
//   POST /site/sets/:id/restore            the owner: at (ISO time), reason → the set as it was then (itself an event)
//   POST /site/sets/:id/lock               the owner: locked=1|0 — locked, the members read and study but change nothing
// Proposals (228): GET /:id carries `proposals` (open, with votes by public name) and `decided` (the last 20).
//   POST /site/sets/:id/proposals          an editor without full rights: kind=add|remove, type, slug | kind=field, field, value; reason
//   POST /site/sets/:id/proposals/:pid/vote      owner or editor: vote=yes|no|abstain (again = changed)
//   POST /site/sets/:id/proposals/:pid/decide    the owner: decision=accepted|rejected — approval and advisory at any
//                                         time; binding only after a tie or with owner_veto
//   POST /site/sets/:id/proposals/:pid/withdraw  its proposer
// The list carries per set `proposals` (open), `to_vote` (open, the account may vote and hasn't), `to_decide` (the
// owner's: waiting for them) and the account's `invitations`.
// A set whose owner's account is deleted (kept 30 days, 221) is hidden from everyone, links and invitations too.
// Exam dates and the day's cards (220): POST /site/sets/:id/plan exam_on; the stats carry `plan` (days left, cards due
// and new today per direction); the cards carry `due` per direction (study_interval(): Leitner days, shortened before
// an exam).
const crypto = require('node:crypto');
const express = require('express');
const { adminPool } = require('../../db');
const { adminOrigin } = require('../auth');
const { cards } = require('../../study');
const { renderMarkdown, linkNames, previewText } = require('../../markdown');

const router = express.Router();
const shared = express.Router();
const { ID } = require('../site-http');
const CODE = /^[A-Za-z0-9_-]{12}$/;
const TYPES = ['artwork', 'artist', 'person', 'institution', 'event', 'movement', 'place', 'polity', 'literature', 'term', 'source'];
const MODES = ['forward', 'reverse', 'both', 'typed', 'choice'];
const VISIBILITY = ['private', 'shared', 'public'];
const RIGHTS = ['view', 'full', 'approval', 'vote'];
const MAX_SETS = 300;
const MAX_ITEMS = 3000;
const MAX_DESCRIPTION = 10000;
const MAX_EDITORS = 200;         // members with editing rights (owner 2026-11-05: 50 → 200)
const MAX_VIEWERS = 5000;        // (500 → 5000; beyond that the members list would want paging)
const MAX_OPEN_PROPOSALS = 300;
const NEW_PER_DAY = 20;          // new cards a day without an exam date
const LINK_CODE = /^[A-Za-z0-9_-]{16}$/;
const newLinkCode = () => crypto.randomBytes(12).toString('base64url');   // 16 characters, 96 bits
const TODAY = `(now() AT TIME ZONE 'Europe/Zurich')::date`;

const { fail, needLogin } = require('../site-http');
const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const newCode = () => crypto.randomBytes(9).toString('base64url');   // 12 characters, 72 bits: not guessed
// what a set shows of itself (to its owner: everything; others never see owner_id or copied_from's id)
const SET_COLS = `s.id, s.name, s.topic, s.description, s.visibility, s.share_code AS code, s.created_at, s.updated_at, s.locked_at, s.chat_on,
  s.vote_mode, s.vote_hours, s.owner_veto,
  (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS count`;
// the owner's account not deleted (221): a deleted account's sets are hidden while it waits 30 days
const ALIVE = `NOT EXISTS (SELECT 1 FROM admin_users d WHERE d.id = s.owner_id AND d.deleted_at IS NOT NULL)`;

/** A write as the account: in one transaction that names it (arthistory.user_id) — the set's history records who. */
async function asUser(req, fn) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('arthistory.user_id', $1, true), set_config('arthistory.source', 'site', true)", [String(req.user.id)]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}
const CREATOR = `(SELECT u.public_name FROM admin_users u WHERE u.id = s.owner_id) AS creator`;

/** Descriptions are Markdown (entries' [[links]], ==highlight==, callouts …): a set gets `description_html` (its page)
 *  and `description_text` (a line of plain text for the lists) beside the source. */
async function described(sets) {
  const env = { names: await linkNames(adminPool, sets.map((s) => s && s.description)), used: new Set(), cited: new Set() };
  // the list's line: the first paragraph, else (a heading first, a list …) the whole text as plain words
  const plain = (html) => {
    const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m])
      .replace(/\s+/g, ' ').trim();
    return t.length > 200 ? `${t.slice(0, 200).replace(/\s+\S*$/, '')} …` : t || null;
  };
  return sets.map((s) => {
    if (!s || !s.description) return s && { ...s, description_html: null, description_text: null };
    const html = renderMarkdown(s.description, env);
    return { ...s, description_html: html, description_text: previewText(s.description, env, 200) || plain(html) };
  });
}
const describe = async (set) => (await described([set]))[0];

/** The account's set `id` — its own, or one it is a member of (220, 228) — or null. `role`: owner | editor | viewer;
 *  `rights`: owner | full | approval | vote | view; `members`: everyone but the owner, with their rights. */
async function ownSet(req) {
  if (!ID.test(req.params.id)) return null;
  const { rows } = await adminPool.query(`SELECT ${SET_COLS}, ${CREATOR},
      CASE WHEN s.owner_id = $2 THEN 'owner' WHEN m.rights = 'view' THEN 'viewer' ELSE 'editor' END AS role,
      CASE WHEN s.owner_id = $2 THEN 'owner' ELSE m.rights::text END AS rights,
      (s.owner_id = $2 OR m.rights <> 'view' OR m.chat) AS chat_allowed,
      (SELECT u.public_name FROM admin_users u WHERE u.id = s.updated_by) AS updated_by,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.account_id::text, 'name', u.public_name, 'me', e.account_id = $2, 'rights', e.rights, 'chat', e.chat)
           ORDER BY e.added_at), '[]')
         FROM study_set_members e JOIN admin_users u ON u.id = e.account_id WHERE e.set_id = s.id) AS members,
      (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $2 AND p.set_id = s.id) AS exam_on,
      (SELECT jsonb_build_object('name', o.name, 'code', o.share_code, 'creator', (SELECT u.public_name FROM admin_users u WHERE u.id = o.owner_id))
         FROM study_sets o WHERE o.id = s.copied_from AND o.visibility = 'public') AS copied_from
    FROM study_sets s LEFT JOIN study_set_members m ON m.set_id = s.id AND m.account_id = $2
    WHERE s.id = $1 AND ${ALIVE} AND (s.owner_id = $2 OR m.account_id IS NOT NULL)`, [req.params.id, req.user.id]);
  const set = rows[0];
  if (set) set.editors = set.members.filter((m) => m.rights !== 'view');   // those who change it with the owner
  return set || null;
}
const ownerOnly = (res, set) => (set.role === 'owner' ? false : (fail(res, 403, 'only the owner of the set may do that'), true));
/** A locked set (221) is changed by its owner only. */
const lockedOut = (res, set) => (set.locked_at && set.role !== 'owner' ? (fail(res, 423, 'the owner has locked this set'), true) : false);
/** Viewers read and study; changes are the owner's and the editors'. */
const viewerOut = (res, set) => (set.role === 'viewer' ? (fail(res, 403, 'you can view this set, not change it'), true) : false);
/** The owner and members with full rights change it at once; the others propose (228). */
const direct = (set) => set.rights === 'owner' || set.rights === 'full';

/** A public set by its code — or null. `mine`: the viewer is its owner or a member. */
async function sharedSet(req) {
  if (!CODE.test(req.params.code)) return null;
  const { rows } = await adminPool.query(`SELECT ${SET_COLS}, ${CREATOR},
      (s.owner_id IS NOT DISTINCT FROM $2 OR EXISTS (SELECT 1 FROM study_set_members e WHERE e.set_id = s.id AND e.account_id = $2)) AS mine,
      (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $2 AND p.set_id = s.id) AS exam_on
    FROM study_sets s WHERE s.share_code = $1 AND s.visibility = 'public' AND ${ALIVE}`, [req.params.code, req.user ? req.user.id : null]);
  return rows[0] || null;
}
/** type + slug → the entry's id (entity_index), or null */
async function entryId(type, slug) {
  if (!TYPES.includes(type) || typeof slug !== 'string' || !slug) return null;
  const { rows } = await adminPool.query('SELECT id FROM entity_index WHERE type = $1::entity_type AND slug = $2', [type, slug]);
  return rows[0] ? rows[0].id : null;
}
const countOf = async (setId) => (await adminPool.query('SELECT count(*)::int AS n FROM study_set_items WHERE set_id = $1', [setId])).rows[0].n;

/** A set's entries as the lists show them (entry_previews: name, the line under it, a picture; an artwork without a
 *  public picture: the viewer's own reference image — never its owner's for anyone else); those deleted since left out. */
async function itemsOf(req, setId, together = false) {
  const viewer = req.user ? req.user.id : null;
  const { rows } = await adminPool.query(`SELECT i.entity_type::text AS type, e.slug, coalesce(p.name, e.name) AS name, p.subtitle, p.image_url AS image,
      CASE WHEN i.entity_type = 'artwork' AND p.image_url IS NULL THEN (SELECT x.id FROM private_images x WHERE x.artwork_id = i.entity_id AND x.owner_id = image_owner($2)
        ORDER BY x.position, x.id LIMIT 1) END AS own_image, i.added_at,
      CASE WHEN $3 THEN (SELECT u.public_name FROM admin_users u WHERE u.id = i.added_by) END AS added_by,
      i.added_by IS NOT DISTINCT FROM $4::bigint AS mine
    FROM study_set_items i JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id)
    LEFT JOIN entry_previews p ON (p.type, p.slug) = (e.type, e.slug)
    WHERE i.set_id = $1 ORDER BY i.added_at, e.slug`, [setId, viewer, together, req.user ? req.user.id : null]);
  const origin = adminOrigin(req);
  return rows.map(({ own_image: own, ...r }) => (own ? { ...r, image: `${origin}/private-images/${own}?w=250`, own: true } : { ...r, own: false }));
}

/** The set's index cards, with the viewer's progress and, per direction, whether the card is due today (none for
 *  visitors): never asked, or its Leitner interval since it was last asked is over (study_interval: shorter before
 *  the viewer's exam date for this set). */
async function cardsOf(req, setId) {
  const viewer = req.user ? req.user.id : null;
  const { rows: entries } = await adminPool.query(`WITH plan AS (SELECT (SELECT exam_on FROM study_plans WHERE owner_id = $2 AND set_id = $1) - ${TODAY} AS days_left)
    SELECT i.entity_type::text AS type, i.entity_id AS id,
      (SELECT jsonb_object_agg(p.direction, jsonb_build_object('box', p.box, 'seen', p.seen, 'known', p.known,
          'due', (p.last_seen_at AT TIME ZONE 'Europe/Zurich')::date + study_interval(p.box, (SELECT days_left FROM plan)) <= ${TODAY}))
         FROM study_progress p WHERE p.owner_id = $2 AND (p.entity_type, p.entity_id) = (i.entity_type, i.entity_id)) AS progress
    FROM study_set_items i WHERE i.set_id = $1 ORDER BY i.added_at`, [setId, viewer]);
  const progress = new Map(entries.map((e) => [`${e.type}:${e.id}`, e.progress || {}]));
  const list = await cards(adminPool, entries, viewer, adminOrigin(req));
  return list.map(({ key, ...c }) => ({ ...c, progress: progress.get(key) || {} }));
}

/** The account's plan for a set (220): the exam date and days left, and per direction the cards due today, the new
 *  ones not asked yet and how many of them today brings (the new cards spread over the days before the exam; without
 *  one NEW_PER_DAY) — less those first asked today already. */
async function planOf(req, setId) {
  const { rows: [p] } = await adminPool.query(`WITH plan AS (SELECT exam_on, exam_on - ${TODAY} AS days_left FROM study_plans WHERE owner_id = $1 AND set_id = $2),
    cards AS (SELECT d.direction, p.box, p.last_seen_at, p.first_seen_at
      FROM study_set_items i CROSS JOIN (VALUES ('forward'), ('reverse')) d (direction)
      LEFT JOIN study_progress p ON p.owner_id = $1 AND (p.entity_type, p.entity_id, p.direction) = (i.entity_type, i.entity_id, d.direction)
      WHERE i.set_id = $2)
    SELECT (SELECT exam_on::text FROM plan) AS exam_on, (SELECT days_left FROM plan) AS days_left,
      jsonb_object_agg(direction, jsonb_build_object('due', due, 'new', fresh, 'new_today', today)) AS directions
    FROM (SELECT direction,
            count(*) FILTER (WHERE box IS NOT NULL AND (last_seen_at AT TIME ZONE 'Europe/Zurich')::date
              + study_interval(box, (SELECT days_left FROM plan)) <= ${TODAY})::int AS due,
            count(*) FILTER (WHERE box IS NULL)::int AS fresh,
            count(*) FILTER (WHERE (first_seen_at AT TIME ZONE 'Europe/Zurich')::date = ${TODAY})::int AS today
          FROM cards GROUP BY direction) x`, [req.user.id, setId]);
  const days = p.days_left;
  const directions = {};
  for (const [dir, d] of Object.entries(p.directions || {})) {
    // new cards a day: all of them by the day before the exam (from then on: all that are left)
    const perDay = days === null || days < 0 ? NEW_PER_DAY : days <= 1 ? d.new : Math.ceil((d.new + d.new_today) / (days - 1));
    directions[dir] = { due: d.due, new: d.new, new_left_today: Math.min(d.new, Math.max(0, perDay - d.new_today)), new_today: d.new_today };
  }
  return { exam_on: p.exam_on, days_left: days, directions };
}

/** One round of a quiz on a set by the account (its own set or a shared one). */
async function recordSession(req, res, setId) {
  const mode = MODES.includes(req.body.mode) ? req.body.mode : null;
  const answered = Number.parseInt(req.body.answered, 10);
  const known = Number.parseInt(req.body.known, 10);
  const seconds = Number.parseInt(req.body.seconds, 10);
  if (!mode || !(answered > 0 && answered <= 20000) || !(known >= 0 && known <= answered)) return fail(res, 422, 'which round?');
  // the set as this round saw it (229): kept with the result, also when the set is gone later
  await asUser(req, (db) => db.query(`INSERT INTO study_sessions (owner_id, set_id, mode, answered, known, seconds, complete, snapshot_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, study_set_snapshot($2))`,
    [req.user.id, setId, mode, answered, known, seconds >= 0 && seconds < 86400 ? seconds : null, req.body.complete !== '0']));
  res.status(201).json({ ok: true });
}

/** The account's results on a set: per kind of quiz (rounds, share known — the last ten, the best whole round), the
 *  cards' Leitner boxes per direction, and the entries most often not known. */
async function statsOf(req, setId) {
  const [modes, boxes, hardest, today] = await Promise.all([
    adminPool.query(`SELECT mode, count(*)::int AS rounds, sum(answered)::int AS answered, sum(known)::int AS known,
        (array_agg(round(100.0 * known / answered)::int ORDER BY finished_at DESC))[1:10] AS recent,
        max(round(100.0 * known / answered)::int) FILTER (WHERE complete) AS best,
        max(finished_at) AS last_at, coalesce(sum(seconds), 0)::int AS seconds
      FROM study_sessions WHERE owner_id = $1 AND set_id = $2 GROUP BY mode`, [req.user.id, setId]),
    adminPool.query(`SELECT d.direction, coalesce(p.box, 0)::int AS box, count(*)::int AS n
      FROM study_set_items i CROSS JOIN (VALUES ('forward'), ('reverse')) d (direction)
      LEFT JOIN study_progress p ON p.owner_id = $1 AND (p.entity_type, p.entity_id, p.direction) = (i.entity_type, i.entity_id, d.direction)
      WHERE i.set_id = $2 GROUP BY 1, 2 ORDER BY 1, 2`, [req.user.id, setId]),
    adminPool.query(`SELECT e.type::text AS type, e.slug, e.name, sum(p.seen)::int AS seen, sum(p.known)::int AS known
      FROM study_set_items i JOIN study_progress p ON p.owner_id = $1 AND (p.entity_type, p.entity_id) = (i.entity_type, i.entity_id)
      JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id)
      WHERE i.set_id = $2 GROUP BY e.type, e.slug, e.name HAVING sum(p.seen) > sum(p.known)
      ORDER BY (sum(p.seen) - sum(p.known))::float / sum(p.seen) DESC, sum(p.seen) DESC LIMIT 5`, [req.user.id, setId]),
    // today's study set (owner 2026-11-07): the set's cards answered today per direction — right the last time = out of
    // box 1 —, and today's rounds of this set
    adminPool.query(`SELECT jsonb_build_object(
        'forward', (SELECT jsonb_build_object('done', count(*), 'right', count(*) FILTER (WHERE p.box > 1)) FROM study_set_items i
          JOIN study_progress p ON p.owner_id = $1 AND (p.entity_type, p.entity_id) = (i.entity_type, i.entity_id) AND p.direction = 'forward'
          WHERE i.set_id = $2 AND (p.last_seen_at AT TIME ZONE 'Europe/Zurich')::date = ${TODAY}),
        'reverse', (SELECT jsonb_build_object('done', count(*), 'right', count(*) FILTER (WHERE p.box > 1)) FROM study_set_items i
          JOIN study_progress p ON p.owner_id = $1 AND (p.entity_type, p.entity_id) = (i.entity_type, i.entity_id) AND p.direction = 'reverse'
          WHERE i.set_id = $2 AND (p.last_seen_at AT TIME ZONE 'Europe/Zurich')::date = ${TODAY}),
        'rounds', count(s.*), 'answered', coalesce(sum(s.answered), 0), 'known', coalesce(sum(s.known), 0), 'seconds', coalesce(sum(s.seconds), 0)) AS today
      FROM study_sessions s WHERE s.owner_id = $1 AND s.set_id = $2 AND (s.finished_at AT TIME ZONE 'Europe/Zurich')::date = ${TODAY}`, [req.user.id, setId]),
  ]);
  const box = { forward: [0, 0, 0, 0, 0, 0], reverse: [0, 0, 0, 0, 0, 0] };   // [new, box 1 … box 5]
  for (const r of boxes.rows) box[r.direction][r.box] = r.n;
  return { modes: Object.fromEntries(modes.rows.map(({ mode, ...m }) => [mode, m])), boxes: box, hardest: hardest.rows, today: today.rows[0].today, plan: await planOf(req, setId) };
}

/** The account's exam date for a set: a date from today on, or none. */
async function savePlan(req, res, setId) {
  const raw = String(req.body.exam_on || '').trim();
  if (!raw) {
    await adminPool.query('DELETE FROM study_plans WHERE owner_id = $1 AND set_id = $2', [req.user.id, setId]);
    return res.json({ plan: await planOf(req, setId) });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail(res, 422, 'a date, please (YYYY-MM-DD)');
  const { rows: [ok] } = await adminPool.query(`SELECT $1::date >= ${TODAY} AND $1::date <= ${TODAY} + 3 * 365 AS fine`, [raw]).catch(() => ({ rows: [{ fine: false }] }));
  if (!ok.fine) return fail(res, 422, 'an exam date from today on, within three years');
  await adminPool.query(`INSERT INTO study_plans (owner_id, set_id, exam_on) VALUES ($1, $2, $3)
    ON CONFLICT (owner_id, set_id) DO UPDATE SET exam_on = EXCLUDED.exam_on`, [req.user.id, setId, raw]);
  res.json({ plan: await planOf(req, setId) });
}

// ---- shared sets: anyone with the link, logged in or not ----------------------------------------------------------
shared.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

shared.get('/', async (req, res) => {
  const topic = text(req.query.topic, 80);
  const q = text(req.query.q, 100);
  const [{ rows: sets }, { rows: topics }] = await Promise.all([
    adminPool.query(`SELECT ${SET_COLS}, ${CREATOR} FROM study_sets s WHERE s.visibility = 'public' AND ${ALIVE}
        AND ($1 = '' OR s.topic = $1)
        AND ($2 = '' OR f_unaccent(concat_ws(' ', s.name, s.topic, s.description)) ILIKE '%' || f_unaccent($2) || '%')
      ORDER BY s.updated_at DESC, s.id DESC LIMIT 200`, [topic, q]),
    adminPool.query(`SELECT topic, count(*)::int AS count FROM study_sets s WHERE visibility = 'public' AND topic IS NOT NULL AND ${ALIVE}
      GROUP BY topic ORDER BY count(*) DESC, topic LIMIT 60`),
  ]);
  res.json({ sets: (await described(sets)).map(({ id, ...s }) => s), topics });
});

// links to join a set with the rights they carry (228) — a link turned off, past its end date or full (230: l.usable)
// lets no one new in; `closed` says which
async function linkedSet(req) {
  if (!LINK_CODE.test(req.params.code)) return null;
  const { rows: [set] } = await adminPool.query(`SELECT s.id, s.name, s.topic, s.visibility, ${CREATOR}, l.id AS link_id, l.rights::text AS rights,
      (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS count,
      (SELECT count(*)::int FROM study_set_members e WHERE e.set_id = s.id) AS members,
      (SELECT count(*)::int FROM study_set_members e WHERE e.set_id = s.id AND e.rights <> 'view') AS editors,
      (SELECT count(*)::int FROM study_set_members e WHERE e.set_id = s.id AND e.rights = 'view') AS viewers,
      CASE WHEN s.owner_id = $2 THEN 'owner' ELSE (SELECT CASE WHEN e.rights = 'view' THEN 'viewer' ELSE 'editor' END
        FROM study_set_members e WHERE e.set_id = s.id AND e.account_id = $2) END AS role,
      s.vote_mode, l.closed_because AS closed, l.expires_at, l.max_joins, l.joined
    FROM study_set_links l JOIN study_sets s ON s.id = l.set_id
    WHERE l.code = $1 AND s.visibility <> 'private' AND ${ALIVE}`, [req.params.code, req.user ? req.user.id : null]);
  return set || null;
}
/** The public name others see — chosen now if there is none yet; an error text or null. */
async function ensurePublicName(req, why) {
  if (req.user.public_name) return null;
  const name = text(req.body.public_name, 60);
  if (!name) return why;
  if (name.toLowerCase() === req.user.username.toLowerCase()) return 'choose a public name other than your login name';
  await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, name]);
  req.user.public_name = name;
  return null;
}
/** Room for one more member with these rights? An error text or null. */
async function roomFor(setId, rights) {
  const { rows: [n] } = await adminPool.query(`SELECT count(*) FILTER (WHERE rights <> 'view')::int AS editors, count(*) FILTER (WHERE rights = 'view')::int AS viewers
    FROM study_set_members WHERE set_id = $1`, [setId]);
  if (rights !== 'view' && n.editors >= MAX_EDITORS) return `at most ${MAX_EDITORS} members with editing rights in a set`;
  if (rights === 'view' && n.viewers >= MAX_VIEWERS) return `at most ${MAX_VIEWERS} viewers in a set`;
  return null;
}
// a link that no longer lets anyone new in: 410 with why (off | expired | full) — its members are sent to the set
const LINK_CLOSED = { off: 'the owner has turned this link off', expired: 'this link has expired', full: 'as many people as this link allows have joined with it' };
const linkClosed = (res, set) => res.status(410).json({ error: LINK_CLOSED[set.closed], closed: set.closed });
shared.get('/join/:code', async (req, res) => {
  const set = await linkedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (set.closed && !set.role) return linkClosed(res, set);
  const { id, link_id: lid, role, closed, joined, ...rest } = set;
  res.json({ set: role ? { id, ...rest } : rest, rights: set.rights, role, public_name: req.user ? req.user.public_name : null });
});
shared.post('/join/:code', needLogin, async (req, res) => {
  const set = await linkedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (set.role) return res.json({ set: { id: set.id } });
  if (set.closed) return linkClosed(res, set);
  const why = await ensurePublicName(req, 'the other members see your public name — choose one first');
  if (why) return fail(res, 422, why);
  const full = await roomFor(set.id, set.rights);
  if (full) return fail(res, 422, full);
  // counted and joined in one transaction: the link's row is taken only while it is usable — of two joining at once
  // for its last place, the second finds it full
  const joined = await asUser(req, async (db) => {
    const { rowCount: counted } = await db.query('UPDATE study_set_links l SET joined = joined + 1 WHERE l.id = $1 AND l.usable', [set.link_id]);
    if (!counted) return false;
    await db.query(`INSERT INTO study_set_members (set_id, account_id, rights, via) VALUES ($1, $2, $3, 'link') ON CONFLICT DO NOTHING`, [set.id, req.user.id, set.rights]);
    await db.query('DELETE FROM study_set_invitations WHERE set_id = $1 AND account_id = $2', [set.id, req.user.id]);
    return true;
  });
  if (!joined) return linkClosed(res, (await linkedSet(req)) || { closed: 'off' });
  res.status(201).json({ set: { id: set.id } });
});

shared.get('/:code', async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { id, ...rest } = await describe(set);
  res.json({ set: set.mine ? { id, ...rest } : rest, items: await itemsOf(req, set.id) });
});

shared.get('/:code/cards', async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { id, ...rest } = set;
  res.json({ set: set.mine ? set : rest, cards: await cardsOf(req, set.id) });
});

shared.post('/:code/copy', needLogin, async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_sets WHERE owner_id = $1', [req.user.id]);
  if (n >= MAX_SETS) return fail(res, 422, `at most ${MAX_SETS} sets`);
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [copy] } = await client.query(`INSERT INTO study_sets (owner_id, name, topic, description, copied_from)
      SELECT $1, name, topic, description, id FROM study_sets WHERE id = $2 RETURNING id`, [req.user.id, set.id]);
    await client.query(`INSERT INTO study_set_items (set_id, entity_type, entity_id)
      SELECT $1, entity_type, entity_id FROM study_set_items WHERE set_id = $2 ORDER BY added_at`, [copy.id, set.id]);
    await client.query('COMMIT');
    res.status(201).json({ set: { id: copy.id, name: set.name } });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

shared.post('/:code/sessions', needLogin, async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  return recordSession(req, res, set.id);
});

shared.get('/:code/stats', needLogin, async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  res.json(await statsOf(req, set.id));
});

shared.post('/:code/plan', needLogin, async (req, res) => {
  const set = await sharedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  return savePlan(req, res, set.id);
});

// ---- the account's own sets ---------------------------------------------------------------------------------------
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'not_logged_in' });
  res.set('Cache-Control', 'no-store');
  next();
});

// binding votes whose time is up are decided when anyone looks (and by the minute timer below)
const settleDue = (accountId) => adminPool.query(`SELECT study_proposals_settle(x.set_id) FROM (SELECT DISTINCT p.set_id FROM study_set_proposals p
    JOIN study_sets s ON s.id = p.set_id
    WHERE p.decided_at IS NULL AND p.procedure = 'binding' AND p.tie_at IS NULL AND p.closes_at <= now()
      AND (s.owner_id = $1 OR EXISTS (SELECT 1 FROM study_set_members e WHERE e.set_id = s.id AND e.account_id = $1))) x`, [accountId]);
const settleSet = (setId) => adminPool.query('SELECT study_proposals_settle($1)', [setId]);
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => adminPool.query('SELECT study_proposals_settle()').catch((err) => console.error('sets: settling votes —', err.message)), 60 * 1000).unref();
}
// a member may chat in the set: the owner, an editor, a viewer the owner allowed (228)
const CHATTER = (m) => `(${m}.rights <> 'view' OR ${m}.chat)`;

router.get('/', async (req, res) => {
  await settleDue(req.user.id);
  const [{ rows: sets }, { rows: [me] }, { rows: topics }, { rows: invitations }] = await Promise.all([
    adminPool.query(`SELECT ${SET_COLS},
        CASE WHEN s.owner_id = $1 THEN 'owner' WHEN m.rights = 'view' THEN 'viewer' ELSE 'editor' END AS role,
        CASE WHEN s.owner_id = $1 THEN 'owner' ELSE m.rights::text END AS rights,
        CASE WHEN s.owner_id <> $1 THEN (SELECT u.public_name FROM admin_users u WHERE u.id = s.owner_id) END AS creator,
        (SELECT count(*)::int FROM study_set_members e WHERE e.set_id = s.id AND e.rights <> 'view') AS editor_count,
        (SELECT count(*)::int FROM study_set_members e WHERE e.set_id = s.id AND e.rights = 'view') AS viewer_count,
        (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $1 AND p.set_id = s.id) AS exam_on,
        CASE WHEN s.owner_id = $1 OR m.rights <> 'view' THEN (SELECT count(*)::int FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL) ELSE 0 END AS proposals,
        CASE WHEN s.owner_id = $1 OR m.rights <> 'view' THEN (SELECT count(*)::int FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL
           AND q.procedure <> 'approval' AND q.tie_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM study_set_votes v WHERE v.proposal_id = q.id AND v.voter_id = $1)) ELSE 0 END AS to_vote,
        CASE WHEN s.owner_id = $1 THEN (SELECT count(*)::int FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL
           AND (q.procedure <> 'binding' OR q.tie_at IS NOT NULL)) ELSE 0 END AS to_decide,
        s.chat_on, CASE WHEN s.chat_on AND (s.owner_id = $1 OR ${CHATTER('m')}) AND NOT EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = $1)
          THEN (SELECT count(*)::int FROM set_chat_messages c WHERE c.set_id = s.id AND c.sender_id IS DISTINCT FROM $1
            AND NOT EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $1 AND h.hidden_id = c.sender_id)
            AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = c.sender_id)
            AND c.id > coalesce((SELECT r.last_read_id FROM set_chat_reads r WHERE r.set_id = s.id AND r.account_id = $1), 0)) ELSE 0 END AS chat_unread
      FROM study_sets s LEFT JOIN study_set_members m ON m.set_id = s.id AND m.account_id = $1
      WHERE ${ALIVE} AND (s.owner_id = $1 OR m.account_id IS NOT NULL)
      ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id]),
    adminPool.query('SELECT public_name FROM admin_users WHERE id = $1', [req.user.id]),
    adminPool.query(`SELECT topic FROM study_sets WHERE topic IS NOT NULL AND (owner_id = $1 OR visibility = 'public')
      GROUP BY topic ORDER BY bool_or(owner_id = $1) DESC, count(*) DESC, topic LIMIT 100`, [req.user.id]),
    adminPool.query(`SELECT s.id AS set_id, s.name, s.topic, ${CREATOR}, i.rights::text AS rights, i.chat, i.invited_at, s.vote_mode,
        (SELECT count(*)::int FROM study_set_items x WHERE x.set_id = s.id) AS count
      FROM study_set_invitations i JOIN study_sets s ON s.id = i.set_id
      WHERE i.account_id = $1 AND s.visibility <> 'private' AND ${ALIVE} ORDER BY i.invited_at DESC`, [req.user.id]),
  ]);
  res.json({ sets: await described(sets), public_name: me ? me.public_name : null, topics: topics.map((t) => t.topic), invitations });
});

router.post('/', async (req, res) => {
  const name = text(req.body.name, 120);
  if (!name) return fail(res, 422, 'a set needs a name');
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_sets WHERE owner_id = $1', [req.user.id]);
  if (n >= MAX_SETS) return fail(res, 422, `at most ${MAX_SETS} sets`);
  const { rows: [{ id }] } = await asUser(req, (db) => db.query(`INSERT INTO study_sets (owner_id, name, topic, description) VALUES ($1, $2, $3, $4) RETURNING id`,
    [req.user.id, name, text(req.body.topic, 80) || null, text(req.body.description, MAX_DESCRIPTION) || null]));
  req.params.id = String(id);
  res.status(201).json({ set: await ownSet(req) });
});

// the answer to one card (Leitner): known → one box up (at most 5), not known → back to box 1
router.post('/progress', async (req, res) => {
  const direction = req.body.direction === 'reverse' ? 'reverse' : req.body.direction === 'forward' ? 'forward' : null;
  const id = await entryId(req.body.type, req.body.slug);
  if (!direction || !id) return fail(res, 422, 'which card?');
  const known = req.body.known === '1' || req.body.known === 'true';
  const { rows: [p] } = await adminPool.query(`INSERT INTO study_progress AS p (owner_id, entity_type, entity_id, direction, box, seen, known)
      VALUES ($1, $2::entity_type, $3, $4, CASE WHEN $5 THEN 2 ELSE 1 END, 1, CASE WHEN $5 THEN 1 ELSE 0 END)
    ON CONFLICT (owner_id, entity_type, entity_id, direction) DO UPDATE SET
      box = CASE WHEN $5 THEN least(p.box + 1, 5) ELSE 1 END, seen = p.seen + 1, known = p.known + (CASE WHEN $5 THEN 1 ELSE 0 END), last_seen_at = now()
    RETURNING box, seen, known`, [req.user.id, req.body.type, id, direction, known]);
  res.json(p);
});

// ---- the account's results with the sets as they were (229) -------------------------------------------------------
//   GET  /site/sets/results                       {sets: [{key, name, topic, access, id, code, rounds: [{…, snapshot}]}]}
//                                                 — every round, grouped by set; access: own | member | public | null (gone)
//   GET  /site/sets/results/snapshots/:sid        the set as it was: {snapshot: {name, topic, description_html, items}}
//   POST /site/sets/results/snapshots/:sid/copy   a new set of the account's own from it (the entries still on the site)
//   POST /site/sets/results/forget                key → the account's rounds on that set deleted
const MAX_ROUNDS_SHOWN = 3000;
router.get('/results', async (req, res) => {
  const { rows } = await adminPool.query(`SELECT s.id::text AS id, s.mode, s.answered, s.known, s.seconds, s.complete, s.finished_at AS at,
      x.origin_set_id::text AS key, x.id::text AS snapshot_id, x.name, x.topic, x.item_count, x.taken_at
    FROM study_sessions s JOIN study_set_snapshots x ON x.id = s.snapshot_id
    WHERE s.owner_id = $1 ORDER BY s.finished_at DESC LIMIT ${MAX_ROUNDS_SHOWN}`, [req.user.id]);
  const keys = [...new Set(rows.map((r) => r.key))];
  const { rows: live } = keys.length ? await adminPool.query(`SELECT s.id::text AS key, s.name, s.topic,
      CASE WHEN s.owner_id = $1 THEN 'own' WHEN EXISTS (SELECT 1 FROM study_set_members m WHERE m.set_id = s.id AND m.account_id = $1) THEN 'member'
           WHEN s.visibility = 'public' THEN 'public' END AS access,
      CASE WHEN s.visibility = 'public' THEN s.share_code END AS code
    FROM study_sets s WHERE s.id = ANY($2::bigint[]) AND ${ALIVE}`, [req.user.id, keys]) : { rows: [] };
  const now = new Map(live.filter((l) => l.access).map((l) => [l.key, l]));
  const sets = new Map();
  for (const r of rows) {
    if (!sets.has(r.key)) {
      const l = now.get(r.key);
      // the set's name as it is now where the account can still open it, else as it was in its latest round
      sets.set(r.key, { key: r.key, name: l ? l.name : r.name, topic: l ? l.topic : r.topic, access: l ? l.access : null,
        id: l && l.access !== 'public' ? r.key : null, code: l ? l.code : null, rounds: [] });
    }
    sets.get(r.key).rounds.push({ id: r.id, at: r.at, mode: r.mode, answered: r.answered, known: r.known, seconds: r.seconds, complete: r.complete,
      snapshot: { id: r.snapshot_id, name: r.name, item_count: r.item_count, taken_at: r.taken_at } });
  }
  res.json({ sets: [...sets.values()], more: rows.length === MAX_ROUNDS_SHOWN });
});

/** A snapshot the account played a round on — or null. */
async function ownSnapshot(req) {
  if (!ID.test(req.params.sid)) return null;
  const { rows: [x] } = await adminPool.query(`SELECT x.id, x.set_id, x.name, x.topic, x.description, x.items, x.taken_at FROM study_set_snapshots x
    WHERE x.id = $1 AND EXISTS (SELECT 1 FROM study_sessions s WHERE s.snapshot_id = x.id AND s.owner_id = $2)`, [req.params.sid, req.user.id]);
  return x || null;
}
router.get('/results/snapshots/:sid', async (req, res) => {
  const x = await ownSnapshot(req);
  if (!x) return fail(res, 404, 'not_found');
  // each entry as it was named then — and where it is now, if it is still on the site
  const { rows: now } = await adminPool.query(`SELECT e.type::text AS type, e.id, e.slug, e.name FROM entity_index e
    JOIN jsonb_to_recordset($1::jsonb) AS i (type text, id bigint) ON (e.type::text, e.id) = (i.type, i.id)`, [JSON.stringify(x.items)]);
  const here = new Map(now.map((e) => [`${e.type}:${e.id}`, e]));
  const [described1] = await described([{ description: x.description }]);
  res.json({ snapshot: { id: String(x.id), name: x.name, topic: x.topic, description_html: described1.description_html, taken_at: x.taken_at,
    items: x.items.map((i) => { const e = here.get(`${i.type}:${i.id}`); return { type: i.type, name: i.name, slug: e ? e.slug : null, now_name: e ? e.name : null }; }) } });
});
router.post('/results/snapshots/:sid/copy', async (req, res) => {
  const x = await ownSnapshot(req);
  if (!x) return fail(res, 404, 'not_found');
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_sets WHERE owner_id = $1', [req.user.id]);
  if (n >= MAX_SETS) return fail(res, 422, `at most ${MAX_SETS} sets`);
  const copy = await asUser(req, async (db) => {
    const { rows: [c] } = await db.query(`INSERT INTO study_sets (owner_id, name, topic, description, copied_from) VALUES ($1, $2, $3, $4,
      (SELECT id FROM study_sets WHERE id = $5 AND visibility = 'public')) RETURNING id`, [req.user.id, x.name, x.topic, x.description, x.set_id]);
    const { rowCount } = await db.query(`INSERT INTO study_set_items (set_id, entity_type, entity_id, added_by)
      SELECT $1, e.type, e.id, $2 FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS i (item, ord)
      JOIN entity_index e ON (e.type::text, e.id) = (i.item ->> 'type', (i.item ->> 'id')::bigint) ORDER BY i.ord`, [c.id, req.user.id, JSON.stringify(x.items)]);
    return { id: String(c.id), entries: rowCount };
  });
  res.status(201).json({ set: { ...copy, name: x.name, missing: x.items.length - copy.entries } });
});
router.post('/results/forget', async (req, res) => {
  if (!ID.test(String(req.body.key || ''))) return fail(res, 422, 'which set?');
  const { rowCount } = await adminPool.query(`DELETE FROM study_sessions WHERE owner_id = $1
    AND snapshot_id IN (SELECT id FROM study_set_snapshots WHERE origin_set_id = $2)`, [req.user.id, req.body.key]);
  res.json({ deleted: rowCount });
});

// a description as it will be shown (the Preview tab of the site's Markdown editor, md-editor.ts)
router.post('/preview', async (req, res) => {
  const source = text(req.body.text, MAX_DESCRIPTION);
  if (!source) return res.json({ html: '' });
  const env = { names: await linkNames(adminPool, [source]), used: new Set(), cited: new Set() };
  res.json({ html: renderMarkdown(source, env) });
});

// the sets the account may change (owner, editors) — whether each holds the entry, and (228) the account's rights there
// and a change of it already proposed and waiting
router.get('/of', async (req, res) => {
  const id = await entryId(String(req.query.type || ''), String(req.query.slug || ''));
  if (!id) return fail(res, 404, 'not_found');
  const { rows } = await adminPool.query(`SELECT s.id, s.name, EXISTS (SELECT 1 FROM study_set_items i WHERE i.set_id = s.id
      AND i.entity_type = $2::entity_type AND i.entity_id = $3) AS has,
      CASE WHEN s.owner_id = $1 THEN 'owner' ELSE m.rights::text END AS rights, s.vote_mode, s.locked_at IS NOT NULL AS locked,
      (SELECT q.kind FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL AND q.kind <> 'field'
         AND q.entity_type = $2::entity_type AND q.entity_id = $3) AS proposed
    FROM study_sets s LEFT JOIN study_set_members m ON m.set_id = s.id AND m.account_id = $1
    WHERE ${ALIVE} AND (s.owner_id = $1 OR m.rights <> 'view')
    ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id, req.query.type, id]);
  res.json({ sets: rows });
});

router.get('/:id', async (req, res) => {
  if (ID.test(req.params.id)) await settleSet(req.params.id);
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { open, decided } = set.role === 'viewer' ? { open: [], decided: [] } : await proposalsOf(req, set);
  res.json({ set: await describe(set), items: await itemsOf(req, set.id, set.members.length > 0), proposals: open, decided });
});

/** The set's proposals (228): the open ones with their votes — by public name — and the account's own vote, the
 *  number who vote; the last 20 decided. */
async function proposalsOf(req, set) {
  const cols = `q.id::text AS id, q.kind, q.field, q.old_value AS old, q.new_value AS new, q.procedure, q.reason, q.created_at, q.closes_at, q.tie_at,
      q.decided_at, q.outcome, q.by_vote, q.proposed_by = $2 AS mine,
      e.type::text AS type, e.slug, e.name,
      (SELECT u.public_name FROM admin_users u WHERE u.id = q.proposed_by) AS proposed_by,
      (SELECT u.public_name FROM admin_users u WHERE u.id = q.decided_by) AS decided_by,
      (SELECT u.public_name FROM admin_users u WHERE u.id = i.added_by) AS added_by`;
  const from = `FROM study_set_proposals q LEFT JOIN entity_index e ON (e.type, e.id) = (q.entity_type, q.entity_id)
    LEFT JOIN study_set_items i ON (i.set_id, i.entity_type, i.entity_id) = (q.set_id, q.entity_type, q.entity_id)`;
  const [{ rows: open }, { rows: decided }, { rows: [{ voters }] }] = await Promise.all([
    adminPool.query(`SELECT ${cols},
        (SELECT coalesce(jsonb_agg(jsonb_build_object('by', u.public_name, 'vote', v.vote) ORDER BY v.at), '[]')
           FROM study_set_votes v JOIN admin_users u ON u.id = v.voter_id WHERE v.proposal_id = q.id AND v.voter_id IN (SELECT study_set_voters(q.set_id))) AS votes,
        (SELECT v.vote FROM study_set_votes v WHERE v.proposal_id = q.id AND v.voter_id = $2) AS my_vote
      ${from} WHERE q.set_id = $1 AND q.decided_at IS NULL ORDER BY q.created_at`, [set.id, req.user.id]),
    adminPool.query(`SELECT ${cols} ${from} WHERE q.set_id = $1 AND q.decided_at IS NOT NULL ORDER BY q.decided_at DESC LIMIT 20`, [set.id, req.user.id]),
    adminPool.query('SELECT count(*)::int AS voters FROM study_set_voters($1)', [set.id]),
  ]);
  for (const q of open) q.voters = voters;
  return { open, decided };
}

/** A change by a member editing with approval or votes: a proposal (the proposer votes yes; a binding vote may be
 *  decided at once — two who vote: accepted). → {proposal: {id, outcome}} or an error text. */
async function propose(req, set, change) {
  const procedure = set.rights === 'approval' ? 'approval' : set.vote_mode;
  const { rows: [{ n }] } = await adminPool.query('SELECT count(*)::int AS n FROM study_set_proposals WHERE set_id = $1 AND decided_at IS NULL', [set.id]);
  if (n >= MAX_OPEN_PROPOSALS) return { error: `at most ${MAX_OPEN_PROPOSALS} open proposals in a set — wait for the owner` };
  return asUser(req, async (db) => {
    const { rows: [q] } = await db.query(`INSERT INTO study_set_proposals (set_id, kind, entity_type, entity_id, field, old_value, new_value, procedure, proposed_by, reason, closes_at)
      VALUES ($1, $2, $3::entity_type, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $8 = 'binding' THEN now() + make_interval(hours => $11) END)
      ON CONFLICT (set_id, entity_type, entity_id) WHERE decided_at IS NULL AND kind <> 'field' DO NOTHING RETURNING id`,
    [set.id, change.kind, change.type || null, change.entity || null, change.field || null, change.old ?? null, change.value ?? null,
      procedure, req.user.id, change.reason || null, set.vote_hours]);
    if (!q) return { error: 'that is proposed already — vote on it' };
    if (procedure !== 'approval') await db.query(`INSERT INTO study_set_votes (proposal_id, voter_id, vote) VALUES ($1, $2, 'yes')`, [q.id, req.user.id]);
    const { rows: [r] } = procedure === 'binding' ? await db.query('SELECT study_proposal_settle($1) AS outcome', [q.id]) : { rows: [{ outcome: null }] };
    return { proposal: { id: String(q.id), procedure, outcome: r.outcome } };
  });
}
const proposed = (res, out) => (out.error ? fail(res, 409, out.error) : res.status(202).json({ proposed: true, ...out }));

// name, topic, description — the owner or a member with full rights at once; with approval or votes: a proposal per
// field changed. base_<field>: what the form showed when editing began; a field changed by someone else since (and not
// to the same) is a conflict: nothing is saved, the set as it is now comes back.
router.post('/:id', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (viewerOut(res, set) || lockedOut(res, set)) return;
  const MAX = { name: 120, topic: 80, description: MAX_DESCRIPTION };
  const next = {};
  for (const f of Object.keys(MAX)) next[f] = req.body[f] === undefined ? set[f] : text(req.body[f], MAX[f]) || null;
  if (!next.name) return fail(res, 422, 'a set needs a name');
  const changed = Object.keys(MAX).filter((f) => req.body[`base_${f}`] !== undefined
    && (text(req.body[`base_${f}`], MAX[f]) || null) !== set[f] && next[f] !== set[f]);
  if (changed.length) return res.status(409).json({ error: 'changed', fields: changed, by: set.updated_by, set: await describe(set) });
  if (!direct(set)) {
    const fields = Object.keys(MAX).filter((f) => next[f] !== set[f]);
    if (!fields.length) return res.json({ set: await describe(set) });
    const out = [];
    for (const f of fields) {
      const r = await propose(req, set, { kind: 'field', field: f, old: set[f], value: next[f], reason: text(req.body.reason, 500) });
      if (r.error) return fail(res, 409, r.error);
      out.push(r.proposal);
    }
    return res.status(202).json({ proposed: true, proposals: out });
  }
  await asUser(req, (db) => db.query('UPDATE study_sets SET name = $2, topic = $3, description = $4, updated_by = $5 WHERE id = $1',
    [set.id, next.name, next.topic, next.description, req.user.id]));
  res.json({ set: await describe(await ownSet(req)) });
});

/** Private again: the members, invitations and links go; open proposals close (228: "private = its owner only"). */
async function makePrivate(db, setId) {
  await db.query('DELETE FROM study_set_members WHERE set_id = $1', [setId]);
  await db.query('DELETE FROM study_set_invitations WHERE set_id = $1', [setId]);
  await db.query('UPDATE study_set_links SET ended_at = now() WHERE set_id = $1 AND ended_at IS NULL', [setId]);
  await db.query(`UPDATE study_set_proposals SET decided_at = now(), outcome = 'closed' WHERE set_id = $1 AND decided_at IS NULL`, [setId]);
}

// who sees it: private (its owner only), shared (its members), public (anyone, listed) — a shared or public set shows
// the owner's public name, so sharing needs one
router.post('/:id/share', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (ownerOnly(res, set)) return;
  const visibility = VISIBILITY.includes(req.body.visibility) ? req.body.visibility : set.visibility;
  let publicName = req.body.public_name === undefined ? undefined : text(req.body.public_name, 60) || null;
  if (publicName !== undefined) {
    if (publicName && publicName.toLowerCase() === req.user.username.toLowerCase()) return fail(res, 422, 'choose a public name other than your login name');
    if (!publicName && (visibility !== 'private' || set.members.length)) return fail(res, 422, 'a shared set shows your public name — choose one first');
    await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, publicName]);
  } else {
    publicName = (await adminPool.query('SELECT public_name FROM admin_users WHERE id = $1', [req.user.id])).rows[0].public_name;
  }
  if (visibility !== 'private' && !publicName) return fail(res, 422, 'a shared set shows your public name — choose one first');
  await asUser(req, async (db) => {
    if (visibility === 'private') await makePrivate(db, set.id);
    // public: an address of its own (a new one each time it is made public); not public: none
    await db.query(`UPDATE study_sets SET visibility = $2,
        share_code = CASE WHEN $2 = 'public' THEN coalesce(CASE WHEN visibility = 'public' THEN share_code END, $3) END,
        shared_at = CASE WHEN $2 = 'private' THEN NULL ELSE coalesce(shared_at, now()) END WHERE id = $1`, [set.id, visibility, newCode()]);
  });
  res.json({ set: await ownSet(req), public_name: publicName });
});

router.post('/:id/delete', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (ownerOnly(res, set)) return;
  await adminPool.query('DELETE FROM study_sets WHERE id = $1 AND owner_id = $2', [set.id, req.user.id]);
  res.status(204).end();
});

router.post('/:id/items', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (viewerOut(res, set) || lockedOut(res, set)) return;
  const id = await entryId(req.body.type, req.body.slug);
  if (!id) return fail(res, 422, 'no such entry');
  if (await countOf(set.id) >= MAX_ITEMS) return fail(res, 422, `at most ${MAX_ITEMS} entries in a set`);
  if (!direct(set)) {
    const { rows: [has] } = await adminPool.query('SELECT 1 FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]);
    if (has) return res.json({ count: await countOf(set.id) });
    return proposed(res, await propose(req, set, { kind: 'add', type: req.body.type, entity: id, reason: text(req.body.reason, 500) }));
  }
  await asUser(req, async (db) => {
    const { rowCount } = await db.query('INSERT INTO study_set_items (set_id, entity_type, entity_id, added_by) VALUES ($1, $2::entity_type, $3, $4) ON CONFLICT DO NOTHING',
      [set.id, req.body.type, id, req.user.id]);
    if (rowCount) await db.query('UPDATE study_sets SET updated_by = $2 WHERE id = $1', [set.id, req.user.id]);
  });
  res.json({ count: await countOf(set.id) });
});

router.post('/:id/items/remove', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (viewerOut(res, set) || lockedOut(res, set)) return;
  const id = await entryId(req.body.type, req.body.slug);
  if (id && !direct(set)) {
    const { rows: [has] } = await adminPool.query('SELECT 1 FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]);
    if (!has) return res.json({ count: await countOf(set.id) });
    return proposed(res, await propose(req, set, { kind: 'remove', type: req.body.type, entity: id, reason: text(req.body.reason, 500) }));
  }
  await asUser(req, async (db) => {
    const gone = id && (await db.query('DELETE FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id])).rowCount;
    if (gone) await db.query('UPDATE study_sets SET updated_by = $2 WHERE id = $1', [set.id, req.user.id]);
  });
  res.json({ count: await countOf(set.id) });
});

router.get('/:id/cards', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  res.json({ set, cards: await cardsOf(req, set.id) });
});

router.post('/:id/sessions', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  return recordSession(req, res, set.id);
});

router.get('/:id/stats', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  res.json(await statsOf(req, set.id));
});

router.post('/:id/plan', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  return savePlan(req, res, set.id);
});


// The owner's side (members, links, invitations, votes, history, proposals) and the chat live in their own files
// (2026-11-07), mounted here with what they share — passed in, not required back (no cycle)
const lent = { ALIVE, CHATTER, ID, MAX_DESCRIPTION, MAX_EDITORS, MAX_SETS, MAX_VIEWERS, RIGHTS, TODAY, adminPool, asUser, countOf, describe, direct, ensurePublicName, entryId, fail, lockedOut, newLinkCode, ownSet, ownerOnly, proposalsOf, propose, proposed, roomFor, settleSet, text, viewerOut };
router.use(require('./site-sets-members')(lent));
router.use(require('./site-sets-chat')(lent));


module.exports = router;
module.exports.shared = shared;

