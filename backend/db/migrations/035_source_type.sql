-- 035 — A new entity type "source": an entry of the bibliography (table and the rest in 036). A new enum value can
-- only be used after the transaction that added it has committed, so this migration does nothing else.
ALTER TYPE entity_type ADD VALUE 'source';
