-- 088 — Network questions (owner, 2026-10-16: "we are not really using all the power that comes with postgres").
--   * entry_path(): how are two entries connected — the shortest chain of relationships and provenance steps
--     ("La Petite Irène → Göring → … → Gauguin");
--   * hands_network(window): through whose hands works went in a time window (1933–1945: holders, the
--     handovers between them, the works) as one JSON document;
--   * shared_hands(artwork): other works that passed through the same hands — and, a step further, works that shared
--     hands with those (a recursive CTE with SEARCH BREADTH FIRST and CYCLE).
--
-- graph_links: the edges view (stored relationships + everything derived from the provenance) STORED, with an index
-- on each end. Computing edges takes ~65 ms; a search reads the neighbours of a whole frontier per step, several
-- steps per question — on the stored copy each step is an index lookup. Rewritten by refresh_quality(), which already
-- runs after every committed change (058: LISTEN/NOTIFY, half a second later) — as fresh as the quality findings.
-- A table, not a MATERIALIZED VIEW: since Postgres 17 REFRESH runs with search_path = pg_catalog (a safety
-- measure), and older functions reached by edges call others unqualified; and DELETE + INSERT in one transaction
-- lets readers go on reading the old copy until the commit, where a plain REFRESH would lock them out.
CREATE TABLE graph_links (
  subject_type entity_type NOT NULL,
  subject_id bigint NOT NULL,
  object_type entity_type NOT NULL,
  object_id bigint NOT NULL,
  relationship_type text NOT NULL,
  period daterange,
  period_label text,
  label text,
  certainty certainty,
  source text,
  provenance_id bigint,
  relationship_id bigint);
CREATE INDEX graph_links_subject_idx ON graph_links (subject_type, subject_id);
CREATE INDEX graph_links_object_idx ON graph_links (object_type, object_id);
COMMENT ON TABLE graph_links IS 'the edges view stored (088), rewritten by refresh_quality() after changes — for path and network searches';
GRANT SELECT ON graph_links TO arthistory_api;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON graph_links FROM arthistory_admin;

CREATE OR REPLACE FUNCTION refresh_quality()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE seen bigint;
BEGIN
  -- one at a time: a second caller waits, then finds little to do
  PERFORM pg_advisory_xact_lock(hashtextextended('refresh_quality', 0));
  -- read before computing: a change counted after this is either in the result or makes it stale again
  SELECT last_value INTO seen FROM quality_changes;
  CREATE TEMP TABLE fresh ON COMMIT DROP AS
    SELECT DISTINCT ON (check_id, issue_key, entity_type, entity_id) * FROM quality_issues_live;
  DELETE FROM quality_issues q WHERE NOT EXISTS (SELECT 1 FROM fresh f
    WHERE (f.check_id, f.issue_key, f.entity_type, f.entity_id) = (q.check_id, q.issue_key, q.entity_type, q.entity_id));
  INSERT INTO quality_issues AS q SELECT * FROM fresh
  ON CONFLICT (check_id, issue_key, entity_type, entity_id) DO UPDATE SET severity = EXCLUDED.severity, detail = EXCLUDED.detail
  -- an unchanged finding isn't written again (no new row version, nothing for VACUUM)
  WHERE (q.severity, q.detail) IS DISTINCT FROM (EXCLUDED.severity, EXCLUDED.detail);
  -- the stored graph (088) goes with it
  DELETE FROM graph_links;
  INSERT INTO graph_links
    SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period, e.period_label,
           e.label, e.certainty, e.source, e.provenance_id, e.id
    FROM edges e
    WHERE (e.subject_type, e.subject_id) IS DISTINCT FROM (e.object_type, e.object_id) AND e.subject_id IS NOT NULL AND e.object_id IS NOT NULL;
  UPDATE quality_refresh SET changes_seen = seen, refreshed_at = clock_timestamp();
END $function$;

-- Shortest path, breadth-first. Why not a recursive CTE? A recursive CTE's next step sees only the rows of the step
-- before, not everything reached so far: it can't skip an entry already reached by another way, so it follows every
-- path (exponentially many through a well-connected dealer). This walks the frontier with a global "seen" set — a
-- jsonb object used as a map: entry → the entry it was reached from and the edge — and stops at the first round
-- that reaches the target: the fewest steps. Both directions of every edge count ("owned by" is also "owned").
-- via: the types an intermediate step may be (places, polities, terms and sources would connect everything to
-- everything: "both in Paris"); the ends may be of any type. Ties: attested before probable before possible, then
-- by name — the same answer every time.
CREATE FUNCTION entry_path(from_type entity_type, from_id bigint, to_type entity_type, to_id bigint,
                           via entity_type[] DEFAULT '{artist,artwork,institution,person,event,movement}',
                           max_steps integer DEFAULT 6)
RETURNS TABLE (step integer, a_type entity_type, a_id bigint, b_type entity_type, b_id bigint, relationship_type text,
               forward boolean, period daterange, period_label text, label text, certainty certainty, provenance_id bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  start_key text := from_type || ':' || from_id;
  goal_key text := to_type || ':' || to_id;
  seen jsonb := jsonb_build_object(start_key, NULL);
  ft entity_type[] := ARRAY[from_type];       -- the frontier, as two arrays (unnest(ft, fi) gives (type, id) rows)
  fi bigint[] := ARRAY[from_id];
  reached jsonb;
  k text;
  n integer := 0;
BEGIN
  IF start_key = goal_key THEN RETURN; END IF;
  FOR round IN 1..least(max_steps, 10) LOOP
    -- every entry next to the frontier, not seen yet, each once (its best edge)
    SELECT jsonb_object_agg(x.nk, jsonb_build_object('from', x.fk, 'edge', x.edge)), array_agg(x.nt), array_agg(x.nid)
      INTO reached, ft, fi
    FROM (
      SELECT DISTINCT ON (nb.nk) nb.fk, nb.nk, nb.nt, nb.nid, e.edge
      FROM (
        SELECT l.subject_type || ':' || l.subject_id AS fk, l.object_type || ':' || l.object_id AS nk, l.object_type AS nt, l.object_id AS nid,
               true AS fwd, l.certainty AS c, l.*
        FROM unnest(ft, fi) f(t, i) JOIN graph_links l ON (l.subject_type, l.subject_id) = (f.t, f.i)
        UNION ALL
        SELECT l.object_type || ':' || l.object_id, l.subject_type || ':' || l.subject_id, l.subject_type, l.subject_id,
               false, l.certainty, l.*
        FROM unnest(ft, fi) f(t, i) JOIN graph_links l ON (l.object_type, l.object_id) = (f.t, f.i)
      ) nb
      CROSS JOIN LATERAL (SELECT jsonb_build_object('type', nb.relationship_type, 'forward', nb.fwd, 'period', nb.period,
                                   'period_label', nb.period_label, 'label', nb.label, 'certainty', nb.c,
                                   'provenance_id', nb.provenance_id) AS edge) e
      WHERE NOT seen ? nb.nk AND (nb.nt = ANY (via) OR nb.nk = goal_key)
      ORDER BY nb.nk, array_position('{attested,probable,possible}'::certainty[], nb.c), nb.relationship_type, nb.fk
    ) x;
    EXIT WHEN reached IS NULL;   -- nothing new: no connection
    seen := seen || reached;
    IF seen ? goal_key THEN
      -- walk back from the goal
      k := goal_key;
      WHILE k <> start_key LOOP
        n := n + 1;
        a_type := split_part(seen -> k ->> 'from', ':', 1)::entity_type; a_id := split_part(seen -> k ->> 'from', ':', 2)::bigint;
        b_type := split_part(k, ':', 1)::entity_type; b_id := split_part(k, ':', 2)::bigint;
        relationship_type := seen -> k -> 'edge' ->> 'type';
        forward := (seen -> k -> 'edge' ->> 'forward')::boolean;
        period := (seen -> k -> 'edge' ->> 'period')::daterange;
        period_label := seen -> k -> 'edge' ->> 'period_label';
        label := seen -> k -> 'edge' ->> 'label';
        certainty := (seen -> k -> 'edge' ->> 'certainty')::certainty;
        provenance_id := (seen -> k -> 'edge' ->> 'provenance_id')::bigint;
        step := -n;   -- numbered from the goal backwards: ORDER BY step gives start → goal
        RETURN NEXT;
        k := seen -> k ->> 'from';
      END LOOP;
      RETURN;
    END IF;
  END LOOP;
END $$;
COMMENT ON FUNCTION entry_path IS 'shortest chain of edges between two entries (088), breadth-first over graph_links; rows numbered from the goal as -n (ORDER BY step: from the start)';

-- Through whose hands, in a time window: the holders (owners of the chain, custodians, possessors …) who had at
-- least one work during it, the handovers between them dated in it, and the works — one JSON document
-- {holders: […], handovers: […]}, built in the database with jsonb_agg (the API passes it on).
CREATE FUNCTION hands_network(win daterange) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH held AS (
    SELECT l.object_type AS t, l.object_id AS id, l.subject_id AS artwork_id, l.relationship_type, l.period, l.period_label, l.label
    FROM graph_links l
    WHERE l.subject_type = 'artwork' AND l.relationship_type IN ('owned_by', 'held_by') AND l.period && win),
  handovers AS (
    SELECT l.subject_type AS from_t, l.subject_id AS from_id, l.object_type AS to_t, l.object_id AS to_id,
           p.artwork_id, l.period, l.period_label, l.label, l.certainty, l.provenance_id
    FROM graph_links l JOIN provenance p ON p.id = l.provenance_id
    WHERE l.relationship_type = 'transferred_to' AND l.period && win)
  SELECT jsonb_build_object(
    'holders', coalesce((
      SELECT jsonb_agg(jsonb_build_object('type', h.t, 'id', h.id, 'artworks', h.artworks, 'roles', h.roles,
                                          'flag', holder_flag(h.t, h.id)) ORDER BY cardinality(h.artworks) DESC, h.t, h.id)
      FROM (SELECT t, id, array_agg(DISTINCT artwork_id ORDER BY artwork_id) AS artworks,
                   array_agg(DISTINCT CASE WHEN relationship_type = 'held_by' THEN split_part(label, ' · ', 1) ELSE 'owner' END) AS roles
            FROM held GROUP BY t, id) h), '[]'),
    'handovers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('from_type', from_t, 'from_id', from_id, 'to_type', to_t, 'to_id', to_id,
                                          'artwork_id', artwork_id, 'period', range_json(period, period_label),
                                          'label', label, 'certainty', certainty, 'provenance_id', provenance_id)
                       ORDER BY lower(period) NULLS LAST, artwork_id)
      FROM handovers), '[]'))
$$;
COMMENT ON FUNCTION hands_network IS 'holders with works in a window, the handovers between them in it (088) — JSON {holders, handovers}';

-- Works that went through the same hands. Depth 1: works with a holder in common with this one; depth 2: works
-- sharing a holder with those; and so on. Not the artist (every work of Gauguin's "passed through" Gauguin), and not
-- the hands both works are still in unless asked (with_current): "both are in the Bührle Foundation now" says
-- little; "both belonged to Emil Bührle" or "both went through Vollard's hands" is the question.
-- A recursive CTE walks from work to work. Rows are only (work, depth) and the union is UNION, not UNION ALL: a row
-- already produced is dropped, so each work is expanded once per depth however many ways lead to it. (Tracking the
-- path, e.g. with CYCLE … USING path, would make every way a row of its own: through a museum with 40 works, 40 × 40
-- × 40 … — 15 seconds instead of milliseconds.) SEARCH BREADTH FIRST adds the column ord, which sorts the rows level
-- by level. The way back — which work and which holder led here — is joined afterwards from the level before.
CREATE FUNCTION shared_hands(start bigint, max_depth integer DEFAULT 2, with_current boolean DEFAULT false)
RETURNS TABLE (artwork_id bigint, depth integer, via_artwork_id bigint, holders jsonb, together boolean)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE hold AS MATERIALIZED (
    -- who held which work, when (owners and custodians); not the artist who made it
    SELECT l.subject_id AS artwork_id, l.object_type AS t, l.object_id AS id, l.period, coalesce(upper_inf(l.period), false) AS ongoing
    FROM graph_links l JOIN artworks w ON w.id = l.subject_id
    WHERE l.subject_type = 'artwork' AND l.relationship_type IN ('owned_by', 'held_by')
      AND NOT (l.object_type = 'artist' AND l.object_id IS NOT DISTINCT FROM w.creator_id)),
  pairs AS MATERIALIZED (
    -- two works and a holder they share; together: held at the same time
    SELECT a.artwork_id AS a, b.artwork_id AS b, a.t, a.id, bool_or(coalesce(a.period && b.period, false)) AS together
    FROM hold a JOIN hold b ON (b.t, b.id) = (a.t, a.id) AND b.artwork_id <> a.artwork_id
    WHERE with_current OR NOT (a.ongoing AND b.ongoing)
    GROUP BY a.artwork_id, b.artwork_id, a.t, a.id),
  reach (artwork_id, depth) AS (
    SELECT start, 0
    UNION
    SELECT p.b, r.depth + 1 FROM reach r JOIN pairs p ON p.a = r.artwork_id
    WHERE r.depth < least(max_depth, 4)
  ) SEARCH BREADTH FIRST BY artwork_id SET ord,
  nearest AS (SELECT r.artwork_id, min(r.depth) AS depth FROM reach r GROUP BY r.artwork_id)
  SELECT DISTINCT ON (n.artwork_id) n.artwork_id, n.depth, v.artwork_id,
         (SELECT jsonb_agg(jsonb_build_object('type', q.t, 'id', q.id, 'together', q.together) ORDER BY q.together DESC, q.t, q.id)
          FROM pairs q WHERE (q.a, q.b) = (v.artwork_id, n.artwork_id)),
         bool_or(p.together) OVER (PARTITION BY n.artwork_id, v.artwork_id)
  FROM nearest n
  JOIN nearest v ON v.depth = n.depth - 1
  JOIN pairs p ON (p.a, p.b) = (v.artwork_id, n.artwork_id)
  WHERE n.depth > 0
  -- the way from the level before: the one with most holders in common, held together first
  ORDER BY n.artwork_id, (SELECT count(*) FROM pairs q WHERE (q.a, q.b) = (v.artwork_id, n.artwork_id)) DESC, p.together DESC, v.artwork_id
$$;
COMMENT ON FUNCTION shared_hands IS 'works that passed through the same hands as this one, and further (088): recursive CTE, UNION + SEARCH BREADTH FIRST';

SELECT refresh_quality();
