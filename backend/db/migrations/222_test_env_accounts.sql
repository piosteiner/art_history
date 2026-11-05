-- 222 — Accounts for the test environment (owner 2026-11-05: "under accounts i, as an admin, also want to be able to
-- create accounts for the test cms and the test site"). The test environment (scripts/test-env.sh) is production's
-- data copied over every night, every login there locked except the shared "test". An account marked test_env is made
-- in production's Accounts page but logs in only on the test hosts: production refuses it (src/admin/auth.js), the
-- CMS copies it to the test database at once (src/admin/test-accounts.js), and the nightly reset keeps it — with its
-- password and its role — instead of locking it. Its role counts there: a test admin manages the test accounts.
ALTER TABLE admin_users ADD COLUMN test_env boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN admin_users.test_env IS 'An account for the test environment only (222): refused by production, kept by the nightly reset.';
GRANT INSERT (test_env), UPDATE (test_env) ON admin_users TO arthistory_admin;

-- the "one active admin" rule (220) counts production's admins: a test-environment admin keeps no one able to log in here
CREATE OR REPLACE FUNCTION keep_an_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM old_rows WHERE role = 'admin' AND disabled_at IS NULL AND NOT test_env)
     AND NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'admin' AND disabled_at IS NULL AND NOT test_env) THEN
    RAISE EXCEPTION 'at least one active admin account must remain' USING ERRCODE = 'check_violation', CONSTRAINT = 'keep_an_admin';
  END IF;
  RETURN NULL;
END $$;
