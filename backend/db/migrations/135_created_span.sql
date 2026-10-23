-- 135 — What a creation span means (owner, 2026-10-23, on Klimt's "Adam und Eva", 1916–1918): a range of years can say
-- two different things, and until now the database could not tell them apart —
--   duration:  the work was made over that time ("worked on 1916–1918": Klimt began it in 1916 and left it unfinished
--              at his death in February 1918) — the artist held it from the start;
--   uncertain: it was made at some point in that time, nobody knows when ("between 1490 and 1500", "c. 1882",
--              "1880s", "13th century") — the artist held it from its making, somewhere in the range.
-- artworks.created_span records which; NULL = not stated. Written-out forms that can only mean the second (circa,
-- between, decades, centuries, "or earlier") are set by a trigger; a plain "1916–1918" stays for the editor to decide,
-- and a new hint (creation_span_unstated) lists the works whose span is longer than a year and still unstated.
--
-- The provenance reads it (provenance_chain, the implied first line "the artist"): for a duration the artist is
-- documented as holder from the start of the span (acquired = its first day), for an uncertain span from its end and
-- presumed before (as all creation dates were read so far — nothing changes for them).
--
-- And: a provenance that begins with the artist's own estate no longer drops that first line. The line was left out
-- when the first step "names the artist" — meant for a first step that is the artist as owner; an estate begins only
-- at the death, so the years in the studio showed as a gap (Degas' studies: 1869–1917). The estate of the creator
-- follows the artist directly by definition, so the line ends where the estate begins.
CREATE TYPE span_meaning AS ENUM ('duration', 'uncertain');
COMMENT ON TYPE span_meaning IS 'What a date range means: duration = over the whole time (worked on throughout); uncertain = at some point within it';

ALTER TABLE artworks ADD COLUMN created_span span_meaning;
COMMENT ON COLUMN artworks.created_span IS 'What the range "created" means: duration (made over that time) or uncertain (made at some point in it); NULL = not stated (135)';

-- citable on its own (a museum that speaks of the work's genesis, an unfinished work): not part of "created", whose
-- citations would otherwise all turn "changed since cited" when the meaning is set
INSERT INTO citable_fields (entity_type, field, cols, position)
SELECT 'artwork', 'created_span', '{created_span}', (SELECT max(position) FROM citable_fields WHERE entity_type = 'artwork') + 1;

-- the forms that can only mean "at some point within": as fuzzy-date.js writes their labels
CREATE FUNCTION created_label_is_uncertain(label text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT label ~* '^(c\.|ca\.?|circa|between|by|at the latest|not before|at the earliest)\s|\m(or earlier|or later)$|^(early|mid|late|first half|second half)\s|centur|^[0-9]{3,4}s$|^[0-9]{3,4}s\s*[–-]'
$$;

CREATE FUNCTION artworks_created_span() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created IS NULL THEN
    NEW.created_span := NULL;                       -- nothing to qualify
  ELSIF NEW.created_span IS NULL AND created_label_is_uncertain(NEW.created_label) THEN
    NEW.created_span := 'uncertain';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER artworks_created_span BEFORE INSERT OR UPDATE OF created, created_label, created_span ON artworks
  FOR EACH ROW EXECUTE FUNCTION artworks_created_span();

-- the existing works: circa, decades, centuries … are uncertain by their wording
UPDATE artworks SET created_span = 'uncertain' WHERE created IS NOT NULL AND created_label_is_uncertain(created_label);

-- the provenance's implied first line, patched as the view stands (074 and later)
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('provenance_chain'::regclass), E'; \n');
  anchors text[] := ARRAY[
    -- the first step: its role, and "direct" also for the creator's estate
    E'            p.acquired_label,\n            p.direct\n           FROM provenance p',
    -- the line's start: a duration documents the artist from the span's first day
    E'    w.created AS acquired,',
    -- the line ends where the artist's estate begins (the death) — an explicit end, as the estate step itself is often
    -- not marked direct
    E'    w.created_label AS acquired_label,\n    NULL::daterange AS ended,\n    NULL::text AS ended_label,',
    -- kept also when the first step is the artist's own estate
    E'(f.owner_artist_id IS DISTINCT FROM w.creator_id)))'];
  repl text[] := ARRAY[
    E'            p.acquired_label,\n            (p.direct OR (p.role = ''estate''::holder_role AND p.owner_artist_id = (SELECT w0.creator_id FROM artworks w0 WHERE w0.id = p.artwork_id))) AS direct,\n            p.role\n           FROM provenance p',
    E'    CASE WHEN w.created_span = ''duration''::span_meaning AND NOT isempty(w.created) THEN daterange(lower(w.created), lower(w.created) + 1) ELSE w.created END AS acquired,',
    E'    w.created_label AS acquired_label,\n    CASE WHEN f.role = ''estate''::holder_role AND f.owner_artist_id = w.creator_id THEN f.acquired END AS ended,\n    CASE WHEN f.role = ''estate''::holder_role AND f.owner_artist_id = w.creator_id THEN f.acquired_label END AS ended_label,',
    E'((f.owner_artist_id IS DISTINCT FROM w.creator_id) OR (f.role = ''estate''::holder_role))))'];
BEGIN
  FOR i IN 1 .. array_length(anchors, 1) LOOP
    IF (length(def) - length(replace(def, anchors[i], ''))) / length(anchors[i]) <> 1 THEN
      RAISE EXCEPTION 'provenance_chain: anchor % not found once', i;
    END IF;
    def := replace(def, anchors[i], repl[i]);
  END LOOP;
  EXECUTE 'CREATE OR REPLACE VIEW provenance_chain AS ' || def;
END $$;

-- the hint: a span of more than a year whose meaning nobody has stated
DO $$
DECLARE
  def text := rtrim(pg_get_viewdef('quality_issues_live'::regclass), E'; \n');
BEGIN
  IF position('creation_span_unstated' IN def) > 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW quality_issues_live AS ' || def || $b$
UNION ALL
 SELECT 'creation_span_unstated'::text AS check_id,
    'info'::text AS severity,
    'artwork'::entity_type AS entity_type,
    a.id AS entity_id,
    'created_span:'::text || a.id AS issue_key,
    (a.created_label || ': worked on over this time, or made at some point in it?')::text AS detail
   FROM artworks a
  WHERE a.created_span IS NULL AND upper(a.created) - lower(a.created) > 366$b$;
END $$;

-- every work's derived rows again: the chain feeds the coverage, the graph and the list rows
INSERT INTO derived_queue (type, id, reason) SELECT 'artwork', id, 'full' FROM artworks;
