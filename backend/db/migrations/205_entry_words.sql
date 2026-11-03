-- 205 — The words of the names stored per entry (perf, 2026-11-03). search_words (113, "did you mean") split every
-- name and other name of the database into words on each refresh — the names folded by dup_names() for 41,000
-- entries: ~1.7 s on the perf data (10× today), most of the worker's global part when due (199: at most every 5
-- minutes; budget 3 s). Now each entry's words are kept in entry_words by triggers when a name changes, and
-- search_words only counts them. Its rows, columns and indexes stay as they were.
CREATE TABLE entry_words (
  type    entity_type NOT NULL,
  id      bigint NOT NULL,
  written text,            -- as written (the main name's words: the suggestion's spelling), NULL for other names
  word    text NOT NULL    -- folded
);
COMMENT ON TABLE entry_words IS 'The words of each entry''s names (205), kept by triggers (entry_words_touch); search_words counts them.';
CREATE INDEX entry_words_entry ON entry_words (type, id);

-- one entry's words, as search_words (113) found them: the main name's words as written and folded, the other names'
-- (dup_names: already folded) as they are; words of three letters and more
CREATE FUNCTION entry_words_refresh(t entity_type, eid bigint) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM entry_words WHERE type = t AND id = eid;
  INSERT INTO entry_words (type, id, written, word)
    SELECT f.type, f.id, x, lower(f_unaccent(x)) FROM dup_facts f, regexp_split_to_table(f.name, '[^[:alpha:]]+') x
    WHERE f.type = t AND f.id = eid AND length(x) >= 3
    UNION ALL
    SELECT f.type, f.id, NULL, x FROM dup_facts f, unnest(f.names) n, regexp_split_to_table(n, '[^[:alpha:]]+') x
    WHERE f.type = t AND f.id = eid AND length(x) >= 3;
$$;

-- filled once for every entry, the same way
INSERT INTO entry_words (type, id, written, word)
  SELECT f.type, f.id, x, lower(f_unaccent(x)) FROM dup_facts f, regexp_split_to_table(f.name, '[^[:alpha:]]+') x WHERE length(x) >= 3
  UNION ALL
  SELECT f.type, f.id, NULL, x FROM dup_facts f, unnest(f.names) n, regexp_split_to_table(n, '[^[:alpha:]]+') x WHERE length(x) >= 3;

-- the trigger: TG_ARGV = (type, name column); an update refreshes only when the name or the other names changed
CREATE FUNCTION entry_words_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  IF TG_OP = 'UPDATE' AND (o -> TG_ARGV[1]) IS NOT DISTINCT FROM (n -> TG_ARGV[1]) AND (o -> 'names') IS NOT DISTINCT FROM (n -> 'names') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM entry_words WHERE type = TG_ARGV[0]::entity_type AND id = (o ->> 'id')::bigint;
  ELSE
    PERFORM entry_words_refresh(TG_ARGV[0]::entity_type, (n ->> 'id')::bigint);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON artworks FOR EACH ROW EXECUTE FUNCTION entry_words_touch('artwork', 'title');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON artists FOR EACH ROW EXECUTE FUNCTION entry_words_touch('artist', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON people FOR EACH ROW EXECUTE FUNCTION entry_words_touch('person', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON places FOR EACH ROW EXECUTE FUNCTION entry_words_touch('place', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON institutions FOR EACH ROW EXECUTE FUNCTION entry_words_touch('institution', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION entry_words_touch('movement', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON polities FOR EACH ROW EXECUTE FUNCTION entry_words_touch('polity', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON glossary FOR EACH ROW EXECUTE FUNCTION entry_words_touch('term', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION entry_words_touch('source', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION entry_words_touch('event', 'name');
CREATE TRIGGER entry_words_touch AFTER INSERT OR UPDATE OR DELETE ON literary_works FOR EACH ROW EXECUTE FUNCTION entry_words_touch('literature', 'name');

-- search_words from the stored words: the same columns, rows and indexes. search_suggest() (113) is written with a
-- SQL-standard body and so depends on it: kept as it is, dropped and created again around it.
DO $$
DECLARE
  f text := pg_get_functiondef('search_suggest(text)'::regprocedure);
BEGIN
  DROP FUNCTION search_suggest(text);
  DROP MATERIALIZED VIEW search_words;
  CREATE MATERIALIZED VIEW search_words AS
    SELECT word, coalesce(mode() WITHIN GROUP (ORDER BY written), word) AS display, count(*)::integer AS n, dmetaphone(word) AS sound
    FROM entry_words GROUP BY word;
  CREATE UNIQUE INDEX search_words_word ON search_words (word);
  CREATE INDEX search_words_trgm ON search_words USING gin (word gin_trgm_ops);
  CREATE INDEX search_words_sound ON search_words (sound);
  GRANT SELECT, INSERT, UPDATE, DELETE ON search_words TO arthistory_admin;
  GRANT SELECT ON search_words TO arthistory_api;
  EXECUTE f;
  GRANT EXECUTE ON FUNCTION search_suggest(text) TO arthistory_admin, arthistory_api;
  COMMENT ON FUNCTION search_suggest(text) IS 'per unknown word of a query, the nearest word of the entries'' names (113)';
END $$;
