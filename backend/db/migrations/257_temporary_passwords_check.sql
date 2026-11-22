-- 257 — The check of 256 narrowed: it demanded an scrypt hash or the marker 'expired', but other placeholders exist on
-- purpose — the test environment locks production's accounts with '!locked' (scripts/test-env.sh), test fixtures use
-- accounts that never log in ('x'). What matters is only that the marker 'expired' never stands without the date of the
-- temporary password it replaced (the login's "expired after 30 days" reads that date).
ALTER TABLE admin_users DROP CONSTRAINT admin_users_password_hash_kind;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_password_expired_marker
  CHECK (password_hash <> 'expired' OR password_temporary_until IS NOT NULL);
