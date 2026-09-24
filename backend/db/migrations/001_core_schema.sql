-- 001 — Core data model: entities, places, generic relationships.
-- Design notes: backend/docs/data-model.md

------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------
CREATE TYPE entity_type   AS ENUM ('artist', 'artwork', 'institution', 'patron', 'movement', 'place');
CREATE TYPE place_kind    AS ENUM ('settlement', 'building', 'site', 'region', 'country');
CREATE TYPE movement_kind AS ENUM ('period', 'movement', 'school', 'style');
CREATE TYPE certainty     AS ENUM ('attested', 'probable', 'possible', 'disputed');

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
-- Fuzzy historical dates are stored as daterange (half-open [start, end)).
-- year_range(1480)       -> [1480-01-01, 1481-01-01)
-- year_range(1478, 1482) -> [1478-01-01, 1483-01-01)   (both years inclusive)
-- Negative years are BCE: year_range(-500) -> 500 BC.
CREATE FUNCTION year_range(from_year int, to_year int DEFAULT NULL) RETURNS daterange
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN daterange(
  make_date(from_year, 1, 1),
  make_date(CASE WHEN coalesce(to_year, from_year) = -1 THEN 1 ELSE coalesce(to_year, from_year) + 1 END, 1, 1)
);

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

------------------------------------------------------------------------------
-- Entity tables. Shared conventions on every table:
--   slug        stable human-readable key (URLs, import upserts)
--   wikidata_id optional Q-id for de-duplication / enrichment
--   metadata    free-form jsonb object (sources, dimensions, extra names …)
--   *_md        Markdown text, rendered + sanitized server-side
--   *_label     display text for a fuzzy date range ("c. 1480", "1860s")
------------------------------------------------------------------------------
CREATE TABLE places (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  alt_names     text[] NOT NULL DEFAULT '{}',
  kind          place_kind NOT NULL,
  parent_id     bigint REFERENCES places ON DELETE RESTRICT,   -- Arles ⊂ Provence ⊂ France
  country_code  char(2) CHECK (country_code ~ '^[A-Z]{2}$'),   -- modern ISO 3166-1, for filtering only
  location      geography(Point, 4326),                        -- representative point (map marker)
  area          geography(MultiPolygon, 4326),                 -- optional outline for regions
  description_md text,
  wikidata_id   text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (location IS NOT NULL OR area IS NOT NULL),
  CHECK (parent_id <> id)
);
CREATE INDEX places_location_gist ON places USING gist (location);
CREATE INDEX places_area_gist     ON places USING gist (area);
CREATE INDEX places_parent_idx    ON places (parent_id);

CREATE TABLE artists (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (btrim(name) <> ''),   -- display name: "Vincent van Gogh"
  sort_name     text,                                       -- "Gogh, Vincent van"
  alt_names     text[] NOT NULL DEFAULT '{}',               -- other spellings / native script
  birth         daterange CHECK (NOT isempty(birth)),
  birth_label   text,
  death         daterange CHECK (NOT isempty(death)),
  death_label   text,
  -- Earliest possible birth → latest possible death; unbounded while alive/unknown.
  lifespan      daterange GENERATED ALWAYS AS (daterange(lower(birth), upper(death))) STORED,
  biography_md  text,
  wikidata_id   text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (birth IS NULL OR death IS NULL OR lower(birth) <= lower(death))
);
CREATE INDEX artists_lifespan_gist ON artists USING gist (lifespan);

CREATE TABLE institutions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  alt_names     text[] NOT NULL DEFAULT '{}',
  kind          text,                                       -- museum, academy, church, collection …
  founded       daterange CHECK (NOT isempty(founded)),
  founded_label text,
  place_id      bigint REFERENCES places ON DELETE RESTRICT, -- location (a building- or settlement-level place)
  description_md text,
  website_url   text CHECK (website_url ~ '^https?://'),
  wikidata_id   text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institutions_place_idx ON institutions (place_id);

CREATE TABLE patrons (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  alt_names     text[] NOT NULL DEFAULT '{}',
  kind          text,                                       -- person, family, dynasty, religious order, state …
  active        daterange CHECK (NOT isempty(active)),
  active_label  text,
  notes_md      text,
  wikidata_id   text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE movements (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  alt_names     text[] NOT NULL DEFAULT '{}',
  kind          movement_kind NOT NULL DEFAULT 'movement',
  parent_id     bigint REFERENCES movements ON DELETE RESTRICT, -- Ukiyo-e ⊂ Edo period
  period        daterange CHECK (NOT isempty(period)),
  period_label  text,
  description_md text,
  wikidata_id   text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id <> id)
);
CREATE INDEX movements_period_gist ON movements USING gist (period);
CREATE INDEX movements_parent_idx  ON movements (parent_id);

CREATE TABLE artworks (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                  text NOT NULL CHECK (btrim(title) <> ''),
  alt_titles             text[] NOT NULL DEFAULT '{}',
  creator_id             bigint REFERENCES artists ON DELETE RESTRICT,  -- NULL = anonymous/unknown
  attribution_label      text,                                          -- "Workshop of Rubens", "Attributed to …"
  created                daterange CHECK (NOT isempty(created)),
  created_label          text,
  kind                   text,                                          -- painting, woodblock print, sculpture …
  medium                 text,                                          -- "Oil on canvas"
  current_institution_id bigint REFERENCES institutions ON DELETE RESTRICT,
  inventory_number       text,
  image_url              text CHECK (image_url ~ '^https://'),          -- hotlinked (e.g. Wikimedia Commons), never stored on the VM
  image_source_url       text CHECK (image_source_url ~ '^https?://'),
  image_license          text,                                          -- "Public domain", "CC BY-SA 4.0" …
  image_credit           text,
  description_md         text,
  wikidata_id            text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata               jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artworks_creator_idx     ON artworks (creator_id);
CREATE INDEX artworks_institution_idx ON artworks (current_institution_id);
CREATE INDEX artworks_created_gist    ON artworks USING gist (created);

------------------------------------------------------------------------------
-- Relationship vocabulary (controlled list; seeded in 002)
------------------------------------------------------------------------------
CREATE TABLE relationship_types (
  code                 text PRIMARY KEY CHECK (code ~ '^[a-z]+(_[a-z]+)*$'),
  label                text NOT NULL,          -- subject → object:  "influenced by"
  inverse_label        text NOT NULL,          -- object → subject:  "influenced"
  category             text NOT NULL,          -- presence, association, influence, education, … (frontend layers)
  is_physical_presence boolean NOT NULL DEFAULT false,  -- true → may be drawn as travel on the map
  is_symmetric         boolean NOT NULL DEFAULT false,  -- A↔B stored once (contemporary_of, collaborated_with)
  subject_types        entity_type[] NOT NULL CHECK (cardinality(subject_types) > 0),
  object_types         entity_type[] NOT NULL CHECK (cardinality(object_types) > 0),
  description          text,
  sort_order           int NOT NULL DEFAULT 0,
  CHECK (NOT is_symmetric OR (subject_types @> object_types AND object_types @> subject_types))
);

------------------------------------------------------------------------------
-- Relationships: one generic, type-tagged edge table between any two entities.
-- Postgres cannot enforce FKs on (type, id) pairs, so triggers below do it.
------------------------------------------------------------------------------
CREATE TABLE relationships (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_type      entity_type NOT NULL,
  subject_id        bigint NOT NULL,
  relationship_type text NOT NULL REFERENCES relationship_types (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  object_type       entity_type NOT NULL,
  object_id         bigint NOT NULL,
  period            daterange CHECK (NOT isempty(period)),
  period_label      text,
  label             text,                      -- short free-text qualifier ("summer studio", "via prints")
  certainty         certainty NOT NULL DEFAULT 'attested',
  notes_md          text,
  metadata          jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),  -- e.g. {"sources": [...]}
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (subject_type = object_type AND subject_id = object_id)),
  -- Same edge may repeat with different periods (lived in Paris twice), not identically.
  UNIQUE NULLS NOT DISTINCT (subject_type, subject_id, relationship_type, object_type, object_id, period)
);
-- "What does X relate to?" is served by the UNIQUE index (leading subject columns);
-- "What relates to X?" (e.g. who did X influence) needs the reverse index:
CREATE INDEX relationships_object_idx ON relationships (object_type, object_id, relationship_type);
CREATE INDEX relationships_type_idx   ON relationships (relationship_type);

-- Does entity (type, id) exist?
CREATE FUNCTION entity_exists(etype entity_type, eid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'patron'      THEN EXISTS (SELECT 1 FROM patrons      WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
  END
$$;

-- Enforce vocabulary rules + referential integrity on every write.
CREATE FUNCTION relationships_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rt relationship_types;
  t  entity_type;
  i  bigint;
BEGIN
  SELECT * INTO rt FROM relationship_types WHERE code = NEW.relationship_type;
  -- (unknown codes are rejected by the FK)

  IF NOT NEW.subject_type = ANY (rt.subject_types) THEN
    RAISE EXCEPTION '"%" cannot have a % as subject (allowed: %)', rt.code, NEW.subject_type, rt.subject_types
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.object_type = ANY (rt.object_types) THEN
    RAISE EXCEPTION '"%" cannot have a % as object (allowed: %)', rt.code, NEW.object_type, rt.object_types
      USING ERRCODE = 'check_violation';
  END IF;

  -- Symmetric edges are stored in one canonical direction so A↔B cannot be duplicated as B↔A.
  IF rt.is_symmetric AND (NEW.subject_type, NEW.subject_id) > (NEW.object_type, NEW.object_id) THEN
    t := NEW.subject_type; i := NEW.subject_id;
    NEW.subject_type := NEW.object_type; NEW.subject_id := NEW.object_id;
    NEW.object_type := t; NEW.object_id := i;
  END IF;

  IF NOT entity_exists(NEW.subject_type, NEW.subject_id) THEN
    RAISE EXCEPTION '% #% does not exist', NEW.subject_type, NEW.subject_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT entity_exists(NEW.object_type, NEW.object_id) THEN
    RAISE EXCEPTION '% #% does not exist', NEW.object_type, NEW.object_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER relationships_validate
  BEFORE INSERT OR UPDATE ON relationships
  FOR EACH ROW EXECUTE FUNCTION relationships_validate();

-- Deleting an entity removes its relationships in both directions (the "ON DELETE CASCADE" FKs can't give us).
CREATE FUNCTION delete_entity_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  etype entity_type := TG_ARGV[0]::entity_type;
BEGIN
  DELETE FROM relationships
   WHERE (subject_type = etype AND subject_id = OLD.id)
      OR (object_type  = etype AND object_id  = OLD.id);
  RETURN OLD;
END $$;

------------------------------------------------------------------------------
-- Per-table triggers
------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('artists', 'artist'), ('artworks', 'artwork'), ('institutions', 'institution'),
    ('patrons', 'patron'), ('movements', 'movement'), ('places', 'place')) AS v(tbl, etype)
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   r.tbl || '_updated_at', r.tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships(%L)',
                   r.tbl || '_delete_relationships', r.tbl, r.etype);
  END LOOP;
END $$;

CREATE TRIGGER relationships_updated_at
  BEFORE UPDATE ON relationships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
