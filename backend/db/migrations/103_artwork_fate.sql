-- 103 — What became of an artwork (owner, 2026-10-19: "Wann ging ein Kunstwerk verloren und wieso? Zerstörung von
-- Kunst"). Until now a theft could be recorded in the provenance and an event (a fire) could concern a work, but the
-- work itself never said that it no longer exists or that nobody knows where it is.
--
--  * fate: destroyed · partly destroyed (fragments survive) · lost (whereabouts unknown — verschollen, also a stolen
--    work never recovered). NULL = extant, as far as we know.
--  * fate_date (+ _label): when, fuzzy like every date; fate_note: how and why, in the source's words ("burnt in the
--    Friedrichshain flak tower, May 1945").
--  * citable as one field 'fate', like the provenance status (074).
-- The provenance stays as it was: the last holder is the last known one. The site says "last known place" instead of
-- "today" for such a work.

CREATE TYPE artwork_fate AS ENUM ('destroyed', 'partly_destroyed', 'lost');
COMMENT ON TYPE artwork_fate IS 'what became of an artwork (103): destroyed · partly destroyed (fragments survive) · lost (whereabouts unknown); NULL = extant';

ALTER TABLE artworks
  ADD COLUMN fate artwork_fate,
  ADD COLUMN fate_date daterange CHECK (NOT isempty(fate_date)),
  ADD COLUMN fate_date_label text,
  ADD COLUMN fate_note text CHECK (btrim(fate_note) <> ''),
  -- a date or a note only with a fate
  ADD CONSTRAINT artworks_fate_details CHECK (fate IS NOT NULL OR (fate_date IS NULL AND fate_note IS NULL));
COMMENT ON COLUMN artworks.fate IS 'destroyed / partly_destroyed / lost (103); NULL = extant as far as known';

INSERT INTO citable_fields (entity_type, field, cols, position)
SELECT 'artwork', 'fate', '{fate,fate_date,fate_date_label,fate_note}', (SELECT max(position) FROM citable_fields WHERE entity_type = 'artwork') + 1;
