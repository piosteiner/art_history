// GET /v1/periods — the periods timeline: styles, movements and periods with where and when each was active (their
// dated "active in" relationships, one lane per place — Europe as a whole, Italy, France, the Low Countries, Japan …),
// their parts (parent), whether the entry has been reviewed (not marked "to complete"), and the works of the collection
// that belong to each (view movement_works, migration 100).
const express = require('express');
const { apiPool } = require('../db');

const router = express.Router();

// "c. 1700–late 18th century": is the start / the end only approximate? (circa, a century or its part, a decade,
// "or earlier" …) — the timeline fades such an edge instead of drawing a hard one.
const ROUGH = /(?:^|[\s(])(?:c|ca)\.|\b(?:circa|century|early|mid|late|first half|second half|or earlier|or later|before|after|until|since)\b|\d0s\b/i;
function fuzzy(label) {
  if (!label) return { start: false, end: false };
  const [a, b] = String(label).split(/\s*–\s*/);
  if (b === undefined) return { start: ROUGH.test(a), end: ROUGH.test(a) };
  return { start: ROUGH.test(a), end: ROUGH.test(b) };
}

router.get('/', async (req, res) => {
  const [periods, spans, works] = await Promise.all([
    apiPool.query(`
      SELECT m.id, m.slug, m.public_id, m.name, m.kind::text AS kind, p.slug AS parent, range_json(m.period, m.period_label) AS period,
             NOT EXISTS (SELECT 1 FROM movement_drafts d WHERE d.movement_id = m.id) AS reviewed
      FROM movements m LEFT JOIN movements p ON p.id = m.parent_id
      WHERE EXISTS (SELECT 1 FROM relationships r WHERE r.subject_type = 'movement' AND r.subject_id = m.id
                      AND r.relationship_type = 'active_in' AND r.period IS NOT NULL)
      ORDER BY lower(m.period) NULLS LAST, m.name`),
    apiPool.query(`
      SELECT r.subject_id AS movement_id, l.slug AS place, l.name AS place_name, l.public_id AS place_public_id,
             range_json(r.period, r.period_label) AS period, r.period_label AS label, lower(r.period) AS starts
      FROM relationships r JOIN places l ON l.id = r.object_id
      WHERE r.subject_type = 'movement' AND r.relationship_type = 'active_in' AND r.object_type = 'place' AND r.period IS NOT NULL`),
    apiPool.query(`
      SELECT mw.movement_id, w.slug, w.public_id, w.title, range_json(w.created, w.created_label) AS created,
             a.name AS creator
      FROM movement_works mw JOIN artworks w ON w.id = mw.artwork_id LEFT JOIN artists a ON a.id = w.creator_id
      ORDER BY lower(w.created) NULLS LAST, w.title`),
  ]);
  const ids = new Set(periods.rows.map((p) => p.id));
  // lanes: Europe as a whole first, then by their earliest span
  const lanes = new Map();
  for (const s of spans.rows) {
    if (!ids.has(s.movement_id)) continue;
    const lane = lanes.get(s.place) || { slug: s.place, name: s.place_name, public_id: s.place_public_id, starts: s.starts };
    if (s.starts && (!lane.starts || s.starts < lane.starts)) lane.starts = s.starts;
    lanes.set(s.place, lane);
  }
  const ordered = [...lanes.values()].sort((a, b) => (a.slug === 'europe' ? -1 : b.slug === 'europe' ? 1 : 0)
    || (a.starts ?? Infinity) - (b.starts ?? Infinity) || a.name.localeCompare(b.name))
    .map(({ starts, ...l }) => l);
  res.json({
    lanes: ordered,
    periods: periods.rows.map(({ id, ...p }) => ({
      ...p,
      spans: spans.rows.filter((s) => s.movement_id === id).map((s) => ({ place: s.place, period: s.period, fuzzy: fuzzy(s.label) })),
      works: works.rows.filter((w) => w.movement_id === id).map(({ movement_id, ...w }) => w),
    })),
  });
});

module.exports = router;
