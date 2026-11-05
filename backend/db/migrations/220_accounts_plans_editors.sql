-- 220 — Accounts managed in the CMS, accounts without CMS access, sign-up, exam dates per set, sets edited together
-- (owner, 2026-11-05: "manage accounts in the cms … create accounts that do not have cms access. exam date per set …
-- self service sign up … shared editing").
--
--   admin_users.role        member (the site only: study sets, the quiz with own results) · editor (also the CMS) ·
--                           admin (also the CMS's Accounts page). An ENUM keeps its order: role >= 'editor' is "may use
--                           the CMS" — one comparison instead of a list. A new row is a member unless said otherwise:
--                           no account gets the CMS by accident. Every account so far is the owner's own → admin.
--   admin_users.disabled_at an account switched off: no login, its sessions ended — its sets stay (shared ones too)
--   admin_users.created_via script (npm run admin:user) · cms (the Accounts page) · signup (the site's own sign-up)
--   account_log             what happened to accounts: created, signed up, role, disabled, password set … — who did
--                           it and when (the content's audit_log leaves accounts out). The username is kept as text: a
--                           deleted account's lines stay readable.
--   at least one admin      a statement trigger with transition tables: if the rows an UPDATE or DELETE touched held an
--                           active admin and afterwards none is left, the statement fails — the CMS can't lock itself
--                           out (whatever page or script tries).
--   site_settings           signup_open (boolean) · signup_daily_limit (sign-ups per day across the site, a brake on
--                           scripts creating accounts by the thousand)
--
--   study_plans             an account's exam date for a set (its own, one it edits, or someone's shared one) — the set
--                           page counts the days and plans each day's cards: study_interval() shortens the Leitner
--                           intervals so that every card comes round again before the exam
--   study_set_editors       accounts that edit a set together with its owner (name, topic, description, entries);
--                           sharing, the editors and deleting stay the owner's. They join through the set's
--                           invitation link (study_sets.edit_code — "New invitation link" ends the old one).
--   study_sets.updated_by   who changed the set last (name, topic, description, an entry) — shown to the set's editors
--   study_set_items.added_by who added an entry (shown in a set edited together)

CREATE TYPE account_role AS ENUM ('member', 'editor', 'admin');
COMMENT ON TYPE account_role IS 'member = the site only · editor = also the CMS · admin = also its accounts (220). Ordered: role >= ''editor'' = CMS.';

ALTER TABLE admin_users
  ADD COLUMN role        account_role NOT NULL DEFAULT 'member',
  ADD COLUMN disabled_at timestamptz,
  ADD COLUMN created_via text NOT NULL DEFAULT 'cms' CHECK (created_via IN ('script', 'cms', 'signup')),
  ADD COLUMN created_by  bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  ADD COLUMN note        text CHECK (length(note) <= 1000),
  ADD COLUMN password_set_at timestamptz;
UPDATE admin_users SET role = 'admin', created_via = 'script';
COMMENT ON COLUMN admin_users.role IS 'member (site only) · editor (CMS) · admin (CMS + accounts) — 220';

CREATE TABLE account_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  account_id bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  username   text NOT NULL,
  actor_id   bigint REFERENCES admin_users (id) ON DELETE SET NULL,   -- NULL: the account itself (sign-up) or a script
  action     text NOT NULL CHECK (action IN ('created', 'signed_up', 'role', 'disabled', 'enabled', 'password_reset',
               'password_changed', 'sessions_ended', 'public_name', 'note', 'deleted')),
  detail     jsonb
);
COMMENT ON TABLE account_log IS 'Changes to accounts (220): who did what to which account, when.';
CREATE INDEX account_log_account_idx ON account_log (account_id, at DESC);
CREATE INDEX account_log_at_idx ON account_log (at DESC);

-- at least one active admin stays (statement level: the old and new rows of the whole statement at once)
CREATE FUNCTION keep_an_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM old_rows WHERE role = 'admin' AND disabled_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL) THEN
    RAISE EXCEPTION 'at least one active admin account must remain' USING ERRCODE = 'check_violation', CONSTRAINT = 'keep_an_admin';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER admin_users_keep_an_admin_upd AFTER UPDATE ON admin_users REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION keep_an_admin();
CREATE TRIGGER admin_users_keep_an_admin_del AFTER DELETE ON admin_users REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION keep_an_admin();

-- the app may now create, change and delete accounts (the Accounts page, the sign-up) — column by column
GRANT INSERT (username, password_hash, role, public_name, created_via, created_by, note, password_set_at) ON admin_users TO arthistory_admin;
GRANT UPDATE (role, disabled_at, note, password_set_at) ON admin_users TO arthistory_admin;
GRANT DELETE ON admin_users TO arthistory_admin;
GRANT SELECT, INSERT, DELETE ON account_log TO arthistory_admin;   -- DELETE: an account deleting itself takes its lines along

INSERT INTO site_settings (key, value) VALUES ('signup_open', 'false'), ('signup_daily_limit', '50') ON CONFLICT (key) DO NOTHING;
ALTER TABLE site_settings
  ADD CONSTRAINT site_settings_signup_open CHECK (key <> 'signup_open' OR jsonb_typeof(value) = 'boolean'),
  ADD CONSTRAINT site_settings_signup_daily_limit CHECK (key <> 'signup_daily_limit'
    OR (jsonb_typeof(value) = 'number' AND (value #>> '{}')::numeric BETWEEN 0 AND 10000 AND (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)));

-- ---- exam dates ----------------------------------------------------------------------------------------------------
CREATE TABLE study_plans (
  owner_id   bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  set_id     bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  exam_on    date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, set_id)
);
COMMENT ON TABLE study_plans IS 'An account''s exam date for a study set (220) — private like its progress.';

-- Days until a card in Leitner box `box` is asked again: 1, 2, 4, 8, 16 — with an exam `days_left` days away at most
-- half of that (at least 1), so a card known well still comes round once or twice before the exam. No exam: NULL.
CREATE FUNCTION study_interval(box integer, days_left integer) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN days_left IS NULL OR days_left < 0 THEN 2 ^ (box - 1)
              ELSE least(2 ^ (box - 1), greatest(1, days_left / 2)) END::integer
$$;
COMMENT ON FUNCTION study_interval IS 'Leitner interval in days for a box (1→1 … 5→16), shortened to half the days left before an exam (220).';

-- ---- sets edited together ------------------------------------------------------------------------------------------
CREATE TABLE study_set_editors (
  set_id     bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, account_id)
);
COMMENT ON TABLE study_set_editors IS 'Accounts editing a study set with its owner (220): content yes; sharing, editors, deleting no.';
CREATE INDEX study_set_editors_account_idx ON study_set_editors (account_id);

ALTER TABLE study_sets
  ADD COLUMN edit_code  text UNIQUE CHECK (edit_code ~ '^[A-Za-z0-9_-]{16}$'),
  ADD COLUMN updated_by bigint REFERENCES admin_users (id) ON DELETE SET NULL;
COMMENT ON COLUMN study_sets.edit_code IS 'The invitation to edit the set (/sets/join/<edit_code>) — NULL: no one may join (220).';
ALTER TABLE study_set_items ADD COLUMN added_by bigint REFERENCES admin_users (id) ON DELETE SET NULL;

-- the owner can't also be an editor of their own set
CREATE FUNCTION study_editor_not_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM study_sets WHERE id = NEW.set_id AND owner_id = NEW.account_id) THEN
    RAISE EXCEPTION 'the owner of a set is not its editor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER study_set_editors_not_owner BEFORE INSERT OR UPDATE ON study_set_editors FOR EACH ROW EXECUTE FUNCTION study_editor_not_owner();

GRANT SELECT, INSERT, UPDATE, DELETE ON study_plans, study_set_editors TO arthistory_admin;   -- the account's routes only

-- the day a card was first asked (the plan's "new cards today" counts those first asked today); older cards: unknown
ALTER TABLE study_progress ADD COLUMN first_seen_at timestamptz DEFAULT now();
UPDATE study_progress SET first_seen_at = NULL;
