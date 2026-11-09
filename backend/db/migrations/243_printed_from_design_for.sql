-- 243: two relationships between works that the course "Aus dem Wald" needs (owner 2026-11-09, parts and connections):
--   printed_from  print → woodblock/plate it was printed from (Dürer's Samson woodcut and its pear-wood block at the
--                 Met; Jacopo de' Barbari's Venice and its six blocks in the Museo Correr). Not copy_after (074): the
--                 block is the matrix, not a model. Inverse "printed as".
--   design_for    drawing/model → the work it was made for (Veit Stoss's Visierung of 1520 for the Bamberg altar).
-- Category influence, like copy_after: artwork → artwork, shown among the works' connections and as graph edges.
INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, description, sort_order)
VALUES
  ('printed_from', 'printed from', 'printed as', 'influence', '{artwork}', '{artwork}',
   'A print and the block or plate it was printed from (243) — the woodblock is the matrix of the woodcut, kept as its own work where it survives.', 92),
  ('design_for', 'design for', 'designed in', 'influence', '{artwork}', '{artwork}',
   'A drawing, model or Visierung and the work it was made for (243) — Veit Stoss''s pen drawing of 1520 for the altar of the Nuremberg Carmelites.', 93)
ON CONFLICT (code) DO NOTHING;
