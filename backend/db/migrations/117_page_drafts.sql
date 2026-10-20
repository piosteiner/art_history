-- 117 — Autosave for pages (owner, 2026-10-20: "autosave for the md editor in the CMS"). As the entries' forms keep
-- drafts (010) and publish on Publish, a page's editor saves what is typed as a draft — per account and per part (a
-- chapter, the introduction or the whole text) — every moment the typing pauses; Save puts it into the page. A tab
-- closed, a crash or a lost connection loses nothing: opening the part again restores the draft. base_sha: the text
-- the draft was written on, so a draft restored after the text changed is still refused by Save's check (116) instead
-- of overwriting the change. Not logged in audit_log (drafts are not content yet).
CREATE TABLE page_drafts (
  page_id bigint NOT NULL REFERENCES pages ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES admin_users ON DELETE CASCADE,
  part text NOT NULL CHECK (part ~ '^(all|\d{1,4})$'),
  base_sha text NOT NULL,
  body_md text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id, part)
);
COMMENT ON TABLE page_drafts IS 'autosaved, unsaved edits of a page part per account (117); Save applies and removes them';
