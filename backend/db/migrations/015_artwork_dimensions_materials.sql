-- 015 — Artworks: dimensions (2D or 3D) and materials.
--
-- Dimensions are numbers in centimetres, not text, so they can be compared, sorted and converted:
--   height_cm × width_cm (× depth_cm for objects) + dimensions_note ("framed", "sheet", "image size" …)
-- numeric(8,2): exact decimals (73.70, not a binary float), up to 999 999.99 cm.
--
-- materials is a text array next to the free-text "medium" ("Oil on canvas"): {oil paint, canvas}, {bronze} — for
-- filtering. The GIN index makes containment queries fast: WHERE materials @> ARRAY['bronze'].
ALTER TABLE artworks
  ADD COLUMN height_cm       numeric(8,2) CHECK (height_cm > 0),
  ADD COLUMN width_cm        numeric(8,2) CHECK (width_cm > 0),
  ADD COLUMN depth_cm        numeric(8,2) CHECK (depth_cm > 0),
  ADD COLUMN dimensions_note text,
  ADD COLUMN materials       text[] NOT NULL DEFAULT '{}',
  -- height and width come together; a depth only with both (a 3D object)
  ADD CONSTRAINT artworks_dimensions_check CHECK (
    (height_cm IS NULL) = (width_cm IS NULL) AND (depth_cm IS NULL OR height_cm IS NOT NULL));

CREATE INDEX artworks_materials_gin ON artworks USING gin (materials);
