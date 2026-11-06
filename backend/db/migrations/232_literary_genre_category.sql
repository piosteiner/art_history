-- 232 — A glossary category for the kinds of literary works (owner 2026-11-06: the Nibelungenlied should be found as
-- "Heldenepos", "Epos" and "epic poem"). Its own migration: a value added to an enum can only be used once the
-- transaction that added it has committed (233 uses it).
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'literary genre' BEFORE 'other';
