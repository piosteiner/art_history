-- 184 — Private reference images (owner 2026-11-01): pictures of a work taken from the owner's own books (Mason,
-- Portal …) for the owner's private use only — a copy for personal use (URG Art. 19), never published. So:
--   * one owner per image (owner_id): the admin shows it only to that account, to no other login (src/admin/private-images.js);
--   * the public API role may not read the table (default privileges would grant it: revoked here);
--   * not audited (no audit_row trigger): audit_log is copied into the test environment and readable by its visitors;
--   * scripts/test-env.sh empties the table in the test copy; the YAML export does not know it.
-- Book, page and figure with each image (source_id + locator), as a citation would give them.
CREATE TABLE private_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artwork_id bigint NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
  owner_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  source_id bigint REFERENCES bibliography (id) ON DELETE SET NULL,
  locator text CHECK (btrim(locator) <> ''),           -- "p. 33, fig. 29"
  content_type text NOT NULL DEFAULT 'image/webp',
  bytes bytea NOT NULL,
  width integer,
  height integer,
  original_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX private_images_artwork_idx ON private_images (artwork_id, owner_id);
COMMENT ON TABLE private_images IS 'reference images for one account only (184): from the owner''s books, never public, not audited';

REVOKE ALL ON private_images FROM arthistory_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON private_images TO arthistory_admin;
