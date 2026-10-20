-- 119 — Autosave for the changelog and roadmap forms (owner, 2026-10-20: "live saves when I stop typing so I don't
-- lose content accidentally … same for roadmap"). As the pages' editor (117), a form sends what is typed as a draft
-- of this account 1.5 s after typing pauses; opening the form again restores it; Save puts it into the entry and
-- removes the draft. One row per account and form:
--   form_key   which form: 'changelog/new', 'changelog/<id>', 'roadmap/new', 'roadmap/<id>'
--   base       the record's updated_at when the draft was started ('' for a new one) — a draft restored after the
--              record changed says so
--   fields     the form's fields as typed ({"day": "…", "items": "…", "published": "1"}; an unticked box is absent)
-- Not logged in audit_log (drafts are not content yet).
CREATE TABLE form_drafts (
  user_id bigint NOT NULL REFERENCES admin_users ON DELETE CASCADE,
  form_key text NOT NULL CHECK (form_key ~ '^(changelog|roadmap)/(new|\d{1,15})$'),
  base text NOT NULL DEFAULT '',
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_key)
);
COMMENT ON TABLE form_drafts IS 'autosaved, unsaved changelog/roadmap forms per account (119); Save applies and removes them';
