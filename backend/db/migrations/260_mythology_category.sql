-- 260 — Glossary category "mythology and legend" (owner 2026-11-25): the figures, creatures and stories of myth,
-- legend, folklore and scripture from the owner's "World Folklore Names" list (gods, heroes, saints, monsters, fables).
-- Those that are subjects of art carry "iconography" as a further category (also_in). Real people are person entries.
-- The terms themselves are content (script, with history), not here.
ALTER TYPE term_category ADD VALUE IF NOT EXISTS 'mythology and legend' BEFORE 'other';
