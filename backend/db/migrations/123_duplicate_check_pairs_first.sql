-- 123 — The duplicate check weighs only its candidate pairs (owner, 2026-10-21: the admin's dashboard didn't load).
-- possible_duplicate in quality_issues_live (093) joined dup_candidate_pairs with dup_facts twice and filtered with
-- dup_maybe(a, b). With 1,706 entries the planner joined the two dup_facts first — every entry with every other of
-- its type, 489,434 pairs — and ran dup_maybe on all of them before narrowing to the 6,146 candidates: 124 s for the
-- check, 130 s for all findings. refresh_quality() then hit the admin role's 30 s statement timeout on every try, the
-- stored findings stayed behind (since 23:41 the night before), and the dashboard, computing them live instead, timed
-- out too. Now the candidates are fetched with their facts first (a subquery with OFFSET 0: the planner may not pull
-- the filter into it) and only those pairs are weighed: 7 s, the same 58 findings. The view is patched as it stands.
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  old_branch text := $o$ SELECT 'possible_duplicate'::text AS check_id,
    'warning'::text AS severity,
    a.type AS entity_type,
    a.id AS entity_id,
    ((('dup:'::text || LEAST(a.id, b.id)) || ':'::text) || GREATEST(a.id, b.id)) AS issue_key,
    format('probably the same as %s (%s) — %s (score %s)'::text, b.name, b.slug, array_to_string(s.reasons, ', '::text), s.score) AS detail
   FROM (((dup_candidate_pairs c
     JOIN dup_facts a ON (((a.type = c.type) AND (a.id = c.a_id))))
     JOIN dup_facts b ON (((b.type = c.type) AND (b.id = c.b_id))))
     CROSS JOIN LATERAL dup_score(a.*, b.*) s(score, reasons))
  WHERE (dup_maybe(a.*, b.*) AND (s.score >= 50))$o$;
  new_branch text := $n$ SELECT 'possible_duplicate'::text AS check_id,
    'warning'::text AS severity,
    (p.fa).type AS entity_type,
    (p.fa).id AS entity_id,
    ((('dup:'::text || LEAST((p.fa).id, (p.fb).id)) || ':'::text) || GREATEST((p.fa).id, (p.fb).id)) AS issue_key,
    format('probably the same as %s (%s) — %s (score %s)'::text, (p.fb).name, (p.fb).slug, array_to_string(s.reasons, ', '::text), s.score) AS detail
   FROM (SELECT a AS fa, b AS fb FROM dup_candidate_pairs c
           JOIN dup_facts a ON a.type = c.type AND a.id = c.a_id
           JOIN dup_facts b ON b.type = c.type AND b.id = c.b_id
         OFFSET 0) p   -- 123: the candidate pairs first, then weighed (OFFSET 0 keeps dup_maybe out of the join)
     CROSS JOIN LATERAL dup_score(p.fa, p.fb) s(score, reasons)
  WHERE (dup_maybe(p.fa, p.fb) AND (s.score >= 50))$n$;
BEGIN
  IF (length(def) - length(replace(def, old_branch, ''))) / length(old_branch) <> 1 THEN
    RAISE EXCEPTION 'quality_issues_live: the possible_duplicate branch not found exactly once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || rtrim(replace(def, old_branch, new_branch), E'; \n');
END $$;
