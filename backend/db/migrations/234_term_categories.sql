-- 234 — More glossary categories (owner 2026-11-06: "kireji" or "ryōsai kenbo" had no fitting category, "other" held 36
-- terms; "style" alone could mislead). "style" becomes "art style" — renaming the enum value in place keeps every term
-- that has it (17), nothing to copy. New: religion, philosophy (kept apart — "the secularization of philosophy was an
-- important step"), aesthetics, politics, society (not "history and society": too broad), language, arts and customs.
-- The terms themselves are moved as content (script, with history), not here.
ALTER TYPE term_category RENAME VALUE 'style' TO 'art style';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'religion' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'philosophy' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'aesthetics' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'politics' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'society' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'language' BEFORE 'other';
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'arts and customs' BEFORE 'other';
