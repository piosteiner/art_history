-- Scale test data for backend/perf (database scale_test ONLY — make-scale-db.sh runs it): each entry cloned K times, with
-- new names / titles combined from today's words (so clones are not near-duplicates of their originals), wired to the same clone of whatever they point at.
\set ON_ERROR_STOP on
SELECT current_database() = 'scale_test' AS ok \gset
\if :ok
\else
  \echo 'not scale_test — refusing'
  \quit
\endif
SET session_replication_role = replica;   -- no triggers while copying (audit, quality NOTIFY, name splitting)

-- word pools
CREATE TEMP TABLE given AS SELECT DISTINCT given_name AS w FROM (SELECT given_name FROM people UNION SELECT given_name FROM artists) x WHERE given_name ~ '^[A-Z]';
CREATE TEMP TABLE family AS SELECT DISTINCT family_name AS w FROM (SELECT family_name FROM people UNION SELECT family_name FROM artists) x WHERE family_name ~ '^[A-Z]';
CREATE TEMP TABLE tword AS SELECT DISTINCT w FROM artworks, regexp_split_to_table(title, '\s+') w WHERE length(w) > 3;
CREATE TEMP TABLE iword AS SELECT DISTINCT w FROM institutions, regexp_split_to_table(name, '\s+') w WHERE length(w) > 3;
CREATE TEMP TABLE pword AS SELECT DISTINCT w FROM places, regexp_split_to_table(name, '\s+') w WHERE length(w) > 3;
CREATE FUNCTION pg_temp.pick(t text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE format('SELECT w FROM %I OFFSET floor(random() * (SELECT count(*) FROM %I)) LIMIT 1', t, t) INTO r; RETURN r; END $$;

-- clone a table's base rows K times; overrides: column → SQL expression over the source row "s" and the copy number "k"
CREATE FUNCTION pg_temp.clone(t text, k int, overrides jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cols text; sel text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg(coalesce(overrides ->> column_name, 's.' || quote_ident(column_name)), ', ' ORDER BY ordinal_position)
    INTO cols, sel
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = t AND is_generated = 'NEVER' AND identity_generation IS NULL
    AND column_name NOT IN ('public_id', 'created_at', 'updated_at');
  EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I s WHERE s.slug !~ ''-s[0-9]+$''', t, cols, replace(sel, '$k', k::text), t);
END $$;

CREATE TEMP TABLE ks AS SELECT generate_series(1, :K) AS k;

DO $$
DECLARE k int;
BEGIN
  FOR k IN SELECT ks.k FROM ks LOOP
    PERFORM pg_temp.clone('places', k, jsonb_build_object(
      'slug', 's.slug || ''-s$k''', 'name', 'pg_temp.pick(''pword'') || '' '' || pg_temp.pick(''pword'')', 'wikidata_id', 'NULL', 'boundary_code', 'NULL',
      'names', '''[]''::jsonb', 'location', 'ST_SetSRID(ST_MakePoint(coalesce(ST_X(coalesce(s.location, (SELECT g.marker FROM place_geo g WHERE g.id = s.id))::geometry), 0) + random() * 4 - 2, coalesce(ST_Y(coalesce(s.location, (SELECT g.marker FROM place_geo g WHERE g.id = s.id))::geometry), 0) + random() * 4 - 2), 4326)::geography',
      'area', 'NULL'));
    PERFORM pg_temp.clone('artists', k, jsonb_build_object(
      'slug', 's.slug || ''-s$k''', 'name', 'pg_temp.pick(''given'') || '' '' || pg_temp.pick(''family'')', 'wikidata_id', 'NULL', 'names', '''[]''::jsonb',
      'given_name', 'NULL', 'family_name', 'NULL', 'sort_name', 'NULL', 'name_ruby', 'NULL'));
    PERFORM pg_temp.clone('people', k, jsonb_build_object(
      'slug', 's.slug || ''-s$k''', 'name', 'pg_temp.pick(''given'') || '' '' || pg_temp.pick(''family'')', 'wikidata_id', 'NULL', 'names', '''[]''::jsonb',
      'given_name', 'NULL', 'family_name', 'NULL', 'sort_name', 'NULL', 'name_ruby', 'NULL'));
    PERFORM pg_temp.clone('institutions', k, jsonb_build_object(
      'slug', 's.slug || ''-s$k''', 'name', 'pg_temp.pick(''iword'') || '' '' || pg_temp.pick(''iword'') || '' '' || pg_temp.pick(''iword'')', 'wikidata_id', 'NULL',
      'names', '''[]''::jsonb', 'name_ruby', 'NULL'));
    PERFORM pg_temp.clone('artworks', k, jsonb_build_object(
      'slug', 's.slug || ''-s$k''', 'title', 'pg_temp.pick(''tword'') || '' '' || pg_temp.pick(''tword'') || '' '' || pg_temp.pick(''tword'')', 'wikidata_id', 'NULL',
      'names', '''[]''::jsonb', 'title_ruby', 'NULL', 'inventory_number', 'CASE WHEN s.inventory_number IS NOT NULL THEN s.inventory_number || ''-s$k'' END'));
  END LOOP;
END $$;

-- the clones point at the matching clone (same copy number); slug suffix → k
CREATE FUNCTION pg_temp.twin(t text, src bigint, k int) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE r bigint; BEGIN
  IF src IS NULL THEN RETURN NULL; END IF;
  EXECUTE format('SELECT c.id FROM %I o JOIN %I c ON c.slug = o.slug || ''-s'' || $2 WHERE o.id = $1', t, t) INTO r USING src, k;
  RETURN r; END $$;
CREATE TEMP TABLE twins AS
  SELECT t, o.id AS old_id, c.id AS new_id, substring(c.slug FROM '-s([0-9]+)$')::int AS k
  FROM (SELECT 'artworks' AS t, id, slug FROM artworks UNION ALL SELECT 'artists', id, slug FROM artists UNION ALL SELECT 'people', id, slug FROM people
        UNION ALL SELECT 'institutions', id, slug FROM institutions UNION ALL SELECT 'places', id, slug FROM places) c(t, id, slug)
  JOIN LATERAL (SELECT id FROM (SELECT 'artworks' AS t2, id, slug FROM artworks UNION ALL SELECT 'artists', id, slug FROM artists UNION ALL SELECT 'people', id, slug FROM people
        UNION ALL SELECT 'institutions', id, slug FROM institutions UNION ALL SELECT 'places', id, slug FROM places) o WHERE o.t2 = c.t AND o.slug = regexp_replace(c.slug, '-s[0-9]+$', '')) o ON true
  WHERE c.slug ~ '-s[0-9]+$';
CREATE INDEX ON twins (t, old_id, k);
CREATE FUNCTION pg_temp.tw(t text, src bigint, k int) RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT new_id FROM twins WHERE twins.t = $1 AND old_id = $2 AND twins.k = $3 $$;

UPDATE artworks c SET creator_id = pg_temp.tw('artists', o.creator_id, x.k), current_institution_id = pg_temp.tw('institutions', o.current_institution_id, x.k),
       parent_id = pg_temp.tw('artworks', o.parent_id, x.k)
  FROM twins x JOIN artworks o ON o.id = x.old_id WHERE x.t = 'artworks' AND c.id = x.new_id;
UPDATE institutions c SET place_id = pg_temp.tw('places', o.place_id, x.k) FROM twins x JOIN institutions o ON o.id = x.old_id WHERE x.t = 'institutions' AND c.id = x.new_id;
UPDATE places c SET parent_id = coalesce(pg_temp.tw('places', o.parent_id, x.k), o.parent_id) FROM twins x JOIN places o ON o.id = x.old_id WHERE x.t = 'places' AND c.id = x.new_id;

-- relationships between clones of the same copy
CREATE FUNCTION pg_temp.tbl(e entity_type) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE e WHEN 'artwork' THEN 'artworks' WHEN 'artist' THEN 'artists' WHEN 'person' THEN 'people' WHEN 'institution' THEN 'institutions' WHEN 'place' THEN 'places' END $$;
INSERT INTO relationships (subject_type, subject_id, relationship_type, object_type, object_id, period, period_label, label, certainty, notes_md, metadata)
  SELECT r.subject_type, coalesce(pg_temp.tw(pg_temp.tbl(r.subject_type), r.subject_id, ks.k), r.subject_id), r.relationship_type, r.object_type,
         coalesce(pg_temp.tw(pg_temp.tbl(r.object_type), r.object_id, ks.k), r.object_id), r.period, r.period_label, r.label, r.certainty, r.notes_md, r.metadata
  FROM relationships r, ks
  WHERE pg_temp.tw(pg_temp.tbl(r.subject_type), r.subject_id, ks.k) IS NOT NULL
ON CONFLICT DO NOTHING;

-- provenance with its parts
CREATE TEMP TABLE prov_twins (old_id bigint, k int, new_id bigint);
DO $$
DECLARE p record; k int; nid bigint;
BEGIN
  FOR p IN SELECT * FROM provenance WHERE artwork_id IN (SELECT old_id FROM twins WHERE t = 'artworks') ORDER BY id LOOP
    FOR k IN SELECT ks.k FROM ks LOOP
      INSERT INTO provenance (artwork_id, position, owner_artist_id, owner_person_id, owner_institution_id, owner_place_id, owner_label, acquired, acquired_label,
        ended, ended_label, method, direct, location_id, label, certainty, notes_md, metadata, role, price, price_currency, price_note, not_sold, event_id,
        exchanged_for_text, check_after)
      VALUES (pg_temp.tw('artworks', p.artwork_id, k), p.position, pg_temp.tw('artists', p.owner_artist_id, k), pg_temp.tw('people', p.owner_person_id, k),
        pg_temp.tw('institutions', p.owner_institution_id, k), pg_temp.tw('places', p.owner_place_id, k), p.owner_label, p.acquired, p.acquired_label,
        p.ended, p.ended_label, p.method, p.direct, pg_temp.tw('places', p.location_id, k), p.label, p.certainty, p.notes_md, p.metadata, p.role, p.price,
        p.price_currency, p.price_note, p.not_sold, p.event_id, p.exchanged_for_text, p.check_after)
      RETURNING id INTO nid;
      INSERT INTO prov_twins VALUES (p.id, k, nid);
    END LOOP;
  END LOOP;
END $$;
UPDATE provenance c SET alternative_to = t2.new_id FROM prov_twins t1 JOIN provenance o ON o.id = t1.old_id JOIN prov_twins t2 ON t2.old_id = o.alternative_to AND t2.k = t1.k
  WHERE c.id = t1.new_id;
INSERT INTO provenance_records (provenance_id, position, kind, date, date_label, place_id, room, number, number_certainty, document, certainty, note)
  SELECT t.new_id, r.position, r.kind, r.date, r.date_label, coalesce(pg_temp.tw('places', r.place_id, t.k), r.place_id), r.room, r.number, r.number_certainty, r.document, r.certainty, r.note
  FROM provenance_records r JOIN prov_twins t ON t.old_id = r.provenance_id;
INSERT INTO provenance_places (provenance_id, position, place_id, period, period_label, label)
  SELECT t.new_id, x.position, coalesce(pg_temp.tw('places', x.place_id, t.k), x.place_id), x.period, x.period_label, x.label FROM provenance_places x JOIN prov_twins t ON t.old_id = x.provenance_id;
INSERT INTO provenance_numbers (provenance_id, kind, number, label, position)
  SELECT t.new_id, x.kind, x.number || '-s' || t.k, x.label, x.position FROM provenance_numbers x JOIN prov_twins t ON t.old_id = x.provenance_id;
INSERT INTO provenance_co_owners (provenance_id, position, owner_artist_id, owner_person_id, owner_institution_id)
  SELECT t.new_id, x.position, pg_temp.tw('artists', x.owner_artist_id, t.k), pg_temp.tw('people', x.owner_person_id, t.k), pg_temp.tw('institutions', x.owner_institution_id, t.k)
  FROM provenance_co_owners x JOIN prov_twins t ON t.old_id = x.provenance_id;

-- citations of fields (for the quality checks that weigh sources) and images (lists show the first)
INSERT INTO citations (entity_type, entity_id, field, source_id, wikidata_item, wikidata_property, locator, note, accessed, cited_value, text, url)
  SELECT c.entity_type, x.new_id, c.field, c.source_id, c.wikidata_item, c.wikidata_property, c.locator, c.note, c.accessed, c.cited_value, c.text, c.url
  FROM citations c JOIN twins x ON x.t = pg_temp.tbl(c.entity_type) AND x.old_id = c.entity_id WHERE c.entity_id IS NOT NULL;
INSERT INTO citations (provenance_id, source_id, wikidata_item, locator, note, accessed, text, url)
  SELECT t.new_id, c.source_id, c.wikidata_item, c.locator, c.note, c.accessed, c.text, c.url FROM citations c JOIN prov_twins t ON t.old_id = c.provenance_id;
INSERT INTO images (artwork_id, artist_id, institution_id, person_id, position, url, source_url, license, credit, caption)
  SELECT pg_temp.tw('artworks', i.artwork_id, ks.k), pg_temp.tw('artists', i.artist_id, ks.k), pg_temp.tw('institutions', i.institution_id, ks.k), pg_temp.tw('people', i.person_id, ks.k),
         i.position, i.url, i.source_url, i.license, i.credit, i.caption
  FROM images i, ks WHERE coalesce(i.artwork_id, i.artist_id, i.institution_id, i.person_id) IS NOT NULL
    AND num_nonnulls(pg_temp.tw('artworks', i.artwork_id, ks.k), pg_temp.tw('artists', i.artist_id, ks.k), pg_temp.tw('institutions', i.institution_id, ks.k), pg_temp.tw('people', i.person_id, ks.k)) = 1;

SET session_replication_role = origin;
-- what the triggers would have done: split new names, link terms
UPDATE people SET name = name WHERE slug ~ '-s[0-9]+$';
UPDATE artists SET name = name WHERE slug ~ '-s[0-9]+$';
ANALYZE;
