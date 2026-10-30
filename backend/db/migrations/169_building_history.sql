-- 169 — The history of a building (owner, 2026-10-30: the Berlin Palace — begun 1443, a Renaissance palace, rebuilt as a
-- Baroque residence by Schlüter and Eosander, its dome by Stüler, burnt out in 1945, blown up in 1950–51, its facades
-- rebuilt 2013–2020 with Franco Stella's modern parts as the Humboldt Forum). A work has one creator and one creation
-- date; a building has phases, each with its own time, its parts, its makers and patrons. And its "fate" is not the
-- end: what was blown up stands again.
--   artwork_phases: the phases in order — kind (construction … reconstruction), title, the parts concerned, period
--     (a fuzzy date range as everywhere), a text with footnotes.
--   artwork_phase_people: who took part in a phase, an artist, a person or an institution (an architects' office) —
--     exclusive arc as images (017) — with the role as written ("architect", "site manager") and whether they were its
--     patron (commissioned it).
--   edges: the phases as derived edges (source 'phase'): an artist → co_creator of the work, a patron → commissioned it,
--     each with the phase's period and "role · phase" as label — so architects and patrons appear on their pages, in the
--     network, in "how are they connected?" without a relationship typed twice. The worker keeps them with the work's
--     other derived edges (graph_links.artwork_id).
CREATE TYPE phase_kind AS ENUM ('construction', 'extension', 'alteration', 'completion', 'restoration', 'damage',
  'destruction', 'demolition', 'reconstruction', 'other');

CREATE TABLE artwork_phases (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artwork_id   bigint NOT NULL REFERENCES artworks (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  kind         phase_kind NOT NULL,
  title        text NOT NULL CHECK (btrim(title) = title AND title <> ''),
  part         text CHECK (btrim(part) <> ''),
  period       daterange CHECK (NOT isempty(period)),
  period_label text,
  notes_md     text CHECK (btrim(notes_md) <> ''),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artwork_id, position) DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE artwork_phases IS 'A building''s (or any work''s) history in phases (169): built, extended, altered, damaged, demolished, rebuilt.';
CREATE INDEX artwork_phases_period_gist ON artwork_phases USING gist (period);

CREATE TABLE artwork_phase_people (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase_id       bigint NOT NULL REFERENCES artwork_phases (id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  artist_id      bigint REFERENCES artists (id) ON DELETE CASCADE,
  person_id      bigint REFERENCES people (id) ON DELETE CASCADE,
  institution_id bigint REFERENCES institutions (id) ON DELETE CASCADE,
  role           text CHECK (btrim(role) = role AND role <> ''),
  patron         boolean NOT NULL DEFAULT false,
  CHECK (num_nonnulls(artist_id, person_id, institution_id) = 1)
);
COMMENT ON TABLE artwork_phase_people IS 'Who took part in a phase (169): artist, person or institution, the role as written; patron = commissioned it.';
CREATE INDEX artwork_phase_people_phase_idx ON artwork_phase_people (phase_id);
CREATE INDEX artwork_phase_people_artist_idx ON artwork_phase_people (artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX artwork_phase_people_person_idx ON artwork_phase_people (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX artwork_phase_people_institution_idx ON artwork_phase_people (institution_id) WHERE institution_id IS NOT NULL;

GRANT SELECT ON artwork_phases, artwork_phase_people TO arthistory_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON artwork_phases, artwork_phase_people TO arthistory_admin;
CREATE TRIGGER artwork_phases_updated_at BEFORE UPDATE ON artwork_phases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER artwork_phases_audit AFTER INSERT OR UPDATE OR DELETE ON artwork_phases FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER artwork_phase_people_audit AFTER INSERT OR UPDATE OR DELETE ON artwork_phase_people FOR EACH ROW EXECUTE FUNCTION audit_row();

-- derived data: a phase changes its work (search fields, findings, its derived edges); a participant also the
-- participant (its page lists the work, its edges)
CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON artwork_phases
  FOR EACH ROW EXECUTE FUNCTION derived_touch('artwork.artwork_id+');
CREATE FUNCTION phase_people_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (SELECT (CASE TG_OP WHEN 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END) AS j
                          UNION ALL SELECT to_jsonb(OLD) WHERE TG_OP = 'UPDATE') x LOOP
    INSERT INTO derived_queue (type, id, spread)
      SELECT 'artwork', p.artwork_id, true FROM artwork_phases p WHERE p.id = (r.j ->> 'phase_id')::bigint;
    INSERT INTO derived_queue (type, id)
      SELECT t, (r.j ->> c)::bigint FROM (VALUES ('artist'::entity_type, 'artist_id'), ('person', 'person_id'), ('institution', 'institution_id')) v(t, c)
      WHERE r.j ->> c IS NOT NULL;
  END LOOP;
  PERFORM nextval('quality_changes');
  PERFORM pg_notify('quality_changed', '');
  RETURN NULL;
END $$;
CREATE TRIGGER derived_touch AFTER INSERT OR UPDATE OR DELETE ON artwork_phase_people
  FOR EACH ROW EXECUTE FUNCTION phase_people_touch();

-- the phases in the edges view (derived, source 'phase')
DO $$
DECLARE def text := rtrim(pg_get_viewdef('edges'::regclass), E'; \n');
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW edges AS ' || def || $b$
UNION ALL
 SELECT NULL::bigint AS id,
    CASE WHEN pp.artist_id IS NOT NULL THEN 'artwork'::entity_type ELSE (CASE WHEN pp.person_id IS NOT NULL THEN 'person' ELSE 'institution' END)::entity_type END AS subject_type,
    CASE WHEN pp.artist_id IS NOT NULL THEN ph.artwork_id ELSE coalesce(pp.person_id, pp.institution_id) END AS subject_id,
    CASE WHEN pp.artist_id IS NOT NULL THEN 'co_creator' ELSE 'commissioned' END AS relationship_type,
    CASE WHEN pp.artist_id IS NOT NULL THEN 'artist'::entity_type ELSE 'artwork'::entity_type END AS object_type,
    CASE WHEN pp.artist_id IS NOT NULL THEN pp.artist_id ELSE ph.artwork_id END AS object_id,
    ph.period,
    ph.period_label,
    concat_ws(' · ', pp.role, ph.title) AS label,
    'attested'::certainty AS certainty,
    NULL::text AS notes_md,
    'phase'::text AS source,
    NULL::text AS end_basis,
    NULL::bigint AS provenance_id
   FROM artwork_phase_people pp JOIN artwork_phases ph ON ph.id = pp.phase_id
  WHERE pp.artist_id IS NOT NULL OR pp.patron$b$;
END $$;

-- the worker: a work's derived edges include its phases'
DO $$
DECLARE
  def text := pg_get_functiondef('process_derived'::regproc);
  old text := $o$e.source IN (''creator'', ''provenance'') AND e.subject_type = ''artwork'' AND e.subject_id = ANY($1)' USING ids;$o$;
  new text := $n$e.source IN (''creator'', ''provenance'', ''phase'') AND e.subject_type = ''artwork'' AND e.subject_id = ANY($1)' USING ids;
    EXECUTE 'INSERT INTO d_edges SELECT e.subject_type, e.subject_id, e.object_type, e.object_id, e.relationship_type, e.period,
               e.period_label, e.label, e.certainty, e.source, e.provenance_id, e.id, e.object_id, e.notes_md, e.end_basis
             FROM edges e WHERE e.source = ''phase'' AND e.relationship_type = ''commissioned'' AND e.object_type = ''artwork'' AND e.object_id = ANY($1)' USING ids;$n$;
BEGIN
  IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'process_derived: the creator/provenance edges not found exactly once';
  END IF;
  EXECUTE replace(def, old, new);
END $$;
