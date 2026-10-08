-- 046 — A new entity type "event": things that happened at a time and a place (the Great Fire of Meireki, a trial,
-- an auction, an exhibition). Table and the rest in 047; a new enum value can only be used once the transaction that
-- added it has committed, so this migration does nothing else (like 035).
ALTER TYPE entity_type ADD VALUE 'event';
