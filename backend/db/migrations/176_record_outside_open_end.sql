-- 176 — provenance_record_outside and holders whose end is unknown (owner 2026-10-30: resolve the Quality warnings).
-- A step whose end is neither recorded nor implied (end_basis 'unknown': Urban VIII "from 20 May 1603", the heirs of
-- Lorenzo di Pierfrancesco "from 1503") has the period of its acquisition only, so every later record was "outside"
-- it — although a Barberini inventory of 1608 only shows the holding lasted at least until then. For such a step a
-- record is now a finding only when it lies before the acquisition, or after the death of the holder (a person or an
-- artist): the 1598 Castello inventory is not Cosimo I's (d. 1574). Steps with a recorded or implied end unchanged.
-- The view is patched as it stands; the expression must be found exactly once.
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  old text := 'WHERE ((r.date IS NOT NULL) AND (pp.period IS NOT NULL) AND (NOT (r.date && pp.period)))';
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: provenance_record_outside condition not found exactly once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old, $b$WHERE r.date IS NOT NULL AND pp.period IS NOT NULL AND NOT (r.date && pp.period)
    AND (pp.end_basis IS DISTINCT FROM 'unknown' OR r.date << pp.period
         OR EXISTS (SELECT 1 FROM people x WHERE pp.owner_type = 'person' AND x.id = pp.owner_id AND x.death << r.date)
         OR EXISTS (SELECT 1 FROM artists x WHERE pp.owner_type = 'artist' AND x.id = pp.owner_id AND x.death << r.date))$b$);
END $$;
