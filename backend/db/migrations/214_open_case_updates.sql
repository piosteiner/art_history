-- 214 — Updates on open cases (owner, 2026-11-04): "Open Cases need the option to write updates with a datepicker,
-- default being today." A case (198) is followed up over weeks — a library visit, a museum's answer, a lead that
-- didn't hold. Each step is an update: the day it happened (`on_day`, a plain date — the day of the library visit,
-- not the moment it was typed; today unless set), what was found (Markdown, as the case's text), who wrote it.
-- Kept in their own table rather than appended to the description: dated, in order, each with its author, and the
-- description stays the question. Shown under the case's text, newest last (a log reads downwards).
CREATE TABLE open_case_updates (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     bigint NOT NULL REFERENCES open_cases (id) ON DELETE CASCADE,
  on_day      date NOT NULL DEFAULT current_date,
  text_md     text NOT NULL CHECK (btrim(text_md) <> ''),
  created_by  bigint REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE open_case_updates IS 'Dated updates on an open case (214): what happened on that day, by whom.';
-- the updates of a case in their order: by day, then as written
CREATE INDEX open_case_updates_case_idx ON open_case_updates (case_id, on_day, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON open_case_updates TO arthistory_admin;   -- the CMS only, like open_cases
CREATE TRIGGER open_case_updates_updated_at BEFORE UPDATE ON open_case_updates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER open_case_updates_audit AFTER INSERT OR UPDATE OR DELETE ON open_case_updates FOR EACH ROW EXECUTE FUNCTION audit_row();
