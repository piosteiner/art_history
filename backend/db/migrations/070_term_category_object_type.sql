-- 070 — A glossary category for object types (oil painting, woodblock print, hanging scroll …): artworks' "type" is
-- linked to glossary terms from 071 on. An enum value has to be committed before it can be used, so it comes alone
-- (as in 018 → 019).
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'object type' BEFORE 'other';
