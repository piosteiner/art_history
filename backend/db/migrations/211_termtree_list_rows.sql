-- 211 — A term's narrower terms follow it (2026-11-04). The glossary's list rows name the broader term (parent: slug,
-- name, collection — the calendars file the era names, the site lists them under the calendar only). derived_touch's
-- `termtree` branch (146) queued only the works linked to the tree when a term's names or broader term changed; now it
-- queues the narrower terms themselves too — their rows carry the parent's name and flag. The function stays as it is
-- otherwise (replaced by text, as 204 did with process_derived).
DO $$
DECLARE
  def text := pg_get_functiondef('derived_touch'::regproc);
  old text := $o$        INSERT INTO derived_queue (type, id)
          SELECT 'artwork'::entity_type, w.id FROM artworks w WHERE w.kind_term_id IN (SELECT glossary_with_narrower(v))
          UNION SELECT 'artwork'::entity_type, am.artwork_id FROM artwork_materials am WHERE am.term_id IN (SELECT glossary_with_narrower(v));$o$;
  new text := $n$        INSERT INTO derived_queue (type, id)
          SELECT 'artwork'::entity_type, w.id FROM artworks w WHERE w.kind_term_id IN (SELECT glossary_with_narrower(v))
          UNION SELECT 'artwork'::entity_type, am.artwork_id FROM artwork_materials am WHERE am.term_id IN (SELECT glossary_with_narrower(v));
        -- the terms under it (211): their list rows name it (parent — name, collection)
        INSERT INTO derived_queue (type, id) SELECT 'term'::entity_type, n FROM glossary_with_narrower(v) n WHERE n <> v;
        INSERT INTO list_queue (type, id) SELECT 'term'::entity_type, n FROM glossary_with_narrower(v) n WHERE n <> v;$n$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'derived_touch: the termtree branch not found once';
  END IF;
  EXECUTE replace(def, old, new);
END $$;
