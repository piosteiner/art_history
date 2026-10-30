-- 172 — Whether a work was finished (owner, 2026-10-30). Klimt left Amalie Zuckerkandl and Adam und Eva unfinished at
-- his death in 1918: complete as they survive, never complete as works. The Nike of Samothrace is the other way round —
-- finished once, fragmentary now — which is its fate (103), not its making. Two questions, two fields:
--
--  * completion: unfinished (left so — the artist's death, abandoned; also a debated non finito, with a note) ·
--    completed_by_another (finished by another hand — who: a co_creator relationship). NULL = finished, as far as known.
--  * completion_date (+ _label): when it stopped or was finished by the other; completion_note: why, in the source's
--    words ("unfinished at the artist's death").
--  * citable as one field 'completion', like the fate.
-- Nothing derived changes: the provenance's first line is still the artist; the site says "left unfinished" there.

CREATE TYPE artwork_completion AS ENUM ('unfinished', 'completed_by_another');
COMMENT ON TYPE artwork_completion IS 'whether a work was finished (172): unfinished · completed by another hand; NULL = finished as far as known';

ALTER TABLE artworks
  ADD COLUMN completion artwork_completion,
  ADD COLUMN completion_date daterange CHECK (NOT isempty(completion_date)),
  ADD COLUMN completion_date_label text,
  ADD COLUMN completion_note text CHECK (btrim(completion_note) <> ''),
  -- a date or a note only with a completion
  ADD CONSTRAINT artworks_completion_details CHECK (completion IS NOT NULL OR (completion_date IS NULL AND completion_note IS NULL));
COMMENT ON COLUMN artworks.completion IS 'unfinished / completed_by_another (172); NULL = finished as far as known';

INSERT INTO citable_fields (entity_type, field, cols, position)
SELECT 'artwork', 'completion', '{completion,completion_date,completion_date_label,completion_note}', (SELECT max(position) FROM citable_fields WHERE entity_type = 'artwork') + 1;
