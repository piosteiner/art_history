-- 126 — The stored graph (graph_links, 088) kept up to date per change, like the findings (125) — step 2 of the
-- scaling plan. Until now the global part rebuilt it from the view edges after every change: on the copy ten times
-- today's size 6.6 s of its 11 s, every half minute while someone edits. Now process_derived() recomputes, for each
-- batch, the edges its entries own: a relationship belongs to its two ends, the creator line and every edge from the
-- provenance to their work — new column artwork_id (also for "transferred_to" between two holders, where the work is
-- at neither end; kept after the step is deleted). Filtered by source and work, the view's branches are reached
-- with their indexes and window partitions (EXECUTE: planned for the values).
-- It compares them with what is stored as multisets (EXCEPT ALL) and writes only when they differ; a change found by
-- the nightly full run is logged as drift 'links'. The neighbours (derived_neighbours, 125) are read before the batch
-- rewrites the graph, so they still include links the change removed.
-- The API reads the stored graph instead of the view (entry pages, the graph, the presence map: a filter "subject or
-- object" can't reach into the view's branches — every request computed all edges): it needs notes and end basis too.
ALTER TABLE graph_links ADD COLUMN artwork_id bigint, ADD COLUMN notes_md text, ADD COLUMN end_basis text;
DELETE FROM graph_links;
INSERT INTO graph_links
  SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period, e.period_label,
         e.label, e.certainty, e.source, e.provenance_id, e.id,
         CASE WHEN e.source = 'creator' THEN e.subject_id ELSE p.artwork_id END, e.notes_md, e.end_basis
  FROM edges e LEFT JOIN provenance p ON p.id = e.provenance_id
  WHERE (e.subject_type, e.subject_id) IS DISTINCT FROM (e.object_type, e.object_id) AND e.subject_id IS NOT NULL AND e.object_id IS NOT NULL;
CREATE INDEX graph_links_artwork_idx ON graph_links (artwork_id) WHERE artwork_id IS NOT NULL;
CREATE INDEX graph_links_period_gist ON graph_links USING gist (period);   -- the presence map's time window (&&)
ANALYZE graph_links;
COMMENT ON COLUMN graph_links.artwork_id IS 'the work owning an edge from the provenance or the creator line (126)';

CREATE OR REPLACE FUNCTION process_derived(max_entries integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET client_min_messages = warning AS $$
DECLARE
  n integer;
  t entity_type;
  ids bigint[];
  globals text := quote_literal(quality_global_checks()) || '::text[]';
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

  -- duplicates: the facts by type (a filter per type reaches into the view's branches and their indexes; EXECUTE
  -- plans with the values, so the other types' branches are left out)
  CREATE TEMP TABLE d_facts (f dup_facts, fp text) ON COMMIT DROP;
  FOR t, ids IN SELECT b.type, array_agg(b.id) FROM d_batch b GROUP BY b.type LOOP
    EXECUTE 'INSERT INTO d_facts SELECT f, md5(f::text) FROM dup_facts f WHERE f.type = $1 AND f.id = ANY($2)' USING t, ids;
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
    EXECUTE 'INSERT INTO d_nf SELECT f FROM dup_facts f WHERE f.type = $1 AND f.id = ANY($2)' USING t, ids;
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
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL, e.notes_md, e.end_basis
             FROM edges e WHERE e.source = ''relationship'' AND e.subject_type = $1 AND e.subject_id = ANY($2)' USING t, ids;
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL, e.notes_md, e.end_basis
             FROM edges e WHERE e.source = ''relationship'' AND e.object_type = $1 AND e.object_id = ANY($2)
               AND NOT EXISTS (SELECT 1 FROM d_batch b WHERE b.type = e.subject_type AND b.id = e.subject_id)' USING t, ids;
  END LOOP;
  ids := ARRAY(SELECT b.id FROM d_batch b WHERE b.type = 'artwork');
  IF cardinality(ids) > 0 THEN
    -- the work at one end (creator, owned_by, held_by, kept_in, exchanged_for; commissioned: the work is the object)
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.subject_id, e.notes_md, e.end_basis
             FROM edges e WHERE e.source IN (''creator'', ''provenance'') AND e.subject_type = ''artwork'' AND e.subject_id = ANY($1)' USING ids;
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.object_id, e.notes_md, e.end_basis
             FROM edges e WHERE e.source = ''provenance'' AND e.relationship_type = ''commissioned''
               AND e.object_type = ''artwork'' AND e.object_id = ANY($1)' USING ids;
    -- transfers between holders: the work at neither end — by its steps
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, NULL, e.notes_md, e.end_basis
             FROM edges e WHERE e.source = ''provenance'' AND e.relationship_type = ''transferred_to'' AND e.provenance_id = ANY($1)'
      USING ARRAY(SELECT p.id FROM provenance p WHERE p.artwork_id = ANY(ids));
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
    EXECUTE 'INSERT INTO d_fields SELECT * FROM entry_search_fields f WHERE f.type = $1 AND f.id = ANY($2)' USING t, ids;
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
    EXECUTE 'INSERT INTO d_issues SELECT DISTINCT ON (q.check_id, q.issue_key, q.entity_type, q.entity_id) q.*
             FROM quality_issues_live q WHERE q.entity_type = $1 AND q.entity_id = ANY($2) AND q.check_id <> ALL (' || globals || ')'
      USING t, ids;
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

  -- what the full run changed, the incremental path had missed
  INSERT INTO derived_drift (type, id, what)
    SELECT DISTINCT x.type, x.id, x.what FROM d_touched x JOIN d_batch b ON b.type = x.type AND b.id = x.id WHERE b.full;
  DELETE FROM derived_queue q USING (SELECT unnest(b.seqs) AS seq FROM d_batch b) s WHERE q.seq = s.seq;
  RETURN n;
END $$;

-- the global part without the graph
CREATE OR REPLACE FUNCTION refresh_quality_global() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET client_min_messages = warning AS $$
DECLARE
  seen bigint;
  globals text := quote_literal(quality_global_checks()) || '::text[]';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  REFRESH MATERIALIZED VIEW search_words;
  DROP TABLE IF EXISTS d_global;
  EXECUTE 'CREATE TEMP TABLE d_global ON COMMIT DROP AS SELECT DISTINCT ON (q.check_id, q.issue_key, q.entity_type, q.entity_id) q.*
           FROM quality_issues_live q WHERE q.check_id = ANY (' || globals || ')';
  DELETE FROM quality_issues q WHERE q.check_id = ANY (quality_global_checks()) AND NOT EXISTS (SELECT 1 FROM d_global f
    WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id));
  INSERT INTO quality_issues AS q SELECT * FROM d_global
  ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
  WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail);
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp(), global_at = clock_timestamp();
END $$;

-- Found by the nightly-run test (drift in a work's search fields): the search field "Type" lists the names of every
-- material and object type whose name occurs in a work's medium — linked by text, not by a key. A term's change (old
-- and new names) now queues those works: derived_touch() learns 'termtext' (the same rule as artwork_term_names()).
CREATE OR REPLACE FUNCTION derived_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r jsonb; spec text; kind text; col text; spr boolean; v bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN RETURN NULL; END IF;
  FOR r IN SELECT x FROM unnest(CASE TG_OP WHEN 'INSERT' THEN ARRAY[to_jsonb(NEW)] WHEN 'DELETE' THEN ARRAY[to_jsonb(OLD)]
                                ELSE ARRAY[to_jsonb(OLD), to_jsonb(NEW)] END) x LOOP
    FOREACH spec IN ARRAY TG_ARGV LOOP
      spr := right(spec, 1) = '+';
      kind := split_part(rtrim(spec, '+'), '.', 1);
      col := split_part(rtrim(spec, '+'), '.', 2);
      IF kind = 'all' THEN
        INSERT INTO derived_queue (type, id) SELECT e.type, e.id FROM entity_index e WHERE col = '*' OR e.type::text = col;
        CONTINUE;
      END IF;
      v := (r ->> col)::bigint;
      CONTINUE WHEN v IS NULL;
      IF kind = 'prov' THEN
        INSERT INTO derived_queue (type, id) SELECT 'artwork', p.artwork_id FROM provenance p WHERE p.id = v;
      ELSIF kind = 'rel' THEN
        INSERT INTO derived_queue (type, id, spread)
          SELECT x.t, x.i, true FROM relationships x0, LATERAL (VALUES (x0.subject_type, x0.subject_id), (x0.object_type, x0.object_id)) x(t, i)
          WHERE x0.id = v;
      ELSIF kind = 'termtext' THEN
        -- a material or object type, by its names in the media of works not linked to it (artwork_term_names, 071)
        INSERT INTO derived_queue (type, id)
          SELECT 'artwork', w.id FROM artworks w
          WHERE w.medium IS NOT NULL AND r ->> 'category' IN ('material', 'object type')
            AND EXISTS (SELECT 1 FROM unnest(term_names(jsonb_populate_record(NULL::glossary, r))) nm
                        WHERE f_unaccent(w.medium) ~* ('\m' || regexp_replace(f_unaccent(nm), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'));
      ELSIF kind = 'num' THEN
        INSERT INTO derived_queue (type, id) SELECT 'artwork', n.artwork_id FROM artwork_numbers n WHERE n.id = v;
      ELSIF left(kind, 1) = '@' THEN
        CONTINUE WHEN r ->> substr(kind, 2) IS NULL;
        INSERT INTO derived_queue (type, id, spread) VALUES ((r ->> substr(kind, 2))::entity_type, v, spr);
      ELSE
        INSERT INTO derived_queue (type, id, spread) VALUES (kind::entity_type, v, spr);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM nextval('quality_changes');
  PERFORM pg_notify('quality_changed', '');  -- the same notice twice in one transaction is sent once
  RETURN NULL;
END $$;

DROP TRIGGER derived_touch ON glossary;
CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON glossary
  FOR EACH ROW EXECUTE FUNCTION derived_touch('term.id+', 'termtext.id');

-- What reads all edges per request reads the stored graph instead: the inferences under provenance steps (086 —
-- where the holders were: every presence of every person was computed for one artwork's page, 1.5 s on the copy at
-- 10×; the worker writes a batch's links before its findings, so the checks see them) and encounters() (091: crossed
-- paths — over the API's 5 s at 10×). Patched as they stand, each "FROM edges" found exactly once.
DO $$
DECLARE
  def text := pg_get_viewdef('provenance_inferences'::regclass);
BEGIN
  IF (length(def) - length(replace(def, 'FROM (((edges e', ''))) / length('FROM (((edges e') <> 1 THEN
    RAISE EXCEPTION 'provenance_inferences: "FROM (((edges e" not found once';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW provenance_inferences AS ' || rtrim(replace(def, 'FROM (((edges e', 'FROM (((graph_links e'), E'; \n');
END $$;
DO $$
DECLARE
  def text := pg_get_functiondef('encounters'::regproc);
BEGIN
  IF (length(def) - length(replace(def, 'FROM edges e', ''))) / length('FROM edges e') <> 1 THEN
    RAISE EXCEPTION 'encounters: "FROM edges e" not found once';
  END IF;
  EXECUTE replace(def, 'FROM edges e', 'FROM graph_links e');
END $$;

-- The inferences filtered by work: with its CTEs inlined (NOT MATERIALIZED — "pairs" is read three times, so Postgres
-- would materialize it, every work's chain computed, before the filter), a filter on artwork_id reaches the window
-- partitions of provenance_chain. One work's inferences: 1.5 s → 37 ms on the copy at 10×; all of them the same 338
-- rows. So "a provenance date can be narrowed" is a check per work now, not a global one (a holder's change reaches
-- the works it held as neighbours, 125).
DO $$
DECLARE
  def text := pg_get_viewdef('provenance_inferences'::regclass);
  cte text;
BEGIN
  FOREACH cte IN ARRAY ARRAY['WITH life AS (', ' presence AS (', ' chain AS (', ' pairs AS ('] LOOP
    IF (length(def) - length(replace(def, cte, ''))) / length(cte) <> 1 THEN
      RAISE EXCEPTION 'provenance_inferences: "%" not found once', cte;
    END IF;
    def := replace(def, cte, replace(cte, ' AS (', ' AS NOT MATERIALIZED ('));
  END LOOP;
  EXECUTE 'CREATE OR REPLACE VIEW provenance_inferences AS ' || rtrim(def, E'; \n');
END $$;
CREATE OR REPLACE FUNCTION quality_global_checks() RETURNS text[] LANGUAGE sql IMMUTABLE
RETURN '{broken_link,broken_glossary_link}'::text[];
