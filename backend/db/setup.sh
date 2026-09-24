#!/bin/bash
# One-time (idempotent) database setup. Run as ubuntu with sudo rights:
#   backend/db/setup.sh arthistory        # production
#   backend/db/setup.sh arthistory_dev    # development
# Creates roles + database + extensions + privileges. Passwords are generated
# into ~/.config/arthistory/backend.env (outside the repo) if missing, and sent
# to Postgres via stdin only. To rotate a password: delete its line, rerun.
set -euo pipefail
DB="${1:?usage: setup.sh <database name>}"
ENV_FILE="$HOME/.config/arthistory/backend.env"
install -d -m 700 "$(dirname "$ENV_FILE")"; touch "$ENV_FILE"; chmod 600 "$ENV_FILE"

for key in DB_OWNER_PASSWORD DB_ADMIN_PASSWORD DB_API_PASSWORD; do
  grep -q "^$key=" "$ENV_FILE" || echo "$key=$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 40)" >> "$ENV_FILE"
done
get() { grep "^$1=" "$ENV_FILE" | cut -d= -f2-; }

psql_su() { sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Roles (cluster-wide) — created without passwords, then passwords via stdin
psql_su -f "$(dirname "$0")/setup-roles.sql"
psql_su <<SQL
ALTER ROLE arthistory_owner PASSWORD '$(get DB_OWNER_PASSWORD)';
ALTER ROLE arthistory_admin PASSWORD '$(get DB_ADMIN_PASSWORD)';
ALTER ROLE arthistory_api   PASSWORD '$(get DB_API_PASSWORD)';
SQL

# Database
psql_su -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 \
  || psql_su -c "CREATE DATABASE \"$DB\" OWNER arthistory_owner ENCODING 'UTF8' TEMPLATE template0"
psql_su -d "$DB" -v db="$DB" -f "$(dirname "$0")/setup-database.sql"

# ~/.pgpass so `psql -h localhost -U arthistory_owner <db>` works without typing passwords
PGPASS="$HOME/.pgpass"; touch "$PGPASS"; chmod 600 "$PGPASS"
sed -i '/:arthistory_\(owner\|admin\|api\):/d' "$PGPASS"
for r in owner admin api; do
  echo "localhost:5432:*:arthistory_$r:$(get "DB_$(echo $r | tr a-z A-Z)_PASSWORD")" >> "$PGPASS"
done
echo "✓ database '$DB' ready"
