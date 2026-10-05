-- 025 — Further measurements of an artwork: mount, frame, sheet, overall, with base … next to the main dimensions
-- (the work itself — those stay in height_cm/width_cm/depth_cm, which the API filters and sorts by).
--   other_dimensions = [{"part": "mount", "cm": [180, 95.5]}, {"part": "frame", "cm": [190, 105, 6]}]
-- Validated by a SQL function over the array (like names_valid, migration 022): a non-empty part and 1–3 positive
-- numbers in the order height, width, depth — the same rule as the main dimensions.
CREATE FUNCTION other_dimensions_valid(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(d) = 'array' AND coalesce((
    SELECT bool_and(jsonb_typeof(e) = 'object'
                    AND (e - 'part' - 'cm') = '{}'
                    AND jsonb_typeof(e->'part') = 'string' AND btrim(e->>'part') <> ''
                    AND jsonb_typeof(e->'cm') = 'array' AND jsonb_array_length(e->'cm') BETWEEN 1 AND 3
                    AND (SELECT bool_and(jsonb_typeof(x) = 'number' AND x::text::numeric > 0 AND x::text::numeric < 1000000)
                         FROM jsonb_array_elements(e->'cm') x))
    FROM jsonb_array_elements(d) e), true) $$;

ALTER TABLE artworks
  ADD COLUMN other_dimensions jsonb NOT NULL DEFAULT '[]' CHECK (other_dimensions_valid(other_dimensions));
