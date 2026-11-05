-- 227 — An account's own start-map views (owner 2026-11-05: "the accounts be able to create their own selections on
-- the landing page and save them and also give them a description with our markdown editor"). Like the curated
-- views (featured_views, 069): the start map's URL query is the selection — what the map shows is exactly what that
-- query shows —, a name and a Markdown description. Private to the account like its study sets (not audited, not
-- exported, emptied in the test copy, deleted with the account).
CREATE TABLE account_views (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  description text CHECK (length(description) <= 10000),
  query       text NOT NULL CHECK (length(query) <= 4000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE account_views IS 'An account''s own start-map views (227): the map''s URL query, a name, a Markdown description.';
CREATE INDEX account_views_owner_idx ON account_views (owner_id, updated_at DESC);
CREATE TRIGGER account_views_updated_at BEFORE UPDATE ON account_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON account_views TO arthistory_admin;
