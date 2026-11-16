-- 253 — Source files and reading notes (owner 2026-11-16: "summaries and if available the table of contents for all
-- sources we have … lock it behind the same barrier we have for private references since it would be ai generated and
-- not proof read … i could release it once i went through an article or book").
--
-- source_files: the owner's copies of a source — scans and PDFs of books, articles, lecture slides — kept on the server
--   under SOURCE_FILES_DIR (/home/ubuntu/sources: compressed to 200 dpi, with a text layer), never in git or on the site.
--   page_offset turns a PDF page into the printed page (printed = pdf + offset) where a file starts mid-book.
-- source_notes: per source a table of contents (jsonb [{title, page, level}]) and summaries — of the whole and per
--   chapter (jsonb [{title, pages, summary_md}]) — in the source's language (English: British English; German; others:
--   English). Written with AI, so private until the owner has proofread them: released_at set by "Publish" in the CMS.
--   Only released notes are visible to the API (view public_source_notes).
CREATE TABLE source_files (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id     bigint NOT NULL REFERENCES bibliography(id) ON DELETE CASCADE,
  path          text NOT NULL UNIQUE CHECK (path !~ '(^/|\.\.)'),        -- relative to SOURCE_FILES_DIR
  original_path text,                                                   -- where it came from (/home/ubuntu/books/…)
  label         text,                                                   -- "Chapter 3, pp. 100–165", "Slides, session 4"
  position      integer NOT NULL DEFAULT 0,
  bytes         bigint,
  sha256        text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  pages         integer CHECK (pages > 0),
  page_offset   integer,
  has_text      boolean,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_files_source ON source_files (source_id, position);

CREATE TABLE source_notes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- audit_row() keys the history by id
  source_id    bigint NOT NULL UNIQUE REFERENCES bibliography(id) ON DELETE CASCADE,
  lang         text NOT NULL CHECK (lang IN ('en-GB', 'de', 'en')),
  toc          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(toc) = 'array'),
  summary_md   text,
  chapters     jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(chapters) = 'array'),
  toc_basis    text CHECK (toc_basis IN ('outline', 'contents pages', 'headings', 'compiled')),   -- where the contents come from
  generated_by text,                     -- e.g. "Claude (Opus 5.5), 2026-11-16"
  generated_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,              -- proofread and published by the owner
  released_by  bigint REFERENCES admin_users(id)
);
CREATE TRIGGER source_notes_audit AFTER INSERT OR UPDATE OR DELETE ON source_notes FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER source_files_audit AFTER INSERT OR UPDATE OR DELETE ON source_files FOR EACH ROW EXECUTE FUNCTION audit_row();

-- private (249): the API role reads only the released notes, never the files
REVOKE ALL ON source_files, source_notes FROM arthistory_api;
CREATE VIEW public_source_notes AS
  SELECT n.source_id, n.lang, n.toc, n.summary_md, n.chapters, n.toc_basis, n.released_at
  FROM source_notes n WHERE n.released_at IS NOT NULL;
GRANT SELECT ON public_source_notes TO arthistory_api;
