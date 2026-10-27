-- 143 — A source cites a piece of information once (owner, 2026-10-27: "it wont make sense to have the exactly same
-- source twice for an item/information"). One citation per bibliography source and target — a field of an entry, a
-- relationship, a provenance step or a further number; two passages of the same source go into one citation's note.
--   1. existing duplicates (7) merged: the oldest kept, the others' notes and pages added to it, the rest deleted
--   2. a unique index — NULLS NOT DISTINCT: the target is spread over columns of which all but one are NULL, and
--      normally two NULLs count as different (every row would be "unique"); with this option they count as equal
--   3. merge_entries() (044): a duplicate's citation of a source the kept entry already cites for that field is
--      dropped before the others move over (else the merge would fail on the index)

-- 1. merge the duplicates: notes and pages in the order they were written (each once), the first link
WITH grp AS (
  SELECT min(id) AS keep, array_agg(id ORDER BY id) AS ids
  FROM citations WHERE source_id IS NOT NULL
  GROUP BY entity_type, entity_id, field, relationship_id, provenance_id, number_id, source_id
  HAVING count(*) > 1
), merged AS (
  SELECT g.keep, g.ids,
         (SELECT string_agg(v, ' · ' ORDER BY first_id) FROM (SELECT btrim(c.note) AS v, min(c.id) AS first_id FROM citations c
            WHERE c.id = ANY (g.ids) AND btrim(c.note) <> '' GROUP BY btrim(c.note)) n) AS notes,
         (SELECT string_agg(v, '; ' ORDER BY first_id) FROM (SELECT btrim(c.locator) AS v, min(c.id) AS first_id FROM citations c
            WHERE c.id = ANY (g.ids) AND btrim(c.locator) <> '' GROUP BY btrim(c.locator)) l) AS locators,
         (SELECT c.url FROM citations c WHERE c.id = ANY (g.ids) AND c.url IS NOT NULL ORDER BY c.id LIMIT 1) AS url
  FROM grp g
), upd AS (
  UPDATE citations c SET note = m.notes, locator = m.locators, url = coalesce(c.url, m.url)
  FROM merged m WHERE c.id = m.keep
  RETURNING c.id
)
DELETE FROM citations c USING grp g WHERE c.id = ANY (g.ids) AND c.id <> g.keep;

-- 2. once per source and target
CREATE UNIQUE INDEX citations_one_per_source ON citations (entity_type, entity_id, field, relationship_id, provenance_id, number_id, source_id)
  NULLS NOT DISTINCT WHERE source_id IS NOT NULL;
COMMENT ON INDEX citations_one_per_source IS 'a bibliography source cites a field, relationship, step or number once (143)';

-- 3. merge_entries(): drop the duplicate's citations of sources the kept entry already cites for the same field
DO $$
DECLARE
  def text := pg_get_functiondef('merge_entries'::regproc);
  old text := 'UPDATE citations SET entity_id = keep_id WHERE entity_type = etype AND entity_id = dup_id;';
BEGIN
  IF position(old IN def) = 0 THEN RAISE EXCEPTION 'merge_entries: the citations line was not found'; END IF;
  EXECUTE replace(def, old, 'DELETE FROM citations d WHERE d.entity_type = etype AND d.entity_id = dup_id AND d.source_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM citations k WHERE k.entity_type = etype AND k.entity_id = keep_id AND k.field = d.field AND k.source_id = d.source_id);
  ' || old);
END $$;
