-- 083 — A role for those who held a work without good title: the ERR that seized it, Göring who took it over,
-- the dealer who received it from him, a thief. They had the work, never the right to it — the dispossessed owner's
-- ownership goes on until the restitution (084 uses it; alone: an enum value can't be used in the transaction that
-- adds it).
ALTER TYPE holder_role ADD VALUE IF NOT EXISTS 'possessor' AFTER 'trustee';
