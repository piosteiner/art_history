-- 215 — The wholes' list rows get their parts' pictures (owner, 2026-11-04: series, cycles … get a preview of their
-- own, "made of 2–4 pictures, so they are told apart from regular previews"). The list query (src/routes/entities.js,
-- artworks: part_images) has the new column; the stored rows (entry_list_rows, 127) of every whole are queued once
-- here, so the worker recomputes them — later changes to a part already queue its whole (as for the first part's
-- picture, image_url). No schema change.
INSERT INTO list_queue (type, id)
SELECT 'artwork', w.id FROM artworks w WHERE EXISTS (SELECT 1 FROM artworks c WHERE c.parent_id = w.id);
