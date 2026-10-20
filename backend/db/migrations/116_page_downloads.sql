-- 116 — A page written in two places (owner, 2026-10-20: the documentation is edited "both" in the CMS and in Obsidian).
-- The CMS offers the text as a .md file and takes one back. page_downloads remembers the text as it was at the last
-- download (or upload): uploading a file then warns when the page has been changed in the CMS since — the file would
-- undo those changes. Not logged in audit_log (a download changes no content).
CREATE TABLE page_downloads (
  page_id bigint PRIMARY KEY REFERENCES pages ON DELETE CASCADE,
  sha256 text NOT NULL,          -- of body_md then
  at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('download', 'upload'))
);
COMMENT ON TABLE page_downloads IS 'the page text at its last .md download or upload (116) — to warn before a file overwrites newer CMS changes';
