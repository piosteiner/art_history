-- 197 — "Other source": the lowest level of reliability (owner, 2026-11-03). A pasted link becomes a source of level
-- "institution" (a museum's page — the usual case, and so it stays); a family tree on Geneanet, a forum or a blog
-- can now be moved below that, below the databases too, by hand on the source's edit page.
--
-- The value goes in BEFORE 'database': enums compare in their order, so "no better than a database" is
-- `<= 'database'` and takes the new level in without naming it — Postgres doesn't let a transaction use an enum value
-- it has just added (ALTER TYPE … ADD VALUE), and every migration is one transaction.
ALTER TYPE source_reliability ADD VALUE IF NOT EXISTS 'other' BEFORE 'database';

-- the check weakly_sourced: a fact whose best source is Wikidata, a database — or now another source — is weakly sourced
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  old_cmp text := $o$(w.best = 'database'::source_reliability)$o$;
  old_lbl text := $o$'only Wikidata / databases: '::text$o$;
BEGIN
  IF (length(def) - length(replace(def, old_cmp, ''))) / length(old_cmp) <> 2 THEN
    RAISE EXCEPTION 'quality_issues_live: the database comparison not found twice';
  END IF;
  IF (length(def) - length(replace(def, old_lbl, ''))) / length(old_lbl) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: the label not found once';
  END IF;
  def := replace(def, old_cmp, $n$(w.best <= 'database'::source_reliability)$n$);
  def := replace(def, old_lbl, $n$'only Wikidata / databases / other sources: '::text$n$);
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def;
END $$;

-- Wikipedia pasted as a link (owner, same day): its sites were made "institution" (M) like a museum's page; Wikipedia
-- articles of the bibliography are "database" — the same level as Wikidata. The sites made so far follow; new ones
-- get it at once (websiteSource() in src/admin/citations.js).
UPDATE bibliography SET reliability = 'database'
WHERE kind = 'web' AND reliability = 'institution'
  AND substring(url FROM '^https?://([^/:]+)') ~* '(^|\.)(wikipedia|wikimedia|wikidata|wikisource)\.org$';
