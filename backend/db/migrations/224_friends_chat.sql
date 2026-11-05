-- 224 — Friends and chat on the site (owner 2026-11-05: "a friendlist … all users who they are working with sorted by
-- sets or username … add users as friends specifically which would send a friend request and allow the friends to
-- chat with each other"; messages private to the two, blocking and reporting, kept until the users delete them).
--
--   friendships    one row per pair, the smaller id first (low_id < high_id: a pair can't exist twice in two orders —
--                  a CHECK plus the primary key do it, no trigger needed). accepted_at NULL = a request by
--                  requested_by still open; accepted = friends.
--   account_blocks who blocked whom: a block ends a friendship and its requests, and no new request or message passes
--                  in either direction while it lasts.
--   chat_messages  between two friends; read_at for the unread badge; a sender may delete a message (gone for both);
--                  each side may delete the conversation for itself (hidden_for_*) — a message both have hidden is gone.
--                  Nobody else reads them: no admin page shows them; only a report sends a copy.
--   chat_reports   "Report": a copy of the conversation's last 100 messages at that moment, for the admins (CMS →
--                  Accounts → Reports), with the reporter's note; handled_at when an admin has looked at it.
--   friend_code    per account, for a personal link (/friends/add/<code>) to send to someone outside one's sets.
--   NOTIFY chat    after every message (and read receipt): the API process LISTENs and pushes it to the open pages of
--                  the two accounts (Server-Sent Events, routes/site-friends.js).
CREATE TABLE friendships (
  low_id       bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  high_id      bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  requested_by bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id),
  CHECK (requested_by IN (low_id, high_id))
);
COMMENT ON TABLE friendships IS 'Friends on the site (224): one row per pair (low_id < high_id); accepted_at NULL = an open request.';
CREATE INDEX friendships_high_idx ON friendships (high_id);

CREATE TABLE account_blocks (
  blocker_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  blocked_id bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
COMMENT ON TABLE account_blocks IS 'An account blocking another (224): no friendship, requests or messages either way.';

CREATE TABLE chat_messages (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id            bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  recipient_id         bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  body                 text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  sent_at              timestamptz NOT NULL DEFAULT now(),
  read_at              timestamptz,
  hidden_for_sender    boolean NOT NULL DEFAULT false,
  hidden_for_recipient boolean NOT NULL DEFAULT false,
  CHECK (sender_id <> recipient_id)
);
COMMENT ON TABLE chat_messages IS 'Messages between two friends (224): private to them; hidden per side when a conversation is deleted.';
-- a conversation in either order, newest first; the unread ones of an account
CREATE INDEX chat_messages_pair_idx ON chat_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id DESC);
CREATE INDEX chat_messages_unread_idx ON chat_messages (recipient_id) WHERE read_at IS NULL;

CREATE TABLE chat_reports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_id bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  reported_id bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  reporter    text NOT NULL,      -- names as they were (the accounts may be gone later)
  reported    text NOT NULL,
  note        text CHECK (length(note) <= 1000),
  messages    jsonb NOT NULL,     -- [{from, at, body}] — the last 100 of the conversation at the time
  at          timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz,
  handled_by  bigint REFERENCES admin_users (id) ON DELETE SET NULL
);
COMMENT ON TABLE chat_reports IS 'A conversation reported to the admins (224): a copy of its last 100 messages at that moment.';

ALTER TABLE admin_users ADD COLUMN friend_code text UNIQUE CHECK (friend_code ~ '^[A-Za-z0-9_-]{12}$');
GRANT UPDATE (friend_code) ON admin_users TO arthistory_admin;

-- after a message is written or read: tell the API process (LISTEN chat) whom to update
CREATE FUNCTION chat_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('chat', json_build_object('kind', CASE WHEN TG_OP = 'INSERT' THEN 'message' ELSE 'read' END,
    'id', NEW.id, 'from', NEW.sender_id, 'to', NEW.recipient_id)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER chat_messages_notify AFTER INSERT OR UPDATE OF read_at ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_notify();

-- private like the reference images: the account's routes only (not the API role, not audited, not exported)
GRANT SELECT, INSERT, UPDATE, DELETE ON friendships, account_blocks, chat_messages TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE ON chat_reports TO arthistory_admin;
