-- 114 — Pages of the site written in the CMS (owner, 2026-10-20: the project documentation, "Projekt Dokumentation",
-- on the site for transparency and as proof of the work; edited in the CMS; Markdown from Obsidian, images included).
--   pages        a text page: slug (its address), title, language (de-CH), Markdown, published. Logged like every
--                content table (audit_row, 006): every revision is in the history.
--   page_images  the images a page embeds — Obsidian's ![[Facharbeit-1790625525635.webp]] finds the image of that name,
--                so a note pasted from Obsidian keeps its embeds once its attachments are uploaded. Stored in the
--                database (bytea; Postgres keeps large values compressed out of line — TOAST), so they are in the nightly
--                dump, its restore check and the encrypted copy off the server; files on disk would be in none of them.
--                Not logged in audit_log (it would copy every image into jsonb); sha256 names the version for caches.
--                No SVG: an SVG file can carry scripts.
CREATE TABLE pages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (btrim(title) <> ''),
  lang text NOT NULL DEFAULT 'de-CH' CHECK (lang ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body_md text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE pages IS 'text pages of the site written in the CMS (114): the project documentation …';
CREATE TRIGGER pages_audit AFTER INSERT OR UPDATE OR DELETE ON pages FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER pages_updated_at BEFORE UPDATE ON pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE page_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES pages ON DELETE CASCADE,
  -- the file name as embedded: ![[name]]; letters, digits, . _ - and spaces (Obsidian's "Pasted image 2026….png")
  name text NOT NULL CHECK (name ~ '^[\w][\w .-]{0,150}\.(webp|png|jpe?g|gif|avif)$' AND name !~ '\.\.'),
  content_type text NOT NULL CHECK (content_type IN ('image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),   -- at most 10 MB
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, name)
);
COMMENT ON TABLE page_images IS 'images embedded in a page (114), found by name: ![[name]]';

GRANT SELECT ON pages, page_images TO arthistory_api;

INSERT INTO pages (slug, title, lang, body_md, published)
VALUES ('projekt-dokumentation', 'Projekt Dokumentation', 'de-CH', '', false);
