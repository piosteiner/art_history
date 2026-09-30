-- 007 — Relationship vocabulary, round 2 (owner feedback 2026-09-30).
--
-- 1. inspired_by_place overlapped with influenced_by_culture_of and was never used → removed.
--    New instead: depicts (artwork → place) — the place is the artwork's subject ("The Starry Night depicts
--    Saint-Rémy"). Category 'association' like the other non-travel place links: a separate map layer, and left out of
--    the influence graph by default (graph.js skips presence/association).
-- 2. Owners, commissioners and patrons are not only private people: a church, abbey, guild or museum (institution) or a
--    city/state as a public body (place) can own, commission or support too. A historical polity (Republic of Florence,
--    Papal States) is still better modelled as a patron of kind 'state' than as the modern place.
--
-- relationships_validate reads subject_types/object_types from this table on every insert, so widening them needs no
-- other change. Deleting a type that is still used would fail (FK ON DELETE RESTRICT) — it has no rows (checked).
DELETE FROM relationship_types WHERE code = 'inspired_by_place';

INSERT INTO relationship_types
  (code, label, inverse_label, category, is_physical_presence, is_symmetric, subject_types, object_types, sort_order, description)
VALUES
  ('depicts', 'depicts', 'depicted in', 'association', false, false, '{artwork}', '{place}', 20,
   'The place is the subject of the artwork (a view, a landscape, a city scene). Not where it was made: that is created_in.');

UPDATE relationship_types SET object_types = '{patron,institution,place}',
       description = 'Ownership history: a person or family, a church or museum (institution), a city or state (place). '
                  || 'Where it is kept is housed_at / the current institution.'
 WHERE code = 'owned_by';

UPDATE relationship_types SET subject_types = '{patron,institution,place}',
       description = 'Who ordered the work: a patron, a church or guild (institution), a city or state (place).'
 WHERE code = 'commissioned';

UPDATE relationship_types SET subject_types = '{patron,institution,place}',
       description = 'Sustained support of an artist or institution — by a person, family, church (institution) or city/state (place).'
 WHERE code = 'patron_of';
