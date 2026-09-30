-- 011 — Shared working copies (live collaboration step 2, src/admin/collab.js).
--
-- One Yjs document per existing entry that someone has opened for editing: every editor's changes merge into it live
-- (a CRDT — concurrent edits always converge, even after working offline). "Publish" writes it into the real table
-- (validated and audited as before); until then it is internal to the admin panel, like step 1's drafts.
--   state         the whole document, Y.encodeStateAsUpdate() — compact binary, hence bytea
--   base_version  the entry's updated_at the working copy is based on (optimistic locking on publish; if the entry
--                 changes elsewhere — revert, import — the copy is rebased onto the new version)
--   dirty         differs from the published entry ("unpublished changes"); contributors = who made them
CREATE TABLE live_docs (
  entity_type  entity_type NOT NULL,
  entity_id    bigint NOT NULL,
  state        bytea NOT NULL,
  base_version text NOT NULL,
  dirty        boolean NOT NULL DEFAULT false,
  contributors text[] NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX live_docs_dirty_idx ON live_docs (updated_at DESC) WHERE dirty;  -- "unpublished changes" on the dashboard

REVOKE ALL ON live_docs FROM arthistory_api;
