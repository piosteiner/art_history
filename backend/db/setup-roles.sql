-- Cluster-wide roles for the art history project (no passwords here — see setup.sh).
--   arthistory_owner : owns the schema, runs migrations (DDL). Not used by the running app.
--   arthistory_admin : admin panel — read/write on content, no DDL.
--   arthistory_api   : public API — read-only, short statement timeout.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arthistory_owner') THEN CREATE ROLE arthistory_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arthistory_admin') THEN CREATE ROLE arthistory_admin LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arthistory_api')   THEN CREATE ROLE arthistory_api   LOGIN; END IF;
END $$;

ALTER ROLE arthistory_owner NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
ALTER ROLE arthistory_admin NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10;
ALTER ROLE arthistory_api   NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10;

-- Public API: a runaway query (e.g. deep recursive CTE) is cut off; writes are refused even if a grant slips.
ALTER ROLE arthistory_api SET statement_timeout = '5s';
ALTER ROLE arthistory_api SET default_transaction_read_only = on;
ALTER ROLE arthistory_admin SET statement_timeout = '30s';
