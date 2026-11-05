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
//   POST /site/sets/:id/share             visibility (private|link|public), public_name, new_link=1 → {set, public_name} (219)
//   POST /site/sets/:id/sessions          mode, answered, known, seconds, complete → 201 — one round of a quiz (219)
//   POST /site/sets/preview               text → {html} — a description as it will look (Markdown, src/markdown.js)
//   GET  /site/sets/:id/stats             the account's results on this set per kind of quiz, its boxes, hardest cards
//   POST /site/sets/:id/delete            → 204
//   POST /site/sets/:id/items             type, slug → {count}   (adding twice changes nothing)
//   POST /site/sets/:id/items/remove      type, slug → {count}
//   GET  /site/sets/:id/cards             {set, cards: [card + progress {forward, reverse}]} (src/study.js)
//   POST /site/sets/progress              type, slug, direction (forward|reverse), known (1|0) → {box}
// Shared sets (219) — the router `shared` below, mounted at /site/shared before any login is asked:
//   GET  /site/shared?topic=&q=           {sets: [public sets with creator], topics: [{topic, count}]}
//   GET  /site/shared/:code               {set (+ creator, mine), items} — a set shared by link or public; anyone
//   GET  /site/shared/:code/cards         its index cards (logged in: with the account's own progress)
//   POST /site/shared/:code/copy          logged in: a copy among the account's sets → {set}
//   POST /site/shared/:code/sessions      logged in: one round of a quiz on it (the account's results, never the owner's)
//   GET  /site/shared/:code/stats         logged in: the account's results on it
//   POST /site/shared/:code/plan          logged in: exam_on (YYYY-MM-DD, empty = none) — the account's exam date (220)
// Sets edited together (220): the owner's invitation link /sets/join/<edit_code> — anyone logged in with a public name
// joins as an editor: name, topic, description, entries; sharing, editors and deleting stay the owner's.
//   GET  /site/shared/join/:code          {set: {name, topic, creator, count, editors}, role} — what the invitation is for
//   POST /site/shared/join/:code          logged in: public_name (if none yet) → {set: {id}}
//   POST /site/sets/:id/editors           the owner: action=invite (a new link; the old one ends) | stop | remove&account=<id>
//   POST /site/sets/:id/leave             an editor leaves the set
//   POST /site/sets/:id                   … + base_name, base_topic, base_description: what the form started from — a
//                                         field someone else changed meanwhile → 409 {error: 'changed', set, by}
// History, restore, lock, proposed removals (221): every change of a set is an event (study_set_events, by triggers —
// the actor is the transaction's arthistory.user_id, so every write goes through asUser()).
//   GET  /site/sets/:id/history            owner and editors: {events: [{at, action, field, old, new, entry, by, detail}]}
//   POST /site/sets/:id/restore            the owner: at (ISO time), reason → the set as it was then (itself an event)
//   POST /site/sets/:id/lock               the owner: locked=1|0 — locked, editors read and study but change nothing
//   POST /site/sets/:id/proposals          an editor: type, slug, reason → an entry someone else added proposed for removal
//   POST /site/sets/:id/proposals/:pid/vote    owner or editor: remove=1|0 (again = changed)
//   POST /site/sets/:id/proposals/:pid/decide  the owner: decision=removed|kept — at any time, whatever the votes
// An editor removes the entries they added themselves; others' they propose. The set's proposals come with GET /:id,
// the list carries `proposals` (open) and `to_vote` (open, not yet voted by the account) per set.
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
const ID = /^[1-9][0-9]{0,17}$/;
const CODE = /^[A-Za-z0-9_-]{12}$/;
const TYPES = ['artwork', 'artist', 'person', 'institution', 'event', 'movement', 'place', 'polity', 'literature', 'term', 'source'];
const MODES = ['forward', 'reverse', 'both', 'typed', 'choice'];
const VISIBILITY = ['private', 'link', 'public'];
const MAX_SETS = 300;
const MAX_ITEMS = 3000;
const MAX_DESCRIPTION = 10000;
const MAX_EDITORS = 50;
const NEW_PER_DAY = 20;          // new cards a day without an exam date
const EDIT_CODE = /^[A-Za-z0-9_-]{16}$/;
const newEditCode = () => crypto.randomBytes(12).toString('base64url');   // 16 characters, 96 bits
const TODAY = `(now() AT TIME ZONE 'Europe/Zurich')::date`;

const fail = (res, status, error) => res.status(status).json({ error });
const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const newCode = () => crypto.randomBytes(9).toString('base64url');   // 12 characters, 72 bits: not guessed
// what a set shows of itself (to its owner: everything; others never see owner_id or copied_from's id)
const SET_COLS = `s.id, s.name, s.topic, s.description, s.visibility, s.share_code AS code, s.created_at, s.updated_at, s.locked_at, s.chat_on,
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

/** The account's set `id` — its own, or one it edits (220) — or null. `role`: owner | editor. */
async function ownSet(req) {
  if (!ID.test(req.params.id)) return null;
  const { rows } = await adminPool.query(`SELECT ${SET_COLS}, ${CREATOR}, CASE WHEN s.owner_id = $2 THEN 'owner' ELSE 'editor' END AS role,
      CASE WHEN s.owner_id = $2 THEN s.edit_code END AS edit_code,
      (SELECT u.public_name FROM admin_users u WHERE u.id = s.updated_by) AS updated_by,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.account_id::text, 'name', u.public_name, 'me', e.account_id = $2) ORDER BY e.added_at), '[]')
         FROM study_set_editors e JOIN admin_users u ON u.id = e.account_id WHERE e.set_id = s.id) AS editors,
      (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $2 AND p.set_id = s.id) AS exam_on,
      (SELECT jsonb_build_object('name', o.name, 'code', o.share_code, 'creator', (SELECT u.public_name FROM admin_users u WHERE u.id = o.owner_id))
         FROM study_sets o WHERE o.id = s.copied_from AND o.visibility <> 'private') AS copied_from
    FROM study_sets s WHERE s.id = $1 AND ${ALIVE}
      AND (s.owner_id = $2 OR EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $2))`, [req.params.id, req.user.id]);
  return rows[0] || null;
}
const ownerOnly = (res, set) => (set.role === 'owner' ? false : (fail(res, 403, 'only the owner of the set may do that'), true));
/** A locked set (221) is changed by its owner only. */
const lockedOut = (res, set) => (set.locked_at && set.role !== 'owner' ? (fail(res, 423, 'the owner has locked this set'), true) : false);

/** A set shared by link or in public, by its code — or null. `mine`: the viewer is its owner. */
async function sharedSet(req) {
  if (!CODE.test(req.params.code)) return null;
  const { rows } = await adminPool.query(`SELECT ${SET_COLS}, ${CREATOR},
      (s.owner_id IS NOT DISTINCT FROM $2 OR EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $2)) AS mine,
      (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $2 AND p.set_id = s.id) AS exam_on
    FROM study_sets s WHERE s.share_code = $1 AND s.visibility <> 'private' AND ${ALIVE}`, [req.params.code, req.user ? req.user.id : null]);
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
  await adminPool.query(`INSERT INTO study_sessions (owner_id, set_id, mode, answered, known, seconds, complete) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.user.id, setId, mode, answered, known, seconds >= 0 && seconds < 86400 ? seconds : null, req.body.complete !== '0']);
  res.status(201).json({ ok: true });
}

/** The account's results on a set: per kind of quiz (rounds, share known — the last ten, the best whole round), the
 *  cards' Leitner boxes per direction, and the entries most often not known. */
async function statsOf(req, setId) {
  const [modes, boxes, hardest] = await Promise.all([
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
  ]);
  const box = { forward: [0, 0, 0, 0, 0, 0], reverse: [0, 0, 0, 0, 0, 0] };   // [new, box 1 … box 5]
  for (const r of boxes.rows) box[r.direction][r.box] = r.n;
  return { modes: Object.fromEntries(modes.rows.map(({ mode, ...m }) => [mode, m])), boxes: box, hardest: hardest.rows, plan: await planOf(req, setId) };
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
const needLogin = (req, res, next) => (req.user ? next() : fail(res, 401, 'not_logged_in'));

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

// invitations to edit a set together (220)
async function invitedSet(req) {
  if (!EDIT_CODE.test(req.params.code)) return null;
  const { rows: [set] } = await adminPool.query(`SELECT s.id, s.name, s.topic, s.owner_id, ${CREATOR},
      (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id) AS count,
      (SELECT count(*)::int FROM study_set_editors e WHERE e.set_id = s.id) AS editors,
      CASE WHEN s.owner_id = $2 THEN 'owner' WHEN EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $2) THEN 'editor' END AS role
    FROM study_sets s WHERE s.edit_code = $1 AND ${ALIVE}`, [req.params.code, req.user ? req.user.id : null]);
  return set || null;
}
shared.get('/join/:code', async (req, res) => {
  const set = await invitedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { id, owner_id: owner, role, ...rest } = set;
  res.json({ set: role ? { id, ...rest } : rest, role, public_name: req.user ? req.user.public_name : null });
});
shared.post('/join/:code', needLogin, async (req, res) => {
  const set = await invitedSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (set.role) return res.json({ set: { id: set.id } });
  let name = req.user.public_name;
  if (!name) {
    name = text(req.body.public_name, 60);
    if (!name) return fail(res, 422, 'the other editors see your public name — choose one first');
    if (name.toLowerCase() === req.user.username.toLowerCase()) return fail(res, 422, 'choose a public name other than your login name');
    await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, name]);
  }
  if (set.editors >= MAX_EDITORS) return fail(res, 422, `at most ${MAX_EDITORS} editors in a set`);
  await adminPool.query('INSERT INTO study_set_editors (set_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [set.id, req.user.id]);
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

router.get('/', async (req, res) => {
  const [{ rows: sets }, { rows: [me] }, { rows: topics }] = await Promise.all([
    adminPool.query(`SELECT ${SET_COLS}, CASE WHEN s.owner_id = $1 THEN 'owner' ELSE 'editor' END AS role,
        CASE WHEN s.owner_id <> $1 THEN (SELECT u.public_name FROM admin_users u WHERE u.id = s.owner_id) END AS creator,
        (SELECT count(*)::int FROM study_set_editors e WHERE e.set_id = s.id) AS editor_count,
        (SELECT p.exam_on::text FROM study_plans p WHERE p.owner_id = $1 AND p.set_id = s.id) AS exam_on,
        (SELECT count(*)::int FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL) AS proposals,
        s.chat_on, CASE WHEN s.chat_on AND NOT EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = $1)
          THEN (SELECT count(*)::int FROM set_chat_messages m WHERE m.set_id = s.id AND m.sender_id IS DISTINCT FROM $1
            AND NOT EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $1 AND h.hidden_id = m.sender_id)
            AND m.id > coalesce((SELECT r.last_read_id FROM set_chat_reads r WHERE r.set_id = s.id AND r.account_id = $1), 0)) ELSE 0 END AS chat_unread,
        (SELECT count(*)::int FROM study_set_proposals q WHERE q.set_id = s.id AND q.decided_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM study_set_votes v WHERE v.proposal_id = q.id AND v.voter_id = $1)) AS to_vote
      FROM study_sets s WHERE ${ALIVE} AND (s.owner_id = $1 OR EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $1))
      ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id]),
    adminPool.query('SELECT public_name FROM admin_users WHERE id = $1', [req.user.id]),
    adminPool.query(`SELECT topic FROM study_sets WHERE topic IS NOT NULL AND (owner_id = $1 OR visibility = 'public')
      GROUP BY topic ORDER BY bool_or(owner_id = $1) DESC, count(*) DESC, topic LIMIT 100`, [req.user.id]),
  ]);
  res.json({ sets: await described(sets), public_name: me ? me.public_name : null, topics: topics.map((t) => t.topic) });
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

// a description as it will be shown (the Preview tab of the site's Markdown editor, md-editor.ts)
router.post('/preview', async (req, res) => {
  const source = text(req.body.text, MAX_DESCRIPTION);
  if (!source) return res.json({ html: '' });
  const env = { names: await linkNames(adminPool, [source]), used: new Set(), cited: new Set() };
  res.json({ html: renderMarkdown(source, env) });
});

router.get('/of', async (req, res) => {
  const id = await entryId(String(req.query.type || ''), String(req.query.slug || ''));
  if (!id) return fail(res, 404, 'not_found');
  const { rows } = await adminPool.query(`SELECT s.id, s.name, EXISTS (SELECT 1 FROM study_set_items i WHERE i.set_id = s.id
      AND i.entity_type = $2::entity_type AND i.entity_id = $3) AS has
    FROM study_sets s WHERE s.owner_id = $1 OR EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $1)
    ORDER BY s.updated_at DESC, s.id DESC`, [req.user.id, req.query.type, id]);
  res.json({ sets: rows });
});

router.get('/:id', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  res.json({ set: await describe(set), items: await itemsOf(req, set.id, set.editors.length > 0), proposals: await proposalsOf(req, set) });
});

/** The set's open proposals (221) with their votes — named by public name — and the account's own vote. */
async function proposalsOf(req, set) {
  const { rows } = await adminPool.query(`SELECT q.id::text AS id, e.type::text AS type, e.slug, e.name, q.reason, q.created_at,
      (SELECT u.public_name FROM admin_users u WHERE u.id = q.proposed_by) AS proposed_by,
      (SELECT u.public_name FROM admin_users u WHERE u.id = i.added_by) AS added_by,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('by', u.public_name, 'remove', v.remove) ORDER BY v.at), '[]')
         FROM study_set_votes v JOIN admin_users u ON u.id = v.voter_id WHERE v.proposal_id = q.id) AS votes,
      (SELECT v.remove FROM study_set_votes v WHERE v.proposal_id = q.id AND v.voter_id = $2) AS my_vote
    FROM study_set_proposals q JOIN entity_index e ON (e.type, e.id) = (q.entity_type, q.entity_id)
    LEFT JOIN study_set_items i ON (i.set_id, i.entity_type, i.entity_id) = (q.set_id, q.entity_type, q.entity_id)
    WHERE q.set_id = $1 AND q.decided_at IS NULL ORDER BY q.created_at`, [set.id, req.user.id]);
  return rows;
}

// name, topic, description — by the owner or an editor. base_<field>: what the form showed when editing began; a field
// changed by someone else since (and not to the same) is a conflict: nothing is saved, the set as it is now comes back.
router.post('/:id', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (lockedOut(res, set)) return;
  const MAX = { name: 120, topic: 80, description: MAX_DESCRIPTION };
  const next = {};
  for (const f of Object.keys(MAX)) next[f] = req.body[f] === undefined ? set[f] : text(req.body[f], MAX[f]) || null;
  if (!next.name) return fail(res, 422, 'a set needs a name');
  const changed = Object.keys(MAX).filter((f) => req.body[`base_${f}`] !== undefined
    && (text(req.body[`base_${f}`], MAX[f]) || null) !== set[f] && next[f] !== set[f]);
  if (changed.length) return res.status(409).json({ error: 'changed', fields: changed, by: set.updated_by, set: await describe(set) });
  await asUser(req, (db) => db.query('UPDATE study_sets SET name = $2, topic = $3, description = $4, updated_by = $5 WHERE id = $1',
    [set.id, next.name, next.topic, next.description, req.user.id]));
  res.json({ set: await describe(await ownSet(req)) });
});

// sharing: private, by link, in public — a shared set shows the account's public name, so sharing needs one
router.post('/:id/share', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (ownerOnly(res, set)) return;
  const visibility = VISIBILITY.includes(req.body.visibility) ? req.body.visibility : set.visibility;
  let publicName = req.body.public_name === undefined ? undefined : text(req.body.public_name, 60) || null;
  if (publicName !== undefined) {
    if (publicName && publicName.toLowerCase() === req.user.username.toLowerCase()) return fail(res, 422, 'choose a public name other than your login name');
    await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, publicName]);
  } else {
    publicName = (await adminPool.query('SELECT public_name FROM admin_users WHERE id = $1', [req.user.id])).rows[0].public_name;
  }
  if (visibility !== 'private' && !publicName) return fail(res, 422, 'a shared set shows your public name — choose one first');
  // turned off (private): the link ends for good — shared again, it gets a new one (221)
  const code = visibility === 'private' ? null : req.body.new_link === '1' || !set.code ? newCode() : set.code;
  await adminPool.query(`UPDATE study_sets SET visibility = $3, share_code = $4,
      shared_at = CASE WHEN $3 = 'private' THEN NULL ELSE coalesce(shared_at, now()) END WHERE id = $1 AND owner_id = $2`,
    [set.id, req.user.id, visibility, code]);
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
  if (lockedOut(res, set)) return;
  const id = await entryId(req.body.type, req.body.slug);
  if (!id) return fail(res, 422, 'no such entry');
  if (await countOf(set.id) >= MAX_ITEMS) return fail(res, 422, `at most ${MAX_ITEMS} entries in a set`);
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
  if (lockedOut(res, set)) return;
  const id = await entryId(req.body.type, req.body.slug);
  if (id && set.role === 'editor') {
    // an editor removes what they added; an entry someone else added is proposed for removal instead (221)
    const { rows: [it] } = await adminPool.query('SELECT added_by FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]);
    if (it && String(it.added_by) !== String(req.user.id)) return fail(res, 403, 'someone else added this entry — propose its removal instead');
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

// the owner: an invitation link to edit the set together (a new one ends the old), no more invitations, an editor out
router.post('/:id/editors', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (ownerOnly(res, set)) return;
  const action = String(req.body.action || '');
  if (action === 'invite') {
    if (!req.user.public_name) {
      const name = text(req.body.public_name, 60);
      if (!name) return fail(res, 422, 'the editors see your public name — choose one first');
      if (name.toLowerCase() === req.user.username.toLowerCase()) return fail(res, 422, 'choose a public name other than your login name');
      await adminPool.query('UPDATE admin_users SET public_name = $2 WHERE id = $1', [req.user.id, name]);
    }
    await adminPool.query('UPDATE study_sets SET edit_code = $2 WHERE id = $1', [set.id, newEditCode()]);
  } else if (action === 'stop') {
    await adminPool.query('UPDATE study_sets SET edit_code = NULL WHERE id = $1', [set.id]);
  } else if (action === 'remove' && ID.test(String(req.body.account))) {
    await adminPool.query('DELETE FROM study_set_editors WHERE set_id = $1 AND account_id = $2', [set.id, req.body.account]);
  } else return fail(res, 422, 'which action?');
  res.json({ set: await ownSet(req) });
});

// ---- history, restore, lock, proposals (221) ----------------------------------------------------------------------
const MAX_EVENTS = 1000;
router.get('/:id/history', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
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

router.post('/:id/proposals', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (lockedOut(res, set)) return;
  if (set.role === 'owner') return fail(res, 422, 'the owner removes entries directly');
  const id = await entryId(req.body.type, req.body.slug);
  const { rows: [it] } = id ? await adminPool.query('SELECT added_by FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, req.body.type, id]) : { rows: [] };
  if (!it) return fail(res, 422, 'that entry is not in the set');
  await asUser(req, async (db) => {
    const { rows: [q] } = await db.query(`INSERT INTO study_set_proposals (set_id, entity_type, entity_id, proposed_by, reason) VALUES ($1, $2::entity_type, $3, $4, $5)
      ON CONFLICT (set_id, entity_type, entity_id) WHERE decided_at IS NULL DO UPDATE SET reason = coalesce(study_set_proposals.reason, EXCLUDED.reason) RETURNING id`,
    [set.id, req.body.type, id, req.user.id, text(req.body.reason, 500) || null]);
    // proposing is voting to remove
    await db.query(`INSERT INTO study_set_votes (proposal_id, voter_id, remove) VALUES ($1, $2, true)
      ON CONFLICT (proposal_id, voter_id) DO UPDATE SET remove = true, at = now()`, [q.id, req.user.id]);
  });
  res.status(201).json({ proposals: await proposalsOf(req, set) });
});

async function openProposal(req, set) {
  if (!ID.test(req.params.pid)) return null;
  const { rows: [q] } = await adminPool.query(`SELECT id, entity_type::text AS type, entity_id FROM study_set_proposals
    WHERE id = $1 AND set_id = $2 AND decided_at IS NULL`, [req.params.pid, set.id]);
  return q || null;
}
router.post('/:id/proposals/:pid/vote', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (lockedOut(res, set)) return;
  const q = await openProposal(req, set);
  if (!q) return fail(res, 404, 'no such open proposal');
  await adminPool.query(`INSERT INTO study_set_votes (proposal_id, voter_id, remove) VALUES ($1, $2, $3)
    ON CONFLICT (proposal_id, voter_id) DO UPDATE SET remove = EXCLUDED.remove, at = now()`, [q.id, req.user.id, req.body.remove === '1']);
  res.json({ proposals: await proposalsOf(req, set) });
});

router.post('/:id/proposals/:pid/decide', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  if (ownerOnly(res, set)) return;
  const q = await openProposal(req, set);
  if (!q) return fail(res, 404, 'no such open proposal');
  const decision = req.body.decision === 'removed' ? 'removed' : req.body.decision === 'kept' ? 'kept' : null;
  if (!decision) return fail(res, 422, 'removed or kept?');
  await asUser(req, async (db) => {
    // removing closes the proposal through the items trigger; keeping closes it here
    if (decision === 'removed') {
      await db.query('DELETE FROM study_set_items WHERE set_id = $1 AND entity_type = $2::entity_type AND entity_id = $3', [set.id, q.type, q.entity_id]);
      await db.query('UPDATE study_sets SET updated_by = $2 WHERE id = $1', [set.id, req.user.id]);
    }
    await db.query(`UPDATE study_set_proposals SET decided_at = now(), decision = $2, decided_by = $3 WHERE id = $1 AND decided_at IS NULL`, [q.id, decision, req.user.id]);
  });
  res.json({ proposals: await proposalsOf(req, set), count: await countOf(set.id) });
});

// a copy of a set one owns or edits (owner 2026-11-05: an editor can carry on when the owner is gone) — name, topic,
// description, entries; not its editors, history or sharing. The copier owns it.
router.post('/:id/copy', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
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

// ---- the set's chat (225): its owner and editors, whether friends or not; the owner switches it on, removes members
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
      EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $2 AND h.hidden_id = u.id) AS hidden
    FROM study_sets s JOIN admin_users u ON u.id = s.owner_id OR u.id IN (SELECT e.account_id FROM study_set_editors e WHERE e.set_id = s.id)
    WHERE s.id = $1 ORDER BY u.id = s.owner_id DESC, lower(u.public_name)`, [set.id, req.user.id])).rows;
  if (!set.chat_on || (set.removed && !owns(set))) return res.json({ on: set.chat_on, removed: set.removed, messages: [], members: owns(set) ? members : [], more: false });
  const before = ID.test(String(req.query.before || '')) ? req.query.before : null;
  const { rows } = await adminPool.query(`SELECT m.id::text AS id, m.kind, m.sender_id::text AS by_id, m.sender_id = $2 AS mine,
      (SELECT u.public_name FROM admin_users u WHERE u.id = m.sender_id) AS by,
      CASE WHEN m.deleted_at IS NULL THEN m.body END AS body, m.sent_at AS at,
      CASE WHEN m.deleted_at IS NULL THEN NULL WHEN m.deleted_by_owner THEN 'owner' ELSE 'author' END AS deleted,
      EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = m.set_id AND h.hider_id = $2 AND h.hidden_id = m.sender_id) AS hidden
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
    AND u.id IN (SELECT e.account_id FROM study_set_editors e WHERE e.set_id = $3)`, [ID.test(String(req.body.account || '')) ? req.body.account : 0, req.user.id, set.id]);
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
// hiding someone in the set's chat (226): only one's own view — nobody is told
router.post('/:id/chat/hide', async (req, res) => {
  const set = await chatMember(req, res);
  if (!set) return;
  const id = ID.test(String(req.body.account || '')) && String(req.body.account) !== String(req.user.id) ? req.body.account : null;
  const { rows: [m] } = id ? await adminPool.query(`SELECT 1 FROM study_sets s WHERE s.id = $1 AND (s.owner_id = $2
      OR EXISTS (SELECT 1 FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = $2))`, [set.id, id]) : { rows: [] };
  if (!m) return fail(res, 404, 'not a member of this set');
  if (req.body.hide === '0') await adminPool.query('DELETE FROM set_chat_hidden WHERE set_id = $1 AND hider_id = $2 AND hidden_id = $3', [set.id, req.user.id, id]);
  else await adminPool.query('INSERT INTO set_chat_hidden (set_id, hider_id, hidden_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [set.id, req.user.id, id]);
  res.status(204).end();
});

// the set's members (226): its owner and editors — for the owner and the editors
router.get('/:id/members', async (req, res) => {
  const set = await ownSet(req);
  if (!set) return fail(res, 404, 'not_found');
  const { rows } = await adminPool.query(`SELECT u.id::text AS id, u.public_name AS name, CASE WHEN u.id = s.owner_id THEN 'owner' ELSE 'editor' END AS role,
      CASE WHEN u.id = s.owner_id THEN s.created_at ELSE (SELECT e.added_at FROM study_set_editors e WHERE e.set_id = s.id AND e.account_id = u.id) END AS since,
      (SELECT count(*)::int FROM study_set_items i WHERE i.set_id = s.id AND i.added_by = u.id) AS added,
      u.id = $2 AS me, s.chat_on AS chat,
      EXISTS (SELECT 1 FROM set_chat_removed x WHERE x.set_id = s.id AND x.account_id = u.id) AS removed,
      EXISTS (SELECT 1 FROM set_chat_hidden h WHERE h.set_id = s.id AND h.hider_id = $2 AND h.hidden_id = u.id) AS hidden
    FROM study_sets s JOIN admin_users u ON u.id = s.owner_id OR u.id IN (SELECT e.account_id FROM study_set_editors e WHERE e.set_id = s.id)
    WHERE s.id = $1 ORDER BY u.id = s.owner_id DESC, lower(u.public_name)`, [set.id, req.user.id]);
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
  if (set.role !== 'editor') return fail(res, 422, 'the owner can delete the set, not leave it');
  await adminPool.query('DELETE FROM study_set_editors WHERE set_id = $1 AND account_id = $2', [set.id, req.user.id]);
  res.status(204).end();
});

module.exports = router;
module.exports.shared = shared;
