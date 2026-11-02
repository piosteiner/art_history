// GET /v1/quiz/… — questions for the site's quiz page (/quiz, owner 2026-11-02). Each answer is a game of n rounds,
// drawn at random (never cached), with the right answers in it: the site checks them itself — a learning game, not an exam.
//   /quiz/image?n=10                a picture → title, artist, year, movement
//   /quiz/artist?n=8                an artist → which of 8 works are theirs; the others look alike (same movement,
//                                   same time, same kind of object)
//   /quiz/movement?n=8&mode=pick|name|mixed   pick: a movement → its works among 8; name: 3 works → their movement of 4
//   /quiz/glossary?n=10&mode=definition|term|describe|mixed   a term → its definition of 4 / a definition (the term
//                                   blanked out) → its term of 4 / describe it, then compare with the definition
//   &for=<slug>: about that work, artist, movement or term only
// What belongs to a movement is the view movement_works (100): linked directly or through the artist while it lasted,
// parts rolled up into their whole. Wrong options never belong to it: works with a movement of their own (an unlinked
// work might belong after all) whose artist isn't linked to it; movements that hold none of the shown works.
// Logged in on the site, the same games come from the admin host (routes/site-account.js → GET /site/quiz/<kind>, the
// admin role): works with only the account's private reference images (184) count as pictured too, shown with that
// image (`own: true`), and ?mine=only (pictures) takes those only. The public API never sees private_images.
const express = require('express');
const { apiPool } = require('../db');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');   // a new draw every time
  next();
});

/** ?for=<slug>: rounds about this artist, movement or term only (one round, if it qualifies) */
const only = (q) => (typeof q.for === 'string' && q.for ? q.for : null);
const count = (v, def, max) => Math.min(max, Math.max(1, Number.parseInt(v, 10) || def));
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** How many of the 8 options are right: 2–4, at most as many as there are. */
const rightCount = (available) => Math.min(available, 2 + Math.floor(Math.random() * 3));
const OPTIONS = 8;

// works the quiz can show: with a picture (the first, as on the entry page), not a whole made of parts (a series).
// `owner`: also with a private image of this account — 'private:<id>' as image_url, made an address by privatize();
// `onlyOwn`: only those, with the private image.
function pictured(owner = null, onlyOwn = false) {
  const priv = owner === null ? null : `(SELECT p.id FROM private_images p WHERE p.artwork_id = a.id AND p.owner_id = ${Number(owner)} ORDER BY p.position, p.id LIMIT 1)`;
  const url = !priv ? 'img.url' : onlyOwn ? `'private:' || pi.id` : `coalesce(img.url, 'private:' || pi.id)`;
  const pub = onlyOwn ? 'false' : 'img.url IS NOT NULL';
  return `
  SELECT a.id, a.slug, a.public_id, a.title, a.creator_id, a.created, a.created_label, a.kind, a.names, ${url} AS image_url,
         CASE WHEN ${pub} THEN img.credit END AS credit, CASE WHEN ${pub} THEN img.license END AS license
  FROM artworks a
  LEFT JOIN LATERAL (SELECT i.url, i.credit, i.license FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  ${priv ? `LEFT JOIN LATERAL (SELECT ${priv} AS id) pi ON true` : ''}
  WHERE (a.kind_term_id IS NULL OR NOT artwork_is_group(a.kind_term_id)) AND ${priv ? `(${pub} OR pi.id IS NOT NULL)` : 'img.url IS NOT NULL'}`;
}
const PUBLIC = { db: apiPool, pictured: pictured() };

/** 'private:<id>' → the image's address on the admin host, marked `own` (only for the account's own answers). */
function privatize(v, origin) {
  if (Array.isArray(v)) v.forEach((x) => privatize(x, origin));
  else if (v && typeof v === 'object') {
    if (typeof v.image_url === 'string' && v.image_url.startsWith('private:')) {
      v.image_url = `${origin}/private-images/${v.image_url.slice(8)}`;
      v.own = true;
    }
    Object.values(v).forEach((x) => privatize(x, origin));
  }
  return v;
}

// a work as an option: what the site shows once the round is answered
const OPTION_COLUMNS = `w.slug, w.public_id, w.title,
  (SELECT ruby_plain(n->>'text') FROM jsonb_array_elements(w.names) n WHERE n->>'lang' = 'en' AND n->>'role' = 'translation' LIMIT 1) AS title_en, w.image_url, w.credit, w.license, range_json(w.created, w.created_label) AS created,
  (SELECT string_agg(c->>'name', ', ') FROM jsonb_array_elements(artwork_creators(w.id)) c) AS creator`;

// names a typed answer may match: the main one and every other (translations, romanizations, former names — furigana
// taken out)
const namesOf = (alias, main) => `array_remove(ARRAY[${alias}.${main}] || ARRAY(SELECT ruby_plain(n->>'text') FROM jsonb_array_elements(${alias}.names) n), NULL)`;

// --- 1. the picture: title, artist, year, movement ----------------------------------------------------------------
async function image(q, { db, pictured: PICTURED }) {
  const n = count(q.n, 10, 20);
  const { rows: picked } = await db.query(`SELECT id FROM (${PICTURED}) w WHERE $2::text IS NULL OR w.slug = $2 ORDER BY random() LIMIT $1`, [n, only(q)]);
  const { rows } = await db.query(`
    SELECT a.slug, a.public_id, a.title, ${namesOf('a', 'title')} AS titles, range_json(a.created, a.created_label) AS created,
           w.image_url, w.credit, w.license, a.attribution_label AS attribution,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', ar.slug, 'public_id', ar.public_id, 'name', ar.name, 'family_name', ar.family_name,
                     'names', ${namesOf('ar', 'name')}, 'main', (c->>'main')::boolean) ORDER BY (c->>'main')::boolean DESC), '[]')
              FROM jsonb_array_elements(artwork_creators(a.id)) c JOIN artists ar ON ar.slug = c->>'slug') AS creators,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', m.slug, 'public_id', m.public_id, 'name', m.name, 'names', ${namesOf('m', 'name')}) ORDER BY m.name), '[]')
              FROM movement_works mw JOIN movements m ON m.id = mw.movement_id WHERE mw.artwork_id = a.id) AS movements
    FROM unnest($1::bigint[]) WITH ORDINALITY AS p(id, i) JOIN artworks a ON a.id = p.id JOIN (${PICTURED}) w ON w.id = a.id
    ORDER BY p.i`, [picked.map((r) => r.id)]);
  // the movements a guess can be chosen from: those with works (the input's suggestions)
  const { rows: movements } = await db.query(`SELECT m.name FROM movements m
    WHERE EXISTS (SELECT 1 FROM movement_works mw WHERE mw.movement_id = m.id) ORDER BY m.name COLLATE sort_natural`);
  return { data: rows, movements: movements.map((m) => m.name) };
}

// --- 2. the artist: which works are theirs ------------------------------------------------------------------------
async function artist(q, { db, pictured: PICTURED }) {
  const n = count(q.n, 8, 15);
  const { rows: artists } = await db.query(`
    SELECT ar.id, ar.slug, ar.public_id, ar.name, ar.birth_label, ar.death_label, ar.active_label
    FROM artists ar
    WHERE ar.id IN (SELECT creator_id FROM (${PICTURED}) w GROUP BY creator_id HAVING count(*) >= 3) AND ($2::text IS NULL OR ar.slug = $2)
    ORDER BY random() LIMIT $1`, [n, only(q)]);
  const rounds = [];
  for (const ar of artists) {
    const { rows: own } = await db.query(`SELECT ${OPTION_COLUMNS}, true AS correct FROM (${PICTURED}) w WHERE w.creator_id = $1 ORDER BY random() LIMIT $2`,
      [ar.id, 4]);
    const right = own.slice(0, rightCount(own.length));
    // look-alikes: a movement of the artist or of their works, the same years (±20), the same kind of object
    const { rows: others } = await db.query(`
      WITH mw AS MATERIALIZED (SELECT movement_id, artwork_id FROM movement_works),
      mine AS (SELECT id, created, kind FROM artworks WHERE creator_id = $1),
      mov AS (SELECT movement_id FROM mw WHERE artwork_id IN (SELECT id FROM mine)
              UNION SELECT movement_id FROM movement_artists WHERE artist_id = $1),
      alike AS MATERIALIZED (SELECT DISTINCT artwork_id FROM mw WHERE movement_id IN (SELECT movement_id FROM mov)),
      span AS (SELECT daterange((min(lower(created)) - interval '20 years')::date, (max(upper(created)) + interval '20 years')::date) AS r
               FROM mine WHERE created IS NOT NULL)
      SELECT ${OPTION_COLUMNS}, false AS correct FROM (
        SELECT w.* FROM (${PICTURED}) w, span
        WHERE w.creator_id IS DISTINCT FROM $1
          AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'artwork' AND r.subject_id = w.id
                            AND r.relationship_type = 'co_creator' AND r.object_type = 'artist' AND r.object_id = $1)
        ORDER BY 4 * (w.id IN (SELECT artwork_id FROM alike))::int
               + 2 * coalesce(w.created && span.r, false)::int
               + coalesce(w.kind IN (SELECT kind FROM mine), false)::int
               + 1.5 * random() DESC
        LIMIT $2) w`, [ar.id, OPTIONS - right.length]);
    rounds.push({
      artist: { slug: ar.slug, public_id: ar.public_id, name: ar.name, dates: [ar.birth_label, ar.death_label].some(Boolean)
        ? `${ar.birth_label ?? '?'} – ${ar.death_label ?? '?'}` : ar.active_label ? `active ${ar.active_label}` : null },
      options: shuffle([...right, ...others]),
    });
  }
  return { data: rounds };
}

// --- 3. the movement: its works, or the movement of three works -------------------------------------------------
// movement_works once per query, and when each movement was: its dates, else the years of its works
const SPANS = `mw AS MATERIALIZED (SELECT movement_id, artwork_id FROM movement_works),
  spans AS MATERIALIZED (SELECT m.id, m.kind, m.period AS own, coalesce(m.period, x.span) AS span FROM movements m
    LEFT JOIN (SELECT mw.movement_id, range_merge(range_agg(a.created)) AS span FROM mw JOIN artworks a ON a.id = mw.artwork_id
               WHERE a.created IS NOT NULL GROUP BY 1) x ON x.movement_id = m.id)`;
const MOVEMENT = `m.slug, m.public_id, m.name, m.kind::text AS kind, range_json(m.period, m.period_label) AS period`;

async function movement(q, { db, pictured: PICTURED }) {
  const n = count(q.n, 8, 15);
  const mode = ['pick', 'name'].includes(q.mode) ? q.mode : 'mixed';
  const { rows: movements } = await db.query(`
    SELECT m.id, ${MOVEMENT} FROM movements m
    WHERE m.id IN (SELECT mw.movement_id FROM movement_works mw JOIN (${PICTURED}) w ON w.id = mw.artwork_id GROUP BY 1 HAVING count(*) >= 3)
      AND ($2::text IS NULL OR m.slug = $2)
    ORDER BY random() LIMIT $1`, [n, only(q)]);
  const rounds = [];
  for (const m of movements) {
    const kind = mode === 'mixed' ? (Math.random() < 0.5 ? 'pick' : 'name') : mode;
    const { id, ...movement } = m;
    if (kind === 'pick') {
      const { rows: own } = await db.query(`SELECT ${OPTION_COLUMNS}, true AS correct FROM (${PICTURED}) w
        WHERE w.id IN (SELECT artwork_id FROM movement_works WHERE movement_id = $1) ORDER BY random() LIMIT 4`, [id]);
      const right = own.slice(0, rightCount(own.length));
      // works of another movement, not of this one nor by one of its artists — of its time and of movements beside it first
      const { rows: others } = await db.query(`
        WITH ${SPANS},
        me AS (SELECT span AS period, kind FROM spans WHERE id = $1),
        -- works of movements beside it: of its time or of its kind
        alike AS MATERIALIZED (SELECT DISTINCT mw.artwork_id FROM mw JOIN spans o ON o.id = mw.movement_id, me
                               WHERE coalesce(o.span && me.period, false) OR o.kind = me.kind)
        SELECT ${OPTION_COLUMNS}, false AS correct FROM (
        SELECT w.* FROM (${PICTURED}) w, me
        WHERE w.id NOT IN (SELECT artwork_id FROM mw WHERE movement_id = $1)
          AND (w.creator_id IS NULL OR w.creator_id NOT IN (SELECT artist_id FROM movement_artists WHERE movement_id = $1))
          AND w.id IN (SELECT artwork_id FROM mw)
          AND NOT (me.kind = 'period' AND coalesce(w.created && me.period, false))
        ORDER BY 3 * (w.id IN (SELECT artwork_id FROM alike))::int
               + 2 * coalesce(w.created && daterange((lower(me.period) - interval '50 years')::date, (upper(me.period) + interval '50 years')::date), false)::int
               + 1.5 * random() DESC
        LIMIT $2) w`, [id, OPTIONS - right.length]);
      rounds.push({ kind, movement, options: shuffle([...right, ...others]) });
    } else {
      const { rows: works } = await db.query(`SELECT ${OPTION_COLUMNS} FROM (${PICTURED}) w
        WHERE w.id IN (SELECT artwork_id FROM movement_works WHERE movement_id = $1) ORDER BY random() LIMIT 3`, [id]);
      // three other movements holding none of the shown works, outside this one's tree (its parts are in it, its
      // wholes hold the works): the same kind and time first
      const { rows: others } = await db.query(`
        WITH RECURSIVE ${SPANS},
        me AS (SELECT span AS period, own, kind FROM spans WHERE id = $1),
        tree AS (SELECT $1::bigint AS id UNION SELECT c.id FROM movements c JOIN tree t ON c.parent_id = t.id)
        SELECT ${MOVEMENT} FROM movements m JOIN spans s ON s.id = m.id, me
        WHERE m.id NOT IN (SELECT id FROM tree)
          AND NOT EXISTS (SELECT 1 FROM mw JOIN artworks a ON a.id = mw.artwork_id WHERE mw.movement_id = m.id AND a.slug = ANY($2))
          AND m.id IN (SELECT movement_id FROM mw)
          AND NOT (m.kind = 'period' AND me.kind = 'period' AND coalesce(s.own && me.own, false))
        ORDER BY 2 * (m.kind = me.kind)::int + 2 * coalesce(s.span && daterange((lower(me.period) - interval '100 years')::date, (upper(me.period) + interval '100 years')::date), false)::int
               + 1.5 * random() DESC
        LIMIT 3`, [id, works.map((w) => w.slug)]);
      rounds.push({ kind, works, answer: movement.slug, options: shuffle([movement, ...others]) });
    }
  }
  return { data: rounds };
}

// --- 4. the glossary ---------------------------------------------------------------------------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The definition without the term's own names (and their plurals) — for "which term is this?" —, and without the
 *  longer words of names of several ("katsura" of "katsura wood"; "wood" stays: too general to give it away). */
function blank(definition, names) {
  const parts = names.flatMap((x) => (x && /\s/.test(x) ? x.split(/[\s-]+/).filter((w) => w.length >= 5) : []));
  const words = [...new Set([...names, ...parts].filter((x) => x && x.length > 1))].sort((a, b) => b.length - a.length);
  if (!words.length) return definition;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRe).join('|')})(?:e?s)?(?![\\p{L}\\p{N}])`, 'giu');
  return definition.replace(re, '…');
}

async function glossary(q, { db }) {
  const n = count(q.n, 10, 20);
  const mode = ['definition', 'term', 'describe'].includes(q.mode) ? q.mode : 'mixed';
  const TERM = `g.slug, g.public_id, g.name, g.category::text AS category, g.definition`;
  const { rows: terms } = await db.query(`
    SELECT g.id, ${TERM}, ${namesOf('g', 'name')} AS names FROM glossary g
    WHERE char_length(g.definition) >= 40 AND ($2::text IS NULL OR g.slug = $2) ORDER BY random() LIMIT $1`, [n, only(q)]);
  const rounds = [];
  for (const t of terms) {
    const kind = mode === 'mixed' ? ['definition', 'term', 'describe'][Math.floor(Math.random() * 3)] : mode;
    const { id, names: _names, ...term } = t;
    if (kind === 'describe') {
      rounds.push({ kind, term });
      continue;
    }
    // three others of the same category first — not its broader or narrower term (too close to tell apart)
    const { rows: others } = await db.query(`
      SELECT ${TERM}, ${namesOf('g', 'name')} AS names FROM glossary g, glossary me
      WHERE me.id = $1 AND g.id <> me.id AND char_length(g.definition) >= 40
        AND g.id IS DISTINCT FROM me.parent_id AND g.parent_id IS DISTINCT FROM me.id
        AND f_unaccent(lower(g.name)) <> f_unaccent(lower(me.name))
      ORDER BY 3 * (g.category = me.category)::int + random() DESC LIMIT 3`, [id]);
    // no definition gives its own term away: each without its names
    const [self, ...rest] = [t, ...others].map(({ id: _id, names: own, ...o }) => ({ ...o, definition: blank(o.definition, own) }));
    rounds.push({ kind, term: kind === 'term' ? self : term, answer: term.slug, options: shuffle([self, ...rest]) });
  }
  return { data: rounds };
}

const QUIZZES = { image, artist, movement, glossary };
for (const [kind, quiz] of Object.entries(QUIZZES)) router.get(`/${kind}`, async (req, res) => res.json(await quiz(req.query, PUBLIC)));

/** One game for a logged-in account (routes/site-account.js): its private images count too. → null: no such game. */
async function forAccount(kind, q, { db, owner, origin }) {
  const quiz = Object.hasOwn(QUIZZES, kind) ? QUIZZES[kind] : null;
  if (!quiz) return null;
  return privatize(await quiz(q, { db, pictured: pictured(owner, kind === 'image' && q.mine === 'only') }), origin);
}

module.exports = router;
module.exports.blank = blank;
module.exports.forAccount = forAccount;
