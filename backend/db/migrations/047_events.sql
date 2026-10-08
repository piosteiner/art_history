-- 047 — Events (046 added the type): something that happened — at a time (fuzzy dates: "2–4 March 1657"), in a place
-- (the city; optionally an exact point or an area on the map, like immovable artworks), maybe part of a larger event.
-- Its links are relationships: an artwork *depicts* it (the handscroll of the Great Fire of Meireki), people and
-- institutions *took part in* it (the role in the relationship's label: defendant, judge, lender …), it *concerns*
-- people, institutions, artworks. Auctions and exhibitions are events too (provenance steps may point at them later).
-- Like every type: names in several languages, Markdown description with [[links]], images, Wikidata, history.
CREATE TABLE events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  name_lang   text CHECK (lang_tag_ok(name_lang)),
  name_ruby   text CHECK (name_ruby IS NULL OR ruby_plain(name_ruby) = name),
  names       jsonb NOT NULL DEFAULT '[]' CHECK (names_valid(names)),
  kind        text,                              -- fire · trial · war · exhibition · auction … (free, suggestions in the form)
  parent_id   bigint REFERENCES events ON DELETE RESTRICT CHECK (parent_id <> id),   -- part of a larger event
  period      daterange,                         -- when (fuzzy, like every date here); open end = still going
  period_label text,
  place_id    bigint REFERENCES places ON DELETE RESTRICT,                           -- where: the city (or region)
  location    geography(Point, 4326),            -- the exact spot, if there is one
  area        geography(MultiPolygon, 4326),     -- or the area it covered (the burned districts)
  description_md text,
  wikidata_id text UNIQUE CHECK (wikidata_id ~ '^Q[0-9]+$'),
  metadata    jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- "events in 1657", "what happened while Hokusai lived": range overlap (&&) on a GiST index
CREATE INDEX events_period_gist ON events USING gist (period);
CREATE INDEX events_place_idx   ON events (place_id);
CREATE INDEX events_parent_idx  ON events (parent_id);
CREATE INDEX events_name_trgm   ON events USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX events_alt_trgm    ON events USING gin (f_unaccent(name_alt_text(name_ruby, names)) gin_trgm_ops);
CREATE INDEX events_geo_gist    ON events USING gist (coalesce(area::geometry, location::geometry));

-- the triggers every entity table has: updated_at, history, relationships go with it, a part can't contain its whole,
-- old slugs redirect (041), [[links]] corrected on the way in (042)
CREATE TRIGGER events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER events_audit AFTER INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER events_delete_relationships AFTER DELETE ON events FOR EACH ROW EXECUTE FUNCTION delete_entity_relationships('event');
CREATE TRIGGER events_no_parent_cycle BEFORE INSERT OR UPDATE OF parent_id ON events FOR EACH ROW EXECUTE FUNCTION no_parent_cycle();
CREATE TRIGGER events_slug_history AFTER UPDATE OF slug ON events FOR EACH ROW EXECUTE FUNCTION record_slug_change('event');
CREATE TRIGGER events_slug_release AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION release_old_slug('event');
CREATE TRIGGER events_old_links BEFORE INSERT OR UPDATE OF description_md ON events FOR EACH ROW EXECUTE FUNCTION correct_old_links('description_md');

-- Images (017/043): a sixth arm of the exclusive arc. The generated owner columns get the new arm by
-- ALTER COLUMN … SET EXPRESSION (PostgreSQL 17+), which recomputes them — no drop and re-create.
ALTER TABLE images ADD COLUMN event_id bigint REFERENCES events ON DELETE CASCADE,
  DROP CONSTRAINT images_check,
  ADD CONSTRAINT images_check CHECK (num_nonnulls(artwork_id, artist_id, institution_id, glossary_id, person_id, event_id) = 1);
CREATE INDEX images_event_idx ON images (event_id, position) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX images_event_url ON images (event_id, url) WHERE event_id IS NOT NULL;
ALTER TABLE images
  ALTER COLUMN entity_type SET EXPRESSION AS (CASE
    WHEN artwork_id     IS NOT NULL THEN 'artwork'::entity_type
    WHEN artist_id      IS NOT NULL THEN 'artist'::entity_type
    WHEN institution_id IS NOT NULL THEN 'institution'::entity_type
    WHEN glossary_id    IS NOT NULL THEN 'term'::entity_type
    WHEN person_id      IS NOT NULL THEN 'person'::entity_type
    WHEN event_id       IS NOT NULL THEN 'event'::entity_type END),
  ALTER COLUMN entity_id SET EXPRESSION AS (coalesce(artwork_id, artist_id, institution_id, glossary_id, person_id, event_id));

-- Relationships: "depicts" may point at an event; two new types. The role goes into the relationship's label.
UPDATE relationship_types SET object_types = object_types || '{event}'::entity_type[],
  description = coalesce(description, '') || ' Also an event (a fire, a battle, a festival).' WHERE code = 'depicts';
INSERT INTO relationship_types (code, label, inverse_label, category, is_physical_presence, is_symmetric,
                                subject_types, object_types, description, sort_order) VALUES
  ('participated_in', 'took part in', 'participants', 'event', false, false, '{artist,person,institution}', '{event}',
   'Took part in an event; the role in the label (defendant, judge, lender, organiser, buyer …), dated if it matters.', 85),
  ('concerns', 'concerns', 'subject of', 'event', false, false, '{event}', '{artist,artwork,institution,person,movement,place,polity}',
   'What an event is about or affected (a trial and the company or collection at issue, a fire and the temple it destroyed).', 86);
CREATE OR REPLACE FUNCTION entity_exists(etype entity_type, eid bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN EXISTS (SELECT 1 FROM artists      WHERE id = eid)
    WHEN 'artwork'     THEN EXISTS (SELECT 1 FROM artworks     WHERE id = eid)
    WHEN 'institution' THEN EXISTS (SELECT 1 FROM institutions WHERE id = eid)
    WHEN 'person'      THEN EXISTS (SELECT 1 FROM people       WHERE id = eid)
    WHEN 'movement'    THEN EXISTS (SELECT 1 FROM movements    WHERE id = eid)
    WHEN 'place'       THEN EXISTS (SELECT 1 FROM places       WHERE id = eid)
    WHEN 'polity'      THEN EXISTS (SELECT 1 FROM polities     WHERE id = eid)
    WHEN 'term'        THEN EXISTS (SELECT 1 FROM glossary     WHERE id = eid)
    WHEN 'source'      THEN EXISTS (SELECT 1 FROM bibliography WHERE id = eid)
    WHEN 'event'       THEN EXISTS (SELECT 1 FROM events       WHERE id = eid)
  END
$$;
CREATE OR REPLACE FUNCTION entity_id(etype entity_type, eslug text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE etype
    WHEN 'artist'      THEN (SELECT id FROM artists      WHERE slug = eslug)
    WHEN 'artwork'     THEN (SELECT id FROM artworks     WHERE slug = eslug)
    WHEN 'institution' THEN (SELECT id FROM institutions WHERE slug = eslug)
    WHEN 'person'      THEN (SELECT id FROM people       WHERE slug = eslug)
    WHEN 'movement'    THEN (SELECT id FROM movements    WHERE slug = eslug)
    WHEN 'place'       THEN (SELECT id FROM places       WHERE slug = eslug)
    WHEN 'polity'      THEN (SELECT id FROM polities     WHERE slug = eslug)
    WHEN 'term'        THEN (SELECT id FROM glossary     WHERE slug = eslug)
    WHEN 'source'      THEN (SELECT id FROM bibliography WHERE slug = eslug)
    WHEN 'event'       THEN (SELECT id FROM events       WHERE slug = eslug)
  END
$$;

-- an event's home place (for its country, 019): its place
CREATE OR REPLACE FUNCTION entity_home_place(etype entity_type, eid bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN etype = 'institution' THEN (SELECT place_id FROM institutions WHERE id = eid)
    WHEN etype = 'event' THEN (SELECT place_id FROM events WHERE id = eid)
    WHEN etype IN ('artist', 'person', 'artwork') THEN (
      SELECT r.object_id FROM relationships r
      WHERE r.subject_type = etype AND r.subject_id = eid AND r.object_type = 'place'
        AND r.relationship_type = CASE etype WHEN 'artwork' THEN 'created_in' ELSE 'born_in' END
      ORDER BY lower(r.period) NULLS LAST, r.id LIMIT 1)
  END
$$;

-- The views over all types get an event branch (each re-created as in its latest migration, plus that branch).
CREATE OR REPLACE VIEW entity_index AS
  SELECT 'artist'::entity_type AS type, id, slug, name, lifespan AS period,
         nullif(concat_ws('–', birth_label, death_label), '') AS period_label, NULL::text AS kind,
         names, name_sort_key(name, name_ruby, names) AS sort_key, name_alt_text(name_ruby, names) AS alt_text
    FROM artists
  UNION ALL
  SELECT 'artwork', id, slug, title, created, created_label, kind,
         names, name_sort_key(title, title_ruby, names), name_alt_text(title_ruby, names)
    FROM artworks
  UNION ALL
  SELECT 'institution', id, slug, name, founded, founded_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM institutions
  UNION ALL
  -- a person's span is the lifespan when known, else the active period (families, orders: only that)
  SELECT 'person', id, slug, name, coalesce(lifespan, active),
         coalesce(nullif(concat_ws('–', birth_label, death_label), ''), active_label), kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM people
  UNION ALL
  SELECT 'movement', id, slug, name, period, period_label, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM movements
  UNION ALL
  SELECT 'place', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM places
  UNION ALL
  SELECT 'polity', id, slug, name, period, period_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM polities
  UNION ALL
  SELECT 'term', id, slug, name, NULL, NULL, category::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM glossary
  UNION ALL
  SELECT 'source', id, slug, name, NULL, NULL, kind::text,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM bibliography
  UNION ALL
  SELECT 'event', id, slug, name, period, period_label, kind,
         names, name_sort_key(name, name_ruby, names), name_alt_text(name_ruby, names)
    FROM events;

CREATE OR REPLACE VIEW content_links AS
SELECT DISTINCT x.entity_type, x.entity_id, coalesce(m[1], 'term') AS target_type, m[2] AS target_slug
FROM (
  SELECT 'artist'::entity_type AS entity_type, id AS entity_id, biography_md AS md FROM artists
  UNION ALL SELECT 'artwork', id, description_md FROM artworks
  UNION ALL SELECT 'institution', id, description_md FROM institutions
  UNION ALL SELECT 'person', id, description_md FROM people
  UNION ALL SELECT 'movement', id, description_md FROM movements
  UNION ALL SELECT 'place', id, description_md FROM places
  UNION ALL SELECT 'polity', id, description_md FROM polities
  UNION ALL SELECT 'term', id, description_md FROM glossary
  UNION ALL SELECT 'source', id, description_md FROM bibliography
  UNION ALL SELECT subject_type, subject_id, notes_md FROM relationships
  UNION ALL SELECT 'artwork', artwork_id, notes_md FROM provenance
  UNION ALL SELECT 'event', id, description_md FROM events
) x
CROSS JOIN LATERAL regexp_matches(x.md, '\[\[(?:([a-z]+)/)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:\|[^\]\n]*)?\]\]', 'g') AS m
WHERE x.md LIKE '%[[%';

CREATE OR REPLACE VIEW markdown_columns AS
SELECT * FROM (VALUES ('artists', 'biography_md'), ('artworks', 'description_md'), ('institutions', 'description_md'),
  ('people', 'description_md'), ('movements', 'description_md'), ('places', 'description_md'),
  ('polities', 'description_md'), ('glossary', 'description_md'), ('bibliography', 'description_md'),
  ('relationships', 'notes_md'), ('provenance', 'notes_md'), ('events', 'description_md')) AS v(tbl, col);

CREATE OR REPLACE VIEW entry_previews AS
  SELECT 'artist'::entity_type AS type, a.slug, a.name,
         nullif(concat_ws('–', a.birth_label, a.death_label), '') AS subtitle,
         img.url AS image_url, a.biography_md AS text_md
    FROM artists a
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.artist_id = a.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "Katsushika Hokusai, c. 1831 · woodblock print"
  SELECT 'artwork', w.slug, w.title,
         nullif(concat_ws(' · ', nullif(concat_ws(', ', c.name, w.created_label), ''), w.kind), ''),
         img.url, w.description_md
    FROM artworks w
    LEFT JOIN artists c ON c.id = w.creator_id
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.artwork_id = w.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "museum · Paris · founded 1793"
  SELECT 'institution', t.slug, t.name,
         nullif(concat_ws(' · ', t.kind, p.name, 'founded ' || t.founded_label), ''),
         img.url, t.description_md
    FROM institutions t
    LEFT JOIN places p ON p.id = t.place_id
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.institution_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  -- "poet, monk · 1886–1942"; families and orders: their active period
  SELECT 'person', t.slug, t.name,
         nullif(concat_ws(' · ', nullif(array_to_string(t.occupations[1:3], ', '), ''),
                          coalesce(nullif(concat_ws('–', t.birth_label, t.death_label), ''), t.active_label)), ''),
         img.url, t.description_md
    FROM people t
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.person_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  SELECT 'movement', t.slug, t.name, nullif(concat_ws(' · ', t.kind::text, t.period_label), ''), NULL, t.description_md
    FROM movements t
  UNION ALL
  -- "settlement · Provence"
  SELECT 'place', t.slug, t.name, concat_ws(' · ', t.kind::text, p.name), NULL, t.description_md
    FROM places t LEFT JOIN places p ON p.id = t.parent_id
  UNION ALL
  SELECT 'polity', t.slug, t.name, nullif(concat_ws(' · ', t.kind, t.period_label), ''), NULL, t.description_md
    FROM polities t
  UNION ALL
  -- a term's short definition is its preview text (the glossary popovers show it too)
  SELECT 'term', t.slug, t.name, t.category::text,
         img.url, coalesce(t.definition, t.description_md)
    FROM glossary t
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.glossary_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true
  UNION ALL
  SELECT 'source', t.slug, t.name, nullif(concat_ws(' · ', replace(t.kind::text, '_', ' '), t.year::text), ''), NULL, t.description_md
    FROM bibliography t
  UNION ALL
  -- "fire · Edo · 1657"
  SELECT 'event', t.slug, t.name, nullif(concat_ws(' · ', t.kind, p.name, t.period_label), ''), img.url, t.description_md
    FROM events t
    LEFT JOIN places p ON p.id = t.place_id
    LEFT JOIN LATERAL (SELECT i.url FROM images i WHERE i.event_id = t.id ORDER BY i.position, i.id LIMIT 1) img ON true;

-- Duplicates (044/045): events are weighed by name, dates, place and position.
CREATE OR REPLACE VIEW dup_facts AS
SELECT 'artwork'::entity_type AS type, w.id, w.slug, w.title AS name, dup_names(w.title, w.names) AS names, w.kind,
       w.created AS period, NULL::daterange AS birth, NULL::daterange AS death, w.creator_id,
       w.current_institution_id AS institution_id, w.inventory_number, w.height_cm, w.width_cm,
       coalesce(w.location, ST_PointOnSurface(w.area::geometry)::geography) AS point, NULL::bigint AS place_id,
       w.parent_id, w.part_number, NULL::text AS web_host, NULL::text AS year, NULL::text[] AS authors,
       NULL::text AS isbn, NULL::text AS doi
  FROM artworks w
UNION ALL
SELECT 'artist', a.id, a.slug, a.name, dup_names(a.name, a.names), NULL, NULL, a.birth, a.death, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM artists a
UNION ALL
SELECT 'person', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind, NULL, p.birth, p.death, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM people p
UNION ALL
SELECT 'place', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       g.marker, NULL, p.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM places p LEFT JOIN place_geo g ON g.id = p.id
UNION ALL
SELECT 'institution', i.id, i.slug, i.name, dup_names(i.name, i.names), i.kind, i.founded, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       i.location, i.place_id, NULL, NULL, lower(substring(i.website_url FROM '^https?://(?:www\.)?([^/:?#]+)')), NULL, NULL, NULL, NULL
  FROM institutions i
UNION ALL
SELECT 'movement', m.id, m.slug, m.name, dup_names(m.name, m.names), m.kind::text, m.period, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, m.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM movements m
UNION ALL
SELECT 'polity', p.id, p.slug, p.name, dup_names(p.name, p.names), p.kind, p.period, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, p.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM polities p
UNION ALL
SELECT 'term', g.id, g.slug, g.name, dup_names(g.name, g.names), g.category::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM glossary g
UNION ALL
SELECT 'source', b.id, b.slug, b.name, dup_names(b.name, b.names), b.kind::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, nullif(btrim(b.year), ''),
       (SELECT array_agg(lower(public.f_unaccent(x))) FROM unnest(b.authors) x),
       nullif(regexp_replace(upper(coalesce(b.isbn, '')), '[^0-9X]', '', 'g'), ''), nullif(lower(btrim(b.doi)), '')
  FROM bibliography b
UNION ALL
SELECT 'event', v.id, v.slug, v.name, dup_names(v.name, v.names), v.kind, v.period, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       coalesce(v.location, ST_PointOnSurface(v.area::geometry)::geography), v.place_id, v.parent_id, NULL, NULL, NULL, NULL, NULL, NULL
  FROM events v;

CREATE OR REPLACE FUNCTION dup_score(a dup_facts, b dup_facts, OUT score int, OUT reasons text[]) LANGUAGE plpgsql STABLE AS $$
DECLARE
  s real := names_similarity(a.names, b.names);
  d double precision;
  -- dimensions in cm: the same within 1 cm or 2 %, different beyond 3 cm and 5 %
  close_h boolean; far_h boolean; close_w boolean; far_w boolean;
BEGIN
  score := 0; reasons := '{}';
  IF s >= 0.999 THEN
    -- a person's or a place's full name says more than a title ("Untitled") or a book title
    score := CASE WHEN a.type IN ('artwork', 'source') THEN 50 ELSE 70 END; reasons := reasons || 'same name'::text;
  ELSIF s >= 0.5 THEN
    score := round(s * 55); reasons := reasons || format('similar name (%s %%)', round(s * 100));
  END IF;

  IF a.type = 'artwork' THEN
    IF a.institution_id = b.institution_id AND lower(btrim(a.inventory_number)) = lower(btrim(b.inventory_number)) THEN
      score := score + 100; reasons := reasons || 'same inventory number in the same collection'::text;
    ELSIF a.institution_id = b.institution_id AND a.inventory_number IS NOT NULL AND b.inventory_number IS NOT NULL THEN
      -- two numbers in one collection: two objects, however alike (Monet's water lily panels at the Kunsthaus)
      score := score - 100; reasons := reasons || format('different inventory numbers (%s / %s)', a.inventory_number, b.inventory_number);
    END IF;
    IF a.creator_id IS NOT NULL AND b.creator_id IS NOT NULL THEN
      IF a.creator_id = b.creator_id THEN score := score + 20; reasons := reasons || 'same creator'::text;
      ELSE score := score - 60; reasons := reasons || 'different creators'::text; END IF;
    END IF;
    IF a.institution_id IS NOT NULL AND b.institution_id IS NOT NULL THEN
      IF a.institution_id = b.institution_id THEN score := score + 10; reasons := reasons || 'same collection'::text;
      ELSE score := score - 10; reasons := reasons || 'different collections'::text; END IF;
    END IF;
    IF a.height_cm IS NOT NULL AND b.height_cm IS NOT NULL THEN
      close_h := abs(a.height_cm - b.height_cm) <= greatest(1, 0.02 * greatest(a.height_cm, b.height_cm));
      far_h   := abs(a.height_cm - b.height_cm) >  greatest(3, 0.05 * greatest(a.height_cm, b.height_cm));
      close_w := a.width_cm IS NULL OR b.width_cm IS NULL OR abs(a.width_cm - b.width_cm) <= greatest(1, 0.02 * greatest(a.width_cm, b.width_cm));
      far_w   := a.width_cm IS NOT NULL AND b.width_cm IS NOT NULL AND abs(a.width_cm - b.width_cm) > greatest(3, 0.05 * greatest(a.width_cm, b.width_cm));
      IF close_h AND close_w THEN score := score + 20; reasons := reasons || 'same dimensions'::text;
      ELSIF far_h OR far_w THEN score := score - 40; reasons := reasons || 'different dimensions'::text; END IF;
    END IF;
    IF a.parent_id = b.parent_id AND a.part_number IS NOT NULL AND b.part_number IS NOT NULL AND a.part_number <> b.part_number THEN
      score := score - 60; reasons := reasons || format('different parts of one series (No. %s / %s)', a.part_number, b.part_number);
    END IF;
  END IF;

  -- created (artworks), founded (institutions), period (movements, polities, events) — a person's "active" is too vague
  IF a.period IS NOT NULL AND b.period IS NOT NULL AND a.type <> 'person' THEN
    IF a.period && b.period THEN score := score + 10; reasons := reasons || 'dates agree'::text;
    ELSE score := score - 30; reasons := reasons || 'different dates'::text; END IF;
  END IF;
  IF a.birth IS NOT NULL AND b.birth IS NOT NULL THEN
    IF a.birth && b.birth THEN score := score + 15; reasons := reasons || 'birth dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different birth dates'::text; END IF;
  END IF;
  IF a.death IS NOT NULL AND b.death IS NOT NULL THEN
    IF a.death && b.death THEN score := score + 15; reasons := reasons || 'death dates agree'::text;
    ELSE score := score - 50; reasons := reasons || 'different death dates'::text; END IF;
  END IF;

  -- a city and a region of the same name (Oslo, Kyoto) are two things; so are a technique and a style
  IF a.type IN ('place', 'term') AND a.kind IS NOT NULL AND b.kind IS NOT NULL THEN
    IF a.kind = b.kind THEN score := score + 5;
    ELSE score := score - 25; reasons := reasons || format('different kinds (%s / %s)', a.kind, b.kind); END IF;
  END IF;

  IF a.point IS NOT NULL AND b.point IS NOT NULL THEN
    d := ST_Distance(a.point, b.point);
    IF a.type = 'place' THEN
      IF d < 5000 THEN score := score + 25; reasons := reasons || 'close together'::text;
      ELSIF d < 25000 THEN score := score + 10; reasons := reasons || format('%s km apart', round(d / 1000));
      ELSIF d > 100000 THEN score := score - 50; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'institution' THEN
      IF d <= 300 THEN score := score + 25; reasons := reasons || 'same spot'::text;
      ELSIF d > 20000 THEN score := score - 40; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'event' THEN
      IF d <= 1000 THEN score := score + 10; reasons := reasons || 'same spot'::text;
      ELSIF d > 50000 THEN score := score - 40; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    ELSIF a.type = 'artwork' THEN
      IF d <= 200 THEN score := score + 15; reasons := reasons || 'same spot'::text;
      ELSIF d > 5000 THEN score := score - 30; reasons := reasons || format('%s km apart', round(d / 1000)); END IF;
    END IF;
  END IF;
  IF a.place_id IS NOT NULL AND b.place_id IS NOT NULL THEN
    IF a.place_id = b.place_id THEN score := score + 10; reasons := reasons || 'same city'::text;
    ELSE score := score - 20; reasons := reasons || 'different cities'::text; END IF;
  END IF;
  IF a.web_host = b.web_host THEN score := score + 40; reasons := reasons || 'same website'::text; END IF;

  IF a.type = 'source' THEN
    IF a.doi = b.doi THEN score := score + 100; reasons := reasons || 'same DOI'::text; END IF;
    -- a chapter has the ISBN of its book: strong, but not proof
    IF a.isbn = b.isbn THEN score := score + 40; reasons := reasons || 'same ISBN'::text; END IF;
    IF a.year IS NOT NULL AND b.year IS NOT NULL THEN
      IF a.year = b.year THEN score := score + 15; reasons := reasons || 'same year'::text;
      ELSE score := score - 40; reasons := reasons || 'different years'::text; END IF;
    END IF;
    IF cardinality(a.authors) > 0 AND cardinality(b.authors) > 0 THEN
      IF a.authors && b.authors THEN score := score + 20; reasons := reasons || 'same author'::text;
      ELSE score := score - 30; reasons := reasons || 'different authors'::text; END IF;
    END IF;
  END IF;
END $$;

-- Quality view: 044's, with events (connected via place/whole/parts; description; Wikidata; without place).
CREATE OR REPLACE VIEW quality_issues AS
WITH rel AS (
  SELECT r.*, rt.label AS type_label, rt.is_physical_presence,
         o.name AS object_name, coalesce(r.period_label, (range_json(r.period))->>'from_year') AS when_text
  FROM relationships r
  JOIN relationship_types rt ON rt.code = r.relationship_type
  JOIN entity_index o ON o.type = r.object_type AND o.id = r.object_id
)
-- ── errors: contradictions ─────────────────────────────────────────────────────────────────────────────────────
-- Physically somewhere while not alive (the lifespan is open-ended while the death is unknown)
SELECT 'presence_outside_lifespan' AS check_id, 'error' AS severity, 'artist'::entity_type AS entity_type, a.id AS entity_id,
       'rel:' || r.id AS issue_key,
       format('%s %s (%s) lies outside the lifespan', r.type_label, r.object_name, r.when_text) AS detail
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.is_physical_presence AND r.period IS NOT NULL AND a.birth IS NOT NULL AND NOT (r.period && a.lifespan)
UNION ALL
-- "born in" / "died in" dated differently from the birth / death date
SELECT 'birth_death_mismatch', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s is dated %s, the %s %s', r.type_label, r.object_name, r.when_text,
              CASE r.relationship_type WHEN 'born_in' THEN 'birth' ELSE 'death' END,
              CASE r.relationship_type WHEN 'born_in' THEN a.birth_label ELSE a.death_label END)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
WHERE r.period IS NOT NULL AND ((r.relationship_type = 'born_in' AND a.birth IS NOT NULL AND NOT (r.period && a.birth))
                             OR (r.relationship_type = 'died_in' AND a.death IS NOT NULL AND NOT (r.period && a.death)))
UNION ALL
-- Created after the artist's death / before their birth (>> and <<: no overlap at all, so fuzzy dates don't trigger it)
SELECT 'artwork_outside_creator_life', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('created %s, but %s %s %s', w.created_label, a.name,
              CASE WHEN w.created >> a.death THEN 'died' ELSE 'was born' END,
              CASE WHEN w.created >> a.death THEN a.death_label ELSE a.birth_label END)
FROM artworks w JOIN artists a ON a.id = w.creator_id
WHERE w.created IS NOT NULL AND ((a.death IS NOT NULL AND w.created >> a.death) OR (a.birth IS NOT NULL AND w.created << a.birth))
UNION ALL
-- Teacher and student (or collaborators, "contemporaries") who were never alive at the same time
SELECT 'never_alive_together', 'error', 'artist', a.id, 'rel:' || r.id,
       format('%s %s, but their lifespans do not overlap', r.type_label, r.object_name)
FROM rel r JOIN artists a ON r.subject_type = 'artist' AND a.id = r.subject_id
JOIN artists b ON r.object_type = 'artist' AND b.id = r.object_id
WHERE r.relationship_type IN ('student_of', 'collaborated_with', 'contemporary_of')
  AND a.birth IS NOT NULL AND b.birth IS NOT NULL AND NOT (a.lifespan && b.lifespan)
UNION ALL
-- An inventory number without the institution whose collection numbered it (enforced for changes by
-- artworks_inventory_needs_institution, migration 016 — this finds rows that existed before)
SELECT 'inventory_without_institution', 'error', 'artwork', w.id, 'artwork:' || w.id,
       format('inventory number %s, but no institution', w.inventory_number)
FROM artworks w WHERE w.inventory_number IS NOT NULL AND w.current_institution_id IS NULL
UNION ALL
-- A dated link to a polity outside the polity's existence (nationality USSR in 1900)
SELECT 'outside_polity_period', 'error', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s (%s) lies outside the existence of %s (%s)', r.type_label, r.object_name, r.when_text, r.object_name,
              coalesce(p.period_label, concat_ws('–', (range_json(p.period))->>'from_year', (range_json(p.period))->>'to_year')))
FROM rel r JOIN polities p ON r.object_type = 'polity' AND p.id = r.object_id
WHERE r.period IS NOT NULL AND p.period IS NOT NULL AND NOT (r.period && p.period)
UNION ALL
-- ── warnings: probably a problem ───────────────────────────────────────────────────────────────────────────────
-- A [[link]] in a text to a glossary term that doesn't exist (yet)
SELECT 'broken_glossary_link', 'warning', l.entity_type, l.entity_id, 'gl:' || l.entity_type || ':' || l.entity_id || ':' || l.term_slug,
       format('links to the glossary term "%s", which doesn''t exist', l.term_slug)
FROM glossary_links l WHERE NOT EXISTS (SELECT 1 FROM glossary g WHERE g.slug = l.term_slug)
UNION ALL
-- Provenance (031): an undocumented change of owner whose gap lies in or across 1933–1945 — the standard red flag
-- of Nazi-era provenance research. The gap runs from the previous owner's last documented holding (their recorded
-- end, else their acquisition) to this acquisition; && is the range overlap operator.
SELECT 'provenance_gap_1933_1945', 'warning', 'artwork', p.artwork_id, 'prov-gap:' || p.id,
       format('%s: the change of owner (%s) is not documented as direct, and the gap lies in 1933–1945',
              p.owner_name, coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.position > p.first_position AND NOT p.direct AND p.acquired IS NOT NULL AND p.prev_holding IS NOT NULL
  AND lower(p.prev_holding) < upper(p.acquired)
  AND daterange(lower(p.prev_holding), upper(p.acquired)) && daterange('1933-01-30', '1945-05-09')
UNION ALL
-- Confiscated or sold under duress: check whether it was restituted (a later step "restitution")
SELECT 'provenance_forced_transfer', 'warning', 'artwork', p.artwork_id, 'prov-forced:' || p.id,
       format('%s: %s (%s) — no later restitution recorded', p.owner_name, replace(p.method::text, '_', ' '), coalesce(p.acquired_label, 'undated'))
FROM provenance_periods p
WHERE p.method IN ('confiscation', 'forced_sale')
  AND NOT EXISTS (SELECT 1 FROM provenance r WHERE r.artwork_id = p.artwork_id AND r.position > p.position AND r.method = 'restitution')
UNION ALL
-- The last owner in the provenance is not the institution that holds the work now
SELECT 'provenance_last_owner', 'warning', 'artwork', w.id, 'prov-last:' || w.id,
       format('the provenance ends with %s, but the work is at %s', p.owner_name, i.name)
FROM artworks w JOIN institutions i ON i.id = w.current_institution_id
JOIN provenance_periods p ON p.artwork_id = w.id AND p.is_last
WHERE p.owner_institution_id IS DISTINCT FROM w.current_institution_id
UNION ALL
-- A [[type/slug]] link to an entry that doesn't exist (030) — a typo, a renamed slug, a deleted entry, an unknown type
SELECT 'broken_link', 'warning', l.entity_type, l.entity_id, 'link:' || l.entity_type || ':' || l.entity_id || ':' || l.target_type || '/' || l.target_slug,
       format('links to %s/%s, which doesn''t exist', l.target_type, l.target_slug)
FROM content_links l
WHERE l.target_type <> 'term'
  AND NOT EXISTS (SELECT 1 FROM entity_index e WHERE e.type::text = l.target_type AND e.slug = l.target_slug)
UNION ALL
-- Living in two places at the same time (can be right: a summer house). r1.period * r2.period is the intersection of
-- the two ranges; fuzzy boundaries overlap a little ("Paris until February 1888", "Arles from 20 February 1888"; moving
-- on 8 May gives both periods that day), so only a substantial overlap counts: more than a month, and either more than
-- a year, or one period containing the other, or more than half of the shorter one.
SELECT 'overlapping_residences', 'warning', r1.subject_type, r1.subject_id, 'rel:' || r1.id || ':' || r2.id,
       format('lived in %s (%s) and %s (%s) at the same time', r1.object_name, r1.when_text, r2.object_name, r2.when_text)
FROM rel r1 JOIN rel r2 ON r2.subject_type = r1.subject_type AND r2.subject_id = r1.subject_id AND r2.id > r1.id
CROSS JOIN LATERAL (SELECT r1.period * r2.period AS i) x
CROSS JOIN LATERAL (SELECT coalesce(upper(x.i), lower(x.i) + 36500) - lower(x.i) AS days,
                           least(coalesce(upper(r1.period), lower(r1.period) + 36500) - lower(r1.period),
                                 coalesce(upper(r2.period), lower(r2.period) + 36500) - lower(r2.period)) AS shorter) d
WHERE r1.relationship_type = 'lived_in' AND r2.relationship_type = 'lived_in' AND r1.object_id <> r2.object_id
  AND r1.period && r2.period
  AND d.days > 31 AND (d.days > 366 OR r1.period @> r2.period OR r2.period @> r1.period OR d.days * 2 > d.shorter)
UNION ALL
-- Held by an institution before it was founded
SELECT 'held_before_founded', 'warning', 'artwork', r.subject_id, 'rel:' || r.id,
       format('housed at %s (%s), founded %s', r.object_name, r.when_text, i.founded_label)
FROM rel r JOIN institutions i ON r.object_type = 'institution' AND i.id = r.object_id
WHERE r.relationship_type = 'housed_at' AND r.period IS NOT NULL AND i.founded IS NOT NULL AND r.period << i.founded
UNION ALL
-- A place outside the outline of its parent region (PostGIS: ST_Covers on geography)
SELECT 'outside_parent_area', 'warning', 'place', c.id, 'place:' || c.id,
       format('its point lies outside the outline of %s (%s km away)', p.name,
              round((ST_Distance(pg.outline, cg.marker) / 1000)::numeric))
FROM places c JOIN places p ON p.id = c.parent_id
JOIN place_geo cg ON cg.id = c.id JOIN place_geo pg ON pg.id = p.id
WHERE pg.outline IS NOT NULL AND c.location IS NOT NULL AND NOT ST_DWithin(pg.outline, cg.marker, 5000)
UNION ALL
-- Probable duplicates: weighed by dup_score (names and evidence), 044
SELECT 'possible_duplicate', 'warning', a.type, a.id, 'dup:' || least(a.id, b.id) || ':' || greatest(a.id, b.id),
       format('probably the same as %s (%s) — %s (score %s)', b.name, b.slug, array_to_string(s.reasons, ', '), s.score)
FROM dup_facts a JOIN dup_facts b ON b.type = a.type AND b.id <> a.id
CROSS JOIN LATERAL dup_score(a, b) s
WHERE dup_maybe(a, b) AND s.score >= 50
UNION ALL
SELECT 'artwork_without_creator', 'warning', 'artwork', w.id, 'artwork:' || w.id, 'no creator and no attribution'
FROM artworks w WHERE w.creator_id IS NULL AND w.attribution_label IS NULL
UNION ALL
SELECT 'image_without_license', 'warning',
       i.entity_type, i.entity_id, 'image:' || i.id,
       concat_ws(' and ', CASE WHEN i.license IS NULL THEN 'no license' END, CASE WHEN i.credit IS NULL THEN 'no credit' END)
       || ' for image ' || i.position + 1 || coalesce(' (' || i.caption || ')', '')
FROM images i WHERE i.license IS NULL OR i.credit IS NULL
UNION ALL
SELECT 'no_relationships', 'warning', e.type, e.id, e.type || ':' || e.id, 'not connected to anything'
FROM entity_index e
WHERE NOT EXISTS (SELECT 1 FROM relationships r WHERE (r.subject_type, r.subject_id) = (e.type, e.id) OR (r.object_type, r.object_id) = (e.type, e.id))
  AND NOT (e.type = 'artwork' AND EXISTS (SELECT 1 FROM artworks w WHERE w.id = e.id AND (w.creator_id IS NOT NULL OR w.current_institution_id IS NOT NULL)))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM institutions i WHERE i.place_id = e.id))
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM places c WHERE c.parent_id = e.id))        -- contains other places
  AND NOT (e.type = 'movement' AND EXISTS (SELECT 1 FROM movements c WHERE c.parent_id = e.id))  -- has sub-movements
  AND NOT (e.type = 'polity' AND EXISTS (SELECT 1 FROM polities c WHERE c.parent_id = e.id))     -- has parts
  AND NOT (e.type = 'place' AND EXISTS (SELECT 1 FROM events v WHERE v.place_id = e.id))        -- where something happened
  AND NOT (e.type = 'event' AND EXISTS (SELECT 1 FROM events v WHERE (v.id = e.id AND (v.place_id IS NOT NULL OR v.parent_id IS NOT NULL))
                                                                    OR v.parent_id = e.id))     -- has a place, a whole or parts
  AND e.type NOT IN ('term', 'source')                                                             -- linked from texts                                                                             -- linked from texts
  AND NOT (e.type = 'institution' AND EXISTS (SELECT 1 FROM artworks w WHERE w.current_institution_id = e.id))
  AND NOT (e.type = 'artist' AND EXISTS (SELECT 1 FROM artworks w WHERE w.creator_id = e.id))
UNION ALL
SELECT 'artist_missing_dates', 'warning', 'artist', a.id, 'artist:' || a.id,
       concat_ws(' and ', CASE WHEN a.birth IS NULL THEN 'no birth date' END, CASE WHEN a.death IS NULL THEN 'no death date' END)
FROM artists a WHERE a.birth IS NULL OR a.death IS NULL
UNION ALL
-- Created automatically (as an artwork's creator / institution, or by the Wikidata comparison) and not edited since
SELECT 'auto_created', 'warning', ac.entity_type, ac.entity_id, 'auto:' || ac.entity_type || ':' || ac.entity_id,
       'created automatically' || coalesce(' while adding ' || f.name, '') || ' — fill in the details'
FROM auto_created ac
LEFT JOIN entity_index f ON f.type = ac.created_from_type AND f.id = ac.created_from_id
UNION ALL
-- ── info: incomplete ───────────────────────────────────────────────────────────────────────────────────────────
-- A part of a series / album / triptych without creator or date, while the whole has one
SELECT 'part_missing_data', 'info', 'artwork', a.id, 'artwork:' || a.id,
       format('no %s — its whole, %s, has %s', concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'creator' END,
                                                             CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN 'date' END),
              w.title, concat_ws(' and ', CASE WHEN a.creator_id IS NULL AND w.creator_id IS NOT NULL THEN 'one' END,
                                          CASE WHEN a.created IS NULL AND w.created IS NOT NULL THEN coalesce(w.created_label, 'one') END))
FROM artworks a JOIN artworks w ON w.id = a.parent_id
WHERE (a.creator_id IS NULL AND w.creator_id IS NOT NULL) OR (a.created IS NULL AND w.created IS NOT NULL)
UNION ALL
-- An institution without its city (place): with a point of its own, the nearest settlement within 25 km is suggested
SELECT 'institution_without_place', 'info', 'institution', i.id, 'institution:' || i.id,
       CASE WHEN s.slug IS NOT NULL THEN format('no place (city) — it lies %s km from %s (%s)', s.km, s.name, s.slug)
            ELSE 'no place (city) set — the map can''t show it unless it has its own point' END
FROM institutions i
LEFT JOIN LATERAL (SELECT p.slug, p.name, round((ST_Distance(g.marker, i.location) / 1000)::numeric, 1) AS km
                   FROM places p JOIN place_geo g ON g.id = p.id
                   WHERE i.location IS NOT NULL AND p.kind = 'settlement' AND ST_DWithin(g.marker, i.location, 25000)
                   ORDER BY g.marker <-> i.location LIMIT 1) s ON true
WHERE i.place_id IS NULL
UNION ALL
-- A place without parent whose point lies inside another place's outline: the smallest such place is suggested
SELECT 'parent_suggestion', 'info', 'place', c.id, 'place:' || c.id || ':' || s.id,
       format('lies inside %s (%s) — set it as parent', s.name, s.slug)
FROM places c JOIN place_geo cg ON cg.id = c.id
CROSS JOIN LATERAL (SELECT p.id, p.name, p.slug FROM places p JOIN place_geo pg ON pg.id = p.id
                    WHERE p.id <> c.id AND pg.outline IS NOT NULL AND ST_Covers(pg.outline, cg.marker)
                    ORDER BY ST_Area(pg.outline) LIMIT 1) s
WHERE c.parent_id IS NULL AND c.kind <> 'country'
UNION ALL
-- A country or region without an outline, while Natural Earth has one with that code / that name in that country
SELECT 'boundary_available', 'info', 'place', p.id, 'place:' || p.id || ':' || b.code,
       format('an outline is available: %s (%s) — set the boundary code', b.name, b.code)
FROM places p
CROSS JOIN LATERAL (SELECT code, name FROM boundaries b
                    WHERE (p.kind = 'country' AND b.level = 0 AND b.code = p.country_code)
                       OR (p.kind = 'region' AND b.level = 1 AND b.country_code = place_country(p.id)->>'code'
                           AND lower(f_unaccent(b.name)) = lower(f_unaccent(p.name)))
                    LIMIT 1) b
WHERE p.kind IN ('country', 'region') AND p.area IS NULL AND p.boundary_code IS NULL
UNION ALL
-- A name without any Latin letter (kanji, Cyrillic, Arabic …) and no romanization: hard to find and to sort
SELECT 'missing_romanization', 'info', e.type, e.id, e.type || ':' || e.id, format('"%s" has no romanization', e.name)
FROM entity_index e
WHERE e.name !~ '[A-Za-zÀ-ɏ]' AND NOT jsonb_path_exists(e.names, '$[*] ? (@.role == "romanization")')
UNION ALL
-- Without a period a presence can't be placed on the timeline or the travel route
SELECT 'presence_without_period', 'info', r.subject_type, r.subject_id, 'rel:' || r.id,
       format('%s %s has no date — not on the timeline or route', r.type_label, r.object_name)
FROM rel r WHERE r.is_physical_presence AND r.period IS NULL
UNION ALL
SELECT 'place_without_parent', 'info', 'place', p.id, 'place:' || p.id, 'not inside any other place (no parent)'
FROM places p WHERE p.parent_id IS NULL AND p.kind <> 'country'
UNION ALL
SELECT 'missing_description', 'info', t.type, t.id, t.type || ':' || t.id, 'no description / biography'
FROM (SELECT 'artist'::entity_type AS type, id, biography_md AS md FROM artists
      UNION ALL SELECT 'artwork', id, description_md FROM artworks
      UNION ALL SELECT 'place', id, description_md FROM places
      UNION ALL SELECT 'movement', id, description_md FROM movements
      UNION ALL SELECT 'institution', id, description_md FROM institutions
      UNION ALL SELECT 'person', id, description_md FROM people
      UNION ALL SELECT 'polity', id, description_md FROM polities
      UNION ALL SELECT 'event', id, description_md FROM events
      UNION ALL SELECT 'term', id, description_md FROM glossary WHERE definition IS NULL) t
WHERE t.md IS NULL
UNION ALL
SELECT 'no_wikidata_id', 'info', t.type, t.id, t.type || ':' || t.id, 'no Wikidata id (compare with Wikidata to add it)'
FROM (SELECT 'artist'::entity_type AS type, id, wikidata_id FROM artists
      UNION ALL SELECT 'artwork', id, wikidata_id FROM artworks
      UNION ALL SELECT 'place', id, wikidata_id FROM places
      UNION ALL SELECT 'movement', id, wikidata_id FROM movements
      UNION ALL SELECT 'institution', id, wikidata_id FROM institutions
      UNION ALL SELECT 'person', id, wikidata_id FROM people
      UNION ALL SELECT 'polity', id, wikidata_id FROM polities
      UNION ALL SELECT 'event', id, wikidata_id FROM events) t
WHERE t.wikidata_id IS NULL
UNION ALL
-- An event without any place: it can't appear on the map
SELECT 'event_without_place', 'info', 'event', v.id, 'event:' || v.id, 'no place, point or area'
FROM events v WHERE v.place_id IS NULL AND v.location IS NULL AND v.area IS NULL;

-- Sites (034): an event is a location too — its spot, its area, else its place — so a person's map shows the trial
-- they took part in (src/routes/map.js).
CREATE OR REPLACE VIEW site_geo AS
  SELECT 'place'::entity_type AS type, p.id, g.marker, g.outline, p.id AS place_id
  FROM places p JOIN place_geo g ON g.id = p.id
  UNION ALL
  SELECT 'institution', i.id, coalesce(i.location, g.marker), NULL::geography, i.place_id
  FROM institutions i LEFT JOIN place_geo g ON g.id = i.place_id
  UNION ALL
  SELECT 'artwork', a.id, coalesce(a.location, ST_PointOnSurface(a.area::geometry)::geography), a.area, entity_home_place('artwork', a.id)
  FROM artworks a WHERE a.location IS NOT NULL OR a.area IS NOT NULL
  UNION ALL
  SELECT 'event', v.id, coalesce(v.location, ST_PointOnSurface(v.area::geometry)::geography, g.marker), v.area, v.place_id
  FROM events v LEFT JOIN place_geo g ON g.id = v.place_id
  WHERE v.location IS NOT NULL OR v.area IS NOT NULL OR g.marker IS NOT NULL;
