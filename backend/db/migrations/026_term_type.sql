-- 026 — A new entity type "term": an entry of the glossary (table and the rest in 027). A new enum value can only
-- be used after the transaction that added it has committed, so this migration does nothing else.
ALTER TYPE entity_type ADD VALUE 'term';
