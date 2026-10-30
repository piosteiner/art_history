-- 167 — The changelog sorts itself (owner, 2026-10-30): the items of a day by kind — Neu, Verbessert, Behoben, Inhalt,
-- Technik — then by roadmap topic (A–Z, natural order; items without a topic after those with one), and within the
-- same kind and topic in the order they were written. Whatever adds or changes an item — the CMS's text field, a
-- roadmap goal marked done (it appends its line), an import — the day is renumbered afterwards, so `position` (what the
-- API, the RSS feed, the site and the CMS read) is always this order.
--   changelog_kind_rank(kind): 1 … 5, the order of the kinds.
--   Two statement-level triggers (INSERT, UPDATE — transition tables allow one event per trigger) see every row the
--   statement touched (REFERENCING NEW TABLE) and renumber those days once; the renumbering's own UPDATE does not
--   start them again (pg_trigger_depth()). The unique (entry_id, position) is deferred (118), so positions may cross
--   during the UPDATE.
CREATE FUNCTION changelog_kind_rank(kind text) RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN array_position(ARRAY['neu', 'verbessert', 'behoben', 'inhalt', 'technik'], kind);
COMMENT ON FUNCTION changelog_kind_rank(text) IS 'Order of the changelog kinds (167): Neu, Verbessert, Behoben, Inhalt, Technik.';

CREATE FUNCTION changelog_sort_days() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;  -- our own renumbering below
  UPDATE changelog_items i SET position = s.rn
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY entry_id
                  ORDER BY changelog_kind_rank(kind), area COLLATE sort_natural NULLS LAST, position, id) - 1)::integer AS rn
    FROM changelog_items WHERE entry_id IN (SELECT DISTINCT entry_id FROM new_rows)
  ) s
  WHERE i.id = s.id AND i.position IS DISTINCT FROM s.rn;
  RETURN NULL;
END $$;

CREATE TRIGGER changelog_items_sorted_ins AFTER INSERT ON changelog_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION changelog_sort_days();
CREATE TRIGGER changelog_items_sorted_upd AFTER UPDATE ON changelog_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION changelog_sort_days();

-- every day once, as it stands
UPDATE changelog_items i SET position = s.rn
FROM (
  SELECT id, (row_number() OVER (PARTITION BY entry_id
                ORDER BY changelog_kind_rank(kind), area COLLATE sort_natural NULLS LAST, position, id) - 1)::integer AS rn
  FROM changelog_items
) s
WHERE i.id = s.id AND i.position IS DISTINCT FROM s.rn;
