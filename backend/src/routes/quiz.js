// GET /v1/quiz/… — questions for the site's quiz page (/quiz, owner 2026-11-02). Each answer is a game of n rounds,
// drawn at random (never cached), with the right answers in it: the site checks them itself — a learning game, not an exam.
//   /quiz/image?n=10                a picture → title, artist, year, movement
//   /quiz/artist?n=8                an artist → which of 8 works are theirs; the others look alike (same movement,
//                                   same time, same kind of object)
//   /quiz/movement?n=8&mode=pick|name|mixed   pick: a movement → its works among 8; name: 3 works → their movement of 4
//   /quiz/glossary?n=10&mode=definition|term|describe|mixed   a term → its definition of 4 / a definition (the term
//                                   blanked out) → its term of 4 / describe it, then compare with the definition
//   /quiz/regions                   the world regions with how many works the games can show from each
//   &for=<slug>: about that work, artist, movement or term only
//   &region=<world region> (191): only works of that region (entry_regions — worked out, or set by hand). Without one,
//                                   a round stays in its artist's or movement's region: no ukiyo-e among Swiss painters.
//                                   Contemporary art (works from 1945, a movement beginning then) keeps to no region.
//                                   A copy after a work of another region counts in that region too (owner 2026-11-03:
//                                   Van Gogh's Bridge in the Rain after Hiroshige among Hokusai's look-alikes) — counts().
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
// the world regions (migration 191: enum world_region, in its order)
const REGIONS = ['europe', 'middle_east', 'africa', 'central_asia', 'south_asia', 'east_asia', 'southeast_asia', 'oceania', 'north_america', 'south_america'];
/** The regions chosen (`region=east_asia,oceania`, owner 2026-11-04: several at once), values of REGIONS; [] = all. */
const regionsOf = (q) => [...new Set(String(q.region ?? '').split(',').filter((r) => REGIONS.includes(r)))];
/** One chosen region — the round's region when exactly one is chosen (its wrong options keep to it); null otherwise. */
const regionOf = (q) => (regionsOf(q).length === 1 ? regionsOf(q)[0] : null);
/** The works of the chosen regions only (values of REGIONS — safe to write into the query). */
const inRegion = (pictured, regions) => (regions.length
  ? `SELECT * FROM (${pictured}) p WHERE ${regions.map((r) => counts('p', `'${r}'`)).join(' OR ')}` : pictured);
/** An entry's worked-out region (entry_regions) as SQL */
const regionSql = (type, idExpr) => `(SELECT er.region::text FROM entry_regions er WHERE er.entity_type = '${type}' AND er.entity_id = ${idExpr})`;
/**
 * A work counts in a region for the games when it is its own, or the region of a work (or artist) it is a copy after —
 * relationship copy_after: a Japanese print copied in Paris belongs to East Asia as much as to Europe here. As a
 * condition on a pictured work `w` (its own region already in the row), the few copies looked up apart.
 */
const counts = (w, region) => `(${w}.region = ${region} OR ${w}.id IN (SELECT cp.subject_id FROM relationships cp
    JOIN entry_regions cpr ON (cpr.entity_type, cpr.entity_id) = (cp.object_type, cp.object_id)
    WHERE cp.subject_type = 'artwork' AND cp.relationship_type = 'copy_after' AND cpr.region::text = ${region}))`;

// works the quiz can show: with a picture (the first, as on the entry page), not a whole made of parts (a series).
// `owner`: also with a private image of this account — 'private:<id>' as image_url, made an address by privatize();
// `onlyOwn`: only those, with the private image.
function pictured(owner = null, onlyOwn = false) {
  const priv = owner === null ? null : `(SELECT p.id FROM private_images p WHERE p.artwork_id = a.id AND p.owner_id = image_owner(${Number(owner)}) ORDER BY p.position, p.id LIMIT 1)`;
  const url = !priv ? 'img.url' : onlyOwn ? `'private:' || pi.id` : `coalesce(img.url, 'private:' || pi.id)`;
  const pub = onlyOwn ? 'false' : 'img.url IS NOT NULL';
  return `
  SELECT a.id, a.slug, a.public_id, a.title, a.creator_id, a.created, a.created_label, a.kind, a.names, ${url} AS image_url,
         CASE WHEN ${pub} THEN img.credit END AS credit, CASE WHEN ${pub} THEN img.license END AS license,
         ${regionSql('artwork', 'a.id')} AS region
  FROM artworks a
  LEFT JOIN LATERAL (SELECT i.url, i.credit, i.license FROM images i WHERE i.artwork_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  ${priv ? `LEFT JOIN LATERAL (SELECT ${priv} AS id) pi ON true` : ''}
  WHERE (a.kind_term_id IS NULL OR NOT artwork_is_group(a.kind_term_id)) AND ${priv ? `(${pub} OR pi.id IS NOT NULL)` : 'img.url IS NOT NULL'}`;
}
// visitors' games read the stored copies (202: quiz_pictured, quiz_movement_works, quiz_movement_artists — refreshed with
// the worker's global part; every round recomputing the views took 1.1–1.6 s per game at 10× today's data)
const PUBLIC = { db: apiPool, pictured: 'SELECT * FROM quiz_pictured' };

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
// Contemporary art is global (owner 2026-11-03: "for contemporary and newer art we can ignore them since art has become
// global by that time"): a round of an artist whose works all date from then, or of a movement beginning then, keeps to
// no region of its own — a region chosen above the games still applies.
const GLOBAL_FROM = '1945-01-01';
/** Wrong options from the round's region — from anywhere when it has too few (a region with only a handful of works). */
async function enough(query, region) {
  const { rows } = await query(region);
  return region && rows.length < 2 ? (await query(null)).rows : rows;
}

async function image(q, { db, pictured }) {
  const PICTURED = inRegion(pictured, regionsOf(q));
  const n = count(q.n, 10, 20);
  const { rows: picked } = await db.query(`SELECT id FROM (${PICTURED}) w WHERE $2::text IS NULL OR w.slug = $2 ORDER BY random() LIMIT $1`, [n, only(q)]);
  const { rows } = await db.query(`
    SELECT a.slug, a.public_id, a.title, ${namesOf('a', 'title')} AS titles, range_json(a.created, a.created_label) AS created,
           w.image_url, w.credit, w.license, a.attribution_label AS attribution,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', ar.slug, 'public_id', ar.public_id, 'name', ar.name, 'family_name', ar.family_name,
                     'names', ${namesOf('ar', 'name')}, 'main', (c->>'main')::boolean) ORDER BY (c->>'main')::boolean DESC), '[]')
              FROM jsonb_array_elements(artwork_creators(a.id)) c JOIN artists ar ON ar.slug = c->>'slug') AS creators,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', m.slug, 'public_id', m.public_id, 'name', m.name, 'names', ${namesOf('m', 'name')}) ORDER BY m.name), '[]')
              FROM quiz_movement_works mw JOIN movements m ON m.id = mw.movement_id WHERE mw.artwork_id = a.id) AS movements
    FROM unnest($1::bigint[]) WITH ORDINALITY AS p(id, i) JOIN artworks a ON a.id = p.id JOIN (${PICTURED}) w ON w.id = a.id
    ORDER BY p.i`, [picked.map((r) => r.id)]);
  // the movements a guess can be chosen from: those with works (the input's suggestions)
  const { rows: movements } = await db.query(`SELECT m.name FROM movements m
    WHERE EXISTS (SELECT 1 FROM quiz_movement_works mw WHERE mw.movement_id = m.id) ORDER BY m.name COLLATE sort_natural`);
  return { data: rows, movements: movements.map((m) => m.name) };
}

// --- 2. the artist: which works are theirs ------------------------------------------------------------------------
async function artist(q, { db, pictured }) {
  const PICTURED = inRegion(pictured, regionsOf(q));
  const n = count(q.n, 8, 15);
  // the round's region: the one chosen, else the artist's — else the one most of their works are of
  const { rows: artists } = await db.query(`
    SELECT ar.id, ar.slug, ar.public_id, ar.name, ar.birth_label, ar.death_label, ar.active_label,
           coalesce(${regionSql('artist', 'ar.id')}, (SELECT mode() WITHIN GROUP (ORDER BY w.region) FROM (${PICTURED}) w WHERE w.creator_id = ar.id)) AS region,
           coalesce((SELECT min(lower(w.created)) FROM (${PICTURED}) w WHERE w.creator_id = ar.id) >= '${GLOBAL_FROM}', false) AS global
    FROM artists ar
    WHERE ar.id IN (SELECT creator_id FROM (${PICTURED}) w GROUP BY creator_id HAVING count(*) >= 3) AND ($2::text IS NULL OR ar.slug = $2)
    ORDER BY random() LIMIT $1`, [n, only(q)]);
  const rounds = [];
  for (const ar of artists) {
    const { rows: own } = await db.query(`SELECT ${OPTION_COLUMNS}, true AS correct FROM (${PICTURED}) w WHERE w.creator_id = $1 ORDER BY random() LIMIT $2`,
      [ar.id, 4]);
    const right = own.slice(0, rightCount(own.length));
    // look-alikes: a movement of the artist or of their works, the same years (±20), the same kind of object
    const lookAlikes = (region) => db.query(`
      WITH mw AS (SELECT movement_id, artwork_id FROM quiz_movement_works),
      mine AS (SELECT id, created, kind FROM artworks WHERE creator_id = $1),
      mov AS (SELECT movement_id FROM mw WHERE artwork_id IN (SELECT id FROM mine)
              UNION SELECT movement_id FROM quiz_movement_artists WHERE artist_id = $1),
      alike AS MATERIALIZED (SELECT DISTINCT artwork_id FROM mw WHERE movement_id IN (SELECT movement_id FROM mov)),
      -- a copy after one of them looks most alike (Van Gogh after Hiroshige for Hokusai): it borrows the look, so it ranks
      -- above works that merely match in time and kind — whatever its own date and medium
      copies AS MATERIALIZED (SELECT DISTINCT r.subject_id AS artwork_id FROM relationships r
                              WHERE r.relationship_type = 'copy_after' AND r.subject_type = 'artwork' AND r.object_type = 'artwork'
                                AND r.object_id = ANY (ARRAY(SELECT artwork_id FROM alike))),   -- built once, not a loop over the CTE
      span AS (SELECT daterange((min(lower(created)) - interval '20 years')::date, (max(upper(created)) + interval '20 years')::date) AS r
               FROM mine WHERE created IS NOT NULL)
      SELECT ${OPTION_COLUMNS}, false AS correct FROM (
        SELECT w.* FROM (${PICTURED}) w CROSS JOIN span LEFT JOIN copies c ON c.artwork_id = w.id
        WHERE w.creator_id IS DISTINCT FROM $1 AND ($3::text IS NULL OR ${counts('w', '$3')})
          AND NOT EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'artwork' AND r.subject_id = w.id
                            AND r.relationship_type = 'co_creator' AND r.object_type = 'artist' AND r.object_id = $1)
        ORDER BY 4 * (w.id IN (SELECT artwork_id FROM alike))::int
               + 8 * (c.artwork_id IS NOT NULL)::int
               + 2 * coalesce(w.created && span.r, false)::int
               + coalesce(w.kind IN (SELECT kind FROM mine), false)::int
               + 1.5 * random() DESC
        LIMIT $2) w`, [ar.id, OPTIONS - right.length, region]);
    const others = await enough(lookAlikes, regionOf(q) || (ar.global ? null : ar.region));
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
const SPANS = `mw AS (SELECT movement_id, artwork_id FROM quiz_movement_works),
  spans AS MATERIALIZED (SELECT m.id, m.kind, m.period AS own, coalesce(m.period, x.span) AS span FROM movements m
    LEFT JOIN (SELECT mw.movement_id, range_merge(range_agg(a.created)) AS span FROM mw JOIN artworks a ON a.id = mw.artwork_id
               WHERE a.created IS NOT NULL GROUP BY 1) x ON x.movement_id = m.id)`;
const MOVEMENT = `m.slug, m.public_id, m.name, m.kind::text AS kind, range_json(m.period, m.period_label) AS period`;

async function movement(q, { db, pictured }) {
  const PICTURED = inRegion(pictured, regionsOf(q));
  const n = count(q.n, 8, 15);
  const mode = ['pick', 'name'].includes(q.mode) ? q.mode : 'mixed';
  const { rows: movements } = await db.query(`
    SELECT m.id, ${regionSql('movement', 'm.id')} AS region, ${MOVEMENT},
           coalesce(coalesce(lower(m.period), (SELECT min(lower(a.created)) FROM quiz_movement_works mw JOIN artworks a ON a.id = mw.artwork_id
             WHERE mw.movement_id = m.id)) >= '${GLOBAL_FROM}', false) AS global
    FROM movements m
    WHERE m.id IN (SELECT mw.movement_id FROM quiz_movement_works mw JOIN (${PICTURED}) w ON w.id = mw.artwork_id GROUP BY 1 HAVING count(*) >= 3)
      AND ($2::text IS NULL OR m.slug = $2)
    ORDER BY random() LIMIT $1`, [n, only(q)]);
  const rounds = [];
  for (const m of movements) {
    const kind = mode === 'mixed' ? (Math.random() < 0.5 ? 'pick' : 'name') : mode;
    const { id, region: own, global, ...movement } = m;
    // the round's: no works or movements of another region among the options — contemporary art from anywhere
    const region = regionOf(q) || (global ? null : own);
    if (kind === 'pick') {
      const { rows: own } = await db.query(`SELECT ${OPTION_COLUMNS}, true AS correct FROM (${PICTURED}) w
        WHERE w.id IN (SELECT artwork_id FROM quiz_movement_works WHERE movement_id = $1) ORDER BY random() LIMIT 4`, [id]);
      const right = own.slice(0, rightCount(own.length));
      // works of another movement, not of this one nor by one of its artists — of its time and of movements beside it first
      const outside = (region) => db.query(`
        WITH ${SPANS},
        me AS (SELECT span AS period, kind FROM spans WHERE id = $1),
        -- works of movements beside it: of its time or of its kind
        alike AS MATERIALIZED (SELECT DISTINCT mw.artwork_id FROM mw JOIN spans o ON o.id = mw.movement_id, me
                               WHERE coalesce(o.span && me.period, false) OR o.kind = me.kind),
        -- copies after the movement's own works: the closest trap, whatever their own date
        copies AS MATERIALIZED (SELECT DISTINCT r.subject_id AS artwork_id FROM relationships r
                                WHERE r.relationship_type = 'copy_after' AND r.subject_type = 'artwork' AND r.object_type = 'artwork'
                                  AND r.object_id = ANY (ARRAY(SELECT artwork_id FROM mw WHERE movement_id = $1)))   -- built once, not a loop over mw
        SELECT ${OPTION_COLUMNS}, false AS correct FROM (
        SELECT w.* FROM (${PICTURED}) w CROSS JOIN me LEFT JOIN copies c ON c.artwork_id = w.id
        WHERE w.id NOT IN (SELECT artwork_id FROM mw WHERE movement_id = $1)
          AND (w.creator_id IS NULL OR w.creator_id NOT IN (SELECT artist_id FROM quiz_movement_artists WHERE movement_id = $1))
          AND w.id IN (SELECT artwork_id FROM mw) AND ($3::text IS NULL OR ${counts('w', '$3')})
          AND NOT (me.kind = 'period' AND coalesce(w.created && me.period, false))
        ORDER BY 3 * (w.id IN (SELECT artwork_id FROM alike))::int
               + 6 * (c.artwork_id IS NOT NULL)::int
               + 2 * coalesce(w.created && daterange((lower(me.period) - interval '50 years')::date, (upper(me.period) + interval '50 years')::date), false)::int
               + 1.5 * random() DESC
        LIMIT $2) w`, [id, OPTIONS - right.length, region]);
      const others = await enough(outside, region);
      rounds.push({ kind, movement, options: shuffle([...right, ...others]) });
    } else {
      const { rows: works } = await db.query(`SELECT ${OPTION_COLUMNS} FROM (${PICTURED}) w
        WHERE w.id IN (SELECT artwork_id FROM quiz_movement_works WHERE movement_id = $1) ORDER BY random() LIMIT 3`, [id]);
      // three other movements holding none of the shown works, outside this one's tree (its parts are in it, its
      // wholes hold the works): the same kind and time first
      const besides = (region) => db.query(`
        WITH RECURSIVE ${SPANS},
        me AS (SELECT span AS period, own, kind FROM spans WHERE id = $1),
        tree AS (SELECT $1::bigint AS id UNION SELECT c.id FROM movements c JOIN tree t ON c.parent_id = t.id)
        SELECT ${MOVEMENT} FROM movements m JOIN spans s ON s.id = m.id, me
        WHERE m.id NOT IN (SELECT id FROM tree)
          AND NOT EXISTS (SELECT 1 FROM mw JOIN artworks a ON a.id = mw.artwork_id WHERE mw.movement_id = m.id AND a.slug = ANY($2))
          AND m.id IN (SELECT movement_id FROM mw)
          AND NOT (m.kind = 'period' AND me.kind = 'period' AND coalesce(s.own && me.own, false))
          -- of the round's region; one whose region isn't known only after those
          AND ($3::text IS NULL OR coalesce(${regionSql('movement', 'm.id')} = $3, true))
        ORDER BY 5 * coalesce(${regionSql('movement', 'm.id')} = $3, false)::int + 2 * (m.kind = me.kind)::int + 2 * coalesce(s.span && daterange((lower(me.period) - interval '100 years')::date, (upper(me.period) + interval '100 years')::date), false)::int
               + 1.5 * random() DESC
        LIMIT 3`, [id, works.map((w) => w.slug), region]);
      const { rows: near } = await besides(region);
      const others = region && near.length < 3 ? (await besides(null)).rows : near;
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

// --- the regions: how many works each one has for the games ---------------------------------------------------------
async function regions(q, { db, pictured }) {
  // each work in its own region, and copies in their models' regions too (counts(), in one pass)
  const { rows } = await db.query(`WITH w AS MATERIALIZED (${pictured}),
    x AS (SELECT w.id, w.region FROM w
          UNION SELECT cp.subject_id, cpr.region::text FROM relationships cp
          JOIN entry_regions cpr ON (cpr.entity_type, cpr.entity_id) = (cp.object_type, cp.object_id)
          WHERE cp.subject_type = 'artwork' AND cp.relationship_type = 'copy_after' AND cp.subject_id IN (SELECT id FROM w))
    SELECT r.region::text AS region, r.name, r.name_de, r.note, count(x.id)::int AS works
    FROM world_regions r LEFT JOIN x ON x.region = r.region::text GROUP BY r.region ORDER BY r.region`);
  return { data: rows };
}

const QUIZZES = { image, artist, movement, glossary, regions };
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
