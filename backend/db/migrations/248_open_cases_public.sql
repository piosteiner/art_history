-- 248 — Open cases on the public site (owner 2026-11-13: "state on the public site of the entry that an open case
-- exists for this entry and what topic or question it is about — this would increase the transparency of the site").
--
-- A case's description is a working note (German or English, research leads, what the museum got wrong) — not for
-- the site. So a case gets its own public note: one sentence in English naming the topic or the question. Empty, the
-- site says only that a question about the entry is being checked.
--
-- The API never reads open_cases itself (198: CMS only). It reads the view public_open_cases: a view runs with its
-- owner's rights, so granting the view lets arthistory_api see exactly these columns of the open cases — the note and
-- two dates — and nothing else (not the description, the finding, who opened it, closed cases).
ALTER TABLE open_cases ADD COLUMN public_note text
  CONSTRAINT open_cases_public_note_line CHECK (public_note IS NULL OR (length(btrim(public_note)) BETWEEN 1 AND 300 AND public_note !~ '[\r\n]'));
COMMENT ON COLUMN open_cases.public_note IS 'Shown on the entry''s public page while the case is open (248): one line, the topic or question.';

CREATE VIEW public_open_cases AS
  SELECT c.id, c.entity_type, c.entity_id, c.public_note AS note, c.created_at::date AS opened,
         (SELECT max(u.on_day) FROM open_case_updates u WHERE u.case_id = c.id) AS last_update
  FROM open_cases c
  WHERE c.closed_at IS NULL;
COMMENT ON VIEW public_open_cases IS 'The open cases as the site may show them (248): no description, no finding, no names.';
GRANT SELECT ON public_open_cases TO arthistory_api, arthistory_admin;
