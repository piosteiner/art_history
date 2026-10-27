-- 138 — The project's numbers in one place (owner's roadmap, 2026-10-27): how many entries of each kind, provenance
-- steps, citations, images, migrations, tests, words of the documentation — today and day by day, so the documentation
-- needn't carry numbers that age (it links to the site's statistics page instead).
--   site_stats: one value per metric and day; today's row is rewritten until the day is over (src/stats.js, hourly).
--   site_stats_counts(): the numbers the database knows (tests and the documentation's words are counted by the app).
--   record_site_stats(): today's values written.
-- Backfill: entries day by day from their created_at (rows that exist — what was deleted since isn't counted back),
-- migrations from schema_migrations.applied_at. Tests come from git history (scripts/backfill-stats.js).
CREATE TABLE site_stats (
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)?$'),
  day    date NOT NULL,
  value  numeric NOT NULL,
  PRIMARY KEY (metric, day)
);
COMMENT ON TABLE site_stats IS 'The project''s numbers day by day (138): entries per kind, provenance steps, citations, migrations, tests … — /v1/stats';

GRANT SELECT ON site_stats TO arthistory_api;
GRANT SELECT, INSERT, UPDATE ON site_stats TO arthistory_admin;

-- SECURITY DEFINER: schema_migrations is the owner's; the function reads nothing else of it than its size
CREATE FUNCTION site_stats_counts() RETURNS TABLE (metric text, value bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT 'entries.artworks', count(*) FROM artworks
  UNION ALL SELECT 'entries.artists', count(*) FROM artists
  UNION ALL SELECT 'entries.people', count(*) FROM people
  UNION ALL SELECT 'entries.institutions', count(*) FROM institutions
  UNION ALL SELECT 'entries.places', count(*) FROM places
  UNION ALL SELECT 'entries.movements', count(*) FROM movements
  UNION ALL SELECT 'entries.events', count(*) FROM events
  UNION ALL SELECT 'entries.polities', count(*) FROM polities
  UNION ALL SELECT 'entries.glossary', count(*) FROM glossary
  UNION ALL SELECT 'entries.bibliography', count(*) FROM bibliography
  UNION ALL SELECT 'content.provenance', count(*) FROM provenance
  UNION ALL SELECT 'content.relationships', count(*) FROM relationships
  UNION ALL SELECT 'content.citations', count(*) FROM citations
  UNION ALL SELECT 'content.images', count(*) FROM images
  UNION ALL SELECT 'project.relationship_types', count(*) FROM relationship_types
  UNION ALL SELECT 'project.migrations', count(*) FROM schema_migrations
$$;

CREATE FUNCTION record_site_stats() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (SELECT * FROM site_stats_counts()),
  t AS (SELECT 'entries.total' AS metric, sum(value)::bigint AS value FROM c WHERE metric LIKE 'entries.%'),
  w AS (
    INSERT INTO site_stats (metric, day, value)
    SELECT metric, current_date, value FROM c UNION ALL SELECT metric, current_date, value FROM t
    ON CONFLICT (metric, day) DO UPDATE SET value = EXCLUDED.value
    RETURNING 1)
  SELECT count(*)::integer FROM w
$$;
GRANT EXECUTE ON FUNCTION record_site_stats() TO arthistory_admin;

-- the past: per day from the first entry until yesterday, the rows created by then
DO $$
DECLARE
  m record;
  first date;
BEGIN
  FOR m IN SELECT * FROM (VALUES
      ('entries.artworks', 'artworks'), ('entries.artists', 'artists'), ('entries.people', 'people'),
      ('entries.institutions', 'institutions'), ('entries.places', 'places'), ('entries.movements', 'movements'),
      ('entries.events', 'events'), ('entries.polities', 'polities'), ('entries.glossary', 'glossary'),
      ('entries.bibliography', 'bibliography'), ('content.provenance', 'provenance'),
      ('content.relationships', 'relationships'), ('content.citations', 'citations'), ('content.images', 'images')) v(metric, tbl)
  LOOP
    EXECUTE format('SELECT min(created_at)::date FROM %I', m.tbl) INTO first;
    CONTINUE WHEN first IS NULL;
    EXECUTE format($q$
      INSERT INTO site_stats (metric, day, value)
      SELECT %L, d::date, (SELECT count(*) FROM %I x WHERE x.created_at < d + interval '1 day')
      FROM generate_series(%L::date, current_date - 1, interval '1 day') d
      ON CONFLICT DO NOTHING$q$, m.metric, m.tbl, first);
  END LOOP;
END $$;

INSERT INTO site_stats (metric, day, value)
SELECT 'project.migrations', d::date, (SELECT count(*) FROM schema_migrations s WHERE s.applied_at < d + interval '1 day')
FROM generate_series((SELECT min(applied_at)::date FROM schema_migrations), current_date - 1, interval '1 day') d
ON CONFLICT DO NOTHING;

INSERT INTO site_stats (metric, day, value)
SELECT 'entries.total', day, sum(value) FROM site_stats WHERE metric LIKE 'entries.%' AND day < current_date GROUP BY day
ON CONFLICT DO NOTHING;

SELECT record_site_stats();
