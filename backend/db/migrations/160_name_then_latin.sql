-- 160 — The name then in Latin script first (owner's site is read in English/German): Tokyo's former names are 江戸
-- (from Wikidata's official names) and Edo; "born in Tokyo (then 江戸)" should read "(then Edo)". name_then() prefers
-- a name in Latin letters, then the order of the list.
CREATE OR REPLACE FUNCTION name_then(etype entity_type, eid bigint, during daterange) RETURNS entry_names
LANGUAGE sql STABLE AS $$
  SELECT n.* FROM entry_names n
   WHERE n.entity_type = etype AND n.entity_id = eid AND n.role = 'former' AND n.period && during
   ORDER BY (n.text ~ '[A-Za-zÀ-ɏ]') DESC, n.position LIMIT 1;
$$;
