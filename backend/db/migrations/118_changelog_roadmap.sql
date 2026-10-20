-- 118 — A public changelog and roadmap (owner, 2026-10-20: "a changelog where I can log patches or just daily updates
-- with bullet point changes … and a 'what I am working on': a to do list or roadmap or a mix of them"). German (de-CH).
--   changelog_entries   one per day or patch: the day, an optional title ("Patch: Suche"), published
--   changelog_items     its bullet points in order, each with a kind — neu · verbessert · behoben · inhalt · technik —
--                       and the roadmap item it completes, if any
--   roadmap_items       what is planned: status jetzt (in Arbeit) · naechstes · spaeter · erledigt, an area
--                       ("Provenienz", "Suche" …), notes, its place in its column; done_on when it was finished
-- All three logged like content (audit_row): every change in the history. Drafts stay off the site (published).
CREATE TABLE changelog_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day date NOT NULL,
  title text CHECK (btrim(title) <> ''),
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX changelog_entries_day_idx ON changelog_entries (day DESC, id DESC);

CREATE TABLE roadmap_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL CHECK (btrim(title) <> ''),
  notes_md text CHECK (btrim(notes_md) <> ''),
  area text CHECK (btrim(area) <> ''),
  status text NOT NULL DEFAULT 'spaeter' CHECK (status IN ('jetzt', 'naechstes', 'spaeter', 'erledigt')),
  position integer NOT NULL DEFAULT 0,
  done_on date,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'erledigt') = (done_on IS NOT NULL))     -- finished ⇔ a day it was finished
);
CREATE INDEX roadmap_items_column_idx ON roadmap_items (status, position, id);

CREATE TABLE changelog_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES changelog_entries ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('neu', 'verbessert', 'behoben', 'inhalt', 'technik')),
  text_md text NOT NULL CHECK (btrim(text_md) <> ''),
  roadmap_item_id bigint REFERENCES roadmap_items ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, position) DEFERRABLE INITIALLY DEFERRED   -- reordering swaps positions within one statement
);
CREATE INDEX changelog_items_kind_idx ON changelog_items (kind);

COMMENT ON TABLE changelog_entries IS 'the public changelog (118): a day or a patch; its bullet points in changelog_items';
COMMENT ON TABLE roadmap_items IS 'the public roadmap (118): what is being worked on, next, later, done';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['changelog_entries', 'changelog_items', 'roadmap_items'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

GRANT SELECT ON changelog_entries, changelog_items, roadmap_items TO arthistory_api;
