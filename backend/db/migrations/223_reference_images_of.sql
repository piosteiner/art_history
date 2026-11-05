-- 223 — An account may see another account's reference images (owner 2026-11-05). private_images (184) belong to one
-- account and only it sees them. An admin can now set `reference_images_of` on an account: it then sees that
-- account's reference images too — read only (adding, ordering, deleting stay the owner's). Every query that shows
-- reference images to a viewer asks image_owner(viewer): the account whose images it sees.
ALTER TABLE admin_users ADD COLUMN reference_images_of bigint REFERENCES admin_users (id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_reference_images_not_self CHECK (reference_images_of IS DISTINCT FROM id);
COMMENT ON COLUMN admin_users.reference_images_of IS 'Sees this account''s reference images (read only), set by an admin (223).';
GRANT UPDATE (reference_images_of) ON admin_users TO arthistory_admin;

CREATE FUNCTION image_owner(viewer bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT u.reference_images_of FROM admin_users u WHERE u.id = viewer), viewer)
$$;
COMMENT ON FUNCTION image_owner(bigint) IS 'The account whose reference images a viewer sees: its own, or the one set in reference_images_of (223).';
GRANT EXECUTE ON FUNCTION image_owner(bigint) TO arthistory_admin;

ALTER TABLE account_log DROP CONSTRAINT account_log_action_check;
ALTER TABLE account_log ADD CONSTRAINT account_log_action_check CHECK (action IN ('created', 'signed_up', 'role', 'disabled', 'enabled',
  'password_reset', 'password_changed', 'sessions_ended', 'public_name', 'note', 'deleted', 'restored', 'purged', 'set_rolled_back',
  'reference_images'));
