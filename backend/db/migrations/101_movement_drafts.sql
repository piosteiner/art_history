-- 101 — Which movements are drafts (marked "to complete" in the admin, table auto_created) — for the periods timeline,
-- which outlines them as not yet reviewed. The API role may not read auto_created itself (who created what, from
-- where); this view tells it only the movements' ids.
CREATE VIEW movement_drafts AS
  SELECT entity_id AS movement_id FROM auto_created WHERE entity_type = 'movement';

GRANT SELECT ON movement_drafts TO arthistory_api;
