-- 042 — [[links]] follow slug changes. Links in Markdown are plain text with the slug written out
-- ([[artist/paul-gauguin|Gauguin]]); after a rename they would point at nothing, and once a new entry took the old
-- slug, silently at the wrong entry. Now:
--   1. renaming an entry rewrites every [[type/old-slug…]] in every text to the new slug, in the same transaction
--      (history source "slug rename", so it shows — and reverts — like any other change);
--   2. a text saved with a link to an old slug (a working copy opened before the rename, an old YAML snapshot) is
--      corrected on the way in, by a BEFORE trigger on every Markdown column.
-- What can't be caught: a link to an old slug that a new entry has taken since — slug_history forgets it then
-- (041's release_old_slug), and the link is valid again. By 1. and 2., no stored text has such a link at that moment.

-- md with every link to an old slug (slug_history) pointing at the entry's current slug. Own words after | and
-- citation pages stay. Glossary links may leave out the type ([[old-term]]), so the "term/" is optional for terms.
-- Slugs are [a-z0-9-] (CHECK in 001), so they can go into the pattern unescaped; (?=…) — a lookahead, which
-- Postgres' "advanced" regular expressions support — makes sure [[artist/monet]] doesn't match [[artist/monet-2]].
CREATE FUNCTION current_links(md text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE r record;
BEGIN
  IF md IS NULL OR md NOT LIKE '%[[%' THEN RETURN md; END IF;
  FOR r IN
    SELECT DISTINCT h.entity_type::text AS type, h.old_slug, e.slug
    FROM regexp_matches(md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]', 'g') AS m
    JOIN public.slug_history h ON h.entity_type::text = coalesce(m[1], 'term') AND h.old_slug = m[2]
    JOIN public.entity_index e ON e.type = h.entity_type AND e.id = h.entity_id
  LOOP
    md := CASE WHEN r.type = 'term'
      THEN regexp_replace(md, '\[\[(term/)?' || r.old_slug || '(?=\||\]\])', '[[\1' || r.slug, 'g')
      ELSE regexp_replace(md, '\[\[' || r.type || '/' || r.old_slug || '(?=\||\]\])', '[[' || r.type || '/' || r.slug, 'g')
    END;
  END LOOP;
  RETURN md;
END $$;

-- 2. On the way in. The column comes as the trigger's argument; NEW can't be assigned by a column name in PL/pgSQL,
-- so jsonb_populate_record writes the one key back into the row.
CREATE FUNCTION correct_old_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  col text := TG_ARGV[0];
  md  text := to_jsonb(NEW) ->> col;
  fixed text;
BEGIN
  IF md LIKE '%[[%' THEN
    fixed := public.current_links(md);
    IF fixed IS DISTINCT FROM md THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(col, fixed));
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 1. On a rename (041's trigger function, one more step): every text that mentions the old slug goes through
-- current_links — UPDATE … SET md = md would do too (2. fires), but saying it is clearer. The history rows get the
-- source "slug rename"; the previous source is put back for the rest of the transaction.
CREATE OR REPLACE FUNCTION record_slug_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  etype entity_type := TG_ARGV[0]::entity_type;
  prev_source text;
  t record;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- the old address now leads here (also if another entry had it before and was renamed or deleted)
    INSERT INTO slug_history (entity_type, old_slug, entity_id) VALUES (etype, OLD.slug, OLD.id)
    ON CONFLICT (entity_type, old_slug) DO UPDATE SET entity_id = EXCLUDED.entity_id, changed_at = now();
    -- a slug in use is no longer an old address of anything
    DELETE FROM slug_history WHERE entity_type = etype AND old_slug = NEW.slug;

    prev_source := current_setting('arthistory.source', true);
    PERFORM set_config('arthistory.source', 'slug rename', true);
    FOR t IN SELECT * FROM public.markdown_columns LOOP
      EXECUTE format('UPDATE %I SET %I = public.current_links(%2$I) WHERE %2$I LIKE %L', t.tbl, t.col,
                     '%[[%' || OLD.slug || '%');
    END LOOP;
    PERFORM set_config('arthistory.source', coalesce(prev_source, ''), true);
  END IF;
  RETURN NEW;
END $$;

-- Every Markdown column, in one place (the same list as content_links in 036).
CREATE VIEW markdown_columns AS
SELECT * FROM (VALUES ('artists', 'biography_md'), ('artworks', 'description_md'), ('institutions', 'description_md'),
  ('people', 'description_md'), ('movements', 'description_md'), ('places', 'description_md'),
  ('polities', 'description_md'), ('glossary', 'description_md'), ('bibliography', 'description_md'),
  ('relationships', 'notes_md'), ('provenance', 'notes_md')) AS v(tbl, col);

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM markdown_columns LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION correct_old_links(%L)',
                   t.tbl || '_old_links', t.col, t.tbl, t.col);
  END LOOP;
  -- links written before this migration to slugs renamed since 041
  PERFORM set_config('arthistory.source', 'slug rename', true);
  FOR t IN SELECT * FROM markdown_columns LOOP
    EXECUTE format('UPDATE %I SET %I = current_links(%2$I) WHERE %2$I IS DISTINCT FROM current_links(%2$I)', t.tbl, t.col);
  END LOOP;
END $$;
