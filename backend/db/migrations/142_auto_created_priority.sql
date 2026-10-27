-- 142 — An owner added on the fly in a provenance step ("+ New person …", src/admin/provenance.js; owner, 2026-10-27)
-- is a high-priority finding: "error" instead of "warning", so it comes first on the Quality page until it is
-- completed. auto_created (021) records how an entry came about: via = 'provenance' for these; the hundreds created
-- along the way by imports and forms stay "warning" — they would otherwise drown the new ones.
-- The checks live in quality_issues_live (058): its definition is read back, the auto_created check's severity
-- replaced by a CASE, and the view replaced — the replacement is checked, so a changed view can't pass silently.
ALTER TABLE auto_created ADD COLUMN via text CHECK (via IN ('provenance'));
COMMENT ON COLUMN auto_created.via IS 'how it came about when it matters for the Quality page: provenance = an owner added in a step (142)';

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  patched text;
BEGIN
  patched := regexp_replace(def, $p$('auto_created'::text AS check_id,\s+)'(?:warning|error)'::text AS severity$p$,
    $r$\1CASE WHEN ac.via = 'provenance' THEN 'error'::text ELSE 'warning'::text END AS severity$r$);
  IF patched = def THEN RAISE EXCEPTION 'quality_issues_live: the auto_created check was not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || patched;
END $$;
