-- 242 — The stored search fields keep their text folded (lower + f_unaccent) in a generated column, `hay`. The admin's
-- list search (src/admin/match.js fieldSearchSql) folded every field of the type on every request; with the
-- provenance's holders (241) the artworks' searched list took 1016 ms at ten times today's data (budget 1000 ms,
-- npm run perf). Folded once when a field is written, a search only compares. process_derived wrote the fields with
-- "SELECT *" from a copy of the table: a generated column takes no value, so it names the columns now.
ALTER TABLE entry_search_fields_stored
  ADD COLUMN hay text GENERATED ALWAYS AS (lower(f_unaccent(coalesce(match, text)))) STORED;
COMMENT ON COLUMN entry_search_fields_stored.hay IS 'match (or text) folded as the searches compare it — lower(f_unaccent(…)) (242)';

DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  old text := 'INSERT INTO entry_search_fields_stored AS s SELECT * FROM d_fields';
  new text := 'INSERT INTO entry_search_fields_stored AS s (type, id, position, label, text, match, tier_rank, tier_heading, shown)
      SELECT type, id, position, label, text, match, tier_rank, tier_heading, shown FROM d_fields';
BEGIN
  IF position(old IN def) = 0 THEN RAISE EXCEPTION 'process_derived: % not found', old; END IF;
  EXECUTE replace(def, old, new);
END $$;

-- the worker's reader returns rows of the table's type: the folded column is left empty there (it is never written
-- from them — the insert above names its columns; the table computes it)
CREATE OR REPLACE FUNCTION derived_search_fields(t entity_type, ids bigint[]) RETURNS SETOF entry_search_fields_stored
LANGUAGE plpgsql STABLE SET plan_cache_mode TO 'force_generic_plan' AS $f$
BEGIN
  RETURN QUERY SELECT f.*, NULL::text FROM entry_search_fields f WHERE f.type = t AND f.id = ANY (ids);
END $f$;
