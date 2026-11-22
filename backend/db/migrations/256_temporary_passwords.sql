-- 256 — Temporary passwords (owner 2026-11-22: "in the cms be able to reset their password and if i did this then the
-- users will be asked to set a new own password upon login. this step cannot be skipped. the temporary password would
-- be cleared once the new password was set by the user or after 30 days").
--
-- A reset in the CMS (Accounts → an account → "New password…") stores the generated password's hash as before and sets
-- `password_temporary_until` = now + 30 days. While it is set, the account must change its password: a login with the
-- temporary one works, but the session can only ask who it is, log out and set a new password (src/admin/auth.js
-- `passwordGate`). Setting one's own clears it. After the 30 days expire_temporary_passwords() (hourly, and at login)
-- replaces the hash by the marker 'expired' — the temporary password's hash doesn't linger — and ends the account's
-- sessions; `password_temporary_until` stays (in the past) so that the login can say why it fails. A new reset or a
-- password set by script (scripts/admin-user.js) clears it.
--
-- One column, not a flag + a date: "must change" is exactly "a temporary password was given and not yet replaced",
-- and the CHECK below keeps the marker hash and the column from disagreeing.
ALTER TABLE admin_users ADD COLUMN password_temporary_until timestamptz;
COMMENT ON COLUMN admin_users.password_temporary_until IS
  'Set by an admin''s password reset (256): the password is a temporary one, to be replaced by the account''s own at its next login, valid until then; in the past = expired (hash cleared to ''expired''). NULL = the account''s own password.';
ALTER TABLE admin_users ADD CONSTRAINT admin_users_password_hash_kind
  CHECK (password_hash LIKE 'scrypt$%' OR (password_hash = 'expired' AND password_temporary_until IS NOT NULL));
-- the hourly sweep looks only at the few accounts with a temporary password
CREATE INDEX admin_users_password_temporary ON admin_users (password_temporary_until) WHERE password_temporary_until IS NOT NULL;
GRANT UPDATE (password_temporary_until) ON admin_users TO arthistory_admin;

ALTER TABLE account_log DROP CONSTRAINT account_log_action_check;
ALTER TABLE account_log ADD CONSTRAINT account_log_action_check CHECK (action IN ('created', 'signed_up', 'role', 'disabled', 'enabled',
  'password_reset', 'password_changed', 'sessions_ended', 'public_name', 'note', 'deleted', 'restored', 'purged', 'set_rolled_back',
  'reference_images', 'password_expired'));

-- Temporary passwords older than their 30 days: the hash cleared, the sessions ended, a line in the account log.
-- → how many. Runs as arthistory_admin (src/admin/auth.js: at start, hourly, and before a login that meets one).
CREATE FUNCTION expire_temporary_passwords() RETURNS integer LANGUAGE sql AS $$
  WITH gone AS (
    UPDATE admin_users SET password_hash = 'expired'
     WHERE password_temporary_until <= now() AND password_hash <> 'expired'
    RETURNING id, username, password_temporary_until
  ), sessions AS (
    DELETE FROM admin_sessions s USING gone WHERE s.user_id = gone.id
  ), logged AS (
    INSERT INTO account_log (account_id, username, action, detail)
    SELECT id, username, 'password_expired', jsonb_build_object('until', password_temporary_until) FROM gone
  )
  SELECT count(*)::int FROM gone
$$;
COMMENT ON FUNCTION expire_temporary_passwords() IS 'Clears temporary passwords past their 30 days and ends those accounts'' sessions (256).';
GRANT EXECUTE ON FUNCTION expire_temporary_passwords() TO arthistory_admin;
