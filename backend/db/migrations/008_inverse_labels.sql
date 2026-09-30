-- 008 — Inverse labels that read naturally on the object's page (owner feedback 2026-09-30).
-- Display text only: codes, data and API shape are unchanged.
--   "Impressionism has member Monet"   (was: "member")
--   "Theo owner of Sunflowers"         (was: "owned" — past tense only)
--   "MoMA holds / held The Starry Night" (was: "held" — sounded finished; housed_at covers past and present holdings)
UPDATE relationship_types SET inverse_label = 'has member'   WHERE code = 'member_of';
UPDATE relationship_types SET inverse_label = 'owner of'     WHERE code = 'owned_by';
UPDATE relationship_types SET inverse_label = 'holds / held' WHERE code = 'housed_at';
