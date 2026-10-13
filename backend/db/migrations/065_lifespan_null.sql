-- 065: no dates, no lifespan. The generated column lifespan was daterange(lower(birth), upper(death)) — with neither
-- date that is the unbounded range (,), "always alive": it overlapped every period (range checks such as
-- never_alive_together saw such a person as a contemporary of everyone) and the API gave a period full of nulls
-- instead of null. 72 entries without dates (most from the Bührle import) had it. Now NULL when both are missing;
-- with one date the range stays open on the other side, as before.
-- (SET EXPRESSION, PostgreSQL 17+: the column is recomputed for every row, its GiST index rebuilt.)
ALTER TABLE artists ALTER COLUMN lifespan SET EXPRESSION AS
  (CASE WHEN birth IS NULL AND death IS NULL THEN NULL ELSE daterange(lower(birth), upper(death)) END);
ALTER TABLE people ALTER COLUMN lifespan SET EXPRESSION AS
  (CASE WHEN birth IS NULL AND death IS NULL THEN NULL ELSE daterange(lower(birth), upper(death)) END);
