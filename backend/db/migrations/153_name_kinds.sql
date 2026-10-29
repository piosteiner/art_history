-- 153 — What kind of name it is (owner, 2026-10-29: "birth names or aliases of artists with more detail"). Beside its
-- role (original, translation, romanization, alternative, former — how the name relates to the main name), a name can
-- now say what it is: a birth name, a married name, a pseudonym, an art name (gō), a religious name, a nickname, an
-- abbreviation. The site writes "born Paula Becker"; lists can ask for every pseudonym.
--
-- One key more in the column `names` (`kind`) and one column more in entry_names (152), kept in step by the same
-- triggers. The kinds are a fixed list like the roles: a CHECK in names_valid() (an immutable function can't read a
-- table) and the same CHECK on the column.

CREATE OR REPLACE FUNCTION names_valid(n jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(n) = 'array' AND coalesce((
    SELECT bool_and(jsonb_typeof(e) = 'object'
                    AND jsonb_typeof(e->'text') = 'string' AND btrim(e->>'text') <> ''
                    AND (e - 'text' - 'lang' - 'role' - 'status' - 'kind' - 'period' - 'period_label' - 'note') = '{}'
                    AND public.lang_tag_ok(e->>'lang')
                    AND e->>'role' IN ('original', 'translation', 'romanization', 'alternative', 'former')
                    AND (e->>'status' IS NULL OR (e->>'role' = 'translation' AND e->>'status' IN ('official', 'common', 'own')))
                    AND (e->>'kind' IS NULL OR e->>'kind' IN ('birth', 'married', 'pseudonym', 'art_name', 'religious', 'nickname', 'abbreviation'))
                    AND (e->'period' IS NULL OR (jsonb_typeof(e->'period') = 'string'
                         AND e->>'period' ~ '^[\[(]([0-9]{4,}-[0-9]{2}-[0-9]{2}( BC)?)?,([0-9]{4,}-[0-9]{2}-[0-9]{2}( BC)?)?[\])]$'
                         AND jsonb_typeof(e->'period_label') = 'string' AND btrim(e->>'period_label') <> ''))
                    AND (e->'period_label' IS NULL OR e->'period' IS NOT NULL)
                    AND (e->'note' IS NULL OR (jsonb_typeof(e->'note') = 'string' AND btrim(e->>'note') <> '')))
    FROM jsonb_array_elements(n) e), true) $$;

ALTER TABLE entry_names ADD COLUMN kind text
  CHECK (kind IN ('birth', 'married', 'pseudonym', 'art_name', 'religious', 'nickname', 'abbreviation'));
COMMENT ON COLUMN entry_names.kind IS 'what kind of name (153): birth, married, pseudonym, art_name (gō), religious, nickname, abbreviation';
CREATE INDEX entry_names_kind_idx ON entry_names (kind, entity_type) WHERE kind IS NOT NULL;

CREATE OR REPLACE FUNCTION entry_names_write(hit bigint, etype entity_type, eid bigint, pos int, item jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text := nullif(item->>'status', 'common');
  v_period daterange := (item->>'period')::daterange;
BEGIN
  IF hit IS NULL THEN
    INSERT INTO entry_names (entity_type, entity_id, position, text, lang, role, status, kind, period, period_label, note)
    VALUES (etype, eid, pos, item->>'text', item->>'lang', coalesce(item->>'role', 'alternative'), v_status, item->>'kind', v_period,
            item->>'period_label', item->>'note')
    RETURNING id INTO hit;
    RETURN hit;
  END IF;
  UPDATE entry_names SET position = pos, text = item->>'text', lang = item->>'lang', role = coalesce(item->>'role', 'alternative'),
         status = v_status, kind = item->>'kind', period = v_period, period_label = item->>'period_label', note = item->>'note'
   WHERE id = hit AND (position, text, lang, role, status, kind, period, period_label, note) IS DISTINCT FROM
         (pos, item->>'text', item->>'lang', coalesce(item->>'role', 'alternative'), v_status, item->>'kind', v_period, item->>'period_label', item->>'note');
  RETURN hit;
END $$;
