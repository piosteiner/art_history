-- 168 — The roadmap's topics in an order of their own (owner, 2026-10-30): each topic may have a section (for internal
-- reference: "Website", "CMS", "Daten" …); the topics are ordered by section, then by name (A–Z, natural) — unless
-- they were put in an order by hand (drag and drop in the CMS: `position`, null = automatic). Hand-ordered topics come
-- first in their order, any without a position after them by section and name; "Sort by section and name" clears the
-- positions. The changelog follows this order within a kind (167 sorted by topic name).
--   roadmap_areas_ordered (name, rank): the order as a view — one place for the CMS, the API and the triggers.
--   changelog_renumber(entry ids): the days' items renumbered (kind, topic rank, as written) — used by 167's triggers
--   and by a statement-level trigger on roadmap_areas, so a topic moved, renamed or given another section re-sorts the
--   changelog at once.
ALTER TABLE roadmap_areas ADD COLUMN section text CHECK (btrim(section) = section AND section <> ''),
  ADD COLUMN position integer;
COMMENT ON COLUMN roadmap_areas.section IS 'Internal grouping of topics (168): ordered by section, then name.';
COMMENT ON COLUMN roadmap_areas.position IS 'Order set by hand (drag and drop, 168); null = by section and name.';

CREATE VIEW roadmap_areas_ordered AS
SELECT a.name, a.color, a.section, a.position,
       row_number() OVER (ORDER BY a.position NULLS LAST, a.section COLLATE sort_natural NULLS LAST, a.name COLLATE sort_natural)::integer AS rank
FROM roadmap_areas a;
COMMENT ON VIEW roadmap_areas_ordered IS 'The roadmap topics in their order (168): by hand, else by section and name.';
GRANT SELECT ON roadmap_areas_ordered TO arthistory_api, arthistory_admin;

CREATE FUNCTION changelog_renumber(entries bigint[]) RETURNS void LANGUAGE sql AS $$
  UPDATE changelog_items i SET position = s.rn
  FROM (
    SELECT c.id, (row_number() OVER (PARTITION BY c.entry_id
                    ORDER BY changelog_kind_rank(c.kind), o.rank NULLS LAST, c.position, c.id) - 1)::integer AS rn
    FROM changelog_items c LEFT JOIN roadmap_areas_ordered o ON o.name = c.area
    WHERE c.entry_id = ANY (entries)
  ) s
  WHERE i.id = s.id AND i.position IS DISTINCT FROM s.rn
$$;

CREATE OR REPLACE FUNCTION changelog_sort_days() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;  -- our own renumbering, or a topic's rename cascading here
  PERFORM changelog_renumber(ARRAY(SELECT DISTINCT entry_id FROM new_rows));
  RETURN NULL;
END $$;

-- a topic moved, renamed or put in another section: every day with topics re-sorted
CREATE FUNCTION changelog_sort_after_topics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM changelog_renumber(ARRAY(SELECT DISTINCT entry_id FROM changelog_items WHERE area IS NOT NULL));
  RETURN NULL;
END $$;
CREATE TRIGGER roadmap_areas_changelog_order AFTER INSERT OR DELETE OR UPDATE OF name, section, position ON roadmap_areas
  FOR EACH STATEMENT EXECUTE FUNCTION changelog_sort_after_topics();
