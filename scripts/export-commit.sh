#!/bin/bash
# Nightly content snapshot (systemd: arthistory-export.timer). Manual run: scripts/export-commit.sh
# Exports the production database to content/ (YAML, backend/scripts/export.js) and, when anything changed, commits
# content/ alone and pushes — a readable public history of the content, beside the encrypted backups (backup.sh).
# Other uncommitted work in this checkout is left alone: only content/ is staged and committed, the rest is stashed
# for the pull and put back. The git hooks run as for every commit (secret scan). Docs: server-docs/README.md → Content snapshots.
set -euo pipefail
cd "$(dirname "$0")/.."

node backend/scripts/export.js
if [ -z "$(git status --porcelain -- content)" ]; then
  echo "export: content unchanged — nothing to commit"; exit 0
fi
git add -A -- content
git commit --quiet -m "Content snapshot $(date -u +%F) (nightly export)" -- content
git pull --rebase --autostash --quiet
git push --quiet origin HEAD
echo "✓ pushed $(git log -1 --format='%h %s') ($(git show --stat --format= HEAD | tail -1))"
