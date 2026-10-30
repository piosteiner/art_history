-- 174 — Years before 4713 BCE (owner, 2026-10-30). Postgres dates begin in 4713 BCE, so the Jōmon period
-- ("c. 11,000–400 BCE"), the Korean Palaeolithic ("100,000–40,000 BCE") and the like keep an open start or only their
-- label. range_json() — the date object of every API answer — now reads the years from such a label where the range
-- has no bound: "c. 11,000–400 BCE" → from_year −11000, "before c. 10,000 BCE" → to_year −10000. The site's timeline
-- and its sorting use these years; filters by year still work on the ranges (an open start matches any earlier window,
-- a label alone matches none). Same signature: CREATE OR REPLACE keeps every view that uses it.

-- the BCE years a label names, as {from, to} (negative years; null where the label doesn't give them)
CREATE FUNCTION bce_label_years(label text) RETURNS integer[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN (
  SELECT CASE
    WHEN m IS NULL THEN NULL
    WHEN m[1] IS NOT NULL THEN ARRAY[NULL, -replace(m[3], ',', '')::integer]                               -- before X BCE
    ELSE ARRAY[-replace(m[3], ',', '')::integer, -replace(coalesce(m[5], m[3]), ',', '')::integer]       -- A–B BCE, A BCE
  END
  FROM (SELECT regexp_match(label, '^\s*(before\s+)?(c\.\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\s*[–-]\s*(c\.\s*)?(\d{1,3}(?:,\d{3})+|\d+))?\s*BCE\s*$', 'i') AS m) x);
COMMENT ON FUNCTION bce_label_years(text) IS 'the BCE years a period label names, {from, to} as negative years (174)';

CREATE OR REPLACE FUNCTION range_json(r daterange, label text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN CASE WHEN r IS NULL AND label IS NULL THEN NULL::jsonb ELSE jsonb_build_object(
  'label', label, 'from', iso_date(lower(r)), 'to', iso_date(upper(r) - 1),
  -- a bound before 4713 BCE is missing from the range: its year from the label (174)
  'from_year', coalesce(EXTRACT(year FROM lower(r))::integer, CASE WHEN label ~* 'BCE' THEN (bce_label_years(label))[1] END),
  'to_year', coalesce(EXTRACT(year FROM (upper(r) - 1))::integer, CASE WHEN label ~* 'BCE' AND (r IS NULL OR NOT upper_inf(r)) THEN (bce_label_years(label))[2] END)) END;
