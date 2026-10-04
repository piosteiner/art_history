-- 020 — Dimensions: height alone is enough (a sculpture or vessel is often given only by its height).
-- Allowed now: height · height × width · height × width × depth (a value only together with the ones before it).
-- Every existing row satisfies the new rule (the old one was stricter), so the constraint is replaced in one ALTER
-- and validated at once.
ALTER TABLE artworks
  DROP CONSTRAINT artworks_dimensions_check,
  ADD CONSTRAINT artworks_dimensions_check CHECK (
    (width_cm IS NULL OR height_cm IS NOT NULL) AND (depth_cm IS NULL OR width_cm IS NOT NULL));
