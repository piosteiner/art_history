-- 105 — A holder's period when the end is known only as "or later" (owner's records, 2026-10-19: the new check
-- provenance_record_outside found inventory entries of 1747–1818 "outside" the Royal Collection's period, which ran
-- "until 1819 or later"). provenance_periods (031 … 098) took the end as upper(range) — NULL for an open range
-- ("1819 or later" = [1819-01-01,)) — and GREATEST() skips NULLs, so the period collapsed to the year of acquisition:
-- the Forge of Vulcan "1634–1819 or later" was 1634 only, La Petite Irène's restitution "27 March 1946 – 8 June 1949
-- or later" one day. Now an open end counts from its earliest possible day: coalesce(upper(r), lower(r) + 1).
-- The view is patched as it stands (its definition otherwise unchanged); each expression must be found exactly once.
DO $$
DECLARE
  def text := pg_get_viewdef('provenance_periods'::regclass);
  pairs text[][] := ARRAY[
    ['WHEN ((b.acquired IS NULL) AND (b.ended IS NOT NULL)) THEN daterange(NULL::date, upper(b.ended))',
     'WHEN ((b.acquired IS NULL) AND (b.ended IS NOT NULL)) THEN daterange(NULL::date, COALESCE(upper(b.ended), (lower(b.ended) + 1)))'],
    ['daterange(lower(b.acquired), GREATEST(upper(b.ended), upper(b.acquired)))',
     'daterange(lower(b.acquired), GREATEST(COALESCE(upper(b.ended), (lower(b.ended) + 1)), upper(b.acquired)))'],
    ['daterange(lower(b.acquired), GREATEST(upper(b.next_acquired), upper(b.acquired)))',
     'daterange(lower(b.acquired), GREATEST(COALESCE(upper(b.next_acquired), (lower(b.next_acquired) + 1)), upper(b.acquired)))']];
  i int;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    IF (length(def) - length(replace(def, pairs[i][1], ''))) / length(pairs[i][1]) <> 1 THEN
      RAISE EXCEPTION 'provenance_periods: expression % not found exactly once', i;
    END IF;
    def := replace(def, pairs[i][1], pairs[i][2]);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE VIEW provenance_periods AS ' || rtrim(def, E'; \n');
END $$;
