#!/bin/bash
# Deploy the backend from the current GitHub main branch.
# Usage: backend/deploy.sh [--skip-tests]
#
# Order matters: nothing that production uses changes until the tests have passed. The running app has its code in
# memory; production's database, admin bundles (src/admin/static/) and process are only touched after the tests.
set -e
cd "$(dirname "$0")"
PREVIOUS=$(git rev-parse --short HEAD)
git pull --ff-only
# Dev dependencies stay installed: this checkout is also the dev environment (npm run dev / build:admin), and
# they are never loaded by the running app — pruning them broke the next local build (2026-09-30).
npm ci --no-fund --no-audit          # incl. dev deps: esbuild, CodeMirror, Leaflet, Playwright

if [ "$1" != "--skip-tests" ]; then
  # Unit tests, then the admin panel in a real browser against its own database (arthistory_test) and server (:3006).
  if ! npm test --silent || ! npm run --silent test:e2e; then
    echo "✗ tests failed — production was not touched (still running $PREVIOUS)."
    echo "  The checkout is now at $(git rev-parse --short HEAD); fix and deploy again, or go back: git checkout $PREVIOUS"
    exit 1
  fi
else
  echo "! --skip-tests: deploying without tests"
fi

npm run build:admin                  # src/admin/editor → src/admin/static/*.js, *.css (not in git)
npm run migrate
# No YAML import since Phase 5: the database is the source of truth (admin panel). `npm run export` for snapshots.
pm2 reload ecosystem.config.js --update-env
pm2 save >/dev/null
sleep 2
curl -fsS http://127.0.0.1:3004/v1/health -H 'Host: api.arthistory.piogino.ch' && echo "  ✓ deployed $(git log -1 --format='%h %s')"
