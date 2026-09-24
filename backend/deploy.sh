#!/bin/bash
# Deploy the backend from the current GitHub main branch.
# Usage: backend/deploy.sh
set -e
cd "$(dirname "$0")"
git pull --ff-only
npm ci --omit=dev --no-fund --no-audit
npm run migrate
npm run import        # content/ YAML → DB (idempotent; never prunes)
pm2 reload ecosystem.config.js --update-env
pm2 save >/dev/null
sleep 2
curl -fsS http://127.0.0.1:3004/v1/health -H 'Host: api.arthistory.piogino.ch' && echo "  ✓ deployed $(git log -1 --format='%h %s')"
