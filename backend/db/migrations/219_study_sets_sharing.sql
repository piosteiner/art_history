-- 219 — Study sets shared, with a topic, and the account's results per set and kind of quiz (owner, 2026-11-04: "the
-- sets created by users to be shareable … at least a creation date, the creator name, the date of the last change, a
-- name and a topic … track the performance of the user per set and quiz type").
--
--   study_sets.topic        what the set is about ("Japanese art", "Exam: Baroque") — free text, offered again from
--                           the account's and the public sets' topics
--   study_sets.visibility   private (the owner only) · link (anyone with the link: /sets/s/<share_code>) · public
--                           (also listed on /sets/shared). The code is made by the routes (crypto.randomBytes, 72 bits)
--                           when a set is first shared; "New link" replaces it, so an old link stops working.
--   study_sets.copied_from  a set saved from someone else's shared set ("Save a copy") — gone (NULL) when that one is
--   admin_users.public_name the name shown on the account's shared sets: the login name is half of what logs in, so it
--                           is never shown — a set is only shared once the account has a public name
--   study_sessions          one round of a quiz on a set by an account: the kind of quiz, how many cards were answered,
--                           how many known, how long — the account's results per set and kind (its own sets and
--                           others' shared ones). Private like study_progress: the owner of a shared set never sees
--                           who studied it or how.
--
--   study_sets.description  now Markdown, as in the entries' texts (owner: "with our markdown formatting environment":
--                           [[type/slug]] links, ==highlight==, callouts …) — rendered by src/markdown.js (raw HTML
--                           escaped, then sanitised), so up to 10,000 characters
--
-- updated_at = the last change of the set's content (name, topic, description, entries): the trigger of 218 now fires
-- only WHEN one of those changes — sharing or unsharing a set is not a change of it.
ALTER TABLE study_sets
  ADD COLUMN topic text CHECK (btrim(topic) <> '' AND length(topic) <= 80),
  ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link', 'public')),
  ADD COLUMN share_code text UNIQUE CHECK (share_code ~ '^[A-Za-z0-9_-]{12}$'),
  ADD COLUMN shared_at timestamptz,
  ADD COLUMN copied_from bigint REFERENCES study_sets (id) ON DELETE SET NULL,
  DROP CONSTRAINT study_sets_description_check,
  ADD CONSTRAINT study_sets_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT study_sets_shared_has_code CHECK (visibility = 'private' OR share_code IS NOT NULL);
COMMENT ON COLUMN study_sets.visibility IS 'private | link (anyone with /sets/s/<share_code>) | public (listed too) — 219';
-- the public sets, newest change first, by topic
CREATE INDEX study_sets_public_idx ON study_sets (topic, updated_at DESC) WHERE visibility = 'public';

DROP TRIGGER study_sets_updated_at ON study_sets;
CREATE TRIGGER study_sets_updated_at BEFORE UPDATE ON study_sets FOR EACH ROW
  WHEN ((OLD.name, OLD.topic, OLD.description) IS DISTINCT FROM (NEW.name, NEW.topic, NEW.description))
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE admin_users ADD COLUMN public_name text CHECK (btrim(public_name) <> '' AND length(public_name) <= 60);
COMMENT ON COLUMN admin_users.public_name IS 'The name shown on the account''s shared study sets (219) — never the login name.';

CREATE TABLE study_sessions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  set_id      bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  mode        text NOT NULL CHECK (mode IN ('forward', 'reverse', 'both', 'typed', 'choice')),
  answered    integer NOT NULL CHECK (answered > 0),
  known       integer NOT NULL CHECK (known BETWEEN 0 AND answered),
  seconds     integer CHECK (seconds >= 0),
  complete    boolean NOT NULL DEFAULT true,          -- false: left before the end of the round
  finished_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE study_sessions IS 'An account''s rounds of a quiz on a study set (219): its results per set and kind of quiz; private.';
CREATE INDEX study_sessions_owner_set_idx ON study_sessions (owner_id, set_id, mode, finished_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON study_sessions TO arthistory_admin;   -- the account's routes only
GRANT UPDATE (public_name) ON admin_users TO arthistory_admin;                -- set by the account on /sets
