-- 216 — The wholes' list rows name their first parts (owner, 2026-11-04: "Birds and Flowers Through the Twelve
-- Months" got no mosaic — its parts have only the owner's private reference images, which the site shows only to that
-- account). The list query (src/routes/entities.js, artworks: part_previews — slug and public picture of the first
-- eight parts) has the new column; every whole's stored list row is queued once more. No schema change.
INSERT INTO list_queue (type, id)
SELECT 'artwork', w.id FROM artworks w WHERE EXISTS (SELECT 1 FROM artworks c WHERE c.parent_id = w.id);
