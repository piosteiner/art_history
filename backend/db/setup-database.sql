-- Per-database setup, run as superuser inside the target database (see setup.sh).

-- Only our roles may connect.
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO arthistory_owner;
GRANT CONNECT ON DATABASE :"db" TO arthistory_admin, arthistory_api;

-- Extensions need superuser, so they are created here rather than in migrations.
CREATE EXTENSION IF NOT EXISTS postgis;     -- geography types, ST_* functions, GiST
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name search (admin relation picker)
CREATE EXTENSION IF NOT EXISTS unaccent;    -- accent-insensitive search (Dürer = Durer)

-- Schema: owned by arthistory_owner (as database owner, via pg_database_owner in PG15+).
GRANT USAGE ON SCHEMA public TO arthistory_admin, arthistory_api;

-- Everything arthistory_owner creates later gets these grants automatically.
-- Skipped when restoring a dump (scripts/restore.sh sets -v restore=1): the dump brings its own default privileges,
-- applied after its tables exist, so a table whose grants were revoked (schema_migrations) stays revoked.
\if :{?restore}
\else
ALTER DEFAULT PRIVILEGES FOR ROLE arthistory_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO arthistory_api;
ALTER DEFAULT PRIVILEGES FOR ROLE arthistory_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arthistory_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE arthistory_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO arthistory_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE arthistory_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO arthistory_admin, arthistory_api;
\endif
