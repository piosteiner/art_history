-- 198 — Open cases (owner, 2026-11-03): what can't be solved at once — Berck, pêcheuses sur la plage needs a book at
-- the library — moved out of the Quality page into its own list, with a description in Markdown, so it can be
-- followed up. A case belongs to an entry; it may park one finding of the Quality page (check_id + issue_key): while
-- the case is open, the finding is left out there and counted as "in open cases"; when the case is closed and the
-- finding still holds, it shows on the Quality page again. A case can also be opened from an entry without a finding.
-- source_id: where the answer is to be found (a book with its shelfmark, an archive) — the list groups by it, so all
-- the cases for one library visit come together; look_url: or simply a link (the library catalogue's record). Closed with a result (resolution_md), kept in the list's history.
CREATE TABLE open_cases (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type    entity_type NOT NULL,
  entity_id      bigint NOT NULL,
  check_id       text,
  issue_key      text,
  finding        text,                                       -- the finding's words when it was parked
  description_md text NOT NULL CHECK (btrim(description_md) <> ''),
  source_id      bigint REFERENCES bibliography (id) ON DELETE SET NULL,
  look_url       text CHECK (look_url ~ '^https?://\S+$'),     -- or just a link: a library catalogue's record …
  created_by     bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closed_by      bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  resolution_md  text CHECK (btrim(resolution_md) <> ''),
  CHECK ((check_id IS NULL) = (issue_key IS NULL)),
  CHECK (closed_at IS NOT NULL OR resolution_md IS NULL)
);
COMMENT ON TABLE open_cases IS 'Cases to follow up (198): an entry, perhaps a parked Quality finding, a description, where to look; closed with a result.';
-- one open case per finding (a closed one may be followed by a new one)
CREATE UNIQUE INDEX open_cases_one_per_finding ON open_cases (check_id, issue_key) WHERE closed_at IS NULL AND check_id IS NOT NULL;
CREATE INDEX open_cases_entity_idx ON open_cases (entity_type, entity_id);
CREATE INDEX open_cases_open_idx ON open_cases (created_at) WHERE closed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON open_cases TO arthistory_admin;   -- the CMS only: not part of the public API
CREATE TRIGGER open_cases_updated_at BEFORE UPDATE ON open_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER open_cases_audit AFTER INSERT OR UPDATE OR DELETE ON open_cases FOR EACH ROW EXECUTE FUNCTION audit_row();
