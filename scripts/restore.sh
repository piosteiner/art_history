#!/bin/bash
# Restore a backup into a NEW database (never over an existing one).
#   scripts/restore.sh ~/backups/arthistory/arthistory-2026-09-28.sql.gz arthistory_restored
#   scripts/restore.sh ~/backups/arthistory-offsite/arthistory.sql.gz.gpg.00 arthistory_restored   # encrypted off-site copy (parts)
# The database is prepared like db/setup.sh does (extensions, database/schema grants), then the dump is loaded as
# arthistory_owner in one transaction. The reference images (private_images, since 2026-11-07 a file of their own)
# are loaded after it when their file lies beside the dump: arthistory-private-images-<date>.sql.gz next to
# arthistory-<date>.sql.gz, private-images.sql.gz.gpg.00 next to arthistory.sql.gz.gpg.00. Dumps from before that
# day hold the images themselves. Prints row counts per table. Needs sudo (createdb as postgres).
# To make a restored database the live one, see server-docs/README.md → Backups.
set -euo pipefail
FILE="${1:?usage: restore.sh <dump .sql.gz | .sql.gz.gpg.00> <new database name>}"
DB="${2:?usage: restore.sh <dump .sql.gz | .sql.gz.gpg.00> <new database name>}"
PASSPHRASE_FILE="$HOME/.config/arthistory/backup-passphrase"
SETUP_SQL="$(dirname "$0")/../backend/db/setup-database.sql"

psql_su() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }

[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "bad database name: $DB"; exit 1; }
if psql_su -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1; then
  echo "database $DB already exists — pick a new name (restore never overwrites)"; exit 1
fi

decode() {   # $1: a file — .sql.gz, .sql.gz.gpg, or the first part .sql.gz.gpg.00 of a cut one
  case "$1" in
    *.gpg.00) cat "${1%.00}".?? | gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt | gunzip ;;
    *.gpg)    gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$1" | gunzip ;;
    *.gz)     gunzip -c "$1" ;;
    *)        cat "$1" ;;
  esac
}
# the images file beside the dump, if any
images_of() {
  local dir; dir="$(dirname "$1")"
  case "$(basename "$1")" in
    arthistory-*.sql.gz) local f="$dir/arthistory-private-images-${1##*/arthistory-}"; [ -f "$f" ] && echo "$f" ;;
    arthistory.sql.gz.gpg.00) [ -f "$dir/private-images.sql.gz.gpg.00" ] && echo "$dir/private-images.sql.gz.gpg.00" ;;
  esac
  return 0
}

psql_su -c "CREATE DATABASE \"$DB\" OWNER arthistory_owner ENCODING 'UTF8' TEMPLATE template0"
psql_su -d "$DB" -v db="$DB" -v restore=1 -f "$SETUP_SQL"
decode "$FILE" | psql -X -q -h localhost -U arthistory_owner -d "$DB" -1 -v ON_ERROR_STOP=1 -f - > /dev/null
IMAGES="$(images_of "$FILE")"
if [ -n "$IMAGES" ]; then
  decode "$IMAGES" | psql -X -q -h localhost -U arthistory_owner -d "$DB" -1 -v ON_ERROR_STOP=1 -f - > /dev/null
  echo "images: loaded from $IMAGES"
fi

# Row count of every table, without listing them by hand: query_to_xml runs a query built per row.
psql -X -h localhost -U arthistory_owner -d "$DB" -Atc "
  SELECT table_name || ' ' || (xpath('/row/n/text()',
           query_to_xml(format('SELECT count(*) AS n FROM %I', table_name), false, true, '')))[1]
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'
  ORDER BY table_name"
echo "✓ restored into $DB"
