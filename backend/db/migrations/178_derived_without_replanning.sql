-- 178 — The derived-data worker without re-planning (owner 2026-10-31: optimise). process_derived spent ~90 % of a
-- call planning, not running: one entry took ~150–200 ms, of which ~130 ms went to planning the read of
-- quality_issues_live (dozens of UNION ALL branches) and ~45 ms the graph's edges. The reads were EXECUTEd with the
-- entry type as a literal, so the planner could drop the other types' branches — but EXECUTE plans afresh every time.
-- Now they go through small functions with a generic plan (plan_cache_mode = force_generic_plan), which PL/pgSQL keeps
-- for the life of the connection: the type is a parameter, and each branch's test of it ("'artwork' = $1", no column
-- involved) becomes a one-time filter — the other types' branches are skipped when the plan runs instead of when it is
-- made. Measured on dev: the quality read 130–150 ms → 7–8 ms with the same findings. Behaviour unchanged.
-- The functions read views only (no temporary tables: those are dropped at every commit and would void the plans).

CREATE FUNCTION derived_issues(t entity_type, ids bigint[], skip text[]) RETURNS SETOF quality_issues
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT ON (q.check_id, q.issue_key, q.entity_type, q.entity_id) q.*
    FROM quality_issues_live q WHERE q.entity_type = t AND q.entity_id = ANY (ids) AND q.check_id <> ALL (skip);
END $$;

CREATE FUNCTION derived_search_fields(t entity_type, ids bigint[]) RETURNS SETOF entry_search_fields_stored
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  RETURN QUERY SELECT * FROM entry_search_fields f WHERE f.type = t AND f.id = ANY (ids);
END $$;

CREATE FUNCTION derived_facts(t entity_type, ids bigint[]) RETURNS SETOF dup_facts
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  RETURN QUERY SELECT f.* FROM dup_facts f WHERE f.type = t AND f.id = ANY (ids);
END $$;

-- stored relationships of these entries, as subject or as object (the edges' owner: their two ends, 126)
CREATE FUNCTION derived_edges(t entity_type, ids bigint[], as_subject boolean) RETURNS SETOF graph_links
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  IF as_subject THEN
    RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
        e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL::bigint, e.notes_md, e.end_basis
      FROM edges e WHERE e.source = 'relationship' AND e.subject_type = t AND e.subject_id = ANY (ids);
  ELSE
    RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
        e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL::bigint, e.notes_md, e.end_basis
      FROM edges e WHERE e.source = 'relationship' AND e.object_type = t AND e.object_id = ANY (ids);
  END IF;
END $$;

-- the edges a work owns: the creator line, its provenance and building phases (the work at one end; commissioned: the
-- work is the object), and the transfers between its holders (the work at neither end — by its steps)
CREATE FUNCTION derived_work_edges(ids bigint[]) RETURNS SETOF graph_links
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
      e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.subject_id, e.notes_md, e.end_basis
    FROM edges e WHERE e.source IN ('creator', 'provenance', 'phase') AND e.subject_type = 'artwork' AND e.subject_id = ANY (ids);
  RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
      e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.object_id, e.notes_md, e.end_basis
    FROM edges e WHERE e.source = 'phase' AND e.relationship_type = 'commissioned' AND e.object_type = 'artwork' AND e.object_id = ANY (ids);
  RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
      e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.object_id, e.notes_md, e.end_basis
    FROM edges e WHERE e.source = 'provenance' AND e.relationship_type = 'commissioned' AND e.object_type = 'artwork' AND e.object_id = ANY (ids);
  RETURN QUERY SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
      e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL::bigint, e.notes_md, e.end_basis
    FROM edges e WHERE e.source = 'provenance' AND e.relationship_type = 'transferred_to'
      AND e.provenance_id = ANY (ARRAY(SELECT p.id FROM provenance p WHERE p.artwork_id = ANY (ids)));
END $$;

CREATE FUNCTION derived_coverage(ids bigint[]) RETURNS SETOF provenance_completeness_stored
LANGUAGE plpgsql STABLE SET plan_cache_mode = force_generic_plan AS $$
BEGIN
  RETURN QUERY SELECT * FROM provenance_completeness c WHERE c.artwork_id = ANY (ids);
END $$;

CREATE OR REPLACE FUNCTION public.process_derived(max_entries integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET client_min_messages TO 'warning'
AS $function$
DECLARE
  n integer;
  t entity_type;
  ids bigint[];
  globals text := quote_literal(quality_global_checks()) || '::text[]';
  skip text[] := quality_global_checks();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  DROP TABLE IF EXISTS d_batch, d_facts, d_changed, d_partners, d_cand, d_nf, d_fields, d_issues, d_touched, d_edges, d_old, d_linkdiff;
  CREATE TEMP TABLE d_batch ON COMMIT DROP AS
    SELECT q.type, q.id, bool_or(q.spread) AS spread, bool_and(q.reason = 'full') AS full, array_agg(q.seq) AS seqs
    FROM derived_queue q GROUP BY q.type, q.id ORDER BY min(q.seq) LIMIT max_entries;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN 0; END IF;
  CREATE TEMP TABLE d_touched (type entity_type, id bigint, what text) ON COMMIT DROP;

  -- the neighbours of entries changed themselves: queued behind this batch
  INSERT INTO derived_queue (type, id, reason)
    SELECT DISTINCT nb.type, nb.id, 'neighbour' FROM d_batch b CROSS JOIN LATERAL derived_neighbours(b.type, b.id) nb
    WHERE b.spread AND NOT EXISTS (SELECT 1 FROM d_batch x WHERE x.type = nb.type AND x.id = nb.id);

  -- duplicates: the facts by type — read through the derived_* functions (178): plans kept for the connection, the
  -- other types' branches skipped when they run
  CREATE TEMP TABLE d_facts (f dup_facts, fp text) ON COMMIT DROP;
  FOR t, ids IN SELECT b.type, array_agg(b.id) FROM d_batch b GROUP BY b.type LOOP
    INSERT INTO d_facts SELECT f, md5(f::text) FROM derived_facts(t, ids) f;
  END LOOP;
  -- new, changed or gone (gone: fp null — "f IS NULL" would test every field of the row)
  CREATE TEMP TABLE d_changed ON COMMIT DROP AS
    SELECT b.type, b.id, d.f, d.fp FROM d_batch b
    LEFT JOIN d_facts d ON (d.f).type = b.type AND (d.f).id = b.id
    LEFT JOIN dup_entries e ON e.type = b.type AND e.id = b.id
    WHERE d.fp IS DISTINCT FROM e.fp;
  INSERT INTO d_touched SELECT c.type, c.id, 'duplicate facts' FROM d_changed c;
  -- their pairs so far: the partners' findings name them
  CREATE TEMP TABLE d_partners (type entity_type, id bigint) ON COMMIT DROP;
  WITH gone AS (DELETE FROM dup_pairs p USING d_changed c WHERE p.type = c.type AND (p.a_id = c.id OR p.b_id = c.id)
                RETURNING p.type, p.a_id, p.b_id)
  INSERT INTO d_partners SELECT g.type, g.a_id FROM gone g UNION SELECT g.type, g.b_id FROM gone g;
  DELETE FROM dup_keys k USING d_changed c WHERE k.type = c.type AND k.id = c.id;
  DELETE FROM dup_entries e USING d_changed c WHERE e.type = c.type AND e.id = c.id;
  INSERT INTO dup_entries SELECT c.type, c.id, c.fp FROM d_changed c WHERE c.fp IS NOT NULL;
  INSERT INTO dup_keys SELECT c.type, c.id, k.kind, k.key FROM d_changed c CROSS JOIN LATERAL dup_entry_keys(c.f) k WHERE c.fp IS NOT NULL;
  -- their candidates, through the keys (with those of the whole batch already in place), and the candidates' facts
  CREATE TEMP TABLE d_cand ON COMMIT DROP AS
    SELECT DISTINCT c.type, c.id AS a_id, n.id AS b_id FROM d_changed c CROSS JOIN LATERAL dup_neighbours(c.f) n(id) WHERE c.fp IS NOT NULL;
  CREATE TEMP TABLE d_nf (f dup_facts) ON COMMIT DROP;
  FOR t, ids IN SELECT x.type, array_agg(DISTINCT x.b_id) FROM d_cand x GROUP BY x.type LOOP
    INSERT INTO d_nf SELECT f FROM derived_facts(t, ids) f;
  END LOOP;
  -- weighed each way round; a pair of two changed entries comes twice — once is enough
  WITH pairs AS (
    SELECT DISTINCT ON ((w.fa).type, (w.fa).id, (w.fb).id) w.fa, w.fb FROM (
      SELECT c.f AS fa, nf.f AS fb FROM d_cand x JOIN d_changed c ON c.type = x.type AND c.id = x.a_id JOIN d_nf nf ON (nf.f).type = x.type AND (nf.f).id = x.b_id
      UNION ALL
      SELECT nf.f, c.f FROM d_cand x JOIN d_changed c ON c.type = x.type AND c.id = x.a_id JOIN d_nf nf ON (nf.f).type = x.type AND (nf.f).id = x.b_id) w),
  found AS (
    INSERT INTO dup_pairs (type, a_id, b_id, score, reasons, b_name, b_slug)
      SELECT (p.fa).type, (p.fa).id, (p.fb).id, s.score, s.reasons, (p.fb).name, (p.fb).slug
      FROM pairs p CROSS JOIN LATERAL dup_score(p.fa, p.fb) s
      WHERE dup_maybe(p.fa, p.fb) AND s.score >= 50
    RETURNING type, a_id, b_id)
  INSERT INTO d_partners SELECT f.type, f.a_id FROM found f UNION SELECT f.type, f.b_id FROM found f;
  INSERT INTO derived_queue (type, id, reason)
    SELECT DISTINCT p.type, p.id, 'partner' FROM d_partners p
    WHERE NOT EXISTS (SELECT 1 FROM d_batch b WHERE b.type = p.type AND b.id = p.id);

  -- the stored graph (088, 126) — before the findings and search fields: the inferences read it (where holders were).
  -- Each edge has an owner whose change recomputes it: a relationship its two ends; the
  -- creator line and the edges from the provenance their work (artwork_id) — a holder's change reaches the works it
  -- held as neighbours. Filtering edges by source and by the work (the partition key of provenance_periods' windows)
  -- lets each filter reach into the view's branches; a filter on a holder couldn't (all chains computed, every time).
  CREATE TEMP TABLE d_edges (LIKE graph_links) ON COMMIT DROP;
  FOR t, ids IN SELECT b.type, array_agg(b.id) FROM d_batch b GROUP BY b.type LOOP
    INSERT INTO d_edges SELECT * FROM derived_edges(t, ids, true);
    INSERT INTO d_edges SELECT * FROM derived_edges(t, ids, false) e
      WHERE NOT EXISTS (SELECT 1 FROM d_batch b WHERE b.type = e.subject_type AND b.id = e.subject_id);
  END LOOP;
  ids := ARRAY(SELECT b.id FROM d_batch b WHERE b.type = 'artwork');
  IF cardinality(ids) > 0 THEN
    INSERT INTO d_edges SELECT * FROM derived_work_edges(ids);  -- creator, provenance, phases; transfers by the works' steps
    UPDATE d_edges e SET artwork_id = p.artwork_id FROM provenance p WHERE e.artwork_id IS NULL AND p.id = e.provenance_id;
  END IF;
  -- as stored since 088: no loops, both ends known
  DELETE FROM d_edges e WHERE e.subject_id IS NULL OR e.object_id IS NULL OR (e.subject_type = e.object_type AND e.subject_id = e.object_id);
  CREATE TEMP TABLE d_old ON COMMIT DROP AS
    SELECT g.ctid AS rid, g.* FROM graph_links g JOIN d_batch b ON b.type = g.subject_type AND b.id = g.subject_id WHERE g.source = 'relationship'
    UNION SELECT g.ctid, g.* FROM graph_links g JOIN d_batch b ON b.type = g.object_type AND b.id = g.object_id WHERE g.source = 'relationship'
    UNION SELECT g.ctid, g.* FROM graph_links g JOIN d_batch b ON b.type = 'artwork' AND b.id = g.artwork_id WHERE g.source <> 'relationship';
  CREATE TEMP TABLE d_linkdiff ON COMMIT DROP AS
    (SELECT subject_type, subject_id, object_type, object_id, relationship_type, period, period_label, label, certainty,
            source, provenance_id, relationship_id, artwork_id, notes_md, end_basis FROM d_old
     EXCEPT ALL SELECT * FROM d_edges)
    UNION ALL
    (SELECT * FROM d_edges
     EXCEPT ALL SELECT subject_type, subject_id, object_type, object_id, relationship_type, period, period_label, label,
                       certainty, source, provenance_id, relationship_id, artwork_id, notes_md, end_basis FROM d_old);
  IF EXISTS (SELECT 1 FROM d_linkdiff) THEN
    DELETE FROM graph_links g USING d_old o WHERE g.ctid = o.rid;
    INSERT INTO graph_links SELECT * FROM d_edges;
    INSERT INTO d_touched SELECT x.subject_type, x.subject_id, 'links' FROM d_linkdiff x
                          UNION SELECT x.object_type, x.object_id, 'links' FROM d_linkdiff x;
  END IF;

  -- search fields (110/111)
  CREATE TEMP TABLE d_fields (LIKE entry_search_fields_stored) ON COMMIT DROP;
  FOR t, ids IN SELECT b.type, array_agg(b.id) FROM d_batch b GROUP BY b.type LOOP
    INSERT INTO d_fields SELECT * FROM derived_search_fields(t, ids);
  END LOOP;
  WITH del AS (
    DELETE FROM entry_search_fields_stored s USING d_batch b WHERE s.type = b.type AND s.id = b.id
      AND NOT EXISTS (SELECT 1 FROM d_fields f WHERE (f.type, f.id, f.position) = (s.type, s.id, s.position))
    RETURNING s.type, s.id),
  up AS (
    INSERT INTO entry_search_fields_stored AS s SELECT * FROM d_fields
    ON CONFLICT (type, id, position) DO UPDATE SET label = EXCLUDED.label, text = EXCLUDED.text, match = EXCLUDED.match,
      tier_rank = EXCLUDED.tier_rank, tier_heading = EXCLUDED.tier_heading, shown = EXCLUDED.shown
    WHERE (s.label, s.text, s.match, s.tier_rank, s.tier_heading, s.shown)
          IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.text, EXCLUDED.match, EXCLUDED.tier_rank, EXCLUDED.tier_heading, EXCLUDED.shown)
    RETURNING s.type, s.id)
  INSERT INTO d_touched SELECT x.type, x.id, 'search fields' FROM (SELECT * FROM del UNION SELECT * FROM up) x;

  -- findings of the per-entry checks (the global ones' branches are left out by the literal list)
  CREATE TEMP TABLE d_issues (LIKE quality_issues) ON COMMIT DROP;
  FOR t, ids IN SELECT b.type, array_agg(b.id) FROM d_batch b GROUP BY b.type LOOP
    INSERT INTO d_issues SELECT * FROM derived_issues(t, ids, skip);
  END LOOP;
  EXECUTE 'WITH del AS (
    DELETE FROM quality_issues q USING d_batch b WHERE q.entity_type = b.type AND q.entity_id = b.id AND q.check_id <> ALL (' || globals || ')
      AND NOT EXISTS (SELECT 1 FROM d_issues f WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id))
    RETURNING q.entity_type, q.entity_id, q.check_id),
  up AS (
    INSERT INTO quality_issues AS q SELECT * FROM d_issues
    ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
    WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail)
    RETURNING q.entity_type, q.entity_id, q.check_id)
  INSERT INTO d_touched SELECT x.entity_type, x.entity_id, ''finding '' || x.check_id FROM (SELECT * FROM del UNION SELECT * FROM up) x';

  -- how completely the batch's works' provenance is documented (078/129): only rows that changed
  ids := ARRAY(SELECT b.id FROM d_batch b WHERE b.type = 'artwork');
  IF cardinality(ids) > 0 THEN
    DROP TABLE IF EXISTS d_cov;
    CREATE TEMP TABLE d_cov ON COMMIT DROP AS SELECT * FROM provenance_completeness_stored WITH NO DATA;
    INSERT INTO d_cov SELECT * FROM derived_coverage(ids);
    WITH del AS (
      DELETE FROM provenance_completeness_stored s WHERE s.artwork_id = ANY (ids)
        AND NOT EXISTS (SELECT 1 FROM d_cov c WHERE c.artwork_id = s.artwork_id)
      RETURNING s.artwork_id),
    up AS (
      INSERT INTO provenance_completeness_stored AS s SELECT * FROM d_cov
      ON CONFLICT (artwork_id) DO UPDATE SET has_provenance = EXCLUDED.has_provenance, life_days = EXCLUDED.life_days,
        documented_days = EXCLUDED.documented_days, presumed_days = EXCLUDED.presumed_days, gap_days = EXCLUDED.gap_days,
        gap_1933_1945_days = EXCLUDED.gap_1933_1945_days, documented_percent = EXCLUDED.documented_percent
      WHERE (s.has_provenance, s.life_days, s.documented_days, s.presumed_days, s.gap_days, s.gap_1933_1945_days, s.documented_percent)
            IS DISTINCT FROM (EXCLUDED.has_provenance, EXCLUDED.life_days, EXCLUDED.documented_days, EXCLUDED.presumed_days,
                              EXCLUDED.gap_days, EXCLUDED.gap_1933_1945_days, EXCLUDED.documented_percent)
      RETURNING s.artwork_id)
    INSERT INTO d_touched SELECT 'artwork', x.artwork_id, 'coverage' FROM (SELECT * FROM del UNION SELECT * FROM up) x;
  END IF;

  -- what the full run changed, the incremental path had missed
  INSERT INTO derived_drift (type, id, what)
    SELECT DISTINCT x.type, x.id, x.what FROM d_touched x JOIN d_batch b ON b.type = x.type AND b.id = x.id WHERE b.full;
  INSERT INTO list_queue (type, id, full_run) SELECT b.type, b.id, b.full FROM d_batch b;
  PERFORM pg_notify('quality_changed', '');   -- the worker computes the rows (also after refresh_quality() called elsewhere)
  DELETE FROM derived_failures f USING d_batch b WHERE f.type = b.type AND f.id = b.id AND f.what = 'derived';
  DELETE FROM derived_queue q USING (SELECT unnest(b.seqs) AS seq FROM d_batch b) s WHERE q.seq = s.seq;
  RETURN n;
END $function$;

-- only the worker (process_derived, SECURITY DEFINER) calls them
REVOKE EXECUTE ON FUNCTION derived_issues(entity_type, bigint[], text[]), derived_search_fields(entity_type, bigint[]),
  derived_facts(entity_type, bigint[]), derived_edges(entity_type, bigint[], boolean), derived_work_edges(bigint[]),
  derived_coverage(bigint[]) FROM PUBLIC;
