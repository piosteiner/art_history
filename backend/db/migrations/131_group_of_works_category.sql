-- 131 — A glossary category for kinds of groups of works: a series, versions of one composition, a cycle, a pair.
-- (A new enum value can't be used in the transaction that adds it — its use follows in 132.)
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'group of works' AFTER 'object type';
