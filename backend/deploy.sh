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
  # Unit tests, then the admin panel in a real browser against their own databases and servers (two workers side by side: arthistory_test :3006, arthistory_test_1 :3008).
  # The whole output goes to logs/deploy-<time>.log (the newest 20 kept), so a failure can be looked up afterwards.
  # E2E_RETRIES=1: a test that fails once and then passes is "flaky" — listed, but the deploy goes on; one that fails
  # twice stops it (2026-10-27: two failures that five full runs could not reproduce had blocked deploys).
  LOG_DIR=../logs; mkdir -p "$LOG_DIR"; LOG="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
  ls -1t "$LOG_DIR"/deploy-*.log 2>/dev/null | tail -n +21 | xargs -r rm --
  echo "  tests … (output: $LOG)"
  if ! { npm test --silent && E2E_RETRIES=1 npm run --silent test:e2e; } > "$LOG" 2>&1; then
    echo "✗ tests failed — production was not touched (still running $PREVIOUS)."
    grep -E "✘|^# fail|^not ok|[0-9]+ failed" "$LOG" | sort -u | head -20
    echo "  Full output: $LOG"
    echo "  The checkout is now at $(git rev-parse --short HEAD); fix and deploy again, or go back: git checkout $PREVIOUS"
    exit 1
  fi
  if grep -qE "^ +[0-9]+ flaky" "$LOG"; then
    echo "! flaky (failed once, passed on retry) — please look at them:"
    sed -n '/^ *[0-9]* flaky/,/^ *[0-9]* passed/p' "$LOG" | grep "›" | head -20
  fi
  grep -E "^ +[0-9]+ passed" "$LOG" | tail -1
else
  echo "! --skip-tests: deploying without tests"
fi

npm run build:admin                  # src/admin/editor → src/admin/static/*.js, *.css (not in git)
npm run migrate
# No YAML import since Phase 5: the database is the source of truth (admin panel). `npm run export` for snapshots.
pm2 reload ecosystem.config.js --update-env
pm2 save >/dev/null
# the reloaded process may need a few seconds before it listens (2026-10-21: probed 2 s after the reload → refused)
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  curl -fsS http://127.0.0.1:3004/v1/health -H 'Host: api.arthistory.piogino.ch' >/dev/null 2>&1 && break
done
curl -fsS http://127.0.0.1:3004/v1/health -H 'Host: api.arthistory.piogino.ch' && echo "  ✓ deployed $(git log -1 --format='%h %s')"
