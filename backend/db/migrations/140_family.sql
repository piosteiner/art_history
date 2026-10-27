-- 140 — Family ties between people and artists (owner, 2026-10-27: Adolph von Liebermann, owner of Menzel's
-- Eisenwalzwerk, was the uncle of Max Liebermann — "i dont think we have relationship relationships yet").
-- Category "family": child of / parent of, sibling of, married to (both ways), and relative of for any other tie, its
-- label saying which (uncle, cousin, sister-in-law …). An uncle is not stored as a type of its own: he is a parent's
-- sibling, and where both links are known the tie follows from them.
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order) VALUES
  ('child_of', 'child of', 'parent of', 'family', false, false, '{artist,person}', '{artist,person}',
   'Daughter or son of; adoptive or step children too, the label says so.', 64),
  ('sibling_of', 'sibling of', 'sibling of', 'family', false, true, '{artist,person}', '{artist,person}',
   'Sister or brother; half-siblings too, the label says so.', 65),
  ('married_to', 'married to', 'married to', 'family', false, true, '{artist,person}', '{artist,person}',
   'Married or in a registered partnership; dated with the years of the marriage.', 66),
  ('relative_of', 'relative of', 'relative of', 'family', false, true, '{artist,person}', '{artist,person}',
   'Any other family tie; the label says which, from the first one''s side (uncle, cousin, sister-in-law …).', 67);
