-- 218 — Study sets (owner, 2026-11-04: "users … generate Sets to which they can add any from the database … study for
-- tests or just save all entries for future reference … quizzes with their sets, mainly like index cards in both
-- ways"). An account's own lists of entries of any type, and what it knows of them as index cards.
--
--   study_sets       one account's set: a name, an optional description
--   study_set_items  the entries in it, any type (entity_type + id, as everywhere else: entity_index resolves them;
--                    an entry deleted later simply drops out of the set's list — no foreign key can span the types)
--   study_progress   the account's index cards: per entry and direction (forward: the entry → what it is; reverse:
--                    what it is → the entry) a Leitner box 1–5 — known moves a card up, not known back to box 1; the
--                    study session asks the low boxes first. Per account, not per set: an entry known in one set is
--                    known in every other.
--
-- Private to the account like its reference images (184): read and written only through the account's own routes
-- (src/admin/routes/site-sets.js, the session's user id in every query), not in the public API, not audited, not in
-- the YAML export, emptied in the test copy (scripts/test-env.sh); gone with the account (ON DELETE CASCADE).
CREATE TABLE study_sets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  description text CHECK (length(description) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE study_sets IS 'An account''s study sets (218): lists of entries of any type, private to the account.';
CREATE INDEX study_sets_owner_idx ON study_sets (owner_id, updated_at DESC);

CREATE TABLE study_set_items (
  set_id      bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, entity_type, entity_id)
);
COMMENT ON TABLE study_set_items IS 'The entries of a study set (218), resolved through entity_index.';
-- "which of my sets hold this entry" (the button on an entry's page)
CREATE INDEX study_set_items_entry_idx ON study_set_items (entity_type, entity_id);

CREATE TABLE study_progress (
  owner_id     bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  entity_type  entity_type NOT NULL,
  entity_id    bigint NOT NULL,
  direction    text NOT NULL CHECK (direction IN ('forward', 'reverse')),
  box          smallint NOT NULL DEFAULT 1 CHECK (box BETWEEN 1 AND 5),
  seen         integer NOT NULL DEFAULT 0,
  known        integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, entity_type, entity_id, direction)
);
COMMENT ON TABLE study_progress IS 'An account''s index cards (218): a Leitner box per entry and direction.';

-- a set's updated_at moves with its items (the list of sets shows the latest first)
CREATE FUNCTION study_set_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE study_sets SET updated_at = now() WHERE id = coalesce(NEW.set_id, OLD.set_id);
  RETURN NULL;
END $$;
CREATE TRIGGER study_set_items_touch AFTER INSERT OR DELETE ON study_set_items FOR EACH ROW EXECUTE FUNCTION study_set_touch();
CREATE TRIGGER study_sets_updated_at BEFORE UPDATE ON study_sets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON study_sets, study_set_items, study_progress TO arthistory_admin;   -- the account's routes only
