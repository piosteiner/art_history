-- 016 added artworks_inventory_needs_institution NOT VALID: new and changed rows were checked from then on, the old
-- ones not (The Great Wave had an inventory number without an institution). That one is fixed, so the constraint is
-- now checked for every row too. VALIDATE CONSTRAINT scans the table under a light lock (SHARE UPDATE EXCLUSIVE):
-- reads and writes go on meanwhile — the reason Postgres has NOT VALID + VALIDATE at all.
ALTER TABLE artworks VALIDATE CONSTRAINT artworks_inventory_needs_institution;
