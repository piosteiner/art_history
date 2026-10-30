-- 175 — Stolen and forged (owner, 2026-10-30: recent art heists; "Beltracchi was a prominent art forger … having the
-- option and not needing it might be the sound solution").
--
-- Stolen is not stored but derived: a theft step of the provenance (method 'theft', 076) without an end — not
-- recovered — makes the work stolen; when it is recovered, the step gets its end and the mark goes by itself.
-- artwork_stolen() gives that step for the API. (A work stolen long ago and never seen again may also carry the fate
-- `lost`.)
--
-- Authenticity is stored like the fate (103) and completion (172): disputed (the attribution is contested) or forgery
-- (made to deceive); a date (when doubted or exposed) and a note, citable as one field. NULL = no doubts known. An honest
-- copy is no forgery: that is `copy_after` (074). For a forgery the creator is the forger where known, and the new
-- relationship `passed_off_as` names the artist it was sold as — so it is found under that artist without counting as
-- his work.

CREATE TYPE artwork_authenticity AS ENUM ('disputed', 'forgery');
COMMENT ON TYPE artwork_authenticity IS 'doubts about an artwork (175): disputed attribution · forgery (made to deceive); NULL = none known';

ALTER TABLE artworks
  ADD COLUMN authenticity artwork_authenticity,
  ADD COLUMN authenticity_date daterange CHECK (NOT isempty(authenticity_date)),
  ADD COLUMN authenticity_date_label text,
  ADD COLUMN authenticity_note text CHECK (btrim(authenticity_note) <> ''),
  ADD CONSTRAINT artworks_authenticity_details CHECK (authenticity IS NOT NULL OR (authenticity_date IS NULL AND authenticity_note IS NULL));
COMMENT ON COLUMN artworks.authenticity IS 'disputed / forgery (175); NULL = no doubts known';

INSERT INTO citable_fields (entity_type, field, cols, position)
SELECT 'artwork', 'authenticity', '{authenticity,authenticity_date,authenticity_date_label,authenticity_note}', (SELECT max(position) FROM citable_fields WHERE entity_type = 'artwork') + 1;

-- the open theft: the last theft step without an end (not recovered), not another source's reading
CREATE FUNCTION artwork_stolen(aid bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('date', range_json(p.acquired, p.acquired_label), 'note', p.label, 'provenance_id', p.id)
  FROM provenance p
  WHERE p.artwork_id = aid AND p.method = 'theft' AND p.ended IS NULL AND p.alternative_to IS NULL
  ORDER BY p.position DESC LIMIT 1
$$;

INSERT INTO relationship_types (code, label, inverse_label, category, subject_types, object_types, description, sort_order)
VALUES ('passed_off_as', 'passed off as a work by', 'forgeries in their name', 'association', '{artwork}', '{artist}',
  'A forgery and the artist it was sold as (175) — e.g. a painting by Wolfgang Beltracchi passed off as a Campendonk. The creator is the forger.', 91);
