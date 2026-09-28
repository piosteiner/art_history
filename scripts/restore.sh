#!/bin/bash
# Restore a backup into a NEW database (never over an existing one).
#   scripts/restore.sh ~/backups/arthistory/arthistory-2026-09-28.sql.gz arthistory_restored
#   scripts/restore.sh ~/backups/arthistory-offsite/arthistory.sql.gz.gpg arthistory_restored   # encrypted off-site copy
# The database is prepared like db/setup.sh does (extensions, database/schema grants), then the dump is loaded as
# arthistory_owner in one transaction. Prints row counts per table. Needs sudo (createdb as postgres).
# To make a restored database the live one, see server-docs/README.md → Backups.
set -euo pipefail
FILE="${1:?usage: restore.sh <dump .sql.gz[.gpg]> <new database name>}"
DB="${2:?usage: restore.sh <dump .sql.gz[.gpg]> <new database name>}"
PASSPHRASE_FILE="$HOME/.config/arthistory/backup-passphrase"
SETUP_SQL="$(dirname "$0")/../backend/db/setup-database.sql"

psql_su() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }

[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "bad database name: $DB"; exit 1; }
if psql_su -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1; then
  echo "database $DB already exists — pick a new name (restore never overwrites)"; exit 1
fi

decode() {
  case "$FILE" in
    *.gpg) gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$FILE" | gunzip ;;
    *.gz)  gunzip -c "$FILE" ;;
    *)     cat "$FILE" ;;
  esac
}

psql_su -c "CREATE DATABASE \"$DB\" OWNER arthistory_owner ENCODING 'UTF8' TEMPLATE template0"
psql_su -d "$DB" -v db="$DB" -v restore=1 -f "$SETUP_SQL"
decode | psql -X -q -h localhost -U arthistory_owner -d "$DB" -1 -v ON_ERROR_STOP=1 -f - > /dev/null

# Row count of every table, without listing them by hand: query_to_xml runs a query built per row.
psql -X -h localhost -U arthistory_owner -d "$DB" -Atc "
  SELECT table_name || ' ' || (xpath('/row/n/text()',
           query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'
  ORDER BY table_name"
echo "✓ restored into $DB"
