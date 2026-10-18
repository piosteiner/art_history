-- 100 — The artworks of a movement or period, for the periods timeline (/v1/periods): the works associated with it
-- directly (artwork associated_with movement), and the works of its artists (artist associated_with / member_of /
-- founded movement) made while it lasted — when both are dated; an undated work or movement counts. A style counts its
-- parts too (parent_id, downwards: the Renaissance has the works of the High Renaissance, Mannerism …).
-- via: 'artwork' (directly) or 'artist'.
CREATE VIEW movement_works AS
WITH RECURSIVE tree (root, id) AS (
  SELECT id, id FROM movements
  UNION
  SELECT t.root, m.id FROM tree t JOIN movements m ON m.parent_id = t.id
), direct AS (
  SELECT r.object_id AS movement_id, r.subject_id AS artwork_id, 'artwork'::text AS via
  FROM relationships r
  WHERE r.subject_type = 'artwork' AND r.object_type = 'movement' AND r.relationship_type = 'associated_with'
  UNION
  SELECT r.object_id, w.id, 'artist'
  FROM relationships r
  JOIN artworks w ON w.creator_id = r.subject_id
  JOIN movements m ON m.id = r.object_id
  WHERE r.subject_type = 'artist' AND r.object_type = 'movement' AND r.relationship_type IN ('associated_with', 'member_of', 'founded')
    AND (w.created IS NULL OR m.period IS NULL OR w.created && m.period)
)
SELECT t.root AS movement_id, d.artwork_id, min(d.via) AS via   -- 'artist' < 'artwork': either way
FROM tree t JOIN direct d ON d.movement_id = t.id
GROUP BY t.root, d.artwork_id;

GRANT SELECT ON movement_works TO arthistory_api;
