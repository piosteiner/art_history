-- 240 — Emotes in the chats (owner 2026-11-07: "for the adenai-map project we have linked my 7tv account to unlock
-- emotes … same implementation, the emotes should only be available in chats"). ":name:" in a chat message shows the
-- emote's picture, as in a Twitch chat. Where they come from: 7TV emote sets — a 7TV or Twitch user name follows that
-- channel's active set, a set link or id that set, "global" 7TV's global emotes; the first source wins a name.
-- One row: the sources as entered in the CMS (/emotes) and the emotes as last fetched (name → {url, w, h, animated,
-- from}); fetched again on every save and by "Refresh" in the CMS. Read by the site through /site/emotes (admin host).
CREATE TABLE chat_emotes (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),       -- the one row (a number: audit_log keeps row ids)
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  emotes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(emotes) = 'object'),
  fetched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE chat_emotes IS 'Emotes in the chats (240): 7TV sources and the emotes last fetched from them — one row.';
GRANT SELECT, INSERT, UPDATE ON chat_emotes TO arthistory_admin;
CREATE TRIGGER chat_emotes_audit AFTER INSERT OR UPDATE OR DELETE ON chat_emotes FOR EACH ROW EXECUTE FUNCTION audit_row();
-- the owner's 7TV account, as on the adenai map; its emotes are fetched by the first save or Refresh in the CMS
INSERT INTO chat_emotes (sources) VALUES ('[{"type": "user", "name": "piogino"}]');
