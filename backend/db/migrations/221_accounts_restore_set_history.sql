-- 221 — Deleted accounts kept 30 days; a study set's history, restored to any moment; locked sets; removals proposed
-- and voted on (owner, 2026-11-05: "restore an account up to 30 days after deletion … roll back a set of a user to a
-- specific day and time … disable a share link … restore a previous version … the history of a set … recommend the
-- deletion of an entry … vote … the owner decides").
--
--   admin_users.deleted_at / deleted_by  a deleted account is kept 30 days, switched off (disabled_at — no login, no
--             session, the "one active admin" rule counts it out) and its sets hidden from everyone; an admin can
--             restore it within the 30 days. purge_deleted_accounts() deletes it for good afterwards (the worker's
--             nightly run). The username stays taken while it waits.
--   study_set_events  every change of a set, written by triggers — whoever makes the change, through whichever route:
--             created · changed (name / topic / description, old and new value) · added / removed (an entry) ·
--             restored (to a moment, by the owner or an admin) · locked / unlocked. The actor is the transaction's
--             arthistory.user_id, as in the content's audit_log. Sets made before 221 get their entries' additions
--             (added_at, added_by) and their current fields as the start of their history.
--   study_set_state(set, at)  what the set held at a moment: each field's last value and each entry whose last event
--             was "added" — two DISTINCT ON queries over the events (the newest row per field / per entry).
--   study_set_restore(set, at, reason)  the set made as it was then: the fields set back, entries removed and added
--             back (only those still in the database), one "restored" event naming the moment — itself undoable,
--             since its changes are events too.
--   study_sets.locked_at  the owner locks a set: its editors may read it but change nothing (and propose nothing).
--   study_set_proposals / study_set_votes  an editor proposes removing an entry someone else added; the set's
--             editors and owner vote; the owner decides at any time, whatever the votes — removed or kept. An entry
--             removed in any other way closes its open proposal.
ALTER TABLE admin_users
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by bigint REFERENCES admin_users (id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_deleted_off CHECK (deleted_at IS NULL OR disabled_at IS NOT NULL);
COMMENT ON COLUMN admin_users.deleted_at IS 'Deleted: kept 30 days, switched off, its sets hidden; restorable by an admin until then (221).';
GRANT UPDATE (deleted_at, deleted_by) ON admin_users TO arthistory_admin;
ALTER TABLE account_log DROP CONSTRAINT account_log_action_check;
ALTER TABLE account_log ADD CONSTRAINT account_log_action_check CHECK (action IN ('created', 'signed_up', 'role', 'disabled', 'enabled',
  'password_reset', 'password_changed', 'sessions_ended', 'public_name', 'note', 'deleted', 'restored', 'purged', 'set_rolled_back'));

CREATE FUNCTION purge_deleted_accounts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  INSERT INTO account_log (account_id, username, action, detail)
    SELECT NULL, '(deleted account)', 'purged', jsonb_build_object('deleted_at', deleted_at) FROM admin_users
    WHERE deleted_at < now() - interval '30 days';
  DELETE FROM account_log WHERE account_id IN (SELECT id FROM admin_users WHERE deleted_at < now() - interval '30 days');
  DELETE FROM admin_users WHERE deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
COMMENT ON FUNCTION purge_deleted_accounts() IS 'Accounts deleted more than 30 days ago removed for good, their sets with them (221; nightly).';
GRANT EXECUTE ON FUNCTION purge_deleted_accounts() TO arthistory_admin;

-- locked sets
ALTER TABLE study_sets ADD COLUMN locked_at timestamptz;
COMMENT ON COLUMN study_sets.locked_at IS 'Locked by the owner: editors read, change nothing (221).';

-- the history
CREATE TABLE study_set_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id      bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id    bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('created', 'changed', 'added', 'removed', 'restored', 'locked', 'unlocked')),
  field       text CHECK (field IN ('name', 'topic', 'description')),
  old_value   text,
  new_value   text,
  entity_type entity_type,
  entity_id   bigint,
  detail      jsonb,
  CHECK ((action = 'changed') = (field IS NOT NULL)),
  CHECK ((action IN ('added', 'removed')) = (entity_id IS NOT NULL))
);
COMMENT ON TABLE study_set_events IS 'Every change of a study set (221), by triggers: its history and the ground of restoring it.';
CREATE INDEX study_set_events_set_idx ON study_set_events (set_id, at DESC, id DESC);
CREATE INDEX study_set_events_item_idx ON study_set_events (set_id, entity_type, entity_id, at DESC, id DESC) WHERE entity_id IS NOT NULL;
CREATE INDEX study_set_events_field_idx ON study_set_events (set_id, field, at DESC, id DESC) WHERE field IS NOT NULL;

CREATE FUNCTION study_set_actor() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('arthistory.user_id', true), '')::bigint
$$;

CREATE FUNCTION study_set_log() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f text;
BEGIN
  IF TG_TABLE_NAME = 'study_sets' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO study_set_events (set_id, actor_id, action) VALUES (NEW.id, coalesce(study_set_actor(), NEW.owner_id), 'created');
      FOREACH f IN ARRAY ARRAY['name', 'topic', 'description'] LOOP
        INSERT INTO study_set_events (set_id, actor_id, action, field, new_value)
          SELECT NEW.id, coalesce(study_set_actor(), NEW.owner_id), 'changed', f, to_jsonb(NEW) ->> f WHERE to_jsonb(NEW) ->> f IS NOT NULL;
      END LOOP;
    ELSE
      FOREACH f IN ARRAY ARRAY['name', 'topic', 'description'] LOOP
        IF (to_jsonb(OLD) ->> f) IS DISTINCT FROM (to_jsonb(NEW) ->> f) THEN
          INSERT INTO study_set_events (set_id, actor_id, action, field, old_value, new_value)
            VALUES (NEW.id, coalesce(study_set_actor(), NEW.updated_by), 'changed', f, to_jsonb(OLD) ->> f, to_jsonb(NEW) ->> f);
        END IF;
      END LOOP;
      IF (OLD.locked_at IS NULL) <> (NEW.locked_at IS NULL) THEN
        INSERT INTO study_set_events (set_id, actor_id, action) VALUES (NEW.id, study_set_actor(), CASE WHEN NEW.locked_at IS NULL THEN 'unlocked' ELSE 'locked' END);
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO study_set_events (set_id, actor_id, action, entity_type, entity_id)
      VALUES (NEW.set_id, coalesce(study_set_actor(), NEW.added_by), 'added', NEW.entity_type, NEW.entity_id);
  ELSE
    -- the set itself being deleted takes its items along: no events for a set that is gone
    IF EXISTS (SELECT 1 FROM study_sets WHERE id = OLD.set_id) THEN
      INSERT INTO study_set_events (set_id, actor_id, action, entity_type, entity_id)
        VALUES (OLD.set_id, study_set_actor(), 'removed', OLD.entity_type, OLD.entity_id);
      UPDATE study_set_proposals SET decided_at = now(), decision = 'removed', decided_by = study_set_actor()
        WHERE set_id = OLD.set_id AND entity_type = OLD.entity_type AND entity_id = OLD.entity_id AND decided_at IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- proposals and votes (before the triggers, which close proposals)
CREATE TABLE study_set_proposals (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id      bigint NOT NULL REFERENCES study_sets (id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_id   bigint NOT NULL,
  proposed_by bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  reason      text CHECK (length(reason) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decision    text CHECK (decision IN ('removed', 'kept')),
  decided_by  bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  CHECK ((decided_at IS NULL) = (decision IS NULL))
);
COMMENT ON TABLE study_set_proposals IS 'An entry of a set proposed for removal (221): voted on by its editors and owner, decided by the owner.';
CREATE UNIQUE INDEX study_set_proposals_open ON study_set_proposals (set_id, entity_type, entity_id) WHERE decided_at IS NULL;
CREATE TABLE study_set_votes (
  proposal_id bigint NOT NULL REFERENCES study_set_proposals (id) ON DELETE CASCADE,
  voter_id    bigint NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  remove      boolean NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, voter_id)
);
COMMENT ON TABLE study_set_votes IS 'A vote on a proposed removal (221): remove (true) or keep (false); one per account, changeable.';

CREATE TRIGGER study_sets_log AFTER INSERT OR UPDATE ON study_sets FOR EACH ROW EXECUTE FUNCTION study_set_log();
CREATE TRIGGER study_set_items_log AFTER INSERT OR DELETE ON study_set_items FOR EACH ROW EXECUTE FUNCTION study_set_log();

-- the start of the history of the sets made before 221: their entries' additions and their fields as they are now
INSERT INTO study_set_events (set_id, at, actor_id, action, detail)
  SELECT id, created_at, owner_id, 'created', '{"seeded": true}' FROM study_sets;
INSERT INTO study_set_events (set_id, at, actor_id, action, field, new_value, detail)
  SELECT s.id, s.created_at, s.owner_id, 'changed', f.field, f.value, '{"seeded": true}'
  FROM study_sets s CROSS JOIN LATERAL (VALUES ('name', s.name), ('topic', s.topic), ('description', s.description)) f(field, value)
  WHERE f.value IS NOT NULL;
INSERT INTO study_set_events (set_id, at, actor_id, action, entity_type, entity_id, detail)
  SELECT set_id, added_at, coalesce(added_by, (SELECT owner_id FROM study_sets s WHERE s.id = i.set_id)), 'added', entity_type, entity_id, '{"seeded": true}'
  FROM study_set_items i;

-- the set as it was at a moment
CREATE FUNCTION study_set_state(sid bigint, at_ts timestamptz)
RETURNS TABLE (name text, topic text, description text, items jsonb) LANGUAGE sql STABLE AS $$
  WITH f AS (
    SELECT DISTINCT ON (field) field, new_value FROM study_set_events
    WHERE set_id = sid AND field IS NOT NULL AND at <= at_ts ORDER BY field, at DESC, id DESC),
  i AS (
    SELECT DISTINCT ON (entity_type, entity_id) entity_type, entity_id, action, actor_id FROM study_set_events
    WHERE set_id = sid AND entity_id IS NOT NULL AND at <= at_ts ORDER BY entity_type, entity_id, at DESC, id DESC)
  SELECT (SELECT new_value FROM f WHERE field = 'name'), (SELECT new_value FROM f WHERE field = 'topic'),
         (SELECT new_value FROM f WHERE field = 'description'),
         coalesce((SELECT jsonb_agg(jsonb_build_object('type', entity_type, 'id', entity_id, 'by', actor_id)) FROM i WHERE action = 'added'), '[]')
$$;
COMMENT ON FUNCTION study_set_state(bigint, timestamptz) IS 'A study set as it was at a moment, from its events (221).';

CREATE FUNCTION study_set_restore(sid bigint, at_ts timestamptz, why text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  st record;
  removed integer;
  added integer;
BEGIN
  SELECT * INTO st FROM study_set_state(sid, at_ts);
  IF st.name IS NULL THEN RAISE EXCEPTION 'the set did not exist yet at %', at_ts USING ERRCODE = 'check_violation'; END IF;
  UPDATE study_sets SET name = st.name, topic = st.topic, description = st.description, updated_by = study_set_actor() WHERE id = sid;
  DELETE FROM study_set_items i WHERE i.set_id = sid
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(st.items) x WHERE (x ->> 'type')::entity_type = i.entity_type AND (x ->> 'id')::bigint = i.entity_id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  INSERT INTO study_set_items (set_id, entity_type, entity_id, added_by)
    SELECT sid, (x ->> 'type')::entity_type, (x ->> 'id')::bigint, (x ->> 'by')::bigint FROM jsonb_array_elements(st.items) x
    WHERE EXISTS (SELECT 1 FROM entity_index e WHERE e.type = (x ->> 'type')::entity_type AND e.id = (x ->> 'id')::bigint)
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  INSERT INTO study_set_events (set_id, actor_id, action, detail)
    VALUES (sid, study_set_actor(), 'restored', jsonb_build_object('to', at_ts, 'removed', removed, 'added', added, 'reason', why));
  RETURN jsonb_build_object('removed', removed, 'added', added);
END $$;
COMMENT ON FUNCTION study_set_restore(bigint, timestamptz, text) IS 'A study set made as it was at a moment (221): fields back, entries removed / added back; itself an event.';

GRANT SELECT, INSERT ON study_set_events TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE ON study_set_proposals TO arthistory_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON study_set_votes TO arthistory_admin;
GRANT EXECUTE ON FUNCTION study_set_state(bigint, timestamptz), study_set_restore(bigint, timestamptz, text), study_set_actor() TO arthistory_admin;
