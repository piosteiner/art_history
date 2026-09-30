-- 010 — Unsaved form state, saved continuously by the admin panel's live connection (src/admin/live.js).
-- Step 1 of live collaboration: one draft per user and entity, so nothing typed is lost when the connection or browser
-- dies. Drafts are internal: the public API never sees them, and they are not content, so they are not audited.
-- (Step 2 will replace the per-user drafts by one shared working copy per entity.)
CREATE TABLE admin_drafts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES admin_users ON DELETE CASCADE,
  entity_type  entity_type NOT NULL,
  entity_id    bigint,                        -- NULL = a new entity that has not been created yet
  form         jsonb NOT NULL CHECK (jsonb_typeof(form) = 'object'),  -- the form's fields as the browser would post them
  base_version text,                          -- the entity's updated_at when editing started (optimistic locking on save)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- One draft per user per entity — and one "new …" draft per user per type: NULLS NOT DISTINCT (PG15+) makes the two
  -- NULL entity_ids of the same user and type collide, as intended.
  UNIQUE NULLS NOT DISTINCT (user_id, entity_type, entity_id)
);

REVOKE ALL ON admin_drafts FROM arthistory_api;
