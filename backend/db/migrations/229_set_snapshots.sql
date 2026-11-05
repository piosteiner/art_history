-- 229 — Results keep the set they were made on (owner 2026-11-05: "die set daten automatisch mit den resultaten
-- gespeichert …, so dass die ergebnisse und das set zu jeder zeit nachvollziehbar bleiben").
--
--   study_set_snapshots  a set as it was: name, topic, description and its entries (type, id, slug, name — the name as
--                        it was then, so an entry deleted from the site later is still named). Taken when a round is
--                        recorded; the same content is stored once per set (fingerprint = md5 of the content).
--   study_sessions       snapshot_id: the set as the round saw it. set_id becomes nullable and ON DELETE SET NULL —
--                        a round outlives its set (deleted, made private, left); the account deletes its results
--                        itself ("Your results") or with the account.
-- origin_set_id is a plain number (no foreign key): it groups an account's rounds by set even after the set is gone.
-- Snapshots no round refers to any more are removed by statement triggers (rounds deleted, sets deleted).
--
-- Postgres: content-addressed rows (md5 over the jsonb text) with a unique index and INSERT … ON CONFLICT … RETURNING
-- to get the existing row's id in one statement; a GENERATED column for the number of entries.

CREATE TABLE study_set_snapshots (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id        bigint REFERENCES study_sets (id) ON DELETE SET NULL,
  origin_set_id bigint NOT NULL,
  fingerprint   text NOT NULL,
  name          text NOT NULL,
  topic         text,
  description   text,
  items         jsonb NOT NULL,
  item_count    integer GENERATED ALWAYS AS (jsonb_array_length(items)) STORED,
  taken_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_set_id, fingerprint)
);
COMMENT ON TABLE study_set_snapshots IS 'A study set as it was when a round of a quiz was played on it (229): kept with the results.';

-- the set as it is now, stored once per content → the snapshot's id
CREATE FUNCTION study_set_snapshot(sid bigint) RETURNS bigint LANGUAGE sql AS $$
  WITH content AS (
    SELECT s.name, s.topic, s.description,
      coalesce((SELECT jsonb_agg(jsonb_build_object('type', i.entity_type, 'id', i.entity_id, 'slug', e.slug, 'name', e.name) ORDER BY i.added_at, i.entity_id)
         FROM study_set_items i JOIN entity_index e ON (e.type, e.id) = (i.entity_type, i.entity_id) WHERE i.set_id = s.id), '[]') AS items
    FROM study_sets s WHERE s.id = sid)
  INSERT INTO study_set_snapshots AS x (set_id, origin_set_id, fingerprint, name, topic, description, items)
    SELECT sid, sid, md5(jsonb_build_array(name, topic, description, items)::text), name, topic, description, items FROM content
  ON CONFLICT (origin_set_id, fingerprint) DO UPDATE SET set_id = EXCLUDED.set_id
  RETURNING x.id
$$;
COMMENT ON FUNCTION study_set_snapshot(bigint) IS 'The set as it is now as a snapshot (229) — an existing one when nothing changed since.';

ALTER TABLE study_sessions DROP CONSTRAINT study_sessions_set_id_fkey;
ALTER TABLE study_sessions ALTER COLUMN set_id DROP NOT NULL,
  ADD CONSTRAINT study_sessions_set_id_fkey FOREIGN KEY (set_id) REFERENCES study_sets (id) ON DELETE SET NULL,
  ADD COLUMN snapshot_id bigint REFERENCES study_set_snapshots (id);
UPDATE study_sessions SET snapshot_id = study_set_snapshot(set_id);
ALTER TABLE study_sessions ALTER COLUMN snapshot_id SET NOT NULL;
CREATE INDEX study_sessions_snapshot_idx ON study_sessions (snapshot_id);
COMMENT ON COLUMN study_sessions.snapshot_id IS 'The set as this round saw it (229); kept when the set is gone.';

-- snapshots no round refers to: gone when rounds or sets are deleted
CREATE FUNCTION study_snapshots_tidy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM study_set_snapshots x WHERE NOT EXISTS (SELECT 1 FROM study_sessions s WHERE s.snapshot_id = x.id)
    AND (TG_TABLE_NAME = 'study_sessions' OR x.set_id IS NULL);
  RETURN NULL;
END $$;
CREATE TRIGGER study_sessions_tidy AFTER DELETE ON study_sessions FOR EACH STATEMENT EXECUTE FUNCTION study_snapshots_tidy();
CREATE TRIGGER study_sets_tidy_snapshots AFTER DELETE ON study_sets FOR EACH STATEMENT EXECUTE FUNCTION study_snapshots_tidy();

GRANT SELECT, INSERT, UPDATE, DELETE ON study_set_snapshots TO arthistory_admin;
GRANT EXECUTE ON FUNCTION study_set_snapshot(bigint) TO arthistory_admin;
