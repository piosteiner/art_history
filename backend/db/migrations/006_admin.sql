-- 006 — Admin panel: users, sessions, and an audit log of every content change.
-- Since Phase 5 the database is the source of truth, so its history lives here (not in git).

------------------------------------------------------------------------------
-- Users & sessions
------------------------------------------------------------------------------
CREATE TABLE admin_users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{2,40}$'),
  password_hash text NOT NULL,                 -- scrypt$N$r$p$salt$hash (src/admin/auth.js), never the password
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- The cookie holds a random token; only its SHA-256 is stored, so a leaked table can't be used to log in.
CREATE TABLE admin_sessions (
  token_hash bytea PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES admin_users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip         inet,
  user_agent text
);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

------------------------------------------------------------------------------
-- Audit log: one row per inserted/updated/deleted content row, with the whole row before and after as JSONB.
-- Who and where from come from transaction-local settings the writer sets:
--   SELECT set_config('arthistory.user_id', '1', true), set_config('arthistory.source', 'admin', true);
-- (third argument true = like SET LOCAL: gone at COMMIT, so a pooled connection can't leak it to the next user)
------------------------------------------------------------------------------
CREATE TYPE audit_action AS ENUM ('insert', 'update', 'delete');

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),   -- now() = transaction start: all rows of one save share it
  txid       xid8 NOT NULL DEFAULT pg_current_xact_id(),  -- groups the rows of one save
  table_name text NOT NULL,
  row_id     bigint NOT NULL,
  action     audit_action NOT NULL,
  old_row    jsonb,                                -- NULL for insert
  new_row    jsonb,                                -- NULL for delete
  user_id    bigint REFERENCES admin_users ON DELETE SET NULL,
  source     text NOT NULL                         -- admin · import · sql (anything else, e.g. psql by hand)
);
CREATE INDEX audit_log_row_idx ON audit_log (table_name, row_id, id);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);

-- SECURITY DEFINER: runs with the owner's rights, so the admin role can write content (which fires this) without
-- being allowed to INSERT into audit_log directly — the app can add history only by changing data, never forge
-- or edit it. search_path is pinned, as it must be for every SECURITY DEFINER function.
CREATE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- An UPDATE that changed nothing but updated_at is not history.
  IF TG_OP = 'UPDATE' AND old_j - 'updated_at' = new_j - 'updated_at' THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, old_row, new_row, user_id, source)
  VALUES (TG_TABLE_NAME, (coalesce(new_j, old_j)->>'id')::bigint, lower(TG_OP)::audit_action, old_j, new_j,
          nullif(current_setting('arthistory.user_id', true), '')::bigint,
          coalesce(nullif(current_setting('arthistory.source', true), ''), 'sql'));
  RETURN NULL;  -- AFTER trigger: return value ignored
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['places', 'movements', 'artists', 'patrons', 'institutions', 'artworks', 'relationships'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
                   t || '_audit', t);
  END LOOP;
END $$;

------------------------------------------------------------------------------
-- Privileges. The default privileges from setup-database.sql gave every new table SELECT to the API and
-- read/write to the admin role — too much here. Tighten per table.
------------------------------------------------------------------------------
-- The public API never sees users, sessions or history.
REVOKE ALL ON admin_users, admin_sessions, audit_log FROM arthistory_api;
-- History is append-only for the app: read it, never change it (rows arrive only via the trigger above).
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM arthistory_admin;
-- Users are created with scripts/admin-user.js (as arthistory_owner). The app may read them and update only
-- these two columns (column-level privileges).
REVOKE INSERT, UPDATE, DELETE ON admin_users FROM arthistory_admin;
GRANT UPDATE (last_login_at, password_hash) ON admin_users TO arthistory_admin;
