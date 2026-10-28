-- 149 — A relationship's target added on the fly ("+ New person …" in the relationship form, relFromForm in
-- src/admin/core.js; owner, 2026-10-28) is flagged like an owner added in a provenance step (142): auto_created.via =
-- 'relationship', and the Quality page's auto_created check is "error" for both until the entry is completed.
-- As 142: quality_issues_live (058) is read back, the CASE of the auto_created check replaced, the view replaced —
-- checked, so a changed view can't pass silently.
ALTER TABLE auto_created DROP CONSTRAINT auto_created_via_check;
ALTER TABLE auto_created ADD CONSTRAINT auto_created_via_check CHECK (via IN ('provenance', 'relationship'));
COMMENT ON COLUMN auto_created.via IS 'how it came about when it matters for the Quality page: provenance = an owner added in a step (142), relationship = a relationship''s target added on the fly (149)';

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  patched text;
BEGIN
  patched := regexp_replace(def, $p$CASE\s+WHEN \(ac\.via = 'provenance'::text\) THEN 'error'::text\s+ELSE 'warning'::text\s+END AS severity$p$,
    $r$CASE WHEN ac.via = ANY (ARRAY['provenance'::text, 'relationship'::text]) THEN 'error'::text ELSE 'warning'::text END AS severity$r$);
  IF patched = def THEN RAISE EXCEPTION 'quality_issues_live: the severity of the auto_created check was not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || patched;
END $$;
