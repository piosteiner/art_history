-- 051 — Correcting 049's backfill. Rule (b) cited every field of an entry whose metadata carried a "Wikidata Q…
-- (retrieved …)" note — but the Wikidata comparison writes that note into every compared entry, and values changed
-- later (an institution corrected by hand, a loan set) are not Wikidata's. A backfilled field citation (no author:
-- created_by IS NULL) stays only if it is justified:
--   · a Wikidata value accepted in a comparison (wikidata_reviews), or
--   · the value is still the one the entry was created with, and it was created with the note (from Wikidata).
DELETE FROM citations c
WHERE c.created_by IS NULL AND c.wikidata_item IS NOT NULL AND c.entity_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM wikidata_reviews w
                   WHERE (w.entity_type, w.entity_id, w.item) = (c.entity_type, c.entity_id, c.field) AND w.decision = 'accepted')
  AND NOT EXISTS (SELECT 1 FROM audit_log a JOIN citable_fields f ON (f.entity_type, f.field) = (c.entity_type, c.field)
                   WHERE a.table_name = entity_table(c.entity_type) AND a.row_id = c.entity_id AND a.action = 'insert'
                     AND a.new_row ->> 'metadata' LIKE '%Wikidata Q%'
                     AND field_value(a.new_row, f.cols) IS NOT DISTINCT FROM c.cited_value);
