#!/bin/bash
# Deploy the backend from the current GitHub main branch.
# Usage: backend/deploy.sh
set -e
cd "$(dirname "$0")"
git pull --ff-only
# Dev dependencies stay installed: this checkout is also the dev environment (npm run dev / build:admin), and
# they are never loaded by the running app — pruning them broke the next local build (2026-09-30).
npm ci --no-fund --no-audit          # incl. dev deps: esbuild, CodeMirror, Leaflet for the admin bundles
npm run build:admin                  # src/admin/editor → src/admin/static/*.js, *.css (not in git)
npm run migrate
# No YAML import since Phase 5: the database is the source of truth (admin panel). `npm run export` for snapshots.
pm2 reload ecosystem.config.js --update-env
pm2 save >/dev/null
sleep 2
curl -fsS http://127.0.0.1:3004/v1/health -H 'Host: api.arthistory.piogino.ch' && echo "  ✓ deployed $(git log -1 --format='%h %s')"
