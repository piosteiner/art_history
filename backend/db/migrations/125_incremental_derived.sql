-- 125 — Derived data kept up to date incrementally: only what a change affects is computed again.
--
-- Until now refresh_quality() recomputed everything after every change: all findings of all 48 checks, all search
-- fields, the duplicate check over every candidate pair, the graph. Its cost grew with the database, not with the
-- change: on a copy ten times today's size (3,500 artworks, 4,200 people, 17,000 provenance steps — 2026-10-21) it
-- took far beyond the admin role's 30 s timeout, the stored findings went stale and the dashboard failed (as it did
-- that morning at today's size, fixed by 123). Now:
--
--   1. A change says which entries it affects. Every table a finding, a search field or a duplicate depends on has
--      the trigger derived_touch() — its arguments name the columns that point at entries ('artwork.creator_id' …,
--      '@subject_type.subject_id' for a type in a column, 'prov.provenance_id' via the provenance step's artwork). It
--      appends them to derived_queue — an append-only log, never updated: a save never waits for a lock held by
--      another save or by the worker, so editors can't deadlock each other through the queue.
--   2. A worker (src/admin/quality.js, LISTEN quality_changed) calls process_derived() for a batch of entries at a
--      time, each batch its own short transaction: their search fields, their findings, their duplicate pairs.
--      An entry changed itself ("spread") also queues its neighbours — linked entries, parts, children, works of an
--      artist, entries citing a source — whose findings may depend on it.
--   3. Duplicates by fingerprint: dup_entries keeps an md5 of each entry's facts (dup_facts); only an entry whose
--      fingerprint changed is weighed again, and only against its candidates, found through dup_keys (names with a
--      trigram index, sound keys, numbers, DOI/ISBN …) instead of comparing every pair. The verdicts that are
--      findings are kept in dup_pairs. (A changed dup_score() or dup_facts needs TRUNCATE dup_entries + a full run.)
--   4. The few checks that depend on entries in no fixed relation (a [[link]] in any text; the provenance chain's
--      inferences, computed for all works at once) are "global": refresh_quality_global() computes them, the words
--      for "did you mean …?" and the graph — after the queue is empty, at most every half minute.
--   5. A nightly full run (refresh_quality_full(): every entry queued as 'full') is the safety net: whatever it
--      changes was missed by the incremental path — a dependency the triggers don't know — and is written to
--      derived_drift, shown on the quality page, to be fixed at the cause.
--
-- refresh_quality() keeps its meaning — everything up to date when it returns (the tests call it) — by emptying the
-- queue and running the global part. quality_fresh(): the queue is empty and the global part has seen every change.

-- 1. The queue ---------------------------------------------------------------------------------------------------
CREATE TABLE derived_queue (
  seq       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type      entity_type NOT NULL,
  id        bigint NOT NULL,
  spread    boolean NOT NULL DEFAULT false,   -- changed itself: its neighbours are queued too
  reason    text NOT NULL DEFAULT 'change' CHECK (reason IN ('change', 'neighbour', 'partner', 'full')),
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX derived_queue_entry ON derived_queue (type, id);
COMMENT ON TABLE derived_queue IS 'entries whose derived data (search fields, findings, duplicates) must be computed again (125); append-only';

-- what the full run found that the incremental path missed
CREATE TABLE derived_drift (
  type     entity_type NOT NULL,
  id       bigint NOT NULL,
  what     text NOT NULL,
  found_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX derived_drift_found ON derived_drift (found_at);
GRANT SELECT ON derived_drift TO arthistory_admin;

ALTER TABLE quality_refresh ADD COLUMN full_at timestamptz, ADD COLUMN global_at timestamptz;

-- the trigger: TG_ARGV = specs '<type>.<column>[+]', '@<type column>.<id column>[+]', 'prov.<column>' (a provenance
-- step → its artwork), 'rel.<column>' (a relationship → both ends), 'num.<column>' (a further number → its artwork),
-- 'all.<type>' / 'all.*' (every entry of a type / of all); '+' = spread to the neighbours.
CREATE FUNCTION derived_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

-- the triggers replace quality_changed() (058) wherever an entry is concerned; quality_acks keeps it (an
-- acknowledgement changes no stored row — the lists leave acknowledged findings out when they read)
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('artworks',       ARRAY['artwork.id+', 'artist.creator_id', 'institution.current_institution_id', 'artwork.parent_id', 'term.kind_term_id']),
    ('artists',        ARRAY['artist.id+']),
    ('people',         ARRAY['person.id+']),
    ('institutions',   ARRAY['institution.id+', 'place.place_id']),
    ('places',         ARRAY['place.id+', 'place.parent_id']),
    ('polities',       ARRAY['polity.id+', 'polity.parent_id']),
    ('movements',      ARRAY['movement.id+', 'movement.parent_id']),
    ('events',         ARRAY['event.id+', 'event.parent_id', 'place.place_id']),
    ('glossary',       ARRAY['term.id+']),
    ('bibliography',   ARRAY['source.id+']),
    ('relationships',  ARRAY['@subject_type.subject_id+', '@object_type.object_id+']),
    ('provenance',     ARRAY['artwork.artwork_id', 'artist.owner_artist_id', 'person.owner_person_id', 'institution.owner_institution_id',
                             'place.owner_place_id', 'place.location_id', 'event.event_id', 'artwork.exchanged_for_artwork_id']),
    ('provenance_co_owners', ARRAY['prov.provenance_id', 'artist.owner_artist_id', 'person.owner_person_id', 'institution.owner_institution_id']),
    ('provenance_records',   ARRAY['prov.provenance_id', 'place.place_id']),
    ('provenance_places',    ARRAY['prov.provenance_id', 'place.place_id']),
    ('provenance_numbers',   ARRAY['prov.provenance_id']),
    ('artwork_numbers',      ARRAY['artwork.artwork_id', 'institution.institution_id']),
    ('artwork_materials',    ARRAY['artwork.artwork_id']),
    ('images',               ARRAY['@entity_type.entity_id']),
    ('citations',            ARRAY['@entity_type.entity_id', 'prov.provenance_id', 'rel.relationship_id', 'num.number_id']),
    ('entry_identifiers',    ARRAY['@entity_type.entity_id']),
    ('auto_created',         ARRAY['@entity_type.entity_id']),
    ('slug_history',         ARRAY['@entity_type.entity_id+']),
    ('entry_moves',          ARRAY['@new_type.new_id+']),
    ('relationship_types',   ARRAY['all.*']),
    ('citable_fields',       ARRAY['all.*']),
    ('authorities',          ARRAY['all.*']),
    ('boundaries',           ARRAY['all.place'])) s(tbl, args)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS quality_changed ON %I', spec.tbl);
    EXECUTE format('CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION derived_touch(%s)',
                   spec.tbl, (SELECT string_agg(quote_literal(a), ', ') FROM unnest(spec.args) a));
  END LOOP;
END $$;

-- the entries whose findings may depend on an entry: linked (the stored graph, both ways — before the global part
-- rebuilds it, it still has the links a change removed), parts and children, an artist's works, a museum's works,
-- holders' works, entries citing a source, works of a type or material
CREATE FUNCTION derived_neighbours(t entity_type, i bigint) RETURNS TABLE (type entity_type, id bigint)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT g.object_type, g.object_id FROM graph_links g WHERE g.subject_type = t AND g.subject_id = i
  UNION SELECT g.subject_type, g.subject_id FROM graph_links g WHERE g.object_type = t AND g.object_id = i
  UNION SELECT 'place', x.id FROM places x WHERE t = 'place' AND x.parent_id = i
  UNION SELECT 'institution', x.id FROM institutions x WHERE t = 'place' AND x.place_id = i
  UNION SELECT 'event', x.id FROM events x WHERE (t = 'place' AND x.place_id = i) OR (t = 'event' AND x.parent_id = i)
  UNION SELECT 'polity', x.id FROM polities x WHERE t = 'polity' AND x.parent_id = i
  UNION SELECT 'movement', x.id FROM movements x WHERE t = 'movement' AND x.parent_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'artwork' AND w.parent_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'artist' AND w.creator_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'institution' AND w.current_institution_id = i
  UNION SELECT 'artwork', w.id FROM artworks w WHERE t = 'term' AND w.kind_term_id = i
  UNION SELECT 'artwork', m.artwork_id FROM artwork_materials m WHERE t = 'term' AND m.term_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'artist' AND p.owner_artist_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'person' AND p.owner_person_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'institution' AND p.owner_institution_id = i
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'place' AND (p.owner_place_id = i OR p.location_id = i)
  UNION SELECT 'artwork', p.artwork_id FROM provenance p WHERE t = 'event' AND p.event_id = i
  UNION SELECT c.entity_type, c.entity_id FROM citations c WHERE t = 'source' AND c.source_id = i AND c.entity_id IS NOT NULL
$$;

-- 3. Duplicates by fingerprint --------------------------------------------------------------------------------------
-- the keys an entry is found by: each name (trigram index, similarity ≥ 0.5 = dup_maybe's threshold), its sound key,
-- and the identifiers dup_maybe compares. One definition for the stored keys and for the lookup of a new entry.
CREATE FUNCTION dup_entry_keys(f dup_facts) RETURNS TABLE (kind text, key text) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT x.kind, x.key FROM (
    SELECT 'name', left(n, 1000) FROM unnest(f.names) n
    UNION ALL SELECT 'sound', name_sound_key(n) FROM unnest(f.names) n
    UNION ALL SELECT 'doi', f.doi
    UNION ALL SELECT 'isbn', f.isbn
    UNION ALL SELECT 'web', f.web_host
    UNION ALL SELECT 'inv', f.institution_id || ':' || lower(btrim(f.inventory_number))
    UNION ALL SELECT 'num', k FROM unnest(f.numbers) k) x(kind, key)
  WHERE x.key IS NOT NULL AND x.key <> ''
$$;

CREATE TABLE dup_entries (
  type entity_type NOT NULL, id bigint NOT NULL,
  fp   text NOT NULL,                      -- md5 of its dup_facts row
  PRIMARY KEY (type, id)
);
CREATE TABLE dup_keys (
  type entity_type NOT NULL, id bigint NOT NULL, kind text NOT NULL, key text NOT NULL,
  PRIMARY KEY (type, id, kind, key)
);
-- the verdicts that are findings, each way round (dup_score words the reasons from one side); b's name and slug for
-- the finding's text — a rename changes b's fingerprint, so the pair is weighed and written again
CREATE TABLE dup_pairs (
  type entity_type NOT NULL, a_id bigint NOT NULL, b_id bigint NOT NULL,
  score integer NOT NULL, reasons text[] NOT NULL, b_name text, b_slug text,
  PRIMARY KEY (type, a_id, b_id)
);
CREATE INDEX dup_pairs_b ON dup_pairs (type, b_id);
GRANT SELECT ON dup_entries, dup_keys, dup_pairs TO arthistory_admin;
COMMENT ON TABLE dup_pairs IS 'possible duplicates (dup_maybe and dup_score ≥ 50), kept up to date by process_derived() (125)';

-- an entry's candidates: other entries of its type sharing a key, or with a name of similarity ≥ 0.5 (the GIN
-- trigram index answers "%" — similarity ≥ pg_trgm.similarity_threshold, 0.3 — and the rest is filtered)
CREATE FUNCTION dup_neighbours(f dup_facts) RETURNS SETOF bigint LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- EXECUTE: planned for these values each time (a cached generic plan scans every name of the type instead)
  RETURN QUERY EXECUTE $q$
    SELECT k.id FROM dup_entry_keys($1) e JOIN dup_keys k ON k.kind = 'name' AND k.key % e.key
    WHERE e.kind = 'name' AND similarity(k.key, e.key) >= 0.5 AND k.type = ($1).type AND k.id <> ($1).id
    UNION
    SELECT k.id FROM dup_entry_keys($1) e JOIN dup_keys k ON k.type = ($1).type AND k.kind = e.kind AND k.key = e.key
    WHERE e.kind <> 'name' AND k.id <> ($1).id$q$ USING f;
END $$;

-- the box on the new-entry form and the merge page: the same lookup, live for the entry being written
CREATE OR REPLACE FUNCTION duplicate_candidates(etype entity_type, eid bigint, min_score integer DEFAULT 50)
RETURNS TABLE (id bigint, slug text, name text, score integer, reasons text[]) LANGUAGE plpgsql STABLE AS $$
DECLARE
  a dup_facts;
  near bigint[];
BEGIN
  SELECT f.* INTO a FROM dup_facts f WHERE f.type = etype AND f.id = eid;
  IF a.id IS NULL THEN RETURN; END IF;
  near := ARRAY(SELECT n FROM dup_neighbours(a) n);
  RETURN QUERY EXECUTE $q$
    SELECT b.id, b.slug, b.name, s.score, s.reasons
    FROM dup_facts b CROSS JOIN LATERAL dup_score($1, b) s
    WHERE b.type = $2 AND b.id = ANY($3) AND dup_maybe($1, b) AND s.score >= $4
      AND NOT EXISTS (SELECT 1 FROM quality_acks k WHERE k.check_id = 'possible_duplicate'
                      AND k.issue_key = 'dup:' || least(($1).id, b.id) || ':' || greatest(($1).id, b.id))
    ORDER BY s.score DESC, b.name LIMIT 10$q$ USING a, etype, near, min_score;
END $$;

-- the check reads the stored verdicts (the branch of quality_issues_live, as 123 left it, replaced)
DO $$
DECLARE
  def text := pg_get_viewdef('quality_issues_live'::regclass);
  head text := ' SELECT ''possible_duplicate''::text AS check_id,';
  tail text := 'WHERE (dup_maybe(p.fa, p.fb) AND (s.score >= 50))';
  s int := position(head IN def);
  e int;
BEGIN
  IF s = 0 OR position(head IN substr(def, s + 1)) > 0 THEN RAISE EXCEPTION 'possible_duplicate branch not found once'; END IF;
  e := s + position(tail IN substr(def, s)) - 1 + length(tail);
  IF position(tail IN substr(def, s)) = 0 THEN RAISE EXCEPTION 'end of the possible_duplicate branch not found'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || rtrim(left(def, s - 1) || $b$ SELECT 'possible_duplicate'::text AS check_id,
    'warning'::text AS severity,
    p.type AS entity_type,
    p.a_id AS entity_id,
    'dup:' || LEAST(p.a_id, p.b_id) || ':' || GREATEST(p.a_id, p.b_id) AS issue_key,
    format('probably the same as %s (%s) — %s (score %s)', p.b_name, p.b_slug, array_to_string(p.reasons, ', '), p.score) AS detail
   FROM dup_pairs p$b$ || substr(def, e), E'; \n');
END $$;
DROP VIEW dup_candidate_pairs;
DROP MATERIALIZED VIEW dup_name_keys;

-- filled once, for everything (afterwards only what changes)
INSERT INTO dup_entries SELECT f.type, f.id, md5(f::text) FROM dup_facts f;
INSERT INTO dup_keys SELECT f.type, f.id, k.kind, k.key FROM dup_facts f CROSS JOIN LATERAL dup_entry_keys(f) k;
-- the indexes after the bulk load (built sorted in one go). fastupdate off: a few keys are written per change, but
-- every lookup reads the index — with the default, new keys wait in a pending list that each lookup scans in full
-- (the first fill took 38 s that way instead of 6 s)
CREATE INDEX dup_keys_lookup ON dup_keys (type, kind, key);
CREATE INDEX dup_keys_name_trgm ON dup_keys USING gin (key gin_trgm_ops) WITH (fastupdate = off) WHERE kind = 'name';
ANALYZE dup_keys;
WITH f AS MATERIALIZED (SELECT f FROM dup_facts f),
     c AS MATERIALIZED (SELECT x.f AS fa, n.id FROM f x CROSS JOIN LATERAL dup_neighbours(x.f) n(id))
INSERT INTO dup_pairs
  SELECT (c.fa).type, (c.fa).id, c.id, s.score, s.reasons, (y.f).name, (y.f).slug
  FROM c JOIN f y ON (y.f).type = (c.fa).type AND (y.f).id = c.id
  CROSS JOIN LATERAL dup_score(c.fa, y.f) s
  WHERE dup_maybe(c.fa, y.f) AND s.score >= 50;

-- 2./4. The worker's two parts ----------------------------------------------------------------------------------------
-- the checks computed for all entries at once (their findings depend on entries in no fixed relation)
CREATE FUNCTION quality_global_checks() RETURNS text[] LANGUAGE sql IMMUTABLE
RETURN '{provenance_date_narrowable,broken_link,broken_glossary_link}'::text[];

-- one batch: the oldest entries in the queue (at most max_entries); returns how many (0 = the queue is empty)
CREATE FUNCTION process_derived(max_entries integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET client_min_messages = warning AS $$
DECLARE
  n integer;
  t entity_type;
  ids bigint[];
  globals text := quote_literal(quality_global_checks()) || '::text[]';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  DROP TABLE IF EXISTS d_batch, d_facts, d_changed, d_partners, d_cand, d_nf, d_fields, d_issues, d_touched;
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

-- the global part: the global checks, the words for "did you mean …?" (113), the stored graph (088)
CREATE FUNCTION refresh_quality_global() RETURNS void
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
  DELETE FROM graph_links;
  INSERT INTO graph_links
    SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period, e.period_label,
           e.label, e.certainty, e.source, e.provenance_id, e.id
    FROM edges e
    WHERE (e.subject_type, e.subject_id) IS DISTINCT FROM (e.object_type, e.object_id) AND e.subject_id IS NOT NULL AND e.object_id IS NOT NULL;
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp(), global_at = clock_timestamp();
END $$;

-- everything up to date when it returns (as before 125)
CREATE OR REPLACE FUNCTION refresh_quality() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  WHILE process_derived(500) > 0 LOOP END LOOP;
  PERFORM refresh_quality_global();
END $$;

-- the nightly safety net: every entry queued; also those that left stored rows behind
CREATE FUNCTION refresh_quality_full() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO derived_queue (type, id, reason)
    SELECT type, id, 'full' FROM entity_index
    UNION SELECT entity_type, entity_id, 'full' FROM quality_issues
    UNION SELECT type, id, 'full' FROM entry_search_fields_stored
    UNION SELECT type, id, 'full' FROM dup_entries;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE quality_refresh SET full_at = clock_timestamp();
  PERFORM nextval('quality_changes');
  PERFORM pg_notify('quality_changed', '');
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION quality_fresh() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM derived_queue) AND r.changes_seen >= s.last_value FROM quality_refresh r, quality_changes s
$$;

-- for the admin: how far behind
CREATE FUNCTION quality_status(OUT waiting integer, OUT oldest timestamptz, OUT global_current boolean,
                               OUT refreshed_at timestamptz, OUT full_at timestamptz, OUT drift_week integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (SELECT count(DISTINCT (q.type, q.id))::int FROM derived_queue q), (SELECT min(q.queued_at) FROM derived_queue q),
         r.changes_seen >= s.last_value, r.refreshed_at, r.full_at,
         (SELECT count(*)::int FROM derived_drift d WHERE d.found_at > now() - interval '7 days')
  FROM quality_refresh r, quality_changes s
$$;

REVOKE ALL ON FUNCTION process_derived(integer), refresh_quality_global(), refresh_quality_full() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_derived(integer), refresh_quality_global(), refresh_quality_full(), quality_status() TO arthistory_admin;
