-- 009 — Revert and restore from the history (admin panel, src/admin/revert.js).
--
-- A revert is an ordinary change written by the admin role, so it lands in audit_log like any other — these two
-- columns say what it undid, so the history can show "revert of …" / "reverted by …" and a revert can be reverted:
--   reverts   the txid of the change set that was reverted (all rows one save wrote share a txid)
--   restores  the audit_log entry whose version an entity was restored to ("Restore this version")
-- Both come from transaction-local settings, like user_id and source:
--   SELECT set_config('arthistory.reverts', '12345', true);   SELECT set_config('arthistory.restores', '42', true);
ALTER TABLE audit_log
  ADD COLUMN reverts  xid8,
  ADD COLUMN restores bigint REFERENCES audit_log ON DELETE SET NULL;

CREATE INDEX audit_log_txid_idx    ON audit_log (txid);                                -- load one change set
CREATE INDEX audit_log_reverts_idx ON audit_log (reverts) WHERE reverts IS NOT NULL;   -- "reverted by"? (partial index:
                                                                                       --  only the few revert rows)
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  -- An UPDATE that changed nothing but updated_at is not history.
  IF TG_OP = 'UPDATE' AND old_j - 'updated_at' = new_j - 'updated_at' THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, old_row, new_row, user_id, source, reverts, restores)
  VALUES (TG_TABLE_NAME, (coalesce(new_j, old_j)->>'id')::bigint, lower(TG_OP)::audit_action, old_j, new_j,
          nullif(current_setting('arthistory.user_id', true), '')::bigint,
          coalesce(nullif(current_setting('arthistory.source', true), ''), 'sql'),
          nullif(current_setting('arthistory.reverts', true), '')::xid8,
          nullif(current_setting('arthistory.restores', true), '')::bigint);
  RETURN NULL;  -- AFTER trigger: return value ignored
END $$;
