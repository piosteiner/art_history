-- 136 — Roadmap: when an item was added, how long done items stay on the site, topics with their own colour
-- (owner, 2026-10-26: "Festhalten, wann ein Roadmap Ziel aufgenommen wurde. Festlegen wann ein erledigtes Ziel
-- automatisch entfernt wird … die Themen in den Bubbles sollen eigene Farben erhalten").
--   roadmap_items.added_on   the day the goal was taken up (editable; existing items: the day they were created)
--   roadmap_areas            the topics (the bubbles): a name and a colour of a fixed palette. Items reference the
--                            name with ON UPDATE CASCADE — renaming a topic renames it on every item in one statement.
--   site_settings            small settings of the public site as key → jsonb; roadmap_done_days = how many days a
--                            done item stays on the public roadmap after its done date (it stays in the CMS and the
--                            changelog). Replaces the fixed "newest 30".

ALTER TABLE roadmap_items ADD COLUMN added_on date NOT NULL DEFAULT current_date;
UPDATE roadmap_items SET added_on = (created_at AT TIME ZONE 'Europe/Zurich')::date;
COMMENT ON COLUMN roadmap_items.added_on IS 'the day the goal was taken up (136)';

CREATE TABLE roadmap_areas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (btrim(name) = name AND name <> ''),
  color text NOT NULL CHECK (color IN ('blue', 'teal', 'purple', 'pink', 'red', 'brown', 'olive', 'indigo', 'cyan', 'slate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE roadmap_areas IS 'topics of the roadmap with their colour (136); roadmap_items.area references name';

-- the topics in use, A–Z, the palette in turn
INSERT INTO roadmap_areas (name, color)
SELECT name, (ARRAY['blue', 'teal', 'purple', 'pink', 'red', 'brown', 'olive', 'indigo', 'cyan', 'slate'])[(row_number() OVER (ORDER BY name) - 1) % 10 + 1]
FROM (SELECT DISTINCT btrim(area) AS name FROM roadmap_items WHERE area IS NOT NULL) a;
UPDATE roadmap_items SET area = btrim(area) WHERE area <> btrim(area);

ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_area_fkey
  FOREIGN KEY (area) REFERENCES roadmap_areas (name) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TABLE site_settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE site_settings IS 'small settings of the public site, key → jsonb (136)';
INSERT INTO site_settings (key, value) VALUES ('roadmap_done_days', '30');
-- a value the API relies on: whole days, 0–365
ALTER TABLE site_settings ADD CONSTRAINT site_settings_roadmap_done_days CHECK (key <> 'roadmap_done_days'
  OR (jsonb_typeof(value) = 'number' AND (value #>> '{}')::numeric BETWEEN 0 AND 365 AND (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roadmap_areas', 'site_settings'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

GRANT SELECT ON roadmap_areas, site_settings TO arthistory_api;
