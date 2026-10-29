-- 154 — Branches: an institution in several cities at once (owner, 2026-10-29: "Institutionen mit mehreren Standorten,
-- wie Sotheby's … Option 2, das macht es nachvollziehbarer"). An auction house or a dealer traded in London, New York,
-- Paris … at the same time; institutions.place_id is its seat, the dated `located_in` relationships (005) where it was
-- before. A branch is the third case: a relationship institution → place with its period — the place a city, or a
-- building of its own with the exact spot (a place under the city). The start map's museums layer shows the branches
-- too (/v1/map/sites, src/routes/map.js), and the time window filters them by their period.
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, description, sort_order)
VALUES ('branch_in', 'has a branch in', 'branch of', 'presence', false, false, '{institution}', '{place}',
        'A branch, office or saleroom beside the institution''s seat (institutions.place_id), with its period — a firm in several cities at once (Sotheby''s in London, Paris, Hong Kong …). Earlier seats are located_in.',
        18);
