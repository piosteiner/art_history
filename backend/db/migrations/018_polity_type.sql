-- 018 — A new entity type "polity" (states, empires, kingdoms, dynasties …; tables and functions in 019).
-- A value added to an enum can only be used after the transaction that added it has committed, so this
-- migration does nothing else.
ALTER TYPE entity_type ADD VALUE 'polity';
