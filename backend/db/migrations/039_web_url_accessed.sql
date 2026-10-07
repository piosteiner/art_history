-- 039 — When an artwork's web page link was added: museum pages move, so the site shows "accessed on …" as in a
-- citation. Kept by a trigger, never typed: a new or changed link gets today's date, a removed link loses it.
ALTER TABLE artworks ADD COLUMN web_url_accessed date;
COMMENT ON COLUMN artworks.web_url_accessed IS 'The day web_url was added or last changed (set by trigger artworks_web_url_accessed).';

-- Links saved before this migration: the day the history (audit_log) shows the current link being set, else today.
-- DISTINCT ON keeps the first row per artwork in ORDER BY a.id DESC — the latest change of the link. Runs before the
-- trigger exists (the trigger keeps the old date on updates).
UPDATE artworks w SET web_url_accessed = coalesce(h.day, current_date)
FROM artworks x
LEFT JOIN (SELECT DISTINCT ON (a.row_id) a.row_id, a.new_row->>'web_url' AS url, a.changed_at::date AS day
           FROM audit_log a
           WHERE a.table_name = 'artworks' AND a.new_row ? 'web_url'
             AND (a.old_row IS NULL OR a.old_row->>'web_url' IS DISTINCT FROM a.new_row->>'web_url')
           ORDER BY a.row_id, a.id DESC) h ON h.row_id = x.id AND h.url = x.web_url
WHERE x.id = w.id AND w.web_url IS NOT NULL;

-- BEFORE trigger: it can change the row about to be written (NEW). "UPDATE OF web_url" fires only when the statement
-- sets that column; IS DISTINCT FROM (NULL-safe) skips saves that write the same link again — the admin saves every field.
CREATE FUNCTION set_web_url_accessed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.web_url IS NULL THEN
    NEW.web_url_accessed := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.web_url IS DISTINCT FROM OLD.web_url THEN
    NEW.web_url_accessed := current_date;
  ELSE
    NEW.web_url_accessed := OLD.web_url_accessed;  -- unchanged link: the date stays (also if someone tries to set it)
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artworks_web_url_accessed BEFORE INSERT OR UPDATE OF web_url, web_url_accessed ON artworks
  FOR EACH ROW EXECUTE FUNCTION set_web_url_accessed();
