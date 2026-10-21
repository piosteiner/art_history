-- 124 — Every artwork should have its web page (owner, 2026-10-21: "it's really important to have a web page for each
-- artwork"): its page at the museum or collection that holds it (artworks.web_url, 038) — where readers see the work
-- itself, and the source most facts are cited from. A new check, artwork_without_web_page (warning), lists the works
-- without one. The view quality_issues_live (058) is patched as it stands: one UNION ALL branch appended.
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('artwork_without_web_page' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'artwork_without_web_page'::text AS check_id,
    'warning'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    'web_page:'::text || a.id AS issue_key,
    'no web page — its page at the museum or collection that holds it'::text AS detail
   FROM artworks a
  WHERE a.web_url IS NULL$b$;
END $$;
