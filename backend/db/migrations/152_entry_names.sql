-- 152 — Other names with context: when a name was in use, a note, and sources per name (owner, 2026-10-29: "der Fall
-- von Direction des Musées nationaux und Direction des musées de France zeigt, wie wichtig es ist, alternative Namen
-- mit Kontext zu versehen").
--
-- Each entry keeps its other names in the column `names` (jsonb, 022) — written by the form, the import, Wikidata, a
-- merge or a conversion, and audited with the entry, so History, Revert and the YAML snapshot keep working. New keys
-- per name:
--   period        when the name was in use, a daterange as text ("(,1946-01-01)") — written as a fuzzy date in the
--                 form ("until 1945", "1912–1940", "c. 1878"), like every other date
--   period_label  that date as written ("until 1945")
--   note          the context in a sentence ("renamed Direction des musées de France in 1945")
--
-- New: the table entry_names — every name of every entry as a row, kept by triggers in step with the column. Why both?
-- The column stays what the trigram, full-text and sort indexes are built on (an index can't reach into a join); the
-- rows give each name an identity that sources can point to (citations.name_id), and a real daterange with a GiST
-- index: "what was it called on 1 October 1939?" is `period @> date '1939-10-01'`. The table is written only by the
-- triggers (SECURITY DEFINER) — nobody edits it directly, so the two can't drift apart.
--
-- A name keeps its row (and so its sources) as long as its text and language stay; a name corrected in place (same
-- position, new spelling) keeps it too, and so does one corrected and moved (a left-over row of the same language and
-- role). A removed name takes its sources with it.

-- 1. what a name may hold
CREATE OR REPLACE FUNCTION names_valid(n jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(n) = 'array' AND coalesce((
    SELECT bool_and(jsonb_typeof(e) = 'object'
                    AND jsonb_typeof(e->'text') = 'string' AND btrim(e->>'text') <> ''
                    AND (e - 'text' - 'lang' - 'role' - 'status' - 'period' - 'period_label' - 'note') = '{}'
                    AND public.lang_tag_ok(e->>'lang')
                    AND e->>'role' IN ('original', 'translation', 'romanization', 'alternative', 'former')
                    AND (e->>'status' IS NULL OR (e->>'role' = 'translation' AND e->>'status' IN ('official', 'common', 'own')))
                    -- a range as Postgres writes it, with its label; the cast itself happens in entry_names (a
                    -- date's text form depends on DateStyle, so it can't be part of an immutable check)
                    AND (e->'period' IS NULL OR (jsonb_typeof(e->'period') = 'string'
                         AND e->>'period' ~ '^[\[(]([0-9]{4,}-[0-9]{2}-[0-9]{2}( BC)?)?,([0-9]{4,}-[0-9]{2}-[0-9]{2}( BC)?)?[\])]$'
                         AND jsonb_typeof(e->'period_label') = 'string' AND btrim(e->>'period_label') <> ''))
                    AND (e->'period_label' IS NULL OR e->'period' IS NOT NULL)
                    AND (e->'note' IS NULL OR (jsonb_typeof(e->'note') = 'string' AND btrim(e->>'note') <> '')))
    FROM jsonb_array_elements(n) e), true) $$;

-- 2. the names as rows
CREATE TABLE entry_names (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type  entity_type NOT NULL,
  entity_id    bigint NOT NULL,
  position     int NOT NULL,                      -- its place in the entry's list, from 0
  text         text NOT NULL CHECK (btrim(text) <> ''),
  lang         text CHECK (lang_tag_ok(lang)),
  role         text NOT NULL CHECK (role IN ('original', 'translation', 'romanization', 'alternative', 'former')),
  status       text CHECK (status IN ('official', 'own')),
  period       daterange CHECK (NOT isempty(period)),
  period_label text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((period IS NULL) = (period_label IS NULL))
);
COMMENT ON TABLE entry_names IS 'every other name of every entry as a row (152): kept in step with the entries'' column names by triggers; sources point here (citations.name_id)';
CREATE INDEX entry_names_entity_idx ON entry_names (entity_type, entity_id, position);
-- GiST: which names were in use at a date or during a span (@>, &&), across all entries
CREATE INDEX entry_names_period_idx ON entry_names USING gist (period) WHERE period IS NOT NULL;
CREATE TRIGGER entry_names_updated_at BEFORE UPDATE ON entry_names FOR EACH ROW EXECUTE FUNCTION set_updated_at();
REVOKE ALL ON entry_names FROM arthistory_admin, arthistory_api;
GRANT SELECT ON entry_names TO arthistory_admin, arthistory_api;

-- the entry's list → its rows: the same name (text + language) keeps its row, a corrected spelling at the same place
-- too; the rest is added or removed. Only rows that change are written.
CREATE FUNCTION entry_names_reconcile(etype entity_type, eid bigint, n jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  item jsonb; pos int; hit bigint; used bigint[] := '{}'; rest jsonb := '[]';
BEGIN
  FOR item, pos IN SELECT x.e, x.o::int - 1 FROM jsonb_array_elements(coalesce(n, '[]')) WITH ORDINALITY x(e, o) LOOP
    SELECT id INTO hit FROM entry_names WHERE entity_type = etype AND entity_id = eid AND id <> ALL (used)
      AND text = item->>'text' AND lang IS NOT DISTINCT FROM item->>'lang' ORDER BY position LIMIT 1;
    IF hit IS NULL THEN rest := rest || jsonb_build_object('pos', pos, 'item', item); CONTINUE; END IF;
    used := used || hit;
    PERFORM entry_names_write(hit, etype, eid, pos, item);
  END LOOP;
  FOR item, pos IN SELECT r->'item', (r->>'pos')::int FROM jsonb_array_elements(rest) r LOOP
    SELECT id INTO hit FROM entry_names WHERE entity_type = etype AND entity_id = eid AND id <> ALL (used) AND position = pos LIMIT 1;
    IF hit IS NULL THEN  -- corrected and moved: a left-over name of the same language and role
      SELECT id INTO hit FROM entry_names WHERE entity_type = etype AND entity_id = eid AND id <> ALL (used)
        AND lang IS NOT DISTINCT FROM item->>'lang' AND role = coalesce(item->>'role', 'alternative') ORDER BY position LIMIT 1;
    END IF;
    hit := entry_names_write(hit, etype, eid, pos, item);
    used := used || hit;
  END LOOP;
  DELETE FROM entry_names WHERE entity_type = etype AND entity_id = eid AND id <> ALL (used);
END $$;

-- one name into its row (hit = the row to update, NULL = a new one) → the row's id
CREATE FUNCTION entry_names_write(hit bigint, etype entity_type, eid bigint, pos int, item jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text := nullif(item->>'status', 'common');
  v_period daterange := (item->>'period')::daterange;
BEGIN
  IF hit IS NULL THEN
    INSERT INTO entry_names (entity_type, entity_id, position, text, lang, role, status, period, period_label, note)
    VALUES (etype, eid, pos, item->>'text', item->>'lang', coalesce(item->>'role', 'alternative'), v_status, v_period,
            item->>'period_label', item->>'note')
    RETURNING id INTO hit;
    RETURN hit;
  END IF;
  UPDATE entry_names SET position = pos, text = item->>'text', lang = item->>'lang', role = coalesce(item->>'role', 'alternative'),
         status = v_status, period = v_period, period_label = item->>'period_label', note = item->>'note'
   WHERE id = hit AND (position, text, lang, role, status, period, period_label, note) IS DISTINCT FROM
         (pos, item->>'text', item->>'lang', coalesce(item->>'role', 'alternative'), v_status, v_period, item->>'period_label', item->>'note');
  RETURN hit;
END $$;

CREATE FUNCTION entry_names_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE etype entity_type := TG_ARGV[0]::entity_type;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM entry_names WHERE entity_type = etype AND entity_id = OLD.id;
  ELSIF TG_OP = 'INSERT' OR OLD.names IS DISTINCT FROM NEW.names THEN
    PERFORM entry_names_reconcile(etype, NEW.id, NEW.names);
  END IF;
  RETURN NULL;
END $$;

-- 3. on every table with names; then the names there are now
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT e.type, entity_table(e.type) AS tbl FROM unnest(enum_range(NULL::entity_type)) e(type)
           WHERE EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                           AND c.table_name = entity_table(e.type) AND c.column_name = 'names') LOOP
    EXECUTE format('CREATE TRIGGER entry_names_sync AFTER INSERT OR DELETE OR UPDATE OF names ON %I FOR EACH ROW EXECUTE FUNCTION entry_names_sync(%L)',
                   t.tbl, t.type);
    EXECUTE format('SELECT entry_names_reconcile(%L, id, names) FROM %I WHERE names <> ''[]''', t.type, t.tbl);
  END LOOP;
END $$;

-- 4. sources for a name
ALTER TABLE citations ADD COLUMN name_id bigint REFERENCES entry_names (id) ON DELETE CASCADE;
COMMENT ON COLUMN citations.name_id IS 'the source of an other name (152): that it was used, when, in which form';
CREATE INDEX citations_name_idx ON citations (name_id) WHERE name_id IS NOT NULL;
ALTER TABLE citations DROP CONSTRAINT citations_one_target;
ALTER TABLE citations ADD CONSTRAINT citations_one_target CHECK ((entity_id IS NOT NULL)::int + (relationship_id IS NOT NULL)::int
  + (provenance_id IS NOT NULL)::int + (number_id IS NOT NULL)::int + (name_id IS NOT NULL)::int = 1);
DROP INDEX citations_one_per_source;
CREATE UNIQUE INDEX citations_one_per_source ON citations (entity_type, entity_id, field, relationship_id, provenance_id, number_id, name_id, source_id)
  NULLS NOT DISTINCT WHERE source_id IS NOT NULL;
COMMENT ON INDEX citations_one_per_source IS 'a bibliography source cites a field, relationship, step, number or name once (143, 152)';

CREATE OR REPLACE VIEW citation_status AS
 SELECT c.id, c.entity_type, c.entity_id, c.field, c.relationship_id, c.provenance_id, c.source_id, c.wikidata_item,
    c.wikidata_property, c.locator, c.note, c.accessed, c.cited_value, c.pending, c.created_by, c.created_at, c.updated_at,
    CASE WHEN c.wikidata_item IS NOT NULL THEN 'database'::source_reliability
         WHEN c.source_id IS NOT NULL THEN source_reliability(b.*)
         ELSE NULL::source_reliability END AS reliability,
    CASE WHEN c.wikidata_item IS NOT NULL THEN concat_ws(', ', 'Wikidata ' || c.wikidata_item, c.wikidata_property)
         WHEN c.source_id IS NOT NULL THEN concat_ws(', ', coalesce(b.siglum, b.name), c.locator)
         ELSE c.text END AS source_text,
    b.slug AS source_slug,
    c.entity_id IS NOT NULL AND c.pending IS NULL AND c.cited_value IS DISTINCT FROM field_value(er.r, f.cols) AS outdated,
    c.text, c.url, c.number_id, c.name_id
   FROM citations c
     LEFT JOIN bibliography b ON b.id = c.source_id
     LEFT JOIN citable_fields f ON f.entity_type = c.entity_type AND f.field = c.field
     LEFT JOIN entity_rows er ON er.type = c.entity_type AND er.id = c.entity_id;

-- 5. a merge or a conversion: the names' sources go along to the same names of the entry that remains
CREATE FUNCTION move_name_citations(from_type entity_type, from_id bigint, to_type entity_type, to_id bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE citations c SET name_id = k.id
    FROM entry_names d JOIN entry_names k ON k.entity_type = to_type AND k.entity_id = to_id
                                         AND k.text = d.text AND k.lang IS NOT DISTINCT FROM d.lang
   WHERE c.name_id = d.id AND d.entity_type = from_type AND d.entity_id = from_id
     AND NOT EXISTS (SELECT 1 FROM citations x WHERE x.name_id = k.id AND x.source_id IS NOT DISTINCT FROM c.source_id
                                                 AND x.wikidata_item IS NOT DISTINCT FROM c.wikidata_item AND x.text IS NOT DISTINCT FROM c.text);
$$;
DO $$
DECLARE
  def text;
  old text;
BEGIN
  def := pg_get_functiondef('merge_entries'::regproc);
  old := $q$  EXECUTE format('DELETE FROM %I WHERE id = $1', tbl) USING dup_id;$q$;
  IF position(old IN def) = 0 THEN RAISE EXCEPTION 'merge_entries: the DELETE line was not found'; END IF;
  EXECUTE replace(def, old, $q$  PERFORM public.move_name_citations(etype, dup_id, etype, keep_id);
$q$ || old);
  def := pg_get_functiondef('convert_entry'::regproc);
  old := $q$  EXECUTE format('DELETE FROM %I WHERE id = $1', old_tbl) USING eid;$q$;
  IF position(old IN def) = 0 THEN RAISE EXCEPTION 'convert_entry: the DELETE line was not found'; END IF;
  EXECUTE replace(def, old, $q$  PERFORM public.move_name_citations(etype, eid, new_type, nid);
$q$ || old);
END $$;

-- 6. the name an entry had at a time: a former name in use then (the earliest in the list), else none
CREATE FUNCTION name_then(etype entity_type, eid bigint, during daterange) RETURNS entry_names
LANGUAGE sql STABLE AS $$
  SELECT n.* FROM entry_names n
   WHERE n.entity_type = etype AND n.entity_id = eid AND n.role = 'former' AND n.period && during
   ORDER BY n.position LIMIT 1;
$$;
COMMENT ON FUNCTION name_then(entity_type, bigint, daterange) IS 'the former name in use during a span (152) — e.g. a holder''s name at a provenance step';

-- 7. a name's sources in the YAML snapshot (names[].sources), like a further number's (081)
CREATE FUNCTION name_citation_docs(name bigint) RETURNS jsonb LANGUAGE sql STABLE
RETURN (SELECT jsonb_agg(citation_doc(c.*) ORDER BY c.id) FROM citations c WHERE c.name_id = name_citation_docs.name);
