-- 096 — Planned provenance: a step dated after today is something announced (an auction at Sotheby's next month, a
-- promised gift), not yet a fact. check_after holds the last day of its latest future date (acquired or ended); from
-- the day after, the admin's dashboard and the artwork page ask whether it happened as planned. "Went as planned"
-- clears it; so does saving the step again once its dates lie in the past (the editor has looked at it). NULL for
-- every step that only records the past. Set by the admin (src/admin/provenance.js fromForm), not by a trigger; the
-- YAML files carry it as check_after (src/content.js, scripts/import.js). The public API: planned_until.
ALTER TABLE provenance ADD COLUMN check_after date;
COMMENT ON COLUMN provenance.check_after IS 'planned step (096): remind after this day whether it happened as planned; NULL = a record of the past';

UPDATE provenance SET check_after = greatest(
    CASE WHEN lower(acquired) > current_date THEN coalesce(upper(acquired) - 1, lower(acquired)) END,
    CASE WHEN lower(ended) > current_date THEN coalesce(upper(ended) - 1, lower(ended)) END)
  WHERE lower(acquired) > current_date OR lower(ended) > current_date;

CREATE INDEX provenance_check_after ON provenance (check_after) WHERE check_after IS NOT NULL;
