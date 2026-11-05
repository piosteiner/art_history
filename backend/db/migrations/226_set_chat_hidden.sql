-- 226 — Hiding someone in a set's chat (owner 2026-11-05: "in case anyone is harassed by another user … hiding does not
-- inform the owner of the set. hidden users are still shown in the chat but with their messages hidden … so the user
-- that hid the other one can still follow the development of a chat"). One row per set, hider and hidden: the hider's
-- view shows the hidden person's messages as "hidden message" lines (a click shows one); nobody else is told — not
-- the owner, not the hidden person. Unlike a report, nothing leaves the account. Their messages don't count as unread.
CREATE TABLE set_chat_hidden (
  set_id    bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  hider_id  bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  hidden_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, hider_id, hidden_id),
  CHECK (hider_id <> hidden_id)
);
COMMENT ON TABLE set_chat_hidden IS 'Members someone hid in a set''s chat (226): only the hider''s view changes; nobody is told.';
GRANT SELECT, INSERT, DELETE ON set_chat_hidden TO arthistory_admin;
