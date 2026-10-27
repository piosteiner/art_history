-- 141 — Feedback from visitors of the site (owner, 2026-10-27: "an easy way to give feedback on the site … general but
-- also highly detailed … a feedback section in the cms where i can check the feedback and add it to the roadmap").
--   feedback          what a visitor sent: a kind, the message, the page it was written on, the elements of the page it
--                     is about (each described in words — heading, kind, text — and a CSS selector to find it again),
--                     an email address only if they want an answer; the owner's status, note and roadmap item.
--   submit_feedback() the only way in from the public API: SECURITY DEFINER, so the API role may call it without any
--                     right on the table — it can neither read feedback (nor the addresses in it) nor change it.
-- Not audited (no audit_row trigger): audit_log is permanent, and deleted feedback — an address with it — must be gone.

CREATE TYPE feedback_kind AS ENUM ('bug', 'idea', 'content', 'other');
CREATE TYPE feedback_status AS ENUM ('new', 'read', 'planned', 'done', 'dismissed');

CREATE TABLE feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind feedback_kind NOT NULL DEFAULT 'other',
  message text NOT NULL CHECK (btrim(message) <> '' AND length(message) <= 5000),
  page_url text NOT NULL CHECK (page_url ~ '^/' AND length(page_url) <= 2000),          -- path, query and anchor on the site
  page_title text CHECK (length(page_title) <= 300),
  elements jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(elements) = 'array' AND jsonb_array_length(elements) <= 20),
  email text CHECK (email IS NULL OR (length(email) <= 200 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  viewport text CHECK (viewport ~ '^\d{2,5}x\d{2,5}$'),
  status feedback_status NOT NULL DEFAULT 'new',
  note_md text,                                                                         -- the owner's own note
  roadmap_item_id bigint REFERENCES roadmap_items ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE feedback IS 'feedback from visitors (141); written only through submit_feedback(), not audited';
CREATE INDEX feedback_open_idx ON feedback (created_at DESC) WHERE status IN ('new', 'read');
CREATE TRIGGER feedback_updated_at BEFORE UPDATE ON feedback FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- an element: {label, heading, text, selector} — short strings only, nothing else
CREATE FUNCTION feedback_elements_ok(e jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce((SELECT bool_and(jsonb_typeof(x) = 'object'
      AND (x - 'label' - 'heading' - 'text' - 'selector') = '{}'
      AND coalesce(jsonb_typeof(x->'selector'), 'string') = 'string' AND length(coalesce(x->>'selector', '')) <= 500
      AND length(coalesce(x->>'label', '')) <= 100 AND length(coalesce(x->>'heading', '')) <= 200 AND length(coalesce(x->>'text', '')) <= 300)
    FROM jsonb_array_elements(e) x), true) $$;
ALTER TABLE feedback ADD CONSTRAINT feedback_elements_shape CHECK (feedback_elements_ok(elements));

CREATE FUNCTION submit_feedback(p_kind text, p_message text, p_page_url text, p_page_title text, p_elements jsonb,
                                p_email text, p_viewport text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO feedback (kind, message, page_url, page_title, elements, email, viewport)
  VALUES (p_kind::feedback_kind, btrim(p_message), p_page_url, nullif(btrim(p_page_title), ''), coalesce(p_elements, '[]'),
          nullif(btrim(p_email), ''), p_viewport)
  RETURNING id $$;

-- the API: this function only (new tables give it SELECT by default — taken back here)
REVOKE ALL ON feedback FROM arthistory_api;
REVOKE ALL ON FUNCTION submit_feedback(text, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_feedback(text, text, text, text, jsonb, text, text) TO arthistory_api;
GRANT SELECT, UPDATE, DELETE ON feedback TO arthistory_admin;
