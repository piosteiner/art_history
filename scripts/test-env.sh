#!/bin/bash
# The test environment for visitors (owner 2026-10-31): the same CMS and site as production, on their own hosts —
#   https://test.arthistory.piogino.ch        the site, built with VITE_API_BASE / VITE_TEST_ENV (frontend/)
#   https://admin.test.arthistory.piogino.ch  the CMS, one shared login "test"
#   https://api.test.arthistory.piogino.ch    the API
# pm2 process arthistory-test (backend/ecosystem.test.config.js, :3010) on its own PostgreSQL cluster 18/test
# (:5433, own roles and passwords — it cannot reach production's database). Secrets: ~/.config/arthistory/test.env.
#
#   scripts/test-env.sh              reset: production's data copied over (private tables emptied), the login set,
#                                    the process restarted, the site rebuilt — nightly by arthistory-test-reset.timer
#   scripts/test-env.sh --site-only  rebuild the site only (deploy.sh, after a change of the frontend)
set -euo pipefail
ROOT=/var/www/arthistory
ENV_FILE="$HOME/.config/arthistory/test.env"
SITE=/var/www/arthistory-test/site
PORT=5433

build_site() {
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci --no-fund --no-audit >/dev/null
  rm -rf "$SITE.new"
  VITE_API_BASE=https://api.test.arthistory.piogino.ch/v1 VITE_SITE=https://test.arthistory.piogino.ch VITE_TEST_ENV=1 \
    npx vite build --logLevel warn --outDir "$SITE.new" --emptyOutDir
  rm -rf "$SITE.old"; [ -d "$SITE" ] && mv "$SITE" "$SITE.old"
  mv "$SITE.new" "$SITE"; rm -rf "$SITE.old"
  echo "  ✓ test site built ($(git -C "$ROOT" log -1 --format=%h))"
}

if [ "${1:-}" = "--site-only" ]; then build_site; exit 0; fi

# 1. production → a dump (as the nightly backup takes it: without the extensions, created here first)
DUMP=$(mktemp "${TMPDIR:-/tmp}/arthistory-test.XXXXXX.dump")
trap 'rm -f "$DUMP"' EXIT
pg_dump -h localhost -p 5432 -U arthistory_owner --exclude-extension='*' -Fc arthistory > "$DUMP"

# 2. a fresh database in the test cluster (its process stopped meanwhile: no connections)
pm2 stop arthistory-test >/dev/null 2>&1 || true
sudo -u postgres psql -p $PORT -q -v ON_ERROR_STOP=1 <<'SQL'
DROP DATABASE IF EXISTS arthistory WITH (FORCE);
CREATE DATABASE arthistory OWNER arthistory_owner;
\c arthistory
CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; CREATE EXTENSION unaccent; CREATE EXTENSION btree_gist;
CREATE EXTENSION fuzzystrmatch; CREATE EXTENSION pg_stat_statements;
SQL
sudo -u postgres pg_restore -p $PORT -d arthistory --exit-on-error < "$DUMP"

# 3. what isn't for visitors: logins and sessions, the owner's drafts and working copies, visitors' feedback, the
#    download log, editing scopes. Production's accounts stay (the history names them) but can't log in here.
sudo -u postgres psql -p $PORT -d arthistory -q -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE admin_sessions, admin_drafts, page_drafts, form_drafts, live_docs, page_downloads, feedback, editor_scopes;
UPDATE admin_users SET password_hash = '!locked';
SQL

# 4. the shared login, then the process and the site
cd "$ROOT/backend"
grep '^TEST_LOGIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | ENV_FILE="$ENV_FILE" DB_PORT=$PORT node scripts/admin-user.js test >/dev/null
pm2 startOrReload ecosystem.test.config.js --update-env >/dev/null
pm2 save >/dev/null
build_site
echo "  ✓ test environment reset to production ($(date -u +%FT%TZ))"
