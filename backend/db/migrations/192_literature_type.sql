-- 192 — A new entity type "literature": literary works — tales, novels, poems, plays, sutras, myths (owner 2026-11-02:
-- "I want to put somewhat of a focus on the intersection of art and literature"). Table and the rest in 193; a new enum
-- value can only be used once the transaction that added it has committed (like 046).
-- One word, as every type: [[literature/the-tale-of-genji]]; addresses /literary-works/…, shown as "Literary work".
ALTER TYPE entity_type ADD VALUE 'literature';
