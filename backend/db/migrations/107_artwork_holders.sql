-- 107 — Which institutions hold an artwork now and which held it before, as one view (owner, 2026-10-19: "if you
-- search for an artist in the museum section you should be shown the museums with artworks of that artist with a
-- number of total held artworks").
--
--  * artwork_holders(artwork_id, institution_id, now): `now` — where the work is (current_institution_id), the owner
--    that museum belongs to (institution_holds, 098), or the open last step of a work without a current institution;
--    otherwise an institution of its provenance that held it before. One row per work and institution.
--  * artwork_artists(artwork_id, artist_id, main): the main creator and the co-creators (028).
-- Used by the lists: artworks name their holders (`holders`, before inline in the API), institutions the artists of the
-- works they hold and held, with counts (`artists_held`).

CREATE VIEW artwork_holders AS
SELECT x.artwork_id, x.institution_id, bool_or(x.now) AS now
FROM (
  SELECT w.id AS artwork_id, w.current_institution_id AS institution_id, true AS now
  FROM artworks w WHERE w.current_institution_id IS NOT NULL
  UNION ALL
  SELECT p.artwork_id, p.owner_institution_id,
         institution_holds(p.owner_institution_id, w.current_institution_id)
         OR (w.current_institution_id IS NULL AND p.ended IS NULL
             AND NOT EXISTS (SELECT 1 FROM provenance q WHERE q.artwork_id = p.artwork_id AND q.position > p.position))
  FROM provenance p JOIN artworks w ON w.id = p.artwork_id
  WHERE p.owner_institution_id IS NOT NULL
) x
GROUP BY x.artwork_id, x.institution_id;
COMMENT ON VIEW artwork_holders IS 'institutions holding a work now (now) or before (provenance), one row each (107)';

CREATE VIEW artwork_artists AS
SELECT w.id AS artwork_id, w.creator_id AS artist_id, true AS main FROM artworks w WHERE w.creator_id IS NOT NULL
UNION
SELECT r.subject_id, r.object_id, false FROM relationships r
WHERE r.relationship_type = 'co_creator' AND r.subject_type = 'artwork' AND r.object_type = 'artist';
COMMENT ON VIEW artwork_artists IS 'an artwork''s main creator and co-creators (107)';

GRANT SELECT ON artwork_holders, artwork_artists TO arthistory_api, arthistory_admin;
