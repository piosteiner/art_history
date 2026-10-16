-- 089 — Citable versions (owner, 2026-10-16: "we are not really using all the power that comes with postgres").
-- Every change to the content has been logged since migration 006 (audit_log: the row before and after, as jsonb).
-- That log is a time machine: the state of any row at any moment since logging began is
--   the last logged state at or before that moment (unless that was its deletion), or else
--   the state before its first change after it (unless that was its insertion), or else
--   the row as it is now (never changed since).
-- So an entry can be cited as it was: /v1/artworks/100476?as_of=2026-10-12 — the data as recorded then, however it
-- was corrected later, with the list of changes since.
--
-- audit_log stays closed to the API (it records who changed what); these functions are SECURITY DEFINER and return
-- content only (without user ids). DISTINCT ON (row_id) … ORDER BY row_id, id DESC: the last entry per row — Postgres'
-- idiom for "the latest per group", read from the index audit_log_row_idx (table_name, row_id, id).

-- the moment logging began (migration 006): earlier states can't be known
CREATE FUNCTION history_since() RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT applied_at FROM schema_migrations WHERE name LIKE '006\_%' $$;

-- the logged tables (those with the audit trigger)
CREATE FUNCTION audited_table(tbl text) RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE c.relname = tbl AND c.relnamespace = 'public'::regnamespace AND t.tgfoid = 'audit_row'::regproc)
$$;

-- what is not for the public: who made a row (admin user ids), the raw outside data
CREATE FUNCTION public_row(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE RETURN r - '{metadata,created_by,user_id}'::text[];

-- The rows of a table as they were at ts, optionally only those containing filter (jsonb @>: '{"artwork_id": 5}').
-- The filter applies to the state at ts — a relationship moved to another entry later still shows where it was.
CREATE FUNCTION rows_as_of(tbl text, ts timestamptz, filter jsonb DEFAULT '{}') RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT audited_table(tbl) THEN RAISE EXCEPTION 'no history for "%"', tbl USING ERRCODE = '22023'; END IF;
  IF ts < history_since() THEN
    RAISE EXCEPTION 'the history begins on %', to_char(history_since(), 'YYYY-MM-DD') USING ERRCODE = '22023';
  END IF;
  RETURN QUERY EXECUTE format($q$
    WITH cand AS (   -- the rows that contain the filter in some logged state
      SELECT DISTINCT a.row_id FROM audit_log a
      WHERE a.table_name = %1$L AND (a.new_row @> $2 OR a.old_row @> $2)),
    before AS (SELECT DISTINCT ON (a.row_id) a.row_id, a.action, a.new_row FROM audit_log a JOIN cand USING (row_id)
               WHERE a.table_name = %1$L AND a.changed_at <= $1 ORDER BY a.row_id, a.id DESC),
    after AS (SELECT DISTINCT ON (a.row_id) a.row_id, a.action, a.old_row FROM audit_log a JOIN cand USING (row_id)
              WHERE a.table_name = %1$L AND a.changed_at > $1 ORDER BY a.row_id, a.id),
    states AS (
      SELECT b.new_row AS r FROM before b WHERE b.action <> 'delete'
      UNION ALL
      SELECT f.old_row FROM after f
      WHERE f.action <> 'insert' AND NOT EXISTS (SELECT 1 FROM before b WHERE b.row_id = f.row_id)
      UNION ALL
      -- never changed since logging began: as it is now
      SELECT to_jsonb(t) FROM %1$I t
      WHERE NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = %1$L AND a.row_id = t.id))
    SELECT public_row(r) FROM states WHERE r @> $2 $q$, tbl) USING ts, filter;
END $$;
COMMENT ON FUNCTION rows_as_of IS 'the rows of a logged table as they were at ts (089), from audit_log; filter = jsonb containment on that state';

-- An entry's row id by slug or public number — also when it was deleted or merged away since (its last state is in
-- the log): deleted = true then.
CREATE FUNCTION entry_row_id(tbl text, key text, OUT id bigint, OUT deleted boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT audited_table(tbl) THEN RAISE EXCEPTION 'no history for "%"', tbl USING ERRCODE = '22023'; END IF;
  EXECUTE format('SELECT id FROM %I WHERE slug = $1 OR ($1 ~ ''^\d{1,15}$'' AND public_id = $1::bigint) ORDER BY slug = $1 DESC LIMIT 1', tbl)
    INTO id USING key;
  IF id IS NOT NULL THEN deleted := false; RETURN; END IF;
  SELECT a.row_id INTO id FROM audit_log a
  WHERE a.table_name = tbl AND a.action = 'delete' AND (a.old_row ->> 'slug' = key OR a.old_row ->> 'public_id' = key)
  ORDER BY a.id DESC LIMIT 1;
  deleted := id IS NOT NULL;
END $$;

-- An entry's log: the entries of audit_log about it — its own row, its relationships (either end), its citations and
-- images, an artwork's provenance steps and further numbers — content only.
CREATE FUNCTION entry_log(etype entity_type, eid bigint)
RETURNS TABLE (id bigint, changed_at timestamptz, txid xid8, table_name text, row_id bigint, action audit_action,
               old_row jsonb, new_row jsonb, source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH own AS (SELECT CASE etype WHEN 'artist' THEN 'artists' WHEN 'artwork' THEN 'artworks' WHEN 'institution' THEN 'institutions'
                 WHEN 'person' THEN 'people' WHEN 'movement' THEN 'movements' WHEN 'place' THEN 'places' WHEN 'polity' THEN 'polities'
                 WHEN 'term' THEN 'glossary' WHEN 'source' THEN 'bibliography' WHEN 'event' THEN 'events' END AS tbl),
  ends AS (SELECT jsonb_build_object('subject_type', etype, 'subject_id', eid) AS s, jsonb_build_object('object_type', etype, 'object_id', eid) AS o,
                  jsonb_build_object('entity_type', etype, 'entity_id', eid) AS e, jsonb_build_object('artwork_id', eid) AS w)
  SELECT a.id, a.changed_at, a.txid, a.table_name, a.row_id, a.action, public_row(a.old_row), public_row(a.new_row), a.source
  FROM audit_log a, own, ends
  WHERE (a.table_name = own.tbl AND a.row_id = eid)
     OR (a.table_name = 'relationships' AND (a.new_row @> ends.s OR a.old_row @> ends.s OR a.new_row @> ends.o OR a.old_row @> ends.o))
     OR (a.table_name IN ('citations', 'images') AND (a.new_row @> ends.e OR a.old_row @> ends.e))
     OR (etype = 'artwork' AND a.table_name IN ('provenance', 'artwork_numbers') AND (a.new_row @> ends.w OR a.old_row @> ends.w))
$$;

-- The versions of an entry: one per transaction that changed it (txid), oldest first — what a citation can point to.
CREATE FUNCTION entry_versions(etype entity_type, eid bigint)
RETURNS TABLE (changed_at timestamptz, txid xid8, sources text[], tables text[], changes integer)
LANGUAGE sql STABLE AS $$
  SELECT min(l.changed_at), l.txid, array_agg(DISTINCT l.source ORDER BY l.source), array_agg(DISTINCT l.table_name ORDER BY l.table_name), count(*)::integer
  FROM entry_log(etype, eid) l
  GROUP BY l.txid
  ORDER BY min(l.changed_at), l.txid
$$;
COMMENT ON FUNCTION entry_versions IS 'the transactions that changed an entry, its relationships, provenance, citations, images (089)';

-- What a change did: the fields whose value it changed
CREATE FUNCTION changed_fields(old_row jsonb, new_row jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(k ORDER BY k), '{}')
  FROM (SELECT jsonb_object_keys(coalesce(old_row, '{}') || coalesce(new_row, '{}')) AS k) keys
  WHERE k NOT IN ('updated_at', 'created_at') AND old_row -> k IS DISTINCT FROM new_row -> k
$$;

GRANT EXECUTE ON FUNCTION history_since(), rows_as_of(text, timestamptz, jsonb), entry_row_id(text, text),
  entry_log(entity_type, bigint), entry_versions(entity_type, bigint) TO arthistory_api;
