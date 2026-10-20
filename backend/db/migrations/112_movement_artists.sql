-- 112 — The artists of a period (owner, 2026-10-20: "switch between artworks and artists in the periods view — how
-- the artists' lives sit in the periods"). The counterpart of movement_works (100): which artists belong to a style,
-- movement or period —
--   directly: the artist is associated with it, a member of it or founded it (with the relationship's dates, when
--             recorded: "member 1874–1886");
--   through works: the creator or a co-creator of a work that belongs to it (movement_works: linked itself, or through
--             its artist).
-- Like the works, a style has the artists of its phases too (the recursive CTE "tree": every movement with all its
-- parts, at any depth). An artist linked several ways is one row: via 'artist' wins over 'works'; the dates of
-- several relationships merged into the smallest range covering them (range_agg → multirange, range_merge → range).
CREATE VIEW movement_artists AS
WITH RECURSIVE tree (root, id) AS (
  SELECT id, id FROM movements
  UNION
  SELECT t.root, m.id FROM tree t JOIN movements m ON m.parent_id = t.id
),
direct AS (
  SELECT r.object_id AS movement_id, r.subject_id AS artist_id, 'artist'::text AS via, r.period, r.period_label
  FROM relationships r
  WHERE r.subject_type = 'artist' AND r.object_type = 'movement' AND r.relationship_type IN ('associated_with', 'member_of', 'founded')
),
rolled AS (
  SELECT t.root AS movement_id, d.artist_id, d.via, d.period, d.period_label FROM tree t JOIN direct d ON d.movement_id = t.id
  UNION ALL
  -- through the period's works (already rolled up to every style above them: movement_works)
  SELECT mw.movement_id, w.creator_id, 'works', NULL, NULL
  FROM movement_works mw JOIN artworks w ON w.id = mw.artwork_id WHERE w.creator_id IS NOT NULL
  UNION ALL
  SELECT mw.movement_id, r.object_id, 'works', NULL, NULL
  FROM movement_works mw JOIN relationships r ON (r.subject_type, r.subject_id, r.relationship_type, r.object_type) = ('artwork', mw.artwork_id, 'co_creator', 'artist')
)
SELECT movement_id, artist_id, min(via) AS via,
       range_merge(range_agg(period)) AS period,
       string_agg(DISTINCT period_label, '; ') AS period_label
FROM rolled
GROUP BY movement_id, artist_id;
COMMENT ON VIEW movement_artists IS 'artists of each style/movement/period (112): directly linked (via artist, with the link''s dates) or creators of its works (via works); phases rolled up';
GRANT SELECT ON movement_artists TO arthistory_api, arthistory_admin;
