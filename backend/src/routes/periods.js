// GET /v1/periods — the periods timeline: styles, movements and periods with where and when each was active (their
// dated "active in" relationships, one lane per place — Europe as a whole, Italy, France, the Low Countries, Japan …),
// their parts (parent), whether the entry has been reviewed (not marked "to complete"), and the works of the collection
// that belong to each (view movement_works, migration 100) and its artists (view movement_artists, 112): their lives,
// how they belong, and where they lived and worked then — for their lane.
const express = require('express');
const { apiPool } = require('../db');
const cache = require('../cache');

const router = express.Router();

// "c. 1700–late 18th century": is the start / the end only approximate? (circa, a century or its part, a decade,
// "or earlier" …) — the timeline fades such an edge instead of drawing a hard one.
const ROUGH = /(?:^|[\s(])(?:c|ca)\.|\b(?:circa|century|early|mid|late|first half|second half|or earlier|or later|before|after|until|since)\b|\d0s\b|\b\d{1,2}(?:st|nd|rd|th)\b/i;
function fuzzy(label) {
  if (!label) return { start: false, end: false };
  const [a, b] = String(label).split(/\s*–\s*/);
  if (b === undefined) return { start: ROUGH.test(a), end: ROUGH.test(a) };
  return { start: ROUGH.test(a), end: ROUGH.test(b) };
}

// the whole timeline sums up the database: cached per data version (src/cache.js) and computed ahead after a change
// (2.1 s on ten times today's data)
const cached = cache.versioned(1);
router.get('/', async (req, res) => { res.type('json').send(await timeline()); });
cache.warm('periods', () => timeline());
const timeline = () => cached('periods', async () => {
  const [periods, spans, works, artists] = await Promise.all([
    apiPool.query(`
      SELECT m.id, m.slug, m.public_id, m.name, m.kind::text AS kind, p.slug AS parent, range_json(m.period, m.period_label) AS period,
             NOT EXISTS (SELECT 1 FROM movement_drafts d WHERE d.movement_id = m.id) AS reviewed
      FROM movements m LEFT JOIN movements p ON p.id = m.parent_id
      WHERE EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'movement' AND r.subject_id = m.id
                      AND r.relationship_type = 'active_in' AND r.period IS NOT NULL)
      ORDER BY lower(m.period) NULLS LAST, m.name`),
    apiPool.query(`
      SELECT r.subject_id AS movement_id, l.slug AS place, l.name AS place_name, l.public_id AS place_public_id,
             -- in Europe (roughly): the European lanes come before the others
             -- (its point, the centre of its outline, or its boundary's label point: Germany has only a boundary code)
             coalesce((SELECT ST_X(g::geometry) BETWEEN -25 AND 45 AND ST_Y(g::geometry) BETWEEN 34 AND 72
                       FROM (SELECT coalesce(l.location, ST_Centroid(l.area), (SELECT b.label_point FROM boundaries b WHERE b.code = l.boundary_code)) AS g) x), false) AS european,
             range_json(r.period, r.period_label) AS period, r.period_label AS label, lower(r.period) AS starts
      FROM relationships r JOIN places l ON l.id = r.object_id
      WHERE r.subject_type = 'movement' AND r.relationship_type = 'active_in' AND r.object_type = 'place' AND r.period IS NOT NULL`),
    // each work with where it was made — the provenance's creation stop (091: recorded, else where the artist lived or
    // worked then), the places above it and its country — so the timeline puts it in the lane of its region
    apiPool.query(`
      WITH RECURSIVE works AS (SELECT DISTINCT artwork_id FROM movement_works),
      made AS (
        SELECT w.artwork_id, cp.place_id FROM works w
        LEFT JOIN LATERAL (SELECT s.place_id FROM provenance_stops(w.artwork_id) s WHERE s.chain_kind = 'creation' AND s.place_id IS NOT NULL LIMIT 1) cp ON true
      ),
      up AS (
        SELECT artwork_id, place_id AS id, 0 AS depth FROM made WHERE place_id IS NOT NULL
        UNION ALL
        SELECT up.artwork_id, p.parent_id, up.depth + 1 FROM up JOIN places p ON p.id = up.id WHERE p.parent_id IS NOT NULL AND up.depth < 20
      ),
      where_made AS (
        SELECT m.artwork_id,
               array_remove(array_agg(pl.slug) || (place_country(m.place_id)->>'slug'), NULL) AS places,
               (SELECT name FROM places WHERE id = m.place_id) AS made_in
        FROM made m LEFT JOIN up ON up.artwork_id = m.artwork_id LEFT JOIN places pl ON pl.id = up.id
        GROUP BY m.artwork_id, m.place_id
      )
      SELECT mw.movement_id, w.slug, w.public_id, w.title, range_json(w.created, w.created_label) AS created,
             a.name AS creator, a.slug AS creator_slug, coalesce(wm.places, '{}') AS places, wm.made_in
      FROM movement_works mw JOIN artworks w ON w.id = mw.artwork_id LEFT JOIN artists a ON a.id = w.creator_id
      LEFT JOIN where_made wm ON wm.artwork_id = w.id
      ORDER BY lower(w.created) NULLS LAST, w.title`),
    // each artist of a period with where they lived and worked during it (dated stays overlapping the period's span,
    // undated ones too; at an institution: its city), the places above those and their countries — for the lane
    apiPool.query(`
      WITH RECURSIVE stays AS (
        SELECT DISTINCT ma.movement_id, ma.artist_id, CASE r.object_type WHEN 'place' THEN r.object_id ELSE i.place_id END AS place_id
        FROM movement_artists ma
        JOIN movements m ON m.id = ma.movement_id
        JOIN relationships r ON r.subject_type = 'artist' AND r.subject_id = ma.artist_id AND r.object_type IN ('place', 'institution')
        JOIN relationship_types rt ON rt.code = r.relationship_type AND rt.is_physical_presence AND rt.code NOT IN ('born_in', 'died_in')
        LEFT JOIN institutions i ON r.object_type = 'institution' AND i.id = r.object_id
        WHERE r.period IS NULL OR m.period IS NULL OR r.period && m.period
      ),
      up AS (
        SELECT movement_id, artist_id, place_id AS id, 0 AS depth FROM stays WHERE place_id IS NOT NULL
        UNION ALL
        SELECT up.movement_id, up.artist_id, p.parent_id, up.depth + 1 FROM up JOIN places p ON p.id = up.id WHERE p.parent_id IS NOT NULL AND up.depth < 20
      ),
      lived AS (
        SELECT s.movement_id, s.artist_id,
               array_remove(array_agg(DISTINCT pl.slug) || array_agg(DISTINCT place_country(s.place_id)->>'slug'), NULL) AS places
        FROM stays s LEFT JOIN up ON (up.movement_id, up.artist_id) = (s.movement_id, s.artist_id) LEFT JOIN places pl ON pl.id = up.id
        GROUP BY s.movement_id, s.artist_id
      )
      SELECT ma.movement_id, a.slug, a.public_id, a.name, a.birth_label, a.death_label,
             range_json(a.lifespan, NULLIF(concat_ws('–', a.birth_label, a.death_label), '')) AS life,
             ma.via, range_json(ma.period, ma.period_label) AS active, coalesce(l.places, '{}') AS places
      FROM movement_artists ma JOIN artists a ON a.id = ma.artist_id
      LEFT JOIN lived l ON (l.movement_id, l.artist_id) = (ma.movement_id, ma.artist_id)
      ORDER BY lower(a.lifespan) NULLS LAST, a.name`),
  ]);
  const ids = new Set(periods.rows.map((p) => p.id));
  // lanes: Europe as a whole first, then by their earliest span
  const lanes = new Map();
  for (const s of spans.rows) {
    if (!ids.has(s.movement_id)) continue;
    const lane = lanes.get(s.place) || { slug: s.place, name: s.place_name, public_id: s.place_public_id, starts: s.starts, european: s.european };
    if (s.starts && (!lane.starts || s.starts < lane.starts)) lane.starts = s.starts;
    lanes.set(s.place, lane);
  }
  // Europe as a whole first, then the European lanes, then the others — each by its earliest span
  const ordered = [...lanes.values()].sort((a, b) => (a.slug === 'europe' ? -1 : b.slug === 'europe' ? 1 : 0)
    || Number(b.european) - Number(a.european) || (a.starts ?? Infinity) - (b.starts ?? Infinity) || a.name.localeCompare(b.name))
    .map(({ starts, european, ...l }) => l);
  return {
    lanes: ordered,
    periods: periods.rows.map(({ id, ...p }) => ({
      ...p,
      spans: spans.rows.filter((s) => s.movement_id === id).map((s) => ({ place: s.place, period: s.period, fuzzy: fuzzy(s.label) })),
      works: works.rows.filter((w) => w.movement_id === id).map(({ movement_id, places, ...w }) => ({ ...w, places: [...new Set(places)] })),
      // fuzzy: a birth or death known only roughly ("c. 1450", "1430s") — the life's edge fades
      artists: artists.rows.filter((a) => a.movement_id === id).map(({ movement_id, places, birth_label: b, death_label: d, ...a }) => ({
        ...a, places: [...new Set(places)], fuzzy: { start: !b || ROUGH.test(b), end: !!d && ROUGH.test(d) } })),
    })),
  };
});

module.exports = router;
