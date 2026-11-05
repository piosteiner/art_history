-- 225 — A chat for a study set (owner 2026-11-05: "the owner of a shared set … allow a set-chat where all users of a set
-- can chat unrelated to whether they are friends … the owner can remove users or messages … the other users are informed
-- … users can report messages or user names").
--
--   study_sets.chat_on      the owner switches the set's chat on (off: nobody reads or writes it; the messages stay)
--   set_chat_messages       its members' messages — the owner and the editors. kind 'system' = a line the site writes
--                           itself ("Ann removed"); deleted_at/deleted_by_owner: the text is gone, the line stays as
--                           "message deleted by the owner of the set" (or "message deleted" by its author)
--   set_chat_removed        members the owner removed from the chat: they no longer read or write it (still editors
--                           of the set unless removed there too); readmitted = the row deleted
--   set_chat_reads          the last message each member has seen: the unread count per set
--   chat_reports            now also of one message or of a user name in a set's chat (kind, set_id, set_name)
-- NOTIFY chat {kind: 'set', set, id}: the API process pushes it to the open pages of the set's members.
ALTER TABLE study_sets ADD COLUMN chat_on boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN study_sets.chat_on IS 'The owner allows a chat among the set''s owner and editors (225).';

CREATE TABLE set_chat_messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id           bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  sender_id        bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  kind             text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
  body             text CHECK (length(body) <= 4000),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by_owner boolean NOT NULL DEFAULT false,
  CHECK (deleted_at IS NOT NULL OR btrim(body) <> '')
);
COMMENT ON TABLE set_chat_messages IS 'A study set''s chat (225): its members'' messages and the site''s own lines (kind system).';
CREATE INDEX set_chat_messages_set_idx ON set_chat_messages (set_id, id DESC);

CREATE TABLE set_chat_removed (
  set_id     bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, account_id)
);
COMMENT ON TABLE set_chat_removed IS 'Members the owner removed from a set''s chat (225).';

CREATE TABLE set_chat_reads (
  set_id       bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  account_id   bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL,
  PRIMARY KEY (set_id, account_id)
);
COMMENT ON TABLE set_chat_reads IS 'The last message of a set''s chat each member has seen (225).';

ALTER TABLE chat_reports
  ADD COLUMN kind text NOT NULL DEFAULT 'conversation' CHECK (kind IN ('conversation', 'set_message', 'set_user')),
  ADD COLUMN set_id bigint REFERENCES study_sets (id) ON DELETE SET NULL,
  ADD COLUMN set_name text;

CREATE FUNCTION set_chat_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('chat', json_build_object('kind', 'set', 'set', NEW.set_id, 'id', NEW.id)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER set_chat_messages_notify AFTER INSERT OR UPDATE OF deleted_at ON set_chat_messages FOR EACH ROW EXECUTE FUNCTION set_chat_notify();

GRANT SELECT, INSERT, UPDATE ON set_chat_messages TO arthistory_admin;
GRANT SELECT, INSERT, DELETE ON set_chat_removed TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON set_chat_reads TO arthistory_admin;
