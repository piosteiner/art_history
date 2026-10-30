-- 177 — no_relationships counts every connection the graph shows (owner 2026-10-30: resolve the Quality warnings).
-- The check looked in relationships only, so 528 of 572 entries "not connected to anything" were in fact connected —
-- collectors and dealers through provenance steps, workshops through building phases, artists as creators — links
-- the graph and the site show (graph_links: stored relationships + derived edges, 126). It now reads graph_links,
-- which holds every stored relationship too (same columns). The view is patched as it stands.
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
  old text := 'FROM relationships r';
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: "%" not found exactly once', old;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || replace(def, old, 'FROM graph_links r');
END $$;
