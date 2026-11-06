-- 237 — The text of a literary work, and its date citable (owner 2026-11-06: "the text of a poem … original (with
-- furigana), romanization and translation, each with a source"; "a literary work's date can't be cited yet").
--   text_original     the text as written, line breaks kept; furigana as in names: {漢字|かんじ}
--   text_lang         its language (ja, zh, de …)
--   text_romanization a romanization of it, line by line
--   text_translation  a translation, line by line, and text_translator: whose (e.g. "Clay MacCauley, 1917"; "own")
-- Short texts — a poem, a verse, a passage — not whole novels (copyright: only texts that are free, or own translations).
ALTER TABLE literary_works
  ADD COLUMN text_original text CHECK (length(text_original) <= 20000),
  ADD COLUMN text_lang text CHECK (text_lang ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})*$'),
  ADD COLUMN text_romanization text CHECK (length(text_romanization) <= 20000),
  ADD COLUMN text_translation text CHECK (length(text_translation) <= 20000),
  ADD COLUMN text_translator text CHECK (length(text_translator) <= 300);
COMMENT ON COLUMN literary_works.text_original IS 'The text as written (a poem, a passage), line breaks kept, furigana as {漢字|かんじ} (237).';
COMMENT ON COLUMN literary_works.text_translator IS 'Whose translation text_translation is: a translator and year, or "own" (237).';

INSERT INTO citable_fields (entity_type, field, cols, wikidata_property, position) VALUES
  ('literature', 'written', '{written,written_label}', 'P571', 2),
  ('literature', 'text', '{text_original,text_lang,text_romanization}', NULL, 3),
  ('literature', 'translation', '{text_translation,text_translator}', NULL, 4);
