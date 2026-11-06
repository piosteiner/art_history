-- 239 — Sources of names only per name (owner 2026-11-06: "why is there a source marker for other names as a whole?").
-- Since 152 each name has its own sources (citations.name_id); the older citations of the field "names" as a whole —
-- from the Wikidata comparison (340), "also for", the new-entry form's source (96) — said "these names", not which.
-- Each is handed to every name it covered: the names in its cited value (the list as it was cited) that the entry
-- still has (matched by text); a citation without a cited value goes to all the entry's names. Then the field-level
-- citations go, and "names" is no longer a citable field — the edit page loses the marker beside "Other names", and
-- the code cites names one by one from now on (src/admin/citations.js citeNames).
--
-- One citation per source and target (143): a name its source cites already keeps that one (its page/note kept).

INSERT INTO citations (name_id, source_id, wikidata_item, wikidata_property, text, url, locator, note, accessed, created_by, created_at)
SELECT n.id, c.source_id, c.wikidata_item, c.wikidata_property, c.text, c.url, c.locator, c.note, c.accessed, c.created_by, c.created_at
  FROM citations c
  JOIN entry_names n ON n.entity_type = c.entity_type AND n.entity_id = c.entity_id
 WHERE c.field = 'names' AND c.pending IS NULL
   AND (c.cited_value IS NULL
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.cited_value -> 'names', '[]'::jsonb)) x(name)
                    WHERE (CASE jsonb_typeof(x.name) WHEN 'string' THEN x.name #>> '{}' ELSE x.name ->> 'text' END) = n.text))
   AND NOT EXISTS (SELECT 1 FROM citations o WHERE o.name_id = n.id
                    AND ((c.source_id IS NOT NULL AND o.source_id = c.source_id)
                      OR (c.wikidata_item IS NOT NULL AND o.wikidata_item = c.wikidata_item)
                      OR (c.text IS NOT NULL AND o.text = c.text)));

DELETE FROM citations WHERE field = 'names';
DELETE FROM citable_fields WHERE field = 'names';
