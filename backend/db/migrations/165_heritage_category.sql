-- 165 — A glossary category for heritage designations: the protection a state or UNESCO gives a work, a building or a
-- place — Japan's National Treasures and Important Cultural Properties, World Heritage, Switzerland's cultural property
-- of national significance, France's monuments historiques (owner, 2026-10-29: "Schutzstatus", kept general).
-- (A new enum value can't be used in the transaction that adds it — its use follows in 166.)
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'heritage designation';
