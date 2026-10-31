-- 183 — Names in sources are stored "Surname, Given names" (owner 2026-10-31, after "Jane Portal 2000" appeared instead
-- of "Portal 2000"): the short reference of the KHIST guide (§ 8.1, src/bibliography.js) takes the surname from before
-- the comma, so a name written "Given Surname" is cited whole. A new check, source_name_order (warning), lists the
-- names of authors, editors, compilers and the container's editors that look like a person's without a comma.
--
-- source_name_unordered(name) is the one definition — the check and the admin form's "Cited as" line
-- (POST /bibliography/new/citation) both ask it. Not flagged: one word ("Anon.", "Nabunken"), names in scripts
-- without Latin letters (Korean and Japanese names put the surname first: 이청규), and names that read as an
-- institution's (Institute, Museum, Regierungsrat …). Anything else that is right as it is: Mark as OK.

CREATE OR REPLACE FUNCTION source_name_unordered(name text) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT name !~ ','
     AND btrim(name) ~ '\S\s+\S'
     AND name ~ '[A-Za-z]'
     AND name !~* '(institu|museum|musée|museo|society|soci[eé]t[eé]|gesellschaft|stiftung|foundation|fondation|verein|bibliothe|library|archiv|universit|regierung|kanton|minist|department|council|office|\mamt\M|commission|kommission|akademie|academy|acad[eé]mie|galerie|gallery|collection|sammlung|verlag|press|trust|association|\(|\))'
$$;

DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('source_name_order' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'source_name_order'::text AS check_id,
    'warning'::text AS severity,
    'source'::entity_type AS entity_type,
    b.id AS entity_id,
    'name_order:'::text || n.role || ':'::text || n.name AS issue_key,
    format('%s “%s” has no comma — cited as “%s”; write “Surname, Given names”'::text, n.role, n.name, n.name) AS detail
   FROM bibliography b
     CROSS JOIN LATERAL ( SELECT 'author'::text AS role, x.name FROM unnest(b.authors) x(name)
        UNION ALL SELECT 'editor'::text, x.name FROM unnest(b.editors) x(name)
        UNION ALL SELECT 'compiler'::text, x.name FROM unnest(b.compilers) x(name)
        UNION ALL SELECT 'editor of the volume'::text, x.name FROM unnest(b.container_editors) x(name)) n
  WHERE source_name_unordered(n.name)$b$;
END $$;
